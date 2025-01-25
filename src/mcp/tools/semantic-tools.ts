/**
 * Semantic MCP Tools
 *
 * Tools for semantic search, entity grounding, and schema categorization.
 * These tools leverage the Semantic Knowledge Graph capabilities.
 */

import { z } from 'zod';
import type { McpTool } from './types.js';
import { validateArgs } from './types.js';
import { createSemanticSearchService } from '../../services/semantic/semantic-search-service.js';
import { createSemanticGraphExecutor } from '../../services/semantic/semantic-graph-executor.js';
import { createValueGroundingService } from '../../services/grounding/value-grounding-service.js';
import { createGroundingGraphExecutor } from '../../services/grounding/grounding-graph-executor.js';
import { createSoslExecutor, type SoslExecutor } from '../../services/grounding/salesforce-sosl-executor.js';
import { createHeuristicTagger } from '../../services/categorization/heuristic-tagger.js';
import { createCategorizationGraphExecutor } from '../../services/categorization/categorization-graph-executor.js';
import { conn } from '../../services/salesforce.js';

/**
 * Get the SOSL executor if Salesforce connection is available.
 */
function getSoslExecutorIfAvailable(): SoslExecutor | undefined {
  if (conn) {
    return createSoslExecutor(conn);
  }
  return undefined;
}

// === Tool Definitions ===

export const semanticTools: McpTool[] = [
  {
    name: 'semantic-search',
    description:
      'Search for Salesforce objects and fields using natural language. ' +
      'Uses semantic similarity to find schema elements that match your intent, ' +
      'even when exact names don\'t match.',
    requirements: { neo4j: true },
    schema: {
      query: z.string().describe('Natural language search query'),
      type: z.enum(['object', 'field', 'all']).optional().describe('Type of schema element to search'),
      objectContext: z.string().optional().describe('Object context for field searches'),
      topK: z.number().optional().describe('Maximum number of results (default: 5)'),
    },
    handler: async (args) => {
      const toolSchema = {
        query: z.string(),
        type: z.enum(['object', 'field', 'all']).default('all'),
        objectContext: z.string().optional(),
        topK: z.number().default(5),
      };
      const validated = validateArgs(args, toolSchema);
      if (!validated.success) return validated.error;
      const { query, type, objectContext, topK } = validated.data;

      try {
        // Create services
        const graphExecutor = createSemanticGraphExecutor();
        const searchService = createSemanticSearchService(graphExecutor);

        const results: {
          objects?: Array<{ apiName: string; label?: string; similarity: number; source: string }>;
          fields?: Array<{ apiName: string; sobjectType: string; label?: string; similarity: number; source: string }>;
        } = {};

        // Search objects
        if (type === 'object' || type === 'all') {
          const objectResults = await searchService.findObjects(query, { topK });
          results.objects = objectResults.map((r) => ({
            apiName: r.apiName,
            label: r.label,
            similarity: r.similarity,
            source: r.source,
          }));
        }

        // Search fields
        if (type === 'field' || type === 'all') {
          const fieldResults = await searchService.findFields(query, objectContext, { topK });
          results.fields = fieldResults.map((r) => ({
            apiName: r.apiName,
            sobjectType: r.sobjectType,
            label: r.label,
            similarity: r.similarity,
            source: r.source,
          }));
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              query,
              type,
              objectContext,
              ...results,
              totalResults: (results.objects?.length ?? 0) + (results.fields?.length ?? 0),
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              hint: 'Make sure Neo4j is running and the graph has been synced.',
            }, null, 2),
          }],
        };
      }
    },
  },
  {
    name: 'ground-entity',
    description:
      'Ground a value against org metadata and data. ' +
      'Determines if a value is a company name, picklist value, date reference, etc. ' +
      'Provides SOQL filter suggestions based on the grounding.',
    requirements: { neo4j: true },
    schema: {
      value: z.string().describe('Value to ground against org data'),
      targetObject: z.string().optional().describe('Target object context (e.g., "Account")'),
    },
    handler: async (args) => {
      const toolSchema = {
        value: z.string(),
        targetObject: z.string().optional(),
      };
      const validated = validateArgs(args, toolSchema);
      if (!validated.success) return validated.error;
      const { value, targetObject } = validated.data;

      try {
        // Create services (with SOSL fallback if Salesforce connection available)
        const graphExecutor = createGroundingGraphExecutor();
        const soslExecutor = getSoslExecutorIfAvailable();
        const groundingService = createValueGroundingService(graphExecutor, soslExecutor);

        // Ground the value with semantic search and SOSL fallback
        const grounded = await groundingService.groundValue(value, {
          targetObject,
          enableSemanticSearch: true,
          enableSoslFallback: !!soslExecutor, // Enable SOSL if connection available
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              value,
              targetObject,
              isGrounded: grounded.isGrounded,
              bestMatch: grounded.bestMatch ? {
                type: grounded.bestMatch.type,
                confidence: grounded.bestMatch.confidence,
                suggestedFilter: grounded.bestMatch.suggestedFilter,
                fields: grounded.bestMatch.fields,
                description: grounded.bestMatch.description,
              } : null,
              allMatches: grounded.groundedAs.slice(0, 5).map((r) => ({
                type: r.type,
                confidence: r.confidence,
                suggestedFilter: r.suggestedFilter,
              })),
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              hint: 'Make sure Neo4j is running and the graph has been synced.',
            }, null, 2),
          }],
        };
      }
    },
  },
  {
    name: 'get-schema-category',
    description:
      'Get the semantic category of a Salesforce object or field. ' +
      'Categories include: business_core, business_extended, system, custom_metadata, etc. ' +
      'Useful for understanding object/field purpose and avoiding anti-patterns.',
    requirements: { neo4j: true },
    schema: {
      apiName: z.string().describe('API name of the object or field'),
      type: z.enum(['object', 'field']).optional().describe('Type of schema element (default: object)'),
      sobjectType: z.string().optional().describe('Parent object for field categorization'),
    },
    handler: async (args) => {
      const toolSchema = {
        apiName: z.string(),
        type: z.enum(['object', 'field']).default('object'),
        sobjectType: z.string().optional(),
      };
      const validated = validateArgs(args, toolSchema);
      if (!validated.success) return validated.error;
      const { apiName, type, sobjectType } = validated.data;

      try {
        // Create services
        const graphExecutor = createCategorizationGraphExecutor();
        const tagger = createHeuristicTagger(graphExecutor);

        let result;
        if (type === 'object') {
          result = await tagger.categorizeObject(apiName);
        } else {
          if (!sobjectType) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  error: 'sobjectType is required for field categorization',
                }, null, 2),
              }],
            };
          }
          result = await tagger.categorizeField(apiName, sobjectType);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              apiName,
              type,
              sobjectType,
              primaryCategory: result.primaryCategory?.category ?? null,
              categories: result.categories.map((c) => ({
                category: c.category,
                confidence: c.confidence,
                rule: c.rule,
              })),
              isCoreBusinessObject: type === 'object' ? tagger.isCoreBusinessObject(apiName) : undefined,
              isDerivedObject: type === 'object' ? tagger.isDerivedObject(apiName) : undefined,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              hint: 'Make sure Neo4j is running and the graph has been synced.',
            }, null, 2),
          }],
        };
      }
    },
  },
  {
    name: 'detect-anti-patterns',
    description:
      'Detect potential anti-patterns in SOQL query construction. ' +
      'Warns when querying system objects for business data, ' +
      'or when using Custom Metadata Types instead of data objects.',
    requirements: { neo4j: true },
    schema: {
      objects: z.array(z.string()).describe('List of object API names from SOQL'),
      userIntent: z.string().describe('User\'s original query or intent'),
    },
    handler: async (args) => {
      const toolSchema = {
        objects: z.array(z.string()),
        userIntent: z.string(),
      };
      const validated = validateArgs(args, toolSchema);
      if (!validated.success) return validated.error;
      const { objects, userIntent } = validated.data;

      try {
        // Create services
        const graphExecutor = createCategorizationGraphExecutor();
        const tagger = createHeuristicTagger(graphExecutor);

        const warnings: Array<{
          object: string;
          category: string | null;
          warning: string;
          severity: 'high' | 'medium' | 'low';
        }> = [];

        // Check each object
        for (const objectApiName of objects) {
          const result = await tagger.categorizeObject(objectApiName);
          const primaryCategory = result.primaryCategory?.category;

          // Warn about system objects
          if (primaryCategory === 'system' || primaryCategory === 'system_derived') {
            warnings.push({
              object: objectApiName,
              category: primaryCategory,
              warning: `${objectApiName} is a system object. Querying it for business data may return unexpected results.`,
              severity: 'high',
            });
          }

          // Warn about custom metadata types
          if (primaryCategory === 'custom_metadata') {
            warnings.push({
              object: objectApiName,
              category: primaryCategory,
              warning: `${objectApiName} is a Custom Metadata Type. It stores configuration, not business data.`,
              severity: 'medium',
            });
          }

          // Warn about platform events
          if (primaryCategory === 'platform_event') {
            warnings.push({
              object: objectApiName,
              category: primaryCategory,
              warning: `${objectApiName} is a Platform Event. Events are not queryable like regular objects.`,
              severity: 'high',
            });
          }

          // Warn about derived objects (Feed, History, Share)
          if (tagger.isDerivedObject(objectApiName)) {
            warnings.push({
              object: objectApiName,
              category: 'system_derived',
              warning: `${objectApiName} is a derived object. Consider querying the parent object instead.`,
              severity: 'low',
            });
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              objects,
              userIntent,
              hasWarnings: warnings.length > 0,
              warningCount: warnings.length,
              warnings,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              hint: 'Make sure Neo4j is running and the graph has been synced.',
            }, null, 2),
          }],
        };
      }
    },
  },
];

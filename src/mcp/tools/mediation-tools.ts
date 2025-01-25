/**
 * Mediation Tools
 *
 * Tools for query intent mediation, entity resolution, and filter recommendations.
 * These tools help translate natural language into valid SOQL constructs.
 */

import { z } from 'zod';
import type { McpTool } from './types.js';
import { validateArgs } from './types.js';
import { extractPotentialEntities } from '../../services/schema-context/index.js';
import { createValueGroundingService } from '../../services/grounding/value-grounding-service.js';
import { createGroundingGraphExecutor } from '../../services/grounding/grounding-graph-executor.js';
import { createSoslExecutor, type SoslExecutor } from '../../services/grounding/salesforce-sosl-executor.js';
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

export const mediationTools: McpTool[] = [
  {
    name: 'mediate-query-intent',
    description: 'Analyze a natural language query to identify entities, intents, and required filters.',
    requirements: { llm: true, neo4j: true },
    schema: {
      query: z.string().describe('The natural language query to analyze'),
      orgId: z.string().optional().describe('Target Salesforce Org ID'),
    },
    handler: async (args) => {
      const toolSchema = {
        query: z.string(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, toolSchema);
      if (!validated.success) return validated.error;
      const { query, orgId } = validated.data;

      try {
        // 1. Extract terms from query
        const extraction = extractPotentialEntities(query);
        const allTerms = [...extraction.entities, ...extraction.potentialValues];
        
        // 2. Ground each term using grounding service (with SOSL fallback if available)
        const graphExecutor = createGroundingGraphExecutor(orgId);
        const soslExecutor = getSoslExecutorIfAvailable();
        const groundingService = createValueGroundingService(graphExecutor, soslExecutor);
        
        const groundedEntities = await Promise.all(
          allTerms.map(async (term) => {
            const grounded = await groundingService.groundValue(term);
            return {
              value: term,
              isGrounded: grounded.isGrounded,
              type: grounded.bestMatch?.type ?? 'unknown',
              confidence: grounded.bestMatch?.confidence ?? 0,
              suggestedFilter: grounded.bestMatch?.suggestedFilter,
            };
          })
        );
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query,
                extractedTerms: allTerms,
                entities: groundedEntities.filter((e) => e.isGrounded),
                ungroundedTerms: groundedEntities.filter((e) => !e.isGrounded).map((e) => e.value),
                intent: 'soql_generation',
              }, null, 2),
            },
          ],
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
    name: 'resolve-entity',
    description: 'Resolve a specific entity name (company, person, status) to valid SOQL filter patterns.',
    requirements: { neo4j: true },
    schema: {
      entityName: z.string().describe('The name/value to resolve'),
      entityType: z.enum(['company', 'person', 'status', 'priority', 'unknown']).optional(),
      targetObject: z.string().optional().describe('Target object context'),
      orgId: z.string().optional(),
    },
    handler: async (args) => {
      const toolSchema = {
        entityName: z.string(),
        entityType: z.enum(['company', 'person', 'status', 'priority', 'unknown']).optional(),
        targetObject: z.string().optional(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, toolSchema);
      if (!validated.success) return validated.error;
      const { entityName, targetObject, orgId } = validated.data;

      try {
        // Use grounding service for resolution (with SOSL fallback if available)
        const graphExecutor = createGroundingGraphExecutor(orgId);
        const soslExecutor = getSoslExecutorIfAvailable();
        const groundingService = createValueGroundingService(graphExecutor, soslExecutor);

        const grounded = await groundingService.groundValue(entityName, {
          targetObject,
        });
        
        if (!grounded.isGrounded) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                found: false,
                value: entityName,
                message: 'Could not resolve entity to a known value',
              }, null, 2),
            }],
          };
        }
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                found: true,
                value: entityName,
                type: grounded.bestMatch?.type,
                confidence: grounded.bestMatch?.confidence,
                suggestedFilter: grounded.bestMatch?.suggestedFilter,
                fields: grounded.bestMatch?.fields,
                description: grounded.bestMatch?.description,
                alternatives: grounded.groundedAs.slice(1, 4).map((r) => ({
                  type: r.type,
                  suggestedFilter: r.suggestedFilter,
                  confidence: r.confidence,
                })),
              }, null, 2),
            },
          ],
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
    name: 'get-filter-recommendation',
    description: 'Get recommended SOQL filters for a given field and value concept (e.g. status="open").',
    requirements: { neo4j: true },
    schema: {
      objectName: z.string(),
      fieldName: z.string(),
      concept: z.string(),
      orgId: z.string().optional(),
    },
    handler: async (args) => {
      const toolSchema = {
        objectName: z.string(),
        fieldName: z.string(),
        concept: z.string(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, toolSchema);
      if (!validated.success) return validated.error;
      const { objectName, fieldName, concept, orgId } = validated.data;
      
      try {
        // Use grounding service to find picklist match (with SOSL fallback if available)
        const graphExecutor = createGroundingGraphExecutor(orgId);
        const soslExecutor = getSoslExecutorIfAvailable();
        const groundingService = createValueGroundingService(graphExecutor, soslExecutor);

        // Find picklist match for this field
        const picklistMatch = await groundingService.findPicklistMatch(concept, objectName);
        
        if (picklistMatch) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  found: true,
                  objectName,
                  fieldName,
                  concept,
                  recommendedFilter: `${picklistMatch.fieldApiName} = '${picklistMatch.value}'`,
                  matchedValue: picklistMatch.value,
                  matchedLabel: picklistMatch.label,
                  confidence: picklistMatch.isExact ? 0.95 : 0.8,
                }, null, 2),
              },
            ],
          };
        }
        
        // Fallback: try grounding the concept
        const grounded = await groundingService.groundValue(concept, {
          targetObject: objectName,
        });
        
        if (grounded.isGrounded && grounded.bestMatch) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  found: true,
                  objectName,
                  fieldName,
                  concept,
                  recommendedFilter: grounded.bestMatch.suggestedFilter,
                  confidence: grounded.bestMatch.confidence,
                  type: grounded.bestMatch.type,
                }, null, 2),
              },
            ],
          };
        }
        
        // No match found - return basic suggestion
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                found: false,
                objectName,
                fieldName,
                concept,
                recommendedFilter: `${fieldName} = '${concept}'`,
                confidence: 0.3,
                message: 'No picklist match found, using literal value',
              }, null, 2),
            },
          ],
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
  }
];

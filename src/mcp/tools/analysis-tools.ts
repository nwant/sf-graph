/**
 * Analysis Tools
 *
 * MCP tools for query intent analysis and schema context retrieval.
 * These tools expose the project's intelligence for reuse by external agents.
 */
import { z } from 'zod';
import { createLogger } from '../../core/index.js';
import type { McpTool } from './types.js';
import { toolResponse, errorResponse, validateArgs } from './types.js';
import {
  extractPotentialEntities,
  detectRelationshipIntent,
  findMatchingObjects,
  FuzzySchemaContextProvider,
  formatSchemaForPrompt,
  type RelationshipIntent,
} from '../../services/schema-context/index.js';
import { classifyEntities } from '../../services/entity-classifier.js';
import type { QueryIntentAnalysis } from '../../core/types.js';

const log = createLogger('mcp:analysis');

/**
 * Build SOQL suggestion for a relationship intent.
 */
function buildRelationshipSoql(intent: RelationshipIntent): string {
  if (intent.type === 'parent_lookup') {
    // e.g., Contact -> Account: Use Contact.Account.Name
    return `SELECT Id, ${intent.targetEntity}.Name FROM ${intent.sourceEntity}`;
  } else if (intent.type === 'child_subquery') {
    // e.g., Account -> Opportunities: Use (SELECT Id FROM Opportunities)
    const childRelName = getChildRelationshipName(intent.targetEntity);
    return `SELECT Id, Name, (SELECT Id FROM ${childRelName}) FROM ${intent.sourceEntity}`;
  }
  return '';
}

/**
 * Get standard child relationship name for an object.
 */
function getChildRelationshipName(objectName: string): string {
  const specialCases: Record<string, string> = {
    Opportunity: 'Opportunities',
    Case: 'Cases',
    Contact: 'Contacts',
    Account: 'Accounts',
    Lead: 'Leads',
    Task: 'Tasks',
    Event: 'Events',
    User: 'Users',
    Campaign: 'Campaigns',
    Contract: 'Contracts',
    Order: 'Orders',
    Product2: 'Products',
    Asset: 'Assets',
    Quote: 'Quotes',
  };
  return specialCases[objectName] || objectName + 's';
}

export const analysisTools: McpTool[] = [
  // === analyze-query-intent ===
  {
    name: 'analyze-query-intent',
    description: `Analyze a natural language query to extract entities, relationships, and filter patterns WITHOUT generating SOQL.

Use this tool BEFORE generating SOQL to:
1. Identify what type of entities are mentioned (company names, person names, status values)
2. Get suggested SOQL filter patterns for each entity
3. Understand relationship patterns (parent lookup vs child subquery)
4. Find matching picklist values

This prevents field hallucination by telling you exactly how to filter.

Example input: "show me high priority cases for microsoft deals owned by John Doe"
Example output includes:
- "microsoft" classified as company_name with pattern "Account.Name LIKE 'Microsoft%'"
- "John Doe" classified as person_name with pattern "Owner.Name LIKE 'John Doe%'"
- "high" classified as priority_value with pattern "Priority = 'High'"`,
    schema: {
      query: z.string().describe('The natural language query to analyze'),
      orgId: z
        .string()
        .optional()
        .describe('Org alias to use for schema matching'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        query: z.string(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { query, orgId } = validated.data;

      try {
        log.debug({ query }, 'Analyzing query intent');

        // 1. Extract potential entities
        const terms = extractPotentialEntities(query);

        // 2. Find matching objects first to get context
        const { objects, picklistMatches, contextObjectNames } = await findMatchingObjects(
          terms,
          orgId,
          query
        );

        // 3. Classify each entity with context objects
        const allTerms = [...terms.entities, ...terms.potentialValues];
        const classifiedEntities = await classifyEntities(allTerms, {
          orgId,
          contextObjects: contextObjectNames,
        });

        // 4. Detect relationship intents
        const relationshipIntents = detectRelationshipIntent(query);

        // 5. Build relationship suggestions with SOQL
        const relationships = relationshipIntents.map((intent) => ({
          type: intent.type as 'parent_lookup' | 'child_subquery' | 'semi_join',
          sourceObject: intent.sourceEntity,
          targetObject: intent.targetEntity,
          phrase: intent.phrase,
          suggestedSoql: buildRelationshipSoql(intent),
        }));

        // 6. Build suggested filters from classified entities
        const suggestedFilters = classifiedEntities
          .filter((e) => e.suggestedPatterns.length > 0)
          .flatMap((e) => e.suggestedPatterns);

        const result: QueryIntentAnalysis = {
          query,
          entities: classifiedEntities,
          detectedObjects: objects.map((categorizedObj, idx) => ({
            apiName: categorizedObj.object.apiName,
            label: categorizedObj.object.label,
            confidence: Math.max(0.5, 1 - idx * 0.1), // Decrease confidence by order
            role: idx === 0 ? 'primary' : 'related',
          })),
          relationships,
          picklistMatches,
          suggestedFilters,
        };

        return toolResponse(result);
      } catch (error) {
        log.error({ err: error }, 'Error in analyze-query-intent tool');
        return errorResponse(
          `Error analyzing query: ${(error as Error).message}`
        );
      }
    },
  },

  // === get-schema-context ===
  {
    name: 'get-schema-context',
    description: `Get formatted schema context for a natural language query.

Returns objects, fields, and relationships relevant to the query.
Use this to inject schema context into your own prompts.

Formats:
- 'prompt': Returns a formatted string ready for LLM prompt injection (includes SOQL rules and examples)
- 'structured': Returns the raw SchemaContext object with all metadata

Example: Get context for "cases for microsoft" returns Account and Case objects with their fields, relationships, and SOQL syntax hints.`,
    schema: {
      query: z
        .string()
        .describe('The natural language query to get context for'),
      orgId: z.string().optional().describe('Org alias'),
      format: z
        .enum(['prompt', 'structured'])
        .optional()
        .describe("Output format: 'prompt' (default) or 'structured'"),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        query: z.string(),
        orgId: z.string().optional(),
        format: z.enum(['prompt', 'structured']).optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { query, orgId } = validated.data;
      const format = validated.data.format ?? 'prompt';

      try {
        log.debug({ query, format }, 'Getting schema context');

        const provider = new FuzzySchemaContextProvider();
        const context = await provider.getContext(query, orgId);

        if (format === 'prompt') {
          const formatted = formatSchemaForPrompt(context);
          return toolResponse({
            format: 'prompt',
            context: formatted,
            stats: context.stats,
            picklistHintCount: context.picklistHints?.length ?? 0,
          });
        } else {
          return toolResponse({
            format: 'structured',
            context,
          });
        }
      } catch (error) {
        log.error({ err: error }, 'Error in get-schema-context tool');
        return errorResponse(
          `Error getting schema context: ${(error as Error).message}`
        );
      }
    },
  },
];

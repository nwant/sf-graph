/**
 * Schema Exploration Tools
 *
 * MCP tools for exploring Salesforce object schemas stored in Neo4j.
 */
import { z } from 'zod';
import { apiService, createLogger } from '../../core/index.js';
import type { SalesforceField, ObjectRelationship } from '../../core/types.js';
import type { McpTool } from './types.js';
import { toolResponse, errorResponse, validateArgs } from './types.js';

const log = createLogger('mcp:schema');

interface FormattedField {
  apiName: string;
  label: string;
  description: string;
  type: string;
  category: string;
  namespace?: string;
  nullable: boolean;
  unique: boolean;
  helpText: string;
  // SOQL-relevant properties
  calculated?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  length?: number;
  precision?: number;
  scale?: number;
  // Relationship metadata
  referenceTo?: string[];
  relationshipName?: string;
  relationshipType?: string;
}

interface FormattedRelationship {
  sourceObject: string;
  targetObject: string[];  // Array for polymorphic support
  relationshipType: string;
  fieldCount: number;
  fields?: string[];
  direction: string;
}

/**
 * Format object fields for tool response
 */
function formatFields(fields: SalesforceField[]): FormattedField[] {
  return fields.map((field) => ({
    apiName: field.apiName,
    label: field.label || field.apiName,
    description: '',
    type: field.type || 'string',
    category: field.category || 'standard',
    namespace: field.namespace,
    nullable: !field.required,
    unique: field.unique || false,
    helpText: '',
    // SOQL-relevant properties
    calculated: field.calculated,
    filterable: field.filterable,
    sortable: field.sortable,
    groupable: field.groupable,
    length: field.length,
    precision: field.precision,
    scale: field.scale,
    // Relationship metadata
    referenceTo: field.referenceTo,
    relationshipName: field.relationshipName,
    relationshipType: field.relationshipType,
  }));
}

/**
 * Format object relationships for tool response
 */
function formatRelationships(relationships: ObjectRelationship[]): FormattedRelationship[] {
  return relationships.map((rel) => ({
    sourceObject: '',
    targetObject: rel.referenceTo,  // Now an array
    relationshipType: rel.relationshipType || 'Lookup',
    fieldCount: 1,
    direction: 'outgoing',
  }));
}

/**
 * Build SOQL filter examples for common patterns.
 * Helps external agents understand how to filter this object.
 */
function buildFilterExamples(
  objectApiName: string,
  fields: SalesforceField[],
  relationships: ObjectRelationship[]
): Record<string, string> {
  const examples: Record<string, string> = {};

  // Name filter (if has Name field)
  if (fields.some((f) => f.apiName === 'Name')) {
    examples.byName = `${objectApiName}.Name LIKE 'Acme%'`;
  }

  // Owner filter (if has OwnerId)
  if (fields.some((f) => f.apiName === 'OwnerId')) {
    examples.byOwner = `OwnerId IN (SELECT Id FROM User WHERE Name LIKE 'John%')`;
    examples.byOwnerName = `Owner.Name LIKE 'John Doe%'`;
  }

  // Status/picklist filter (find first picklist field)
  const picklistField = fields.find(
    (f) => f.type === 'picklist' && f.picklistValues && f.picklistValues.length > 0
  );
  if (picklistField && picklistField.picklistValues?.[0]) {
    examples.byPicklist = `${picklistField.apiName} = '${picklistField.picklistValues[0].value}'`;
  }

  // Priority filter (common pattern)
  const priorityField = fields.find(
    (f) => f.apiName.toLowerCase().includes('priority')
  );
  if (priorityField) {
    examples.byPriority = `${priorityField.apiName} = 'High'`;
  }

  // Status filter (common pattern)
  const statusField = fields.find(
    (f) => f.apiName.toLowerCase().includes('status') && f.type === 'picklist'
  );
  if (statusField) {
    examples.byStatus = `${statusField.apiName} = 'Open'`;
  }

  // Date filter (if has CreatedDate)
  if (fields.some((f) => f.apiName === 'CreatedDate')) {
    examples.byDate = `CreatedDate = THIS_MONTH`;
  }

  // Parent relationship example (if has lookup fields)
  const lookupRel = relationships.find((r) => r.relationshipName);
  if (lookupRel) {
    examples.byParentField = `${lookupRel.relationshipName}.Name = 'Example Account'`;
  }

  // Account relationship (common pattern)
  const accountRel = relationships.find((r) =>
    r.referenceTo?.includes('Account') && r.relationshipName
  );
  if (accountRel) {
    examples.byAccountName = `${accountRel.relationshipName}.Name LIKE 'Microsoft%'`;
  }

  return examples;
}

export const schemaTools: McpTool[] = [
  {
    name: 'check-graph-status',
    description: 'Check if the metadata graph has been populated and get sync status',
    schema: {},
    requirements: { neo4j: true },
    handler: async () => {
      try {
        const status = await apiService.getGraphStatus();

        const response: Record<string, unknown> = {
          hasData: status.populated,
          objectCount: status.objectCount,
          lastSyncedAt: status.lastSyncedAt || null,
          message: status.populated
            ? `Graph populated with ${status.objectCount} Salesforce objects`
            : 'Graph is empty. Run sync to populate: sf graph sync --target-org <alias>',
        };

        if (status.populated) {
          // Get sample object names
          const objects = await apiService.listObjects();
          response.sampleObjects = objects.slice(0, 10).map((o) => o.apiName);
        }

        return toolResponse(response);
      } catch (error) {
        log.error({ err: error }, 'Error in check-graph-status tool');
        return errorResponse(`Error checking graph status: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'list-objects',
    description: 'List all Salesforce objects in the metadata graph',
    schema: {
      orgId: z.string().optional().describe('Org alias to filter by (use specific Org ID if provided)'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = { orgId: z.string().optional() };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { orgId } = validated.data;

      try {
        const objects = await apiService.listObjects(orgId);
        return toolResponse(objects);
      } catch (error) {
        log.error({ err: error }, 'Error in list-objects tool');
        return errorResponse(`Error retrieving objects: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'find-object',
    description: `Check if a Salesforce object exists and get basic info. Use to verify objects exist before including in query plans.

Returns:
- found: true/false
- apiName: The canonical API name
- label: Human-readable label
- category: Object category (standard, custom, etc.)
- relationshipHints: Key relationships for SOQL (parent lookups, child objects)

IMPORTANT: For "working on" queries involving Opportunity:
- Check if "OpportunityTeamMember" exists (links Users to Opportunities)
- Check if "OpportunityContactRole" exists (links Contacts to Opportunities)`,
    schema: {
      objectApiName: z.string().describe('API name of the object to find (case insensitive)'),
      orgId: z.string().optional().describe('Org alias to filter by'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        objectApiName: z.string(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { objectApiName, orgId } = validated.data;

      try {
        const object = await apiService.getObject(objectApiName, orgId);

        if (!object) {
          return toolResponse({
            found: false,
            objectApiName,
            message: `Object "${objectApiName}" not found in the metadata graph.`,
            suggestions: [
              'Check spelling (API names are case-insensitive)',
              'Run "sf graph sync" if the object was recently created',
              'Use "list-objects" to see available objects',
            ],
          });
        }

        // Check for ghost objects (synced but empty/failed)
        if (!object.fields || object.fields.length === 0) {
           return toolResponse({
            found: false,
            objectApiName,
            message: `Object "${objectApiName}" exists but has NO fields (sync may have failed or feature is disabled).`,
            suggestions: [
              'Check if the feature (e.g. Team Selling) is enabled in Salesforce Setup',
              'Run "sf graph sync --object ${objectApiName}" to retry',
            ],
           });
        }

        // Build relationship hints for SOQL generation
        const relationshipHints: Record<string, string[]> = {
          parentLookups: [],
          childObjects: [],
          junctionHints: [],
        };

        // Extract parent lookups from relationships
        const relationships = object.relationships || [];
        for (const rel of relationships) {
          if (rel.relationshipName && rel.referenceTo?.length) {
            relationshipHints.parentLookups.push(
              `${rel.relationshipName} -> ${rel.referenceTo.join(', ')}`
            );
          }
        }

        // Add junction object hints for common patterns
        if (object.apiName === 'Opportunity') {
          relationshipHints.junctionHints.push(
            'OpportunityTeamMember: Links Users (internal team) to this Opportunity. Use for "working on" queries.',
            'OpportunityContactRole: Links Contacts (external people) to this Opportunity. Use for "contact on deal" queries.'
          );
        } else if (object.apiName === 'Account') {
          relationshipHints.junctionHints.push(
            'AccountTeamMember: Links Users to this Account for team-based queries.'
          );
        } else if (object.apiName === 'Case') {
          relationshipHints.junctionHints.push(
            'CaseTeamMember: Links Users to this Case for team-based queries.'
          );
        }

        // Check for Owner field and add hint
        const hasOwner = (object.fields || []).some((f) => f.apiName === 'OwnerId');
        if (hasOwner) {
          relationshipHints.parentLookups.push(
            'Owner -> User (use Owner.Name for owner name filtering, NOT OwnerId LIKE)'
          );
        }

        return toolResponse({
          found: true,
          apiName: object.apiName,
          label: object.label || object.apiName,
          category: object.category || 'standard',
          subtype: object.subtype,
          fieldCount: (object.fields || []).length,
          relationshipHints,
        });
      } catch (error) {
        log.error({ err: error }, 'Error in find-object tool');
        return errorResponse(`Error finding object: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'get-object',
    description:
      'Get details about a specific Salesforce object including fields, relationships, and optional filter examples for SOQL generation',
    schema: {
      apiName: z.string().describe('API name of the Salesforce object (case insensitive)'),
      orgId: z.string().optional().describe('Org alias to query (use specific Org ID if provided)'),
      includeFilterExamples: z.boolean().optional().describe('Include SOQL filter examples for common patterns (default: false)'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        apiName: z.string(),
        orgId: z.string().optional(),
        includeFilterExamples: z.boolean().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { apiName, orgId, includeFilterExamples } = validated.data;

      try {
        const object = await apiService.getObject(apiName, orgId);

        if (!object) {
          return errorResponse(`Object with API name '${apiName}' not found.`);
        }

        const result: Record<string, unknown> = {
          object: {
            apiName: object.apiName,
            label: object.label || object.apiName,
            description: '',
            category: object.category || 'standard',
            subtype: object.subtype,
            namespace: object.namespace,
            parentObjectName: object.parentObjectName,
          },
          fields: formatFields(object.fields || []),
          relationships: formatRelationships(object.relationships || []),
        };

        // Add filter examples if requested
        if (includeFilterExamples) {
          result.filterExamples = buildFilterExamples(object.apiName, object.fields || [], object.relationships || []);
        }

        return toolResponse(result);
      } catch (error) {
        log.error({ err: error }, 'Error in get-object tool');
        return errorResponse(`Error retrieving object details: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'explore-relationships',
    description: 'Find paths between two Salesforce objects in the metadata graph',
    schema: {
      sourceObjectApiName: z.string().describe('API name of the source object'),
      targetObjectApiName: z.string().describe('API name of the target object'),
      maxDepth: z.number().optional().describe('Maximum path depth to search (default: 5)'),
      orgId: z.string().optional().describe('Org alias to query (future use)'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        sourceObjectApiName: z.string(),
        targetObjectApiName: z.string(),
        maxDepth: z.number().optional(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { sourceObjectApiName, targetObjectApiName, orgId } = validated.data;
      const maxDepth = validated.data.maxDepth ?? 5;

      try {
        log.debug({ sourceObjectApiName, targetObjectApiName, maxDepth }, 'Exploring relationships');

        const paths = await apiService.findPaths(
          sourceObjectApiName,
          targetObjectApiName,
          maxDepth,
          orgId
        );

        if (paths.length === 0) {
          return errorResponse(
            `No paths found between ${sourceObjectApiName} and ${targetObjectApiName} within ${maxDepth} steps.`
          );
        }

        return toolResponse({
          sourceObject: sourceObjectApiName,
          targetObject: targetObjectApiName,
          pathCount: paths.length,
          paths: paths,
        });
      } catch (error) {
        log.error({ err: error }, 'Error in explore-relationships tool');
        return errorResponse(`Error exploring relationships: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'find-paths',
    description: 'Find paths between two Salesforce objects with detailed hop information',
    schema: {
      fromObject: z.string().describe('API name of the start object'),
      toObject: z.string().describe('API name of the end object'),
      minHops: z.number().optional().describe('Minimum number of hops (default: 1)'),
      maxHops: z.number().optional().describe('Maximum number of hops (default: 5)'),
      orgId: z.string().optional().describe('Org alias to query'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        fromObject: z.string(),
        toObject: z.string(),
        minHops: z.number().optional(),
        maxHops: z.number().optional(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { fromObject, toObject, orgId } = validated.data;
      const minHops = validated.data.minHops ?? 1;
      const maxHops = validated.data.maxHops ?? 5;

      try {
        log.debug({ fromObject, toObject, minHops, maxHops }, 'Finding detailed paths');

        const result = await apiService.findDetailedPaths(fromObject, toObject, {
          minHops,
          maxHops,
          orgId,
        });

        if (result.pathCount === 0) {
          return toolResponse({
            fromObject,
            toObject,
            pathCount: 0,
            message: `No paths found within ${maxHops} hops.`,
          });
        }

        return toolResponse(result);
      } catch (error) {
        log.error({ err: error }, 'Error in find-paths tool');
        return errorResponse(`Error finding paths: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'find-related-objects',
    description: 'Find all objects related to a specific Salesforce object',
    schema: {
      objectApiName: z.string().describe('API name of the Salesforce object'),
      maxDepth: z.number().optional().describe('Maximum relationship depth to search (default: 2)'),
      orgId: z.string().optional().describe('Org alias to query (future use)'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        objectApiName: z.string(),
        maxDepth: z.number().optional(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { objectApiName, orgId } = validated.data;
      const maxDepth = validated.data.maxDepth ?? 2;

      try {
        log.debug({ objectApiName, maxDepth }, 'Finding related objects');

        const relatedObjects = await apiService.findRelatedObjects(objectApiName, maxDepth, orgId);

        return toolResponse({
          sourceObject: objectApiName,
          relatedObjects: relatedObjects,
        });
      } catch (error) {
        log.error({ err: error }, 'Error in find-related-objects tool');
        return errorResponse(`Error finding related objects: ${(error as Error).message}`);
      }
    },
  },
];

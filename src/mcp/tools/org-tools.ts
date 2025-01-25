/**
 * Org Management Tools
 *
 * MCP tools for managing multiple Salesforce orgs, syncing metadata,
 * and comparing schemas between orgs.
 */
import { z } from 'zod';
import { apiService, createLogger } from '../../core/index.js';
import type { McpTool } from './types.js';
import { toolResponse, errorResponse, validateArgs } from './types.js';

const log = createLogger('mcp:org');

export const orgTools: McpTool[] = [
  {
    name: 'list-orgs',
    description: 'List all authenticated Salesforce orgs from SF CLI and orgs synced to the graph',
    schema: {
      showGraphOnly: z
        .boolean()
        .optional()
        .describe('If true, only show orgs that have been synced to the graph'),
    },
    requirements: { sfCli: true },
    handler: async (args) => {
      const schema = { showGraphOnly: z.boolean().optional() };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { showGraphOnly } = validated.data;

      try {
        const result = await apiService.listOrgs();
        const { authenticated, synced } = result;

        // Create a combined view
        const graphOrgIds = new Set(synced.map((o) => o.orgId));

        const response = {
          authenticatedOrgs: showGraphOnly
            ? []
            : authenticated.map((o) => ({
                alias: o.alias,
                username: o.username,
                instanceUrl: o.instanceUrl,
                isScratch: o.isScratch || false,
                isDefault: o.isDefault || false,
                syncedToGraph: graphOrgIds.has(o.alias) || graphOrgIds.has(o.username),
              })),
          syncedOrgs: synced,
          summary: {
            authenticatedCount: authenticated.length,
            syncedCount: synced.length,
          },
        };

        return toolResponse(response);
      } catch (error) {
        log.error({ err: error }, 'Error in list-orgs tool');
        return errorResponse(`Error listing orgs: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'get-org-status',
    description: 'Get sync status for a specific org in the graph',
    schema: {
      orgId: z.string().describe('Org alias or username to check'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = { orgId: z.string() };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { orgId } = validated.data;

      try {
        const status = await apiService.getOrgStatus(orgId);
        return toolResponse(status);
      } catch (error) {
        log.error({ err: error }, 'Error in get-org-status tool');
        return errorResponse(`Error getting org status: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'compare-schemas',
    description: 'Compare schemas between two Salesforce orgs to find differences',
    schema: {
      sourceOrg: z.string().describe('Source org alias or username'),
      targetOrg: z.string().describe('Target org alias or username'),
      objectFilter: z
        .string()
        .optional()
        .describe('Optional: filter to a specific object API name'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        sourceOrg: z.string(),
        targetOrg: z.string(),
        objectFilter: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { sourceOrg, targetOrg, objectFilter } = validated.data;

      if (sourceOrg === targetOrg) {
        return errorResponse('Source and target orgs must be different');
      }

      try {
        const comparison = await apiService.compareSchemas(sourceOrg, targetOrg, objectFilter);
        return toolResponse(comparison);
      } catch (error) {
        log.error({ err: error }, 'Error in compare-schemas tool');
        return errorResponse(`Error comparing schemas: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'compare-object',
    description: 'Deep compare a specific object between two orgs, showing field-level differences',
    schema: {
      objectApiName: z.string().describe('Object API name to compare (e.g., Account)'),
      sourceOrg: z.string().describe('Source org alias or username'),
      targetOrg: z.string().describe('Target org alias or username'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        objectApiName: z.string(),
        sourceOrg: z.string(),
        targetOrg: z.string(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { objectApiName, sourceOrg, targetOrg } = validated.data;

      if (sourceOrg === targetOrg) {
        return errorResponse('Source and target orgs must be different');
      }

      try {
        const comparison = await apiService.compareObject(objectApiName, sourceOrg, targetOrg);
        return toolResponse(comparison);
      } catch (error) {
        log.error({ err: error }, 'Error in compare-object tool');
        return errorResponse(`Error comparing object: ${(error as Error).message}`);
      }
    },
  },
];

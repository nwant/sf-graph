/**
 * Data Tools
 *
 * MCP tools for generating sample data.
 */
import { z } from 'zod';
import { createLogger } from '../../core/index.js';
import {
  generateSampleData,
  generateRelatedSampleData,
} from '../../services/sample-data-generator.js';
import type { McpTool } from './types.js';
import { toolResponse, errorResponse, validateArgs } from './types.js';

const log = createLogger('mcp:data');

export const dataTools: McpTool[] = [
  {
    name: 'generate-sample-data',
    description: 'Generate sample data for a Salesforce object',
    schema: {
      objectApiName: z.string().describe('API name of the Salesforce object'),
      count: z.number().optional().describe('Number of records to generate (default: 5)'),
      includeRelated: z
        .boolean()
        .optional()
        .describe('Whether to include related objects (default: false)'),
      orgId: z.string().optional().describe('Org alias (future use)'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        objectApiName: z.string(),
        count: z.number().optional(),
        includeRelated: z.boolean().optional(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { objectApiName, orgId } = validated.data;
      const count = validated.data.count ?? 5;
      const includeRelated = validated.data.includeRelated ?? false;

      try {
        log.debug({ objectApiName, count, includeRelated }, 'Generating sample data');

        let result;
        if (includeRelated) {
          result = await generateRelatedSampleData(objectApiName, count, { orgId });
        } else {
          result = await generateSampleData(objectApiName, count, { orgId });
        }

        return toolResponse(result);
      } catch (error) {
        log.error({ err: error }, 'Error in generate-sample-data tool');
        return errorResponse(`Error generating sample data: ${(error as Error).message}`);
      }
    },
  },
];

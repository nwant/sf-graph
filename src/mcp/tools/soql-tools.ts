/**
 * SOQL Tools
 *
 * MCP tools for generating and executing SOQL queries.
 */
import { z } from 'zod';
import { apiService, createLogger } from '../../core/index.js';
import type { McpTool, McpToolResponse } from './types.js';
import { validateArgs } from './types.js';
import { validateAndCorrectSoqlEnhanced } from '../../services/soql-validator.js';

const log = createLogger('mcp:soql');

/**
 * Create a standard tool response
 */
function toolResponse(data: unknown): McpToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Create an error tool response
 */
function errorResponse(message: string): McpToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
  };
}

export const soqlTools: McpTool[] = [
  {
    name: 'generate-soql',
    description: 'Generate a structured SOQL query when you ALREADY KNOW the exact object API name and field names. Do NOT use this for natural language queries like "get contacts with account name" - use natural-language-to-soql instead.',
    schema: {
      objectApiName: z.string().describe('Exact API name of the Salesforce object (e.g., Contact, Account)'),
      fields: z
        .array(z.string())
        .optional()
        .describe('Exact field API names to include (e.g., Name, AccountId). Must be valid field names.'),
      whereClause: z.string().optional().describe('WHERE clause for the query (optional)'),
      limit: z.number().optional().describe('Limit the number of records returned (optional)'),
      orgId: z.string().optional().describe('Org alias (future use)'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        objectApiName: z.string(),
        fields: z.array(z.string()).optional(),
        whereClause: z.string().optional(),
        limit: z.number().optional(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { objectApiName, fields, whereClause, limit } = validated.data;

      try {
        const query = await apiService.generateSoql({
          objectApiName,
          fields,
          whereClause,
          limit,
        });

        return toolResponse(query);
      } catch (error) {
        log.error({ err: error }, 'Error in generate-soql tool');
        return errorResponse(`Error generating SOQL query: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'execute-soql',
    description: 'Execute a SOQL query against Salesforce and return the results',
    schema: {
      query: z.string().describe('SOQL query to execute'),
      orgAlias: z
        .string()
        .optional()
        .describe('Org alias or username to execute against (defaults to SF_DEFAULT_ORG)'),
    },
    requirements: { sfCli: true },
    handler: async (args) => {
      const schema = {
        query: z.string(),
        orgAlias: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { query, orgAlias } = validated.data;

      try {
        log.debug({ query, orgAlias }, 'Executing SOQL query');

        const result = await apiService.executeSoql(query, orgAlias);

        return toolResponse({
          orgAlias: orgAlias || 'default',
          totalSize: result.totalSize,
          done: result.done,
          records: result.records,
        });
      } catch (error) {
        log.error({ err: error }, 'Error in execute-soql tool');
        return errorResponse(`Error executing SOQL query: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'natural-language-to-soql',
    description: 'BEST TOOL for converting human language to SOQL. Use this when user says things like "get contacts with account name" or "show me accounts created this month". This tool understands natural language and generates proper SOQL with relationship queries.',
    schema: {
      query: z.string().describe('The natural language query to convert to SOQL, e.g. "get contacts with their account name"'),
      useLLM: z
        .boolean()
        .optional()
        .describe('Whether to use LLM for enhanced processing (default: true)'),
      orgId: z.string().optional().describe('Org alias (future use)'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        query: z.string(),
        useLLM: z.boolean().optional(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { query } = validated.data;
      const useLLM = validated.data.useLLM ?? true;

      try {
        log.debug({ query, useLLM }, 'Converting natural language to SOQL');

        const result = await apiService.naturalLanguageToSoql(query, useLLM);

        const response: Record<string, unknown> = {
          soql: result.soql,
          mainObject: result.mainObject,
          selectedFields: result.selectedFields,
          conditions: result.conditions,
          orderBy: result.orderBy,
          limit: result.limit,
          isValid: result.isValid,
          validationMessages: result.validationMessages,
        };

        // Add LLM analysis if available
        if (result.llmAnalysis) {
          response.llmAnalysis = result.llmAnalysis;
        }

        return toolResponse(response);
      } catch (error) {
        log.error({ err: error }, 'Error in natural-language-to-soql tool');
        return errorResponse(
          `Error converting natural language to SOQL: ${(error as Error).message}`
        );
      }
    },
  },

  {
    name: 'validate-soql',
    description: `Validate a SOQL query against the metadata graph and get smart corrections.

This tool:
1. Validates all objects, fields, and relationships exist in your Salesforce org
2. Detects hallucinated entity names (e.g., "Account.Microsoft" → suggests "Account.Name LIKE 'Microsoft%'")
3. Validates picklist values
4. Returns corrected SOQL if fixes were applied

SMART DETECTION: If a "field" like "ProviderType" is not found, the tool checks if it's actually an entity name (company, person, status) and suggests the correct filter pattern.

Use this tool to validate SOQL before execution, especially when the SOQL was generated by an LLM.`,
    schema: {
      soql: z.string().describe('The SOQL query to validate'),
      orgId: z
        .string()
        .optional()
        .describe('Org alias for schema validation'),
    },
    requirements: { neo4j: true },
    handler: async (args) => {
      const schema = {
        soql: z.string(),
        orgId: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { soql, orgId } = validated.data;

      try {
        log.debug({ soql }, 'Validating SOQL query');

        const result = await validateAndCorrectSoqlEnhanced(soql, orgId);

        return toolResponse({
          isValid: result.isValid,
          originalSoql: soql,
          correctedSoql: result.correctedSoql,
          wasCorrected: result.wasCorrected,
          messages: result.messages,
          enhancedErrors: result.enhancedErrors,
          hints: result.hints,
          parsed: result.parsed,
        });
      } catch (error) {
        log.error({ err: error }, 'Error in validate-soql tool');
        return errorResponse(
          `Error validating SOQL: ${(error as Error).message}`
        );
      }
    },
  },
];

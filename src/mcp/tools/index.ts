/**
 * MCP Tool Registry
 *
 * Central registry for all MCP tools. Each tool module exports an array of tool definitions.
 * Tools are registered based on capability availability (Neo4j, LLM, SF CLI).
 */
import { schemaTools } from './schema-tools.js';
import { soqlTools } from './soql-tools.js';
import { dataTools } from './data-tools.js';
import { llmTools } from './llm-tools.js';
import { orgTools } from './org-tools.js';
import { analysisTools } from './analysis-tools.js';
import { mediationTools } from './mediation-tools.js';
import { semanticTools } from './semantic-tools.js';
import type { McpTool, McpToolRequirements } from './types.js';

export interface Capabilities {
  neo4j?: boolean;
  llm?: boolean;
  sfCli?: boolean;
}

/**
 * Get all available tools based on current capabilities
 */
export function getAvailableTools(capabilities: Capabilities = {}): McpTool[] {
  const allTools: McpTool[] = [
    ...schemaTools,
    ...soqlTools,
    ...dataTools,
    ...llmTools,
    ...orgTools,
    ...analysisTools,
    ...mediationTools,
    ...semanticTools,
  ];

  return allTools.filter((tool) => {
    const requirements: McpToolRequirements = tool.requirements || {};

    // Check each requirement
    if (requirements.neo4j && !capabilities.neo4j) {
      return false;
    }
    if (requirements.llm && !capabilities.llm) {
      return false;
    }
    if (requirements.sfCli && !capabilities.sfCli) {
      return false;
    }

    return true;
  });
}

// MCP Server type (loosely typed to avoid importing the full SDK)
interface McpServer {
  tool(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: McpTool['handler']
  ): void;
}

/**
 * Register all available tools with an MCP server instance
 */
export function registerTools(server: McpServer, capabilities: Capabilities): number {
  const tools = getAvailableTools(capabilities);

  console.log(`📦 Registering ${tools.length} tools...`);

  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema, tool.handler);
    console.log(`  ✅ ${tool.name}`);
  }

  return tools.length;
}

export { schemaTools, soqlTools, dataTools, llmTools, orgTools, analysisTools, semanticTools };
export type { McpTool, McpToolRequirements } from './types.js';

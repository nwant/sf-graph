/**
 * Tool Converter
 *
 * Converts MCP tool definitions to the generic LLM tool format.
 */

import type { LlmToolDefinition, LlmToolProperty } from '../llm/types.js';

/**
 * MCP tool definition (from listTools response)
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, McpPropertySchema>;
    required?: string[];
  };
}

interface McpPropertySchema {
  type?: string;
  description?: string;
  items?: { type: string };
  enum?: string[];
}

/**
 * Convert MCP tool definitions to LlmToolDefinition format
 *
 * @param tools - Array of MCP tool definitions from the server's listTools response
 * @returns Array of LlmToolDefinition for use with any LLM provider
 */
export function convertMcpToLlmTools(tools: McpToolDefinition[]): LlmToolDefinition[] {
  return tools.map((tool) => {
    const properties: Record<string, LlmToolProperty> = {};
    const required: string[] = tool.inputSchema?.required || [];

    if (tool.inputSchema?.properties) {
      for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
        properties[key] = {
          type: prop.type || 'string',
          description: prop.description,
          items: prop.items,
          enum: prop.enum,
        };
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties,
        required,
      },
    };
  });
}

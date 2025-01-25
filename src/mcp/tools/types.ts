/**
 * Shared types for MCP tools
 */
import { z } from 'zod';

export interface McpToolResponse {
  content: { type: string; text: string }[];
  isError?: boolean;
}

export interface McpToolRequirements {
  neo4j?: boolean;
  sfCli?: boolean;
  llm?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  requirements: McpToolRequirements;
  handler: (args: Record<string, unknown>) => Promise<McpToolResponse>;
}

/**
 * Create a standard tool response
 */
export function toolResponse(data: unknown): McpToolResponse {
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
export function errorResponse(message: string): McpToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
}

/**
 * Validate tool arguments against a Zod schema.
 * Returns the parsed data or an error response.
 */
export function validateArgs<T extends z.ZodRawShape>(
  args: Record<string, unknown>,
  schema: T
): { success: true; data: z.infer<z.ZodObject<T>> } | { success: false; error: McpToolResponse } {
  const zodSchema = z.object(schema);
  const result = zodSchema.safeParse(args);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    return {
      success: false,
      error: errorResponse(`Invalid arguments: ${errors}`),
    };
  }

  return { success: true, data: result.data };
}

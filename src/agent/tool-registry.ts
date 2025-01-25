import type { LlmToolDefinition } from '../llm/types.js';
import { McpClient, type ToolResult } from './mcp-client.js';
import { getAvailableTools, type Capabilities, type McpTool } from '../mcp/tools/index.js';
import { convertMcpToLlmTools, type McpToolDefinition } from './tool-converter.js';

/**
 * Interface for tool execution strategy
 */
export interface ToolExecutor {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getTools(): LlmToolDefinition[];
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  isConnected(): boolean;
}

/**
 * Options for in-process tool executor
 */
export interface InProcessToolExecutorOptions {
  capabilities?: Capabilities;
  toolFilter?: (tool: McpTool) => boolean;
}

/**
 * In-process tool executor
 * Executes tools directly without subprocess overhead
 */
export class InProcessToolExecutor implements ToolExecutor {
  private tools: McpTool[] = [];
  private connected = false;
  private options: InProcessToolExecutorOptions;

  constructor(options: InProcessToolExecutorOptions = {}) {
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    // Load available tools based on capabilities
    const allTools = getAvailableTools(this.options.capabilities);
    
    // Apply filter if provided
    this.tools = this.options.toolFilter 
      ? allTools.filter(this.options.toolFilter)
      : allTools;
      
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.tools = [];
  }

  getTools(): LlmToolDefinition[] {

    
    const definitions: McpToolDefinition[] = this.tools.map(tool => {
        const properties: Record<string, any> = {};
        const required: string[] = [];
        
        for (const [key, zodSchema] of Object.entries(tool.schema)) {
            const { type, description, items, isOptional } = parseZodSchema(zodSchema);
             
             properties[key] = {
                 type,
                 description,
                 items
             };
             
             if (!isOptional) {
                 required.push(key);
             }
        }
        
        return {
            name: tool.name,
            description: tool.description,
            inputSchema: {
                type: 'object',
                properties,
                required
            }
        };
    });

    return convertMcpToLlmTools(definitions);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.find(t => t.name === name);
    if (!tool) {
      return {
        success: false,
        content: `Tool ${name} not found`,
        isError: true
      };
    }

    try {
      // Execute the handler
      const result = await tool.handler(args);
      
      // Serialize content for LLM
      let content = '';
      if (result.content && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type === 'text') {
            // Check if it's already a string or needs stringification
            // The handler typically returns { type: 'text', text: '...' }
            // If text is already stringified JSON, good.
            // If the handler returns raw objects in text (which shouldn't happen with current helpers), we fix it.
            content += item.text; 
          }
        }
      }

      return {
        success: !result.isError,
        content,
        isError: result.isError
      };
    } catch (error) {
      return {
        success: false,
        content: `Error executing tool ${name}: ${(error as Error).message}`,
        isError: true
      };
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// Helper to extract metadata from Zod schema
function parseZodSchema(schema: any): { type: string, description?: string, items?: any, isOptional: boolean } {
  let current = schema;
  let isOptional = false;
  let description = current.description;

  // Handle optional and describe wrappers
  while (current._def.typeName === 'ZodOptional' || current._def.typeName === 'ZodDescription') {
    if (current._def.typeName === 'ZodOptional') {
      isOptional = true;
      current = current._def.innerType;
    } else if (current._def.typeName === 'ZodDescription') {
      description = current.description;
      current = current._def.innerType;
    }
  }

  // Handle types
  let type = 'string';
  let items = undefined;

  switch (current._def.typeName) {
    case 'ZodString':
      type = 'string';
      break;
    case 'ZodNumber':
      type = 'number'; // Note: LLM tools usually expect 'integer' or 'number'
      break;
    case 'ZodBoolean':
      type = 'boolean';
      break;
    case 'ZodArray':
      type = 'array';
      const innerStore = parseZodSchema(current._def.type);
      items = { type: innerStore.type };
      break;
    default:
      type = 'string'; // Fallback
  }

  return { type, description, items, isOptional };
}



/**
 * MCP client wrapper
 */
export class McpToolExecutor implements ToolExecutor {
  private client: McpClient;

  constructor(client: McpClient) {
    this.client = client;
  }

  async connect(): Promise<void> {
    return this.client.connect();
  }

  async disconnect(): Promise<void> {
    return this.client.disconnect();
  }

  getTools(): LlmToolDefinition[] {
    return this.client.getTools();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return this.client.callTool(name, args);
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }
}

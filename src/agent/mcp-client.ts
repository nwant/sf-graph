/**
 * MCP Client
 *
 * Connects to the sf-graph MCP server as a client to execute tools.
 * Spawns the MCP server as a child process with stdio transport.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertMcpToLlmTools, type McpToolDefinition } from './tool-converter.js';
import type { LlmToolDefinition } from '../llm/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ToolResult {
  success: boolean;
  content: string;
  isError?: boolean;
}

export class McpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: McpToolDefinition[] = [];
  private connected = false;

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    // Path to the compiled MCP server
    const serverPath = path.resolve(__dirname, '..', 'mcp-server.js');

    // Create transport that spawns the server process
    this.transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: {
        ...process.env,
        // Ensure we don't inherit interactive terminal settings
        FORCE_COLOR: '0',
      },
    });

    // Create the MCP client
    this.client = new Client(
      {
        name: 'sf-graph-agent',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    // Connect
    await this.client.connect(this.transport);
    this.connected = true;

    // Fetch available tools
    await this.refreshTools();
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.connected = false;
  }

  /**
   * Refresh the list of available tools from the server
   */
  async refreshTools(): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to MCP server');
    }

    const result = await this.client.listTools();
    this.tools = result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema as McpToolDefinition['inputSchema'],
    }));
  }

  /**
   * Get available tools for LLM providers
   */
  getTools(): LlmToolDefinition[] {
    return convertMcpToLlmTools(this.tools);
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return this.tools.map((t) => t.name);
  }

  /**
   * Call a tool by name with arguments
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    if (!this.client) {
      throw new Error('Not connected to MCP server');
    }

    try {
      const result = await this.client.callTool({
        name,
        arguments: args,
      });

      // Extract text content from the result
      let content = '';
      if (result.content && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type === 'text') {
            content += item.text;
          }
        }
      }

      return {
        success: !result.isError,
        content,
        isError: result.isError as boolean | undefined,
      };
    } catch (error) {
      return {
        success: false,
        content: `Error calling tool ${name}: ${(error as Error).message}`,
        isError: true,
      };
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}

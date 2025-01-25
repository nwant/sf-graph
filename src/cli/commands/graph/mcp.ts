/**
 * sf graph mcp <tool-name>
 *
 * Invoke MCP tools directly from the CLI.
 */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Args, Errors } from '@oclif/core';
import { Messages } from '@salesforce/core';
import { getAvailableTools, type McpTool } from '../../../mcp/tools/index.js';
import { detectCapabilities, type Capabilities } from '../../../mcp/index.js';
import { closeDriver } from '../../../services/neo4j/driver.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.mcp');

export type McpResult = {
  success: boolean;
  tool: string;
  result?: unknown;
  error?: string;
  availableTools?: string[];
};

export default class Mcp extends SfCommand<McpResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    tool: Args.string({
      description: 'Name of the MCP tool to execute',
      required: false,
    }),
  };

  public static readonly flags = {
    param: Flags.string({
      char: 'p',
      summary: messages.getMessage('flags.param.summary'),
      description: messages.getMessage('flags.param.description'),
      multiple: true,
    }),
    list: Flags.boolean({
      char: 'l',
      summary: messages.getMessage('flags.list.summary'),
      default: false,
    }),
  };

  public async run(): Promise<McpResult> {
    const { args, flags } = await this.parse(Mcp);
    const toolName = args.tool;

    try {
      // Detect capabilities
      const capabilities = await detectCapabilities();

      // Get available tools
      const tools = getAvailableTools(capabilities);

      // If --list flag or no tool specified, show available tools
      if (flags.list || !toolName) {
        this.printToolList(tools, capabilities);
        return {
          success: true,
          tool: '',
          availableTools: tools.map((t) => t.name),
        };
      }

      // Find the requested tool
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        this.error(`Unknown tool: ${toolName}\n\nRun "sf graph mcp --list" to see available tools.`);
      }

      // Parse parameters from --param flags
      const params = this.parseParams(flags.param || []);

      // Execute the tool
      this.log(`🔧 Executing: ${toolName}`);
      if (Object.keys(params).length > 0) {
        this.log(`   Params: ${JSON.stringify(params)}`);
      }

      const result = await tool.handler(params);

      // Extract and output the result
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((result as any).content?.[0]?.text) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = (result as any).content[0].text;

        // Try to pretty-print JSON
        try {
          const parsed = JSON.parse(text);
          this.log(JSON.stringify(parsed, null, 2));
          return { success: !result.isError, tool: toolName, result: parsed };
        } catch {
          this.log(text);
          return { success: !result.isError, tool: toolName, result: text };
        }
      }

      if (result.isError) {
        throw new Errors.CLIError(`Tool execution failed`);
      }

      return { success: true, tool: toolName, result };
    } finally {
      await closeDriver();
    }
  }

  /**
   * Parse --param flags into a params object
   * Supports: --param key=value or -p key=value
   */
  private parseParams(paramFlags: string[]): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    for (const param of paramFlags) {
      const [key, ...valueParts] = param.split('=');
      const value = valueParts.join('=');

      if (!key || value === undefined) {
        this.warn(`Invalid param format: ${param}. Use key=value format.`);
        continue;
      }

      // Try to parse as JSON for complex types
      try {
        params[key] = JSON.parse(value);
      } catch {
        // Use as string if not valid JSON
        params[key] = value || true;
      }
    }

    return params;
  }

  /**
   * Print list of available tools
   */
  private printToolList(tools: McpTool[], capabilities: Capabilities): void {
    this.log('');
    this.log('╔══════════════════════════════════════════════════════════════╗');
    this.log('║                    MCP Tools                                 ║');
    this.log('╚══════════════════════════════════════════════════════════════╝');
    this.log('');
    this.log('Capabilities:');
    this.log(`  Neo4j:  ${capabilities.neo4j ? '✅' : '❌'}`);
    this.log(`  LLM:    ${capabilities.llm ? '✅' : '❌'}`);
    this.log(`  SF CLI: ${capabilities.sfCli ? '✅' : '❌'}`);
    this.log('');
    this.log('Available tools:');
    this.log('');

    for (const tool of tools) {
      this.log(`  ${tool.name.padEnd(25)} ${tool.description.substring(0, 50)}`);
    }

    this.log('');
    this.log('Usage:');
    this.log('  sf graph mcp <tool-name> [--param key=value ...]');
    this.log('');
    this.log('Examples:');
    this.log('  sf graph mcp list-objects');
    this.log('  sf graph mcp get-object --param apiName=Account');
    this.log('  sf graph mcp compare-schemas -p sourceOrg=prod -p targetOrg=dev');
    this.log('');
  }
}

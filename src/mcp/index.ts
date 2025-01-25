/**
 * MCP Server Factory
 *
 * Creates and configures the MCP server with capability detection
 * and dynamic tool registration.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { initNeo4jDriver, getDriver } from '../services/neo4j/index.js';
import { isLLMAvailable } from '../services/llm-service.js';
import { isSfCliInstalled } from '../services/sf-cli.js';
import { registerTools, type Capabilities } from './tools/index.js';
import { SYSTEM_PROMPTS } from '../agent/prompts.js';

/**
 * Detect available capabilities
 */
export async function detectCapabilities(): Promise<Capabilities> {
  const capabilities: Capabilities = {
    neo4j: false,
    llm: false,
    sfCli: false,
  };

  // Check Neo4j
  try {
    await initNeo4jDriver();
    const driver = getDriver();
    if (driver) {
      capabilities.neo4j = true;
    }
  } catch (error) {
    console.warn('⚠️  Neo4j not available:', (error as Error).message);
  }

  // Check LLM (Ollama)
  try {
    capabilities.llm = await isLLMAvailable();
  } catch (error) {
    console.warn('⚠️  LLM not available:', (error as Error).message);
  }

  // Check SF CLI
  try {
    capabilities.sfCli = await isSfCliInstalled();
  } catch (error) {
    console.warn('⚠️  SF CLI not available:', (error as Error).message);
  }

  return capabilities;
}

interface CreateMcpServerOptions {
  skipCapabilityCheck?: boolean;
}

interface CreateMcpServerResult {
  server: McpServer;
  capabilities: Capabilities;
  toolCount: number;
}

/**
 * Create and configure an MCP server instance
 */
export async function createMcpServer(
  options: CreateMcpServerOptions = {}
): Promise<CreateMcpServerResult> {
  console.log('🚀 Creating MCP Server...');

  // Detect capabilities unless skipped
  const capabilities = options.skipCapabilityCheck
    ? { neo4j: true, llm: true, sfCli: true }
    : await detectCapabilities();

  console.log('\n📊 Capabilities:');
  console.log(`  Neo4j:  ${capabilities.neo4j ? '✅' : '❌'}`);
  console.log(`  LLM:    ${capabilities.llm ? '✅' : '❌'}`);
  console.log(`  SF CLI: ${capabilities.sfCli ? '✅' : '❌'}`);
  console.log('');

  // Create MCP server instance
  const server = new McpServer({
    name: 'sf-graph',
    version: '1.0.0',
  });

  // Register prompts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerPrompts(server as any);

  // Register tools based on capabilities
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolCount = registerTools(server as any, capabilities);

  console.log(`\n✅ MCP Server configured with ${toolCount} tools`);

  return { server, capabilities, toolCount };
}

// MCP Server prompt interface (loosely typed)
interface McpServerWithPrompts {
  prompt(
    name: string,
    description: string,
    handler: () => Promise<{ messages: Array<{ role: string; content: { type: string; text: string } }> }>
  ): void;
}

/**
 * Register MCP prompts for Claude Desktop and other MCP clients.
 * These prompts provide guidance for SOQL generation and schema exploration.
 */
function registerPrompts(server: McpServerWithPrompts): void {
  console.log('📝 Registering MCP prompts...');

  try {
    // SOQL Expert prompt - primary guidance for SOQL generation
    server.prompt(
      'soql-expert',
      'Expert guidance for generating valid SOQL queries. Includes rules for handling entity names, relationships, and common pitfalls.',
      async () => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: SYSTEM_PROMPTS.soqlExpert,
            },
          },
        ],
      })
    );
    console.log('  ✅ soql-expert');

    // Schema Explorer prompt
    server.prompt(
      'schema-explorer',
      'Guidance for exploring and documenting Salesforce schema. Focuses on presenting actual data clearly.',
      async () => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: SYSTEM_PROMPTS.schemaExplorer,
            },
          },
        ],
      })
    );
    console.log('  ✅ schema-explorer');
  } catch (error) {
    // Prompts may not be supported in all MCP SDK versions
    console.warn('⚠️  Could not register prompts:', (error as Error).message);
  }
}

export { registerTools };
export type { Capabilities };

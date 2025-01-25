/**
 * Salesforce Metadata Graph MCP Server
 *
 * Entry point for the MCP server. Uses the modular tool architecture
 * from src/mcp/ for capability-based tool registration.
 *
 * Usage:
 *   npm run mcp
 *
 * Prerequisites:
 *   - Neo4j running (for schema tools)
 *   - Salesforce CLI with authenticated orgs (for SOQL execution)
 *   - Ollama running (for LLM tools)
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp/index.js';

async function main(): Promise<void> {
  try {
    // Create and configure the MCP server
    const { server } = await createMcpServer();

    // Connect via STDIO transport (for Claude Desktop integration)
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error('Fatal error starting MCP server:', (error as Error).message);
    process.exit(1);
  }
}

main();

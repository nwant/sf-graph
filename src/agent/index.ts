/**
 * Agent Module
 *
 * Provides a local agentic AI experience using pluggable LLM providers
 * and the sf-graph MCP server for Salesforce schema exploration.
 */

export { Agent, type AgentOptions, type AgentMessage } from './agent.js';
export { McpClient } from './mcp-client.js';
export { convertMcpToLlmTools, type McpToolDefinition } from './tool-converter.js';
export { loadConfig, saveConfig, resetConfig, getConfigPath, type AgentConfig } from './config.js';
export { SYSTEM_PROMPTS } from './prompts.js';

/**
 * Agent Configuration
 *
 * Manages persistent configuration for the sf-graph agent.
 * Config is stored in ~/.sf-graph/agent-config.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { LlmProviderType } from '../llm/types.js';

export type EmbeddingProviderType = 'openai' | 'ollama';

export interface AgentConfig {
  /** LLM provider: 'ollama' | 'openai' | 'claude' | 'gemini' */
  provider: LlmProviderType;
  /** Model to use (provider-specific) */
  model: string;
  /** Base URL for Ollama or custom endpoints */
  baseUrl?: string;
  /** Require confirmation before executing tools (default: false) */
  confirmTools: boolean;
  /** Custom system prompt (optional) */
  systemPrompt?: string;
  /** Neo4j Bolt URI (default: bolt://localhost:7687) */
  neo4jUri: string;
  /** Neo4j Username (default: neo4j) */
  neo4jUser: string;
  /** Neo4j Password (default: password) */
  neo4jPassword: string;
  /** Neo4j data directory path for Docker volume mounts */
  neo4jDataPath?: string;
  /** OpenAI API Key */
  openaiApiKey?: string;
  /** Anthropic API Key */
  anthropicApiKey?: string;
  /** Google API Key */
  googleApiKey?: string;
  /** Default Salesforce Org Alias */
  defaultOrg?: string;
  /** REST API Server Port (default: 3000) */
  serverPort: number;
  /** REST API Server Host (default: localhost) */
  serverHost: string;
  /** Log Level (default: info) */
  logLevel: string;

  // === Embedding Configuration ===

  /** Embedding provider: 'openai' | 'ollama' (default: 'ollama') */
  embeddingProvider: EmbeddingProviderType;
  /** Embedding model name (default: 'nomic-embed-text' for ollama, 'text-embedding-3-small' for openai) */
  embeddingModel: string;

  // === Agent Roles Configuration ===
  /** Model to use for cheap/fast tasks (Decomposer, Router) */
  decomposerModel?: string;
  /** Model to use for complex/reasoning tasks (Coder, GenerateSOQL) */
  coderModel?: string;

  /** Ollama Context Window Size (default: 2048) */
  ollamaNumCtx?: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  provider: 'ollama',
  model: 'qwen2.5:3b',
  baseUrl: undefined,
  confirmTools: false,
  neo4jUri: 'bolt://localhost:7687',
  neo4jUser: 'neo4j',
  neo4jPassword: 'password',
  neo4jDataPath: undefined,
  serverPort: 3000,
  serverHost: 'localhost',
  openaiApiKey: undefined,
  anthropicApiKey: undefined,
  googleApiKey: undefined,
  defaultOrg: undefined,
  logLevel: 'info',

  embeddingProvider: 'ollama',
  embeddingModel: 'nomic-embed-text',
  
  decomposerModel: undefined,
  coderModel: undefined,
  ollamaNumCtx: undefined,
};

export const CONFIG_DESCRIPTIONS: Record<keyof AgentConfig, string> = {
  provider: "LLM provider to use ('ollama' | 'openai' | 'claude' | 'gemini')",
  model: 'Model name to use with the selected provider',
  baseUrl: 'Base URL for Ollama or custom endpoints',
  confirmTools: 'Require user confirmation before executing tools',
  systemPrompt: 'Optional custom system prompt override',
  neo4jUri: 'Neo4j Bolt URI for database connection',
  neo4jUser: 'Username for Neo4j authentication',
  neo4jPassword: 'Password for Neo4j authentication',
  neo4jDataPath: 'Path to Neo4j data directory for Docker volume mounts',
  openaiApiKey: 'API key for OpenAI',
  anthropicApiKey: 'API key for Anthropic',
  googleApiKey: 'API key for Google Gemini',
  defaultOrg: 'Default Salesforce org alias',
  serverPort: 'Port for the REST API server',
  serverHost: 'Host for the REST API server',
  logLevel: 'Logging level (trace, debug, info, warn, error, fatal)',
  embeddingProvider: "Embedding provider: 'openai' | 'ollama'",
  embeddingModel: 'Embedding model name (e.g., nomic-embed-text, text-embedding-3-small)',
  decomposerModel: 'Model override for Decomposer/Router (Fast Model)',
  coderModel: 'Model override for Coder/Generator (Strong Model)',
  ollamaNumCtx: 'Context window size for Ollama (num_ctx)',
};

/**
 * Get the path to the config directory
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.sf-graph');
}

/**
 * Get the path to the config file
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), 'agent-config.json');
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Load the agent configuration from disk
 * Returns default config if file doesn't exist
 */
export function loadConfig(): AgentConfig {
  const configPath = getConfigPath();

  let fileConfig: Partial<AgentConfig> = {};
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(content) as Partial<AgentConfig>;
    } catch (error) {
      console.warn(`Warning: Could not parse config file, using defaults: ${(error as Error).message}`);
    }
  }

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
  };
}

/**
 * Save configuration to disk
 * Merges with existing config
 */
export function saveConfig(config: Partial<AgentConfig>): void {
  ensureConfigDir();
  const configPath = getConfigPath();

  const existing = loadConfig();
  const merged = { ...existing, ...config };

  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
}

/**
 * Reset configuration to defaults
 */
export function resetConfig(): void {
  ensureConfigDir();
  const configPath = getConfigPath();

  fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
}

/**
 * Get a specific config value
 */
export function getConfigValue<K extends keyof AgentConfig>(key: K): AgentConfig[K] {
  const config = loadConfig();
  return config[key];
}

/**
 * Set a specific config value
 */
export function setConfigValue<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]): void {
  saveConfig({ [key]: value });
}

/**
 * Get all valid config keys
 */
export function getConfigKeys(): (keyof AgentConfig)[] {
  return Object.keys(DEFAULT_CONFIG) as (keyof AgentConfig)[];
}

/**
 * Check if a key is a valid config key
 */
export function isValidConfigKey(key: string): key is keyof AgentConfig {
  return key in DEFAULT_CONFIG;
}

/**
 * Parse a string value to the appropriate type for a config key
 */
export function parseConfigValue(key: keyof AgentConfig, value: string): AgentConfig[keyof AgentConfig] {
  const defaultValue = DEFAULT_CONFIG[key];

  if (typeof defaultValue === 'boolean') {
    return value.toLowerCase() === 'true';
  }
  if (typeof defaultValue === 'number') {
    const num = parseInt(value, 10);
    if (isNaN(num)) {
      throw new Error(`Invalid number value for ${key}: ${value}`);
    }
    return num;
  }
  return value;
}

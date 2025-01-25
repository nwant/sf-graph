/**
 * LLM Provider Factory
 *
 * Factory function to create LLM providers based on configuration.
 * Handles API key resolution from environment variables.
 */

import type { LlmProvider, LlmProviderType } from './types.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { ClaudeProvider } from './providers/claude-provider.js';
import { GeminiProvider } from './providers/gemini-provider.js';

/**
 * Configuration for creating a provider
 */
export interface CreateProviderConfig {
  /** Provider type */
  provider: LlmProviderType;
  /** Model to use (provider-specific) */
  model?: string;
  /** Base URL for Ollama or custom endpoints */
  baseUrl?: string;
}

/**
 * Default models for each provider
 */
const DEFAULT_MODELS: Record<LlmProviderType, string> = {
  ollama: 'llama3.1:8b',
  openai: 'gpt-4o',
  claude: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.0-flash',
};

import { loadConfig } from '../agent/config.js';

/**
 * Get API key from configuration for a provider
 */
export function getApiKey(provider: LlmProviderType): string | undefined {
  const config = loadConfig();
  switch (provider) {
    case 'openai':
      return config.openaiApiKey;
    case 'claude':
      return config.anthropicApiKey;
    case 'gemini':
      return config.googleApiKey;
    default:
      return undefined;
  }
}

/**
 * Get the default model for a provider
 */
export function getDefaultModel(provider: LlmProviderType): string {
  return DEFAULT_MODELS[provider];
}

/**
 * Check if a provider requires an API key
 */
export function requiresApiKey(provider: LlmProviderType): boolean {
  return provider !== 'ollama';
}

/**
 * Create an LLM provider instance
 *
 * @param config - Provider configuration
 * @returns LlmProvider instance
 * @throws Error if cloud provider API key is missing
 */
export function createProvider(config: CreateProviderConfig): LlmProvider {
  const { provider, model, baseUrl } = config;

  switch (provider) {
    case 'ollama':
      // Reuse loaded config if baseUrl is missing to find default
      const agentConfig = loadConfig();
      return new OllamaProvider({
        model: model || DEFAULT_MODELS.ollama,
        baseUrl: baseUrl || agentConfig.baseUrl || 'http://127.0.0.1:11434',
      });

    case 'openai': {
      const apiKey = getApiKey('openai');
      if (!apiKey) {
        throw new Error(
          'OpenAI API key is not configured. ' +
            'Set it with: sf graph config set openaiApiKey sk-...'
        );
      }
      return new OpenAIProvider({
        model: model || DEFAULT_MODELS.openai,
        apiKey,
        baseUrl,
      });
    }

    case 'claude': {
      const apiKey = getApiKey('claude');
      if (!apiKey) {
        throw new Error(
          'Anthropic API key is not configured. ' +
            'Set it with: sf graph config set anthropicApiKey sk-ant-...'
        );
      }
      return new ClaudeProvider({
        model: model || DEFAULT_MODELS.claude,
        apiKey,
        baseUrl,
      });
    }

    case 'gemini': {
      const apiKey = getApiKey('gemini');
      if (!apiKey) {
        throw new Error(
          'Google API key is not configured. ' +
            'Set it with: sf graph config set googleApiKey AIza...'
        );
      }
      return new GeminiProvider({
        model: model || DEFAULT_MODELS.gemini,
        apiKey,
      });
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Singleton provider instance (lazy initialized)
 */
let _defaultProvider: LlmProvider | null = null;

/**
 * Get the default LLM provider based on configuration
 */
export function getLlmProvider(config?: Partial<CreateProviderConfig>): LlmProvider {
  // If specific config is provided, create a fresh instance (don't use singleton)
  if (config?.provider) {
    return createProvider({
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
    } as CreateProviderConfig);
  }

  if (_defaultProvider) {
    return _defaultProvider;
  }

  const agentConfig = loadConfig();
  const provider = agentConfig.provider;
  const model = agentConfig.model;
  const baseUrl = agentConfig.baseUrl;

  _defaultProvider = createProvider({ provider, model, baseUrl });
  return _defaultProvider;
}

/**
 * Reset the default provider (for testing)
 */
export function resetLlmProvider(): void {
  _defaultProvider = null;
}

/**
 * LLM Module
 *
 * Entry point for the LLM provider abstraction layer.
 */

// Types
export type {
  LlmProviderType,
  LlmMessage,
  LlmToolCall,
  LlmToolDefinition,
  LlmToolProperty,
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmProvider,
} from './types.js';

// Factory
export {
  createProvider,
  getLlmProvider,
  resetLlmProvider,
  getApiKey,
  getDefaultModel,
  requiresApiKey,
  type CreateProviderConfig,
} from './provider-factory.js';

// Providers
export { BaseProvider, type ProviderConfig } from './providers/base-provider.js';
export { OllamaProvider } from './providers/ollama-provider.js';
export { OpenAIProvider } from './providers/openai-provider.js';
export { ClaudeProvider } from './providers/claude-provider.js';
export { GeminiProvider } from './providers/gemini-provider.js';

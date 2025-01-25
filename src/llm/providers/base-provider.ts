/**
 * Base LLM Provider
 *
 * Abstract base class with common functionality for all LLM providers.
 */

import type {
  LlmProvider,
  LlmProviderType,
  LlmMessage,
  LlmCompletionOptions,
  LlmCompletionResult,
} from '../types.js';

/**
 * Configuration passed to provider constructors
 */
export interface ProviderConfig {
  /** Model to use */
  model?: string;
  /** API key for cloud providers */
  apiKey?: string;
  /** Base URL for custom endpoints */
  baseUrl?: string;
}

/**
 * Abstract base class for LLM providers
 */
export abstract class BaseProvider implements LlmProvider {
  abstract readonly providerType: LlmProviderType;

  protected model: string;
  protected apiKey?: string;
  protected baseUrl?: string;

  constructor(config: ProviderConfig, defaultModel: string) {
    this.model = config.model || defaultModel;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }

  /**
   * Get the current model
   */
  getModel(): string {
    return this.model;
  }

  abstract generate(prompt: string, options?: LlmCompletionOptions): Promise<string>;

  abstract chat(
    messages: LlmMessage[],
    options?: LlmCompletionOptions
  ): Promise<LlmCompletionResult>;

  abstract chatStream(
    messages: LlmMessage[],
    options?: LlmCompletionOptions
  ): AsyncGenerator<string, LlmCompletionResult, undefined>;

  abstract isAvailable(): Promise<boolean>;

  abstract listModels(): Promise<string[]>;

  /**
   * Helper: Prepend system message if not already present
   */
  protected prependSystemMessage(
    messages: LlmMessage[],
    systemPrompt?: string
  ): LlmMessage[] {
    if (!systemPrompt) return messages;
    if (messages.length > 0 && messages[0].role === 'system') return messages;
    return [{ role: 'system', content: systemPrompt }, ...messages];
  }

  /**
   * Helper: Convert simple prompt to chat messages
   */
  protected promptToMessages(prompt: string, systemPrompt?: string): LlmMessage[] {
    const messages: LlmMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });
    return messages;
  }
}

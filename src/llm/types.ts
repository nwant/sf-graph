/**
 * LLM Provider Types
 *
 * Shared interfaces for the LLM provider abstraction layer.
 * Supports Ollama (local), OpenAI, Claude (Anthropic), and Gemini (Google).
 */

/**
 * Supported LLM provider types
 */
export type LlmProviderType = 'ollama' | 'openai' | 'claude' | 'gemini';

/**
 * Message format for chat completions
 */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool name (for tool messages) */
  name?: string;
  /** Tool call ID (for tool result messages) */
  toolCallId?: string;
  /** Tool calls requested by assistant */
  toolCalls?: LlmToolCall[];
}

/**
 * Tool call from the model
 */
export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool definition for the LLM
 */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, LlmToolProperty>;
    required?: string[];
  };
}

/**
 * Tool parameter property definition
 */
export interface LlmToolProperty {
  type: string;
  description?: string;
  items?: { type: string };
  enum?: string[];
}

/**
 * Options for LLM completion requests
 */
export interface LlmCompletionOptions {
  /** Model override (provider-specific) */
  model?: string;
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Top-p nucleus sampling */
  topP?: number;
  /** Top-k sampling (Ollama/Gemini) */
  topK?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** System prompt to prepend */
  systemPrompt?: string;
  /** Available tools for function calling */
  tools?: LlmToolDefinition[];
  /** Response format hint */
  responseFormat?: 'text' | 'json';
  /** Context window size (e.g. num_ctx for Ollama) */
  contextWindow?: number;
}

/**
 * Result from a chat completion
 */
export interface LlmCompletionResult {
  /** Generated text content */
  content: string;
  /** Tool calls requested by the model */
  toolCalls?: LlmToolCall[];
  /** Reason the model stopped generating */
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  /** Token usage statistics */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * LLM Provider interface
 *
 * All providers must implement this interface.
 */
export interface LlmProvider {
  /** Provider type identifier */
  readonly providerType: LlmProviderType;

  /**
   * Generate a completion from a simple prompt
   * @param prompt - The text prompt
   * @param options - Generation options
   * @returns Generated text
   */
  generate(prompt: string, options?: LlmCompletionOptions): Promise<string>;

  /**
   * Chat completion with message history
   * @param messages - Conversation messages
   * @param options - Generation options
   * @returns Completion result with content and optional tool calls
   */
  chat(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<LlmCompletionResult>;

  /**
   * Streaming chat completion
   * @param messages - Conversation messages
   * @param options - Generation options
   * @yields String chunks as they're generated
   * @returns Final completion result
   */
  chatStream(
    messages: LlmMessage[],
    options?: LlmCompletionOptions
  ): AsyncGenerator<string, LlmCompletionResult, undefined>;

  /**
   * Check if the provider is available and configured
   * @returns True if ready to use
   */
  isAvailable(): Promise<boolean>;

  /**
   * List available models for this provider
   * @returns Array of model identifiers
   */
  listModels(): Promise<string[]>;
}

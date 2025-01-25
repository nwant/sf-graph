/**
 * Ollama Provider
 *
 * LLM provider implementation for local Ollama server.
 */

import { Ollama } from 'ollama';
import { BaseProvider, type ProviderConfig } from './base-provider.js';
import type {
  LlmProviderType,
  LlmMessage,
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmToolDefinition,
  LlmToolCall,
  LlmToolProperty,
} from '../types.js';

const DEFAULT_MODEL = 'llama3.1:8b';
const DEFAULT_HOST = 'http://127.0.0.1:11434';

/**
 * Ollama tool property type (matches SDK expectations)
 */
interface OllamaToolProperty {
  type?: string | string[];
  items?: { type: string };
  description?: string;
  enum?: unknown[];
}

/**
 * Ollama-specific tool format
 */
interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, OllamaToolProperty>;
      required: string[];
    };
  };
}

/**
 * Ollama message format
 */
interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
}

export class OllamaProvider extends BaseProvider {
  readonly providerType: LlmProviderType = 'ollama';
  private client: Ollama;

  constructor(config: ProviderConfig = {}) {
    super(config, DEFAULT_MODEL);
    this.client = new Ollama({
      host: config.baseUrl || DEFAULT_HOST,
    });
  }

  async generate(prompt: string, options: LlmCompletionOptions = {}): Promise<string> {
    const response = await this.client.generate({
      model: options.model || this.model,
      prompt,
      system: options.systemPrompt,
      format: options.responseFormat === 'json' ? 'json' : undefined,
      options: {
        temperature: options.temperature,
        top_p: options.topP,
        top_k: options.topK,
        num_predict: options.maxTokens,
        num_ctx: options.contextWindow,
      },
    });

    return response.response;
  }

  async chat(
    messages: LlmMessage[],
    options: LlmCompletionOptions = {}
  ): Promise<LlmCompletionResult> {
    const ollamaMessages = this.convertMessages(messages, options.systemPrompt);
    const tools = options.tools ? this.convertTools(options.tools) : undefined;

    const response = await this.client.chat({
      model: options.model || this.model,
      messages: ollamaMessages,
      tools,
      format: options.responseFormat === 'json' ? 'json' : undefined,
      options: {
        temperature: options.temperature,
        top_p: options.topP,
        top_k: options.topK,
        num_predict: options.maxTokens,
        num_ctx: options.contextWindow,
      },
      stream: false,
    });

    return {
      content: response.message.content,
      toolCalls: this.extractToolCalls(response.message.tool_calls),
      finishReason: response.message.tool_calls?.length ? 'tool_calls' : 'stop',
    };
  }

  async *chatStream(
    messages: LlmMessage[],
    options: LlmCompletionOptions = {}
  ): AsyncGenerator<string, LlmCompletionResult, undefined> {
    const ollamaMessages = this.convertMessages(messages, options.systemPrompt);
    const tools = options.tools ? this.convertTools(options.tools) : undefined;

    const stream = await this.client.chat({
      model: options.model || this.model,
      messages: ollamaMessages,
      tools,
      format: options.responseFormat === 'json' ? 'json' : undefined,
      options: {
        temperature: options.temperature,
        top_p: options.topP,
        top_k: options.topK,
        num_predict: options.maxTokens,
        num_ctx: options.contextWindow,
      },
      stream: true,
    });

    let fullContent = '';
    let toolCalls: LlmToolCall[] | undefined;

    for await (const chunk of stream) {
      if (chunk.message.content) {
        fullContent += chunk.message.content;
        yield chunk.message.content;
      }
      if (chunk.message.tool_calls) {
        toolCalls = this.extractToolCalls(chunk.message.tool_calls);
      }
    }

    return {
      content: fullContent,
      toolCalls,
      finishReason: toolCalls?.length ? 'tool_calls' : 'stop',
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.list();
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.list();
      return response.models.map((m) => m.name);
    } catch {
      return [];
    }
  }

  /**
   * Check if a model exists, and pull it if it doesn't.
   * Rejects if the Ollama server is unreachable.
   */
  async ensureModelExists(modelName: string): Promise<boolean> {
    try {
      // 1. Check if model exists
      const currentModels = await this.listModels();
      // Handle tags (e.g. qwen2.5:3b) matching
      const exists = currentModels.some(m => m === modelName || m.startsWith(modelName + ':'));
      
      if (exists) {
        return true;
      }

      // 2. Pull model if missing
      console.log(`📦 Model '${modelName}' not found locally. Pulling from Ollama registry...`);
      const stream = await this.client.pull({ model: modelName, stream: true });
      
      let lastStatus = '';
      for await (const part of stream) {
        if (part.status && part.status !== lastStatus) {
            lastStatus = part.status;
            if (part.total && part.completed) {
                const percent = Math.round((part.completed / part.total) * 100);
                process.stdout.write(`\r   ${part.status}: ${percent}%`);
            } else {
                process.stdout.write(`\r   ${part.status}`);
            }
        }
      }
      process.stdout.write('\n'); // Newline after pull
      console.log(`✅ Successfully pulled '${modelName}'`);
      
      return true;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to pull model '${modelName}': ${error.message}. Is Ollama running?`);
      }
      throw error;
    }
  }

  /**
   * Convert LlmMessage[] to Ollama format
   */
  private convertMessages(messages: LlmMessage[], systemPrompt?: string): OllamaMessage[] {
    const result: OllamaMessage[] = [];

    // Prepend system prompt if provided and not already present
    if (systemPrompt && (messages.length === 0 || messages[0].role !== 'system')) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      const ollamaMsg: OllamaMessage = {
        role: msg.role,
        content: msg.content,
      };

      if (msg.toolCalls) {
        ollamaMsg.tool_calls = msg.toolCalls.map((tc) => ({
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }

      result.push(ollamaMsg);
    }

    return result;
  }

  /**
   * Convert LlmToolDefinition[] to Ollama format
   */
  private convertTools(tools: LlmToolDefinition[]): OllamaTool[] {
    return tools.map((tool) => {
      // Convert properties to Ollama format
      const properties: Record<string, OllamaToolProperty> = {};
      for (const [key, prop] of Object.entries(tool.parameters.properties)) {
        const typedProp = prop as LlmToolProperty;
        properties[key] = {
          type: typedProp.type,
          description: typedProp.description,
          items: typedProp.items,
          enum: typedProp.enum,
        };
      }

      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object' as const,
            properties,
            required: tool.parameters.required || [],
          },
        },
      };
    });
  }

  /**
   * Extract tool calls from Ollama response
   */
  private extractToolCalls(
    toolCalls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>
  ): LlmToolCall[] | undefined {
    if (!toolCalls || toolCalls.length === 0) return undefined;

    return toolCalls.map((tc, index) => ({
      id: `call_${index}`,
      name: tc.function.name,
      arguments:
        typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments,
    }));
  }
}

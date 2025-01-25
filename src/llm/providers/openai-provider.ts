/**
 * OpenAI Provider
 *
 * LLM provider implementation for OpenAI API.
 */

import OpenAI from 'openai';
import { BaseProvider, type ProviderConfig } from './base-provider.js';
import type {
  LlmProviderType,
  LlmMessage,
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmToolDefinition,
  LlmToolCall,
} from '../types.js';

const DEFAULT_MODEL = 'gpt-4o';

/**
 * OpenAI message format
 */
type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;

/**
 * OpenAI tool format
 */
type OpenAITool = OpenAI.Chat.ChatCompletionTool;

export class OpenAIProvider extends BaseProvider {
  readonly providerType: LlmProviderType = 'openai';
  private client: OpenAI;

  constructor(config: ProviderConfig = {}) {
    super(config, DEFAULT_MODEL);
    if (!config.apiKey) {
      throw new Error("OpenAI API key is required. Run 'sf graph config set openaiApiKey <key>' or 'sf graph ai config' to set it.");
    }
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async generate(prompt: string, options: LlmCompletionOptions = {}): Promise<string> {
    const messages = this.promptToMessages(prompt, options.systemPrompt);
    const result = await this.chat(messages, options);
    return result.content;
  }

  async chat(
    messages: LlmMessage[],
    options: LlmCompletionOptions = {}
  ): Promise<LlmCompletionResult> {
    const openaiMessages = this.convertMessages(messages, options.systemPrompt);
    const tools = options.tools ? this.convertTools(options.tools) : undefined;

    const response = await this.client.chat.completions.create({
      model: options.model || this.model,
      messages: openaiMessages,
      tools,
      temperature: options.temperature,
      top_p: options.topP,
      max_tokens: options.maxTokens,
      response_format:
        options.responseFormat === 'json' ? { type: 'json_object' } : undefined,
    });

    const choice = response.choices[0];
    const message = choice.message;

    return {
      content: message.content || '',
      toolCalls: this.extractToolCalls(message.tool_calls),
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *chatStream(
    messages: LlmMessage[],
    options: LlmCompletionOptions = {}
  ): AsyncGenerator<string, LlmCompletionResult, undefined> {
    const openaiMessages = this.convertMessages(messages, options.systemPrompt);
    const tools = options.tools ? this.convertTools(options.tools) : undefined;

    const stream = await this.client.chat.completions.create({
      model: options.model || this.model,
      messages: openaiMessages,
      tools,
      temperature: options.temperature,
      top_p: options.topP,
      max_tokens: options.maxTokens,
      stream: true,
    });

    let fullContent = '';
    const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
    let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        fullContent += delta.content;
        yield delta.content;
      }

      // Accumulate tool calls from deltas
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallsMap.get(tc.index);
          if (existing) {
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
            }
          } else {
            toolCallsMap.set(tc.index, {
              id: tc.id || `call_${tc.index}`,
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            });
          }
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        finishReason = this.mapFinishReason(chunk.choices[0].finish_reason);
      }
    }

    // Convert accumulated tool calls
    const toolCalls: LlmToolCall[] = [];
    for (const [, tc] of toolCallsMap) {
      try {
        toolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: JSON.parse(tc.arguments || '{}'),
        });
      } catch {
        // Skip malformed tool calls
      }
    }

    return {
      content: fullContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      return response.data
        .filter((m) => m.id.startsWith('gpt-'))
        .map((m) => m.id);
    } catch {
      return [];
    }
  }

  /**
   * Convert LlmMessage[] to OpenAI format
   */
  private convertMessages(messages: LlmMessage[], systemPrompt?: string): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    // Prepend system prompt if provided
    if (systemPrompt && (messages.length === 0 || messages[0].role !== 'system')) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        result.push({ role: 'system', content: msg.content });
      } else if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: msg.content,
        };
        if (msg.toolCalls) {
          assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        result.push(assistantMsg);
      } else if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId || '',
        });
      }
    }

    return result;
  }

  /**
   * Convert LlmToolDefinition[] to OpenAI format
   */
  private convertTools(tools: LlmToolDefinition[]): OpenAITool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      },
    }));
  }

  /**
   * Extract tool calls from OpenAI response
   */
  private extractToolCalls(
    toolCalls?: OpenAI.Chat.ChatCompletionMessageToolCall[]
  ): LlmToolCall[] | undefined {
    if (!toolCalls || toolCalls.length === 0) return undefined;

    return toolCalls
      .filter((tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: 'function' } => 
        tc.type === 'function'
      )
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }));
  }

  /**
   * Map OpenAI finish reason to our format
   */
  private mapFinishReason(
    reason: string | null
  ): 'stop' | 'tool_calls' | 'length' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'tool_calls':
        return 'tool_calls';
      case 'length':
        return 'length';
      default:
        return 'stop';
    }
  }
}

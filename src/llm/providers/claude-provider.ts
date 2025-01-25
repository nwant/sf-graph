/**
 * Claude Provider
 *
 * LLM provider implementation for Anthropic's Claude API.
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider, type ProviderConfig } from './base-provider.js';
import type {
  LlmProviderType,
  LlmMessage,
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmToolDefinition,
  LlmToolCall,
} from '../types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export class ClaudeProvider extends BaseProvider {
  readonly providerType: LlmProviderType = 'claude';
  private client: Anthropic;

  constructor(config: ProviderConfig = {}) {
    super(config, DEFAULT_MODEL);
    if (!config.apiKey) {
      throw new Error("Anthropic API key is required. Run 'sf graph config set anthropicApiKey <key>' or 'sf graph ai config' to set it.");
    }
    this.client = new Anthropic({
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
    const { systemPrompt, anthropicMessages } = this.convertMessages(messages, options.systemPrompt);
    const tools = options.tools ? this.convertTools(options.tools) : undefined;

    const response = await this.client.messages.create({
      model: options.model || this.model,
      max_tokens: options.maxTokens || 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      tools,
      temperature: options.temperature,
      top_p: options.topP,
    });

    // Extract content from response
    let textContent = '';
    const toolCalls: LlmToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapStopReason(response.stop_reason),
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  async *chatStream(
    messages: LlmMessage[],
    options: LlmCompletionOptions = {}
  ): AsyncGenerator<string, LlmCompletionResult, undefined> {
    const { systemPrompt, anthropicMessages } = this.convertMessages(messages, options.systemPrompt);
    const tools = options.tools ? this.convertTools(options.tools) : undefined;

    const stream = this.client.messages.stream({
      model: options.model || this.model,
      max_tokens: options.maxTokens || 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      tools,
      temperature: options.temperature,
      top_p: options.topP,
    });

    let fullContent = '';
    const toolCalls: LlmToolCall[] = [];
    let currentToolUse: { id: string; name: string; input: string } | null = null;
    let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            input: '',
          };
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          fullContent += event.delta.text;
          yield event.delta.text;
        } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
          currentToolUse.input += event.delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolUse) {
          try {
            toolCalls.push({
              id: currentToolUse.id,
              name: currentToolUse.name,
              arguments: JSON.parse(currentToolUse.input || '{}'),
            });
          } catch {
            // Skip malformed tool calls
          }
          currentToolUse = null;
        }
      } else if (event.type === 'message_delta') {
        finishReason = this.mapStopReason(event.delta.stop_reason);
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
      // Simple test - try to create a minimal message
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    // Anthropic doesn't have a models list API, return known models
    return [
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ];
  }

  /**
   * Convert LlmMessage[] to Anthropic format
   * Extracts system prompt separately as Anthropic requires it
   */
  private convertMessages(
    messages: LlmMessage[],
    systemPromptOption?: string
  ): { systemPrompt?: string; anthropicMessages: Anthropic.MessageParam[] } {
    let systemPrompt = systemPromptOption;
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Anthropic handles system prompt separately
        systemPrompt = msg.content;
      } else if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }
        anthropicMessages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId || '',
              content: msg.content,
            },
          ],
        });
      }
    }

    return { systemPrompt, anthropicMessages };
  }

  /**
   * Convert LlmToolDefinition[] to Anthropic format
   */
  private convertTools(tools: LlmToolDefinition[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }));
  }

  /**
   * Map Anthropic stop reason to our format
   */
  private mapStopReason(
    reason: string | null | undefined
  ): 'stop' | 'tool_calls' | 'length' | 'error' {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'tool_use':
        return 'tool_calls';
      case 'max_tokens':
        return 'length';
      default:
        return 'stop';
    }
  }
}

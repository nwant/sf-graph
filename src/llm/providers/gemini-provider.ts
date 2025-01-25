/**
 * Gemini Provider
 *
 * LLM provider implementation for Google's Gemini API.
 */

import {
  GoogleGenerativeAI,
  type GenerativeModel,
  type Content,
  type Part,
} from '@google/generative-ai';
import { BaseProvider, type ProviderConfig } from './base-provider.js';
import type {
  LlmProviderType,
  LlmMessage,
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmToolDefinition,
  LlmToolCall,
} from '../types.js';

const DEFAULT_MODEL = 'gemini-2.0-flash';

export class GeminiProvider extends BaseProvider {
  readonly providerType: LlmProviderType = 'gemini';
  private client: GoogleGenerativeAI;

  constructor(config: ProviderConfig = {}) {
    super(config, DEFAULT_MODEL);
    if (!config.apiKey) {
      throw new Error("Google API key is required. Run 'sf graph config set googleApiKey <key>' or 'sf graph ai config' to set it.");
    }
    this.client = new GoogleGenerativeAI(config.apiKey);
  }

  private createModel(modelName?: string, tools?: LlmToolDefinition[]): GenerativeModel {
    const modelConfig: { model: string; tools?: unknown[] } = {
      model: modelName || this.model,
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      modelConfig.tools = [
        {
          functionDeclarations: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: {
              type: 'OBJECT',
              properties: this.convertProperties(tool.parameters.properties),
              required: tool.parameters.required || [],
            },
          })),
        },
      ];
    }

    return this.client.getGenerativeModel(modelConfig as Parameters<typeof this.client.getGenerativeModel>[0]);
  }

  /**
   * Convert tool properties to Gemini schema format
   */
  private convertProperties(
    properties: Record<string, unknown>
  ): Record<string, { type: string; description?: string }> {
    const result: Record<string, { type: string; description?: string }> = {};
    for (const [key, value] of Object.entries(properties)) {
      const prop = value as { type?: string; description?: string };
      result[key] = {
        type: (prop.type || 'STRING').toUpperCase(),
        description: prop.description,
      };
    }
    return result;
  }

  async generate(prompt: string, options: LlmCompletionOptions = {}): Promise<string> {
    const model = this.createModel(options.model);

    const config: {
      contents: Content[];
      generationConfig: Record<string, unknown>;
      systemInstruction?: string;
    } = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        maxOutputTokens: options.maxTokens,
        responseMimeType: options.responseFormat === 'json' ? 'application/json' : undefined,
      },
    };

    if (options.systemPrompt) {
      config.systemInstruction = options.systemPrompt;
    }

    const result = await model.generateContent(config);

    return result.response.text();
  }

  async chat(
    messages: LlmMessage[],
    options: LlmCompletionOptions = {}
  ): Promise<LlmCompletionResult> {
    const model = this.createModel(options.model, options.tools);
    const { systemInstruction, contents } = this.convertMessages(messages, options.systemPrompt);

    const config: {
      contents: Content[];
      generationConfig: Record<string, unknown>;
      systemInstruction?: string;
    } = {
      contents,
      generationConfig: {
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        maxOutputTokens: options.maxTokens,
      },
    };

    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    const result = await model.generateContent(config);
    const response = result.response;
    const candidate = response.candidates?.[0];

    // Extract text and function calls
    let textContent = '';
    const toolCalls: LlmToolCall[] = [];

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if ('text' in part && part.text) {
          textContent += part.text;
        } else if ('functionCall' in part && part.functionCall) {
          toolCalls.push({
            id: `call_${toolCalls.length}`,
            name: part.functionCall.name,
            arguments: (part.functionCall.args || {}) as Record<string, unknown>,
          });
        }
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapFinishReason(candidate?.finishReason),
      usage: response.usageMetadata
        ? {
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            completionTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    };
  }

  async *chatStream(
    messages: LlmMessage[],
    options: LlmCompletionOptions = {}
  ): AsyncGenerator<string, LlmCompletionResult, undefined> {
    const model = this.createModel(options.model, options.tools);
    const { systemInstruction, contents } = this.convertMessages(messages, options.systemPrompt);

    const config: {
      contents: Content[];
      generationConfig: Record<string, unknown>;
      systemInstruction?: string;
    } = {
      contents,
      generationConfig: {
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        maxOutputTokens: options.maxTokens,
      },
    };

    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    const result = await model.generateContentStream(config);

    let fullContent = '';
    const toolCalls: LlmToolCall[] = [];
    let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';

    for await (const chunk of result.stream) {
      const candidate = chunk.candidates?.[0];

      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if ('text' in part && part.text) {
            fullContent += part.text;
            yield part.text;
          } else if ('functionCall' in part && part.functionCall) {
            toolCalls.push({
              id: `call_${toolCalls.length}`,
              name: part.functionCall.name,
              arguments: (part.functionCall.args || {}) as Record<string, unknown>,
            });
          }
        }
      }

      if (candidate?.finishReason) {
        finishReason = this.mapFinishReason(candidate.finishReason);
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
      const model = this.createModel();
      await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        generationConfig: { maxOutputTokens: 1 },
      });
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    // Gemini doesn't have a public models list API, return known models
    return ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'];
  }

  /**
   * Convert LlmMessage[] to Gemini format
   */
  private convertMessages(
    messages: LlmMessage[],
    systemPromptOption?: string
  ): { systemInstruction?: string; contents: Content[] } {
    let systemPrompt = systemPromptOption;
    const contents: Content[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        const parts: Part[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            });
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        // Tool responses in Gemini are added as function response parts
        contents.push({
          role: 'function' as 'user', // Cast for TS - Gemini uses 'function' role
          parts: [
            {
              functionResponse: {
                name: msg.name || 'unknown',
                response: { result: msg.content },
              },
            },
          ],
        });
      }
    }

    return {
      systemInstruction: systemPrompt,
      contents,
    };
  }

  /**
   * Map Gemini finish reason to our format
   */
  private mapFinishReason(reason: string | undefined): 'stop' | 'tool_calls' | 'length' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
      case 'OTHER':
        return 'error';
      default:
        return 'stop';
    }
  }
}

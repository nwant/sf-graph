/**
 * Agent
 *
 * Core agent that uses the LLM provider abstraction for reasoning
 * and the MCP client for tool execution.
 * Supports multiple LLM providers: Ollama, OpenAI, Claude, Gemini.
 */

import { createProvider, type LlmProvider, type LlmMessage, type LlmToolCall } from '../llm/index.js';
import { McpClient } from './mcp-client.js';
import { ToolExecutor, InProcessToolExecutor, McpToolExecutor, type InProcessToolExecutorOptions } from './tool-registry.js';
import { getSystemPrompt, type SystemPromptKey } from './prompts.js';
import { loadConfig } from './config.js';

export interface AgentOptions {
  /** LLM provider: 'ollama' | 'openai' | 'claude' | 'gemini' */
  provider?: 'ollama' | 'openai' | 'claude' | 'gemini';
  /** Model to use (provider-specific) */
  model?: string;
  /** System prompt key or custom prompt */
  systemPrompt?: string | SystemPromptKey;
  /** Stream tokens as they're generated */
  stream?: boolean;
  /** Require confirmation before tool execution (from config if not specified) */
  confirmTools?: boolean;
  /** Show verbose output (tool calls, timing) */
  verbose?: boolean;
  /** Callback for streaming tokens */
  onToken?: (token: string) => void;
  /** Callback for tool execution (for confirmation) */
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  /** Callback for verbose output */
  onVerbose?: (message: string) => void;
  /** Tool executor (defaults to MCP subprocess if not provided) */
  toolExecutor?: ToolExecutor;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: LlmToolCall[];
}

export class Agent {
  private provider: LlmProvider;
  private toolExecutor: ToolExecutor;
  private options: Required<Omit<AgentOptions, 'onToken' | 'onToolCall' | 'onVerbose' | 'provider' | 'toolExecutor'>> &
    Pick<AgentOptions, 'onToken' | 'onToolCall' | 'onVerbose'>;
  private conversationHistory: LlmMessage[] = [];
  private initialized = false;

  constructor(options: AgentOptions = {}) {
    const config = loadConfig();

    this.options = {
      model: options.model || config.model,
      systemPrompt: options.systemPrompt || 'default',
      stream: options.stream ?? true,
      confirmTools: options.confirmTools ?? config.confirmTools,
      verbose: options.verbose ?? false,
      onToken: options.onToken,
      onToolCall: options.onToolCall,
      onVerbose: options.onVerbose,
    };

    // Create provider based on options or config
    const providerType = options.provider || config.provider;
    this.provider = createProvider({
      provider: providerType,
      model: this.options.model,
      baseUrl: config.baseUrl,
    });

    // Use provided executor or default to MCP subprocess
    if (options.toolExecutor) {
      this.toolExecutor = options.toolExecutor;
    } else {
      this.toolExecutor = new McpToolExecutor(new McpClient());
    }
  }

  /**
   * Factory to create an Agent with in-process tool execution
   * Optimized for CLI usage where subprocess overhead is undesirable
   */
  static createWithInProcessTools(options: AgentOptions & InProcessToolExecutorOptions = {}): Agent {
    const executor = new InProcessToolExecutor({
      capabilities: options.capabilities,
      toolFilter: options.toolFilter,
    });
    
    return new Agent({
      ...options,
      toolExecutor: executor,
    });
  }

  /**
   * Initialize the agent (connect to tool executor)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.toolExecutor.connect();

    // Set up system prompt
    const systemPrompt = this.resolveSystemPrompt();
    this.conversationHistory.push({
      role: 'system',
      content: systemPrompt,
    });

    this.initialized = true;
  }

  /**
   * Resolve the system prompt from key or custom string
   */
  private resolveSystemPrompt(): string {
    const promptInput = this.options.systemPrompt;

    // Check if it's a known prompt key
    if (promptInput === 'default' || promptInput === 'soqlExpert' || promptInput === 'schemaExplorer') {
      return getSystemPrompt(promptInput);
    }

    // Otherwise treat as custom prompt
    return promptInput;
  }

  /**
   * Log verbose message
   */
  private verbose(message: string): void {
    if (this.options.verbose && this.options.onVerbose) {
      this.options.onVerbose(message);
    }
  }

  /**
   * Get tools in LlmToolDefinition format
   */
  private getTools() {
    return this.toolExecutor.getTools();
  }

  /**
   * Chat with the agent (non-streaming)
   */
  async chat(message: string): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: message,
    });

    // Get available tools
    const tools = this.getTools();

    // Call LLM provider
    const response = await this.provider.chat(this.conversationHistory, { tools });

    // Handle tool calls if present
    if (response.toolCalls && response.toolCalls.length > 0) {
      return await this.handleToolCalls({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });
    }

    // Add assistant response to history
    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
    });

    return response.content;
  }

  /**
   * Chat with streaming response
   */
  async *chatStream(message: string): AsyncGenerator<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: message,
    });

    // Get available tools
    const tools = this.getTools();

    // Call LLM provider with streaming
    const stream = this.provider.chatStream(this.conversationHistory, { tools });

    let fullContent = '';
    let toolCalls: LlmToolCall[] | undefined;

    for await (const chunk of stream) {
      fullContent += chunk;
      yield chunk;
    }

    // Get final result from generator
    const result = await stream.next();
    if (result.done && result.value) {
      toolCalls = result.value.toolCalls;
    }

    // Handle tool calls if present
    if (toolCalls && toolCalls.length > 0) {
      const toolResponse = await this.handleToolCalls({
        role: 'assistant',
        content: fullContent,
        toolCalls,
      });
      yield '\n' + toolResponse;
    } else {
      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: fullContent,
      });
    }
  }

  /**
   * Handle tool calls from the model
   */
  private async handleToolCalls(assistantMessage: LlmMessage): Promise<string> {
    if (!assistantMessage.toolCalls) {
      return assistantMessage.content;
    }

    // Add the assistant message with tool calls to history
    this.conversationHistory.push(assistantMessage);

    // Execute each tool call
    for (const toolCall of assistantMessage.toolCalls) {
      const { id, name, arguments: args } = toolCall;

      this.verbose(`🔧 Calling: ${name}`);
      this.verbose(`   Params: ${JSON.stringify(args)}`);

      // Check for confirmation if enabled
      if (this.options.confirmTools && this.options.onToolCall) {
        const confirmed = await this.options.onToolCall(name, args);
        if (!confirmed) {
          this.conversationHistory.push({
            role: 'tool',
            content: `Tool call "${name}" was cancelled by user.`,
            toolCallId: id,
            name,
          });
          continue;
        }
      }

      // Execute the tool
      const startTime = Date.now();
      const result = await this.toolExecutor.callTool(name, args);
      const duration = Date.now() - startTime;

      this.verbose(`   ✓ ${duration}ms`);

      // Add tool result to history
      this.conversationHistory.push({
        role: 'tool',
        content: result.content,
        toolCallId: id,
        name,
      });
    }

    // Get the final response from the model with tool results
    const tools = this.getTools();
    const response = await this.provider.chat(this.conversationHistory, { tools });

    // Check for more tool calls (recursive)
    if (response.toolCalls && response.toolCalls.length > 0) {
      return await this.handleToolCalls({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });
    }

    // Add final response to history
    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
    });

    return response.content;
  }

  /**
   * Clear conversation history (keep system prompt)
   */
  clearHistory(): void {
    const systemMessage = this.conversationHistory[0];
    this.conversationHistory = systemMessage ? [systemMessage] : [];
  }

  /**
   * Get conversation history
   */
  getHistory(): AgentMessage[] {
    return this.conversationHistory
      .filter((msg) => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'tool',
        content: msg.content,
        toolCalls: msg.toolCalls,
      }));
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    await this.toolExecutor.disconnect();
    this.initialized = false;
  }

  /**
   * Get the model being used
   */
  getModel(): string {
    return this.options.model;
  }

  /**
   * Get the provider type being used
   */
  getProviderType(): string {
    return this.provider.providerType;
  }

  /**
   * Check if agent is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

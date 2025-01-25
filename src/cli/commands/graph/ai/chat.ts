/**
 * sf graph ai chat
 *
 * Interactive AI chat for Salesforce schema exploration.
 */

// plain import removed
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages } from '@salesforce/core';
import * as readline from 'node:readline';
import { Agent } from '../../../../agent/agent.js';
import { loadConfig } from '../../../../agent/config.js';
import { parseModelFlag } from '../../../utils/model-parser.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.ai.chat');

export type ChatResult = {
  success: boolean;
  provider: string;
  model: string;
  messageCount: number;
  error?: string;
};

export default class Chat extends SfCommand<ChatResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    query: Args.string({
      description: messages.getMessage('args.query.description'),
      required: false,
    }),
  };

  public static readonly flags = {
    'target-org': Flags.string({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
    }),
    model: Flags.string({
      char: 'm',
      summary: messages.getMessage('flags.model.summary'),
      env: 'SF_GRAPH_MODEL',
    }),
    stream: Flags.boolean({
      summary: messages.getMessage('flags.stream.summary'),
      default: true,
      allowNo: true,
    }),
    history: Flags.boolean({
      summary: messages.getMessage('flags.history.summary'),
      allowNo: true,
    }),
    verbose: Flags.boolean({
      char: 'v',
      summary: messages.getMessage('flags.verbose.summary'),
      default: false,
    }),
  };

  private agent: Agent | null = null;
  private messageCount = 0;

  public async run(): Promise<ChatResult> {
    const { args, flags } = await this.parse(Chat);
    const config = loadConfig();

    // Parse model flag: supports "provider:model" format
    const { provider, model } = parseModelFlag(flags.model);

    // Create agent with options
    this.agent = new Agent({
      provider,
      model,
      stream: flags.stream,
      confirmTools: config.confirmTools,
      verbose: flags.verbose,
      onVerbose: (message) => this.log(message),
      onToolCall: async (name, toolArgs) => {
        // If confirmTools is enabled, prompt for confirmation
        if (config.confirmTools) {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          return new Promise((resolve) => {
            rl.question(`Execute ${name}(${JSON.stringify(toolArgs)})? [Y/n] `, (answer) => {
              rl.close();
              resolve(answer.toLowerCase() !== 'n');
            });
          });
        }
        return true;
      },
    });

    try {
      // Initialize agent (connects to MCP server)
      await this.agent.initialize();

      // Single query mode
      if (args.query) {
        const response = await this.processQuery(args.query, flags.stream);
        // Only log if not streaming (streaming already wrote to stdout)
        if (!flags.stream) {
          this.log(response);
        }
        return {
          success: true,
          provider: this.agent.getProviderType(),
          model: this.agent.getModel(),
          messageCount: 1,
        };
      }

      // Interactive mode
      return await this.runInteractive(flags.stream);
    } catch (error) {
      const errorMessage = (error as Error).message;
      
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
        this.error(
          'Could not connect to Ollama. Make sure Ollama is running:\n\n' +
            '  ollama serve\n\n' +
            'Then pull a model:\n\n' +
            '  ollama pull llama3.1:8b'
        );
      }

      return {
        success: false,
        provider: this.agent?.getProviderType() || 'unknown',
        model: this.agent?.getModel() || 'unknown',
        messageCount: this.messageCount,
        error: errorMessage,
      };
    } finally {
      if (this.agent) {
        await this.agent.disconnect();
      }
    }
  }

  /**
   * Process a single query
   */
  private async processQuery(query: string, stream: boolean): Promise<string> {
    if (!this.agent) {
      throw new Error('Agent not initialized');
    }

    this.messageCount++;

    if (stream) {
      let fullResponse = '';
      for await (const token of this.agent.chatStream(query)) {
        process.stdout.write(token);
        fullResponse += token;
      }
      process.stdout.write('\n');
      return fullResponse;
    } else {
      return await this.agent.chat(query);
    }
  }

  /**
   * Run interactive chat mode
   */
  private async runInteractive(stream: boolean): Promise<ChatResult> {
    if (!this.agent) {
      throw new Error('Agent not initialized');
    }

    const model = this.agent.getModel();

    // Print welcome message
    this.log('');
    this.log(`🤖 Salesforce Schema Assistant (${model})`);
    this.log("   Type 'exit' to quit, 'clear' to reset conversation");
    this.log('');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Handle Ctrl+C gracefully
    rl.on('SIGINT', () => {
      this.log('\n\n👋 Goodbye!');
      rl.close();
    });

    const prompt = (): Promise<void> => {
      return new Promise((resolve) => {
        rl.question('You: ', async (input) => {
          const trimmed = input.trim();

          if (!trimmed) {
            resolve();
            return prompt();
          }

          // Handle special commands
          if (trimmed.toLowerCase() === 'exit') {
            this.log('\n👋 Goodbye!');
            rl.close();
            resolve();
            return;
          }

          if (trimmed.toLowerCase() === 'clear') {
            this.agent!.clearHistory();
            this.log('🗑️  Conversation cleared\n');
            resolve();
            return prompt();
          }

          // Process the query
          try {
            this.log('');
            await this.processQuery(trimmed, stream);
            this.log('');
          } catch (error) {
            this.log(`❌ Error: ${(error as Error).message}\n`);
          }

          resolve();
          return prompt();
        });
      });
    };

    await prompt();

    return {
      success: true,
      provider: this.agent?.getProviderType() || 'unknown',
      model,
      messageCount: this.messageCount,
    };
  }
}

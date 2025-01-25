import { SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import inquirer from 'inquirer';
import { saveConfig, loadConfig, type AgentConfig } from '../../../../agent/config.js';
import { EMBEDDING_MODELS, getDefaultModel } from '../../../../config/embedding-config.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.embeddings.config');

export type EmbeddingsConfigResult = {
  success: boolean;
  provider: string;
  model: string;
};

export default class EmbeddingsConfig extends SfCommand<EmbeddingsConfigResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public async run(): Promise<EmbeddingsConfigResult> {
    const currentConfig = loadConfig();

    this.log('🧠  Embeddings Configuration Wizard');
    this.log('   This wizard will help you configure embedding settings.');
    this.log('');

    // Step 1: Select provider
    const providerAnswer = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Select Embedding Provider:',
        choices: [
          { name: 'Ollama (Local)', value: 'ollama' },
          { name: 'OpenAI (Cloud)', value: 'openai' },
        ],
        default: currentConfig.embeddingProvider || 'ollama',
      },
    ]);

    const provider = providerAnswer.provider as 'openai' | 'ollama';
    const modelOptions = EMBEDDING_MODELS[provider].options;
    const defaultModel = getDefaultModel(provider);

    // Step 2: Select model
    const modelAnswer = await inquirer.prompt([
      {
        type: 'list',
        name: 'model',
        message: 'Select Embedding Model:',
        choices: modelOptions.map((m) => ({
          name: m === defaultModel ? `${m} (recommended)` : m,
          value: m,
        })),
        default: currentConfig.embeddingModel || defaultModel,
      },
    ]);

    // Step 3: OpenAI API key if needed
    let configUpdates: Partial<AgentConfig> = {
      embeddingProvider: provider,
      embeddingModel: modelAnswer.model,
    };

    if (provider === 'openai') {
      const hasExistingKey = !!currentConfig.openaiApiKey;
      
      if (!hasExistingKey) {
        const keyAnswer = await inquirer.prompt([
          {
            type: 'password',
            name: 'apiKey',
            message: 'OpenAI API Key (required for OpenAI embeddings):',
            mask: '*',
            validate: (input) => input ? true : 'API Key is required for OpenAI',
          },
        ]);
        configUpdates.openaiApiKey = keyAnswer.apiKey;
      } else {
        this.log('   ✓ Using existing OpenAI API key from configuration');
      }
    }

    // Confirmation
    this.log('');
    this.log('📝 Configuration to save:');
    this.log(`   Provider: ${configUpdates.embeddingProvider}`);
    this.log(`   Model:    ${configUpdates.embeddingModel}`);

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Save configuration?',
        default: true,
      },
    ]);

    if (confirm) {
      saveConfig(configUpdates);
      this.log('');
      this.log('✅ Configuration saved successfully.');
      this.log('');
      this.log('💡 Next steps:');
      this.log('   1. Run `sf graph embeddings init` to create vector indexes');
      this.log('   2. Run `sf graph embeddings generate` to generate embeddings for your org');
    } else {
      this.log('');
      this.log('❌ Configuration cancelled.');
    }

    return {
      success: confirm,
      provider: configUpdates.embeddingProvider!,
      model: configUpdates.embeddingModel!,
    };
  }
}


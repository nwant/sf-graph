import { SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import inquirer from 'inquirer';
import { saveConfig, loadConfig, type AgentConfig } from '../../../../agent/config.js';
import { ensureOllamaModelIfNeeded } from '../../../utils/model-utils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.ai.config');

export type AiConfigResult = {
  success: boolean;
  provider: string;
  model: string;
  baseUrl?: string;
};

export default class AiConfig extends SfCommand<AiConfigResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  
  public static readonly aliases = ['graph:config:ai'];

  public async run(): Promise<AiConfigResult> {
    const currentConfig = loadConfig();

    this.log('🤖  AI Configuration Wizard');
    this.log('   This wizard will help you configure your LLM provider settings.');
    this.log('');

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Select AI Provider:',
        choices: [
          { name: 'Ollama (Local)', value: 'ollama' },
          { name: 'OpenAI (Cloud)', value: 'openai' },
          { name: 'Anthropic Claude (Cloud)', value: 'claude' },
          { name: 'Google Gemini (Cloud)', value: 'gemini' },
        ],
        default: currentConfig.provider,
      },
    ]);

    const provider = answers.provider as AgentConfig['provider'];
    let configUpdates: Partial<AgentConfig> = { provider };
    
    // Provider specific configuration
    if (provider === 'ollama') {
      const ollamaConfig = await inquirer.prompt([
        {
          type: 'input',
          name: 'baseUrl',
          message: 'Ollama Base URL:',
          default: currentConfig.baseUrl || 'http://127.0.0.1:11434',
        },
        {
          type: 'input',
          name: 'model',
          message: 'Model Name:',
          default: currentConfig.model || 'llama3.1:8b',
        },
      ]);
      
      configUpdates = { ...configUpdates, ...ollamaConfig };
    } else {
      // Cloud providers (OpenAI, Claude, Gemini)
      
      // Determine which API key to ask for
      let apiKeyField: keyof AgentConfig | undefined;
      let apiKeyMessage = 'API Key:';
      let defaultModel = '';
      
      switch (provider) {
        case 'openai':
          apiKeyField = 'openaiApiKey';
          apiKeyMessage = 'OpenAI API Key:';
          defaultModel = 'gpt-4o';
          break;
        case 'claude':
          apiKeyField = 'anthropicApiKey';
          apiKeyMessage = 'Anthropic API Key:';
          defaultModel = 'claude-sonnet-4-20250514';
          break;
        case 'gemini':
          apiKeyField = 'googleApiKey';
          apiKeyMessage = 'Google API Key:';
          defaultModel = 'gemini-2.0-flash';
          break;
      }

      if (apiKeyField) {
        const cloudConfig = await inquirer.prompt([
          {
            type: 'password',
            name: 'apiKey',
            message: apiKeyMessage,
            mask: '*',
            // Show [configured] if exists, but don't show value
            default: currentConfig[apiKeyField] ? undefined : undefined,
            validate: (input) => {
               if (!input && !currentConfig[apiKeyField!]) {
                   return 'API Key is required';
               }
               return true;
            }
          },
          {
            type: 'input',
            name: 'model',
            message: 'Model Name:',
            default: currentConfig.model || defaultModel,
          },
          {
            type: 'confirm',
            name: 'customBaseUrl',
            message: 'Do you want to use a custom Base URL (e.g. for a proxy)?',
            default: false,
          }
        ]);

        // Only update API key if entered
        if (cloudConfig.apiKey) {
          configUpdates[apiKeyField] = cloudConfig.apiKey;
        }
        
        configUpdates.model = cloudConfig.model;
        
        if (cloudConfig.customBaseUrl) {
           const urlPrompt = await inquirer.prompt([{
               type: 'input',
               name: 'baseUrl',
               message: 'Custom Base URL:',
               default: currentConfig.baseUrl,
               validate: (input) => input ? true : 'URL is required'
           }]);
           configUpdates.baseUrl = urlPrompt.baseUrl;
        } else {
           // Explicitly unset baseUrl for cloud providers unless custom
           configUpdates.baseUrl = undefined;
        }
      }
    }

    // Confirmation
    this.log('');
    this.log('📝 Configuration to save:');
    this.log(`   Provider: ${configUpdates.provider}`);
    this.log(`   Model:    ${configUpdates.model}`);
    
    if (configUpdates.baseUrl === undefined && provider !== 'ollama') {
        this.log(`   Base URL: (using default SDK endpoint)`);
    } else {
        this.log(`   Base URL: ${configUpdates.baseUrl}`);
    } 

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: 'Save configuration?',
            default: true
        }
    ]);

    if (confirm) {
        saveConfig(configUpdates);
        this.log('');
        this.log('✅ Configuration saved successfully.');

        // Auto-pull for Ollama models
        if (configUpdates.model) {
            await ensureOllamaModelIfNeeded(configUpdates.provider, configUpdates.model, configUpdates.baseUrl);
        }
    } else {
        this.log('');
        this.log('❌ Configuration cancelled.');
    }

    return {
        success: confirm,
        provider: configUpdates.provider!,
        model: configUpdates.model!,
        baseUrl: configUpdates.baseUrl
    };
  }
}

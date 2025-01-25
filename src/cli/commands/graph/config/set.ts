import { SfCommand } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages } from '@salesforce/core';
import {
  saveConfig,
  loadConfig,
  isValidConfigKey,
  parseConfigValue,
  getConfigKeys,
  type AgentConfig,
} from '../../../../agent/config.js';

import { parseModelFlag } from '../../../utils/model-parser.js';
import { ensureOllamaModelIfNeeded } from '../../../utils/model-utils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.config.set');

export type ConfigSetResult = {
  success: boolean;
  key: string;
  value: unknown;
  message?: string;
};

export default class ConfigSet extends SfCommand<ConfigSetResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    key: Args.string({
      description: 'Configuration key to set',
      required: true,
    }),
    value: Args.string({
      description: 'Value to set',
      required: true,
    }),
  };

  public async run(): Promise<ConfigSetResult> {
    const { args } = await this.parse(ConfigSet);
    
    // Validate key
    if (!isValidConfigKey(args.key)) {
      const validKeys = getConfigKeys().join(', ');
      this.error(`Invalid configuration key: ${args.key}\n\nValid keys: ${validKeys}`);
    }

    // Special handling for 'model' key to support 'provider:model' syntax
    if (args.key === 'model' || args.key === 'decomposerModel' || args.key === 'coderModel') {
      let provider: AgentConfig['provider'] | undefined;
      let model = args.key === 'model' ? args.value : undefined; // Only parse split for generic 'model' key

      if (args.key === 'model') {
        const parsed = parseModelFlag(args.value);
        provider = parsed.provider as AgentConfig['provider'];
        model = parsed.model;
        
        saveConfig({ provider, model });
        this.log(`✅ Set provider = ${provider}`);
        this.log(`✅ Set model = ${model}`);
      } else {
        // For decomposer/coderModel, we just set the value directly
        model = args.value;
        // Parse provider if user supplied "ollama:model" format for these specific keys
        if (model.includes(':') && !model.includes(' ')) {
             // Heuristic: check if start is a known provider
             if (model.startsWith('ollama:') || model.startsWith('openai:') || model.startsWith('claude:') || model.startsWith('gemini:')) {
                 const split = model.split(':');
                 // For overrides, we don't save the provider globally, but we might check if it's ollama for pulling
                 if (split[0] === 'ollama') {
                     // strip provider prefix for the pull check if it's ollama
                     // but we usually save the pure model name for overrides unless semantic
                 }
             }
        }

        saveConfig({ [args.key]: args.value });
        this.log(`✅ Set ${args.key} = ${args.value}`);
      }
      
      // Auto-pull for Ollama models
      // Check if effective provider is Ollama
      const currentConfig = loadConfig();
      const effectiveProvider = provider || currentConfig.provider;

      await ensureOllamaModelIfNeeded(effectiveProvider, model!, currentConfig.baseUrl);

      return { 
        success: true, 
        key: args.key, 
        value: args.value, 
        message: `Set ${args.key} to ${args.value}` 
      };
    }

    // Set value
    try {
      const parsedValue = parseConfigValue(args.key as keyof AgentConfig, args.value);
      saveConfig({ [args.key]: parsedValue });
      
      const displayValue = typeof parsedValue === 'string' ? parsedValue : JSON.stringify(parsedValue);
      this.log(`✅ Set ${args.key} = ${displayValue}`);
      
      return { success: true, key: args.key, value: parsedValue, message: `Set ${args.key}` };
    } catch (error) {
      if (error instanceof Error) {
        this.error(`Failed to set ${args.key}: ${error.message}`);
      } else {
        this.error(`Failed to set ${args.key}: Unknown error`);
      }
    }
  }
}

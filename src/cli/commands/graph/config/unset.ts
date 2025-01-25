import { SfCommand } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages } from '@salesforce/core';
import {
  saveConfig,
  isValidConfigKey,
  getConfigKeys,
} from '../../../../agent/config.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.config.unset');

export type ConfigUnsetResult = {
  success: boolean;
  key: string;
  message?: string;
};

export default class ConfigUnset extends SfCommand<ConfigUnsetResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    key: Args.string({
      description: 'Configuration key to unset',
      required: true,
    }),
  };

  public async run(): Promise<ConfigUnsetResult> {
    const { args } = await this.parse(ConfigUnset);
    
    // Validate key
    if (!isValidConfigKey(args.key)) {
      const validKeys = getConfigKeys().join(', ');
      this.error(`Invalid configuration key: ${args.key}\n\nValid keys: ${validKeys}`);
    }

    // Unset value (set to undefined)
    try {
      saveConfig({ [args.key]: undefined });
      
      this.log(`✅ Unset ${args.key}`);
      
      return { success: true, key: args.key, message: `Unset ${args.key}` };
    } catch (error) {
      if (error instanceof Error) {
        this.error(`Failed to unset ${args.key}: ${error.message}`);
      } else {
        this.error(`Failed to unset ${args.key}: Unknown error`);
      }
    }
  }
}

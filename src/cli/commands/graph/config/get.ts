import { SfCommand } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages } from '@salesforce/core';
import { loadConfig, isValidConfigKey, type AgentConfig } from '../../../../agent/config.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.config.get');

export type ConfigGetResult = { key: string; value: unknown };

export default class ConfigGet extends SfCommand<ConfigGetResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    key: Args.string({
      description: 'Configuration key to get',
      required: true,
    }),
  };

  public async run(): Promise<ConfigGetResult> {
    const { args } = await this.parse(ConfigGet);
    
    if (!isValidConfigKey(args.key)) {
      this.error(`Invalid configuration key: ${args.key}`);
    }

    const config = loadConfig();
    const value = config[args.key as keyof AgentConfig];

    // Check if --json is passed (handled by SfCommand automatically for return value, but we might want structured log if not)
    // For human readable output:
    if (typeof value === 'string') {
      this.log(value);
    } else {
      this.log(JSON.stringify(value));
    }

    return { key: args.key, value };
  }
}

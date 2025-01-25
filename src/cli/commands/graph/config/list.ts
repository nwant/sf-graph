import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { loadConfig, getConfigKeys, CONFIG_DESCRIPTIONS, type AgentConfig } from '../../../../agent/config.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.config.list');

export type ConfigListResult = Array<{ key: string; value: unknown; description?: string; originalValue?: unknown }>;

export default class ConfigList extends SfCommand<ConfigListResult> {
  // ... (unchanged static properties) ...
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    verbose: Flags.boolean({
      summary: messages.getMessage('flags.verbose.summary'),
      char: 'v',
    }),
  };

  public async run(): Promise<ConfigListResult> {
    const { flags } = await this.parse(ConfigList);
    const config = loadConfig();
    let result: ConfigListResult = [];
    const keys = getConfigKeys();
    const maxKeyLength = Math.max(...keys.map((k) => k.length));

    this.log('');
    this.log('Configured Values:');
    this.log('');

    // Configuration for resolving defaults
    const { llmConfig } = await import('../../../../config/llm-config.js');
    
    for (const key of keys) {
      let value = config[key];
      let displayValue = value;

      // Resolve effective defaults if not set
      if (value === undefined) {
        if (key === 'decomposerModel') {
           // Default is decomposer model (usually fast model)
           displayValue = llmConfig.taskParams.decomposer.model + ' (default)';
        } else if (key === 'coderModel') {
           // Default is coder model (usually strong model)
           displayValue = llmConfig.taskParams.coder.model + ' (default)';
        } else if (key === 'ollamaNumCtx' && config.provider === 'ollama') {
           // Default context window for ollama
           displayValue = llmConfig.defaultParams.contextWindow + ' (default)';
        } else if (key === 'neo4jDataPath') {
           displayValue = '(uses docker volume)';
        }
      }

      // Mask sensitive values
      if ((key.toLowerCase().includes('password') || key.toLowerCase().includes('token') || key.toLowerCase().includes('key')) && value !== undefined) {
        displayValue = '******';
      }
      
      result.push({ key, value: displayValue, originalValue: value });
    }

// ... unchanged
    if (flags.verbose) {
       // Enrich result with descriptions for JSON output
       result = result.map(item => ({
         ...item,
         description: CONFIG_DESCRIPTIONS[item.key as keyof AgentConfig] || ''
       }));

       const tableData = result.map(item => ({
          key: item.key,
          value: formatValue(item.value),
          description: item.description
       }));

       // Force 'all' border style to get grid view (row separators)
       // We must use the env var because SfCommand.table ignores the borderStyle option in defaults
       process.env.SF_TABLE_BORDER_STYLE = 'all';
       this.table({
         data: tableData,
         columns: [
           { key: 'key', name: 'Key' },
           { key: 'value', name: 'Value' },
           { key: 'description', name: 'Description' }
         ],
         overflow: 'wrap',
         title: 'Configuration'
       });
       delete process.env.SF_TABLE_BORDER_STYLE;
    } else {
      for (const item of result) {
         this.log(`  ${item.key.padEnd(maxKeyLength + 2)}${formatValue(item.value)}`);
      }
    }
    this.log('');
    return result;
  }
}

function formatValue(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined) {
        return '(not set)';
    }
    return JSON.stringify(value);
}

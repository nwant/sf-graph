import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { resetConfig } from '../../../../agent/config.js';
import confirm from '@inquirer/confirm';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.config.reset');

export default class Reset extends SfCommand<void> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    force: Flags.boolean({
      char: 'f',
      summary: messages.getMessage('flags.force.summary'),
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Reset);

    // Prompt for confirmation unless --force is used
    if (!flags.force) {
      const confirmed = await confirm({
        message: '⚠️  This will reset ALL configuration to factory defaults. Continue?',
        default: false,
      });

      if (!confirmed) {
        this.log('❌ Reset cancelled.');
        return;
      }
    }

    try {
      resetConfig();
      this.log('✅ Configuration reset to factory defaults.');
      this.log('');
      this.log('ℹ️  You will need to reconfigure:');
      this.log('   • Neo4j connection: sf graph db config');
      this.log('   • LLM provider: sf graph ai config');
      this.log('   • Default org: sf graph org config');
    } catch (error) {
      this.error(
        `Failed to reset configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

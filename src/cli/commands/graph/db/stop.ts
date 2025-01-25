import { SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { execSync } from 'node:child_process';
import { findComposeFile } from '../../../utils/docker.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.db.stop');

export type DbStopResult = {
  success: boolean;
  message: string;
};

export default class DbStop extends SfCommand<DbStopResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public async run(): Promise<DbStopResult> {
    const composeFile = findComposeFile();
    if (!composeFile) {
      throw new Error(
        'Could not find docker-compose.yml. Please run this command from the sf-graph project directory, ' +
          'or ensure docker-compose.yml is in your current directory.'
      );
    }

    this.log('Stopping Neo4j...');

    execSync(`docker compose -f ${composeFile} down`, { stdio: 'inherit' });

    this.log('');
    this.log('Neo4j stopped successfully.');

    return {
      success: true,
      message: 'Neo4j stopped successfully',
    };
  }
}

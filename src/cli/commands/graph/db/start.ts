import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { execSync, spawn } from 'node:child_process';
import { loadConfig } from '../../../../agent/config.js';
import { findComposeFile, getDefaultDataPath, ensureDataDirectories } from '../../../utils/docker.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.db.start');

export type DbStartResult = {
  success: boolean;
  dataPath: string;
  message: string;
};

export default class DbStart extends SfCommand<DbStartResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    detach: Flags.boolean({
      char: 'd',
      summary: messages.getMessage('flags.detach.summary'),
      default: true,
    }),
  };

  public async run(): Promise<DbStartResult> {
    const { flags } = await this.parse(DbStart);
    const config = loadConfig();

    const dataPath = config.neo4jDataPath || getDefaultDataPath();

    // Ensure directories exist
    const { created } = ensureDataDirectories(dataPath);
    for (const dir of created) {
      this.log(`Created directory: ${dir}`);
    }

    const composeFile = findComposeFile();
    if (!composeFile) {
      throw new Error(
        'Could not find docker-compose.yml. Please run this command from the sf-graph project directory, ' +
          'or ensure docker-compose.yml is in your current directory.'
      );
    }

    const env = {
      ...process.env,
      NEO4J_DATA_PATH: dataPath,
      NEO4J_USERNAME: config.neo4jUser || 'neo4j',
      NEO4J_PASSWORD: config.neo4jPassword || 'password',
    };

    this.log(`Starting Neo4j with data path: ${dataPath}`);

    const args = ['compose', '-f', composeFile, 'up'];
    if (flags.detach) {
      args.push('-d');
    }

    if (flags.detach) {
      execSync(`docker ${args.join(' ')}`, { env, stdio: 'inherit' });
      this.log('');
      this.log('Neo4j started successfully.');
      this.log(`Data persisted to: ${dataPath}`);
      this.log('Run "sf graph db stop" to stop the database.');
    } else {
      const child = spawn('docker', args, { env, stdio: 'inherit' });
      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Docker exited with code ${code}`))));
        child.on('error', reject);
      });
    }

    return {
      success: true,
      dataPath,
      message: 'Neo4j started successfully',
    };
  }
}

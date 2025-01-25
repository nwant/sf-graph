import { SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import inquirer from 'inquirer';
import neo4j from 'neo4j-driver';
import { saveConfig, loadConfig, type AgentConfig } from '../../../../agent/config.js';
import { getDefaultDataPath, ensureDataDirectories } from '../../../utils/docker.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.db.config');

export type DbConfigResult = {
  success: boolean;
  uri: string;
  user: string;
  dataPath?: string;
  verified: boolean;
};

export default class DbConfig extends SfCommand<DbConfigResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  
  public static readonly aliases = ['graph:config:db'];

  public async run(): Promise<DbConfigResult> {
    const currentConfig = loadConfig();

    this.log('🗄️  Database Configuration Wizard');
    this.log('   This wizard will help you configure your Neo4j connection.');
    this.log('');

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'uri',
        message: 'Neo4j Bolt URI:',
        default: currentConfig.neo4jUri || 'bolt://localhost:7687',
        validate: (input) => input ? true : 'URI is required',
      },
      {
        type: 'input',
        name: 'user',
        message: 'Username:',
        default: currentConfig.neo4jUser || 'neo4j',
        validate: (input) => input ? true : 'Username is required',
      },
      {
        type: 'password',
        name: 'password',
        message: currentConfig.neo4jPassword
          ? 'Password (leave blank to keep current):'
          : 'Password:',
        mask: '*',
        // For fresh setups, use 'password' to match docker-compose.yml defaults
        default: currentConfig.neo4jPassword ? undefined : 'password',
      },
      {
        type: 'input',
        name: 'dataPath',
        message: 'Data directory (for Docker volume persistence):',
        default: currentConfig.neo4jDataPath || getDefaultDataPath(),
        validate: (input) => input ? true : 'Data path is required',
      },
    ]);

    // Construct updates
    const updates: Partial<AgentConfig> = {
        neo4jUri: answers.uri,
        neo4jUser: answers.user,
        neo4jDataPath: answers.dataPath,
    };
    if (answers.password) {
        updates.neo4jPassword = answers.password;
    }
    const passwordToUse = answers.password || currentConfig.neo4jPassword;

    // Ensure data directories exist
    ensureDataDirectories(answers.dataPath);

    // Confirmation
    this.log('');
    this.log('📝 Configuration to save:');
    this.log(`   URI:       ${updates.neo4jUri}`);
    this.log(`   Username:  ${updates.neo4jUser}`);
    this.log(`   Password:  ******`);
    this.log(`   Data Path: ${updates.neo4jDataPath}`);

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: 'Save configuration?',
            default: true
        }
    ]);

    let verified = false;

    if (confirm) {
        if (this.shouldUpdatePassword(answers.password, currentConfig.neo4jPassword)) {
            await this.updatePasswordOnServer(
                answers.password!,
                currentConfig,
                updates.neo4jUri || currentConfig.neo4jUri || 'bolt://localhost:7687',
                updates.neo4jUser || currentConfig.neo4jUser || 'neo4j'
            );
        }

        saveConfig(updates);
        this.log('');
        this.log('✅ Configuration saved successfully.');

        // Verify connection
        this.log('Testing connection...');
        const driver = neo4j.driver(
            updates.neo4jUri!,
            neo4j.auth.basic(updates.neo4jUser!, passwordToUse)
        );
        
        try {
            await driver.verifyConnectivity();
            this.log('✅ Connection verified successfully.');
            verified = true;
        } catch (err: unknown) {
            const error = err as Error;
            this.warn(`⚠️  Could not connect to Neo4j: ${error.message}`);
            this.log('   The configuration was saved, but please check your database status.');
        } finally {
            await driver.close();
        }

    } else {
        this.log('');
        this.log('❌ Configuration cancelled.');
    }

    return {
        success: confirm,
        uri: updates.neo4jUri!,
        user: updates.neo4jUser!,
        dataPath: updates.neo4jDataPath,
        verified
    };
  }

  private shouldUpdatePassword(newPassword: string | undefined, currentPassword: string | undefined): boolean {
    return !!(newPassword && currentPassword && newPassword !== currentPassword);
  }

  private async updatePasswordOnServer(newPassword: string, currentConfig: AgentConfig, uri: string, user: string): Promise<void> {
    this.log('🔄 Detected password change. Attempting to update database server...');
    try {
        // Connect with OLD credentials
        const tempDriver = neo4j.driver(
            uri,
            neo4j.auth.basic(user, currentConfig.neo4jPassword)
        );
        
        await tempDriver.verifyConnectivity();
        
        const session = tempDriver.session();
        try {
            await session.run(`ALTER USER neo4j SET PASSWORD $newPassword CHANGE NOT REQUIRED`, {
                newPassword
            });
             this.log('✅ Database password updated successfully.');
        } finally {
            await session.close();
            await tempDriver.close();
        }
    } catch (err) {
        const error = err as Error;
        this.warn(`⚠️  Could not update database password: ${error.message}`);
        this.log('   We will still save the configuration, but you might need to update the database manually.');
    }
    this.log('');
  }
}

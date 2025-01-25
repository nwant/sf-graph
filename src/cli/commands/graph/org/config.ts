import { SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import inquirer from 'inquirer';
import { saveConfig, loadConfig } from '../../../../agent/config.js';
import { apiService } from '../../../../core/index.js';
import type { OrgInfo } from '../../../../core/types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.org.config');

export type OrgConfigResult = {
  success: boolean;
  defaultOrg: string;
};

export default class OrgConfig extends SfCommand<OrgConfigResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  
  public static readonly aliases = ['graph:config:org'];

  public async run(): Promise<OrgConfigResult> {
    const currentConfig = loadConfig();

    this.log('☁️   Salesforce Org Configuration Wizard');
    this.log('   Select the default org to use with the graph plugin.');
    this.log('');

    this.spinner.start('Loading authenticated orgs...');
    let authenticatedOrgs: OrgInfo[] = [];
    try {
        const result = await apiService.listOrgs();
        authenticatedOrgs = result.authenticated;
    } catch (error) {
        this.spinner.stop('failed');
        throw error;
    }
    this.spinner.stop();

    if (authenticatedOrgs.length === 0) {
        this.warn('No authenticated orgs found. Please authenticate with `sf org login web` first.');
        return { success: false, defaultOrg: '' };
    }

    const { selectedOrg } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedOrg',
        message: 'Select Default Org:',
        choices: authenticatedOrgs.map(org => {
            const alias = org.alias ? `(${org.alias})` : '';
            const name = `${org.username} ${alias}`;
            // Use alias if available, otherwise username
            const value = org.alias || org.username;
            const isCurrentDefault = value === currentConfig.defaultOrg;
            
            return {
                name: isCurrentDefault ? `${name} [Current Default]` : name,
                value: value
            };
        }),
        default: currentConfig.defaultOrg,
      },
    ]);

    // Confirmation
    this.log('');
    this.log('📝 Configuration to save:');
    this.log(`   Default Org: ${selectedOrg}`);

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: 'Save configuration?',
            default: true
        }
    ]);

    if (confirm) {
        saveConfig({ defaultOrg: selectedOrg });
        this.log('');
        this.log('✅ Configuration saved successfully.');
    } else {
        this.log('');
        this.log('❌ Configuration cancelled.');
    }

    return {
        success: confirm,
        defaultOrg: selectedOrg
    };
  }
}

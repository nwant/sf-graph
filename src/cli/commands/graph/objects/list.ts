/**
 * sf graph objects list
 *
 * List all Salesforce objects in the metadata graph.
 */

import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { apiService } from '../../../../core/index.js';
import type { SalesforceObject } from '../../../../core/types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.objects.list');

export type ObjectListResult = {
  objects: Array<{
    apiName: string;
    label: string;
    category: string;
  }>;
  total: number;
};

export default class List extends SfCommand<ObjectListResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    custom: Flags.boolean({
      char: 'c',
      summary: messages.getMessage('flags.custom.summary'),
      default: false,
    }),
    standard: Flags.boolean({
      char: 's',
      summary: messages.getMessage('flags.standard.summary'),
      default: false,
    }),
    json: Flags.boolean({
      summary: 'Format output as json.',
      default: false,
    }),
  };

  public async run(): Promise<ObjectListResult> {
    try {
      const { flags } = await this.parse(List);

      this.spinner.start('Loading objects from graph...');
      const objects = await apiService.listObjects();
      this.spinner.stop();

      // Apply filters
      let filtered: SalesforceObject[] = objects;
      if (flags.custom && !flags.standard) {
        filtered = objects.filter((o: SalesforceObject) => o.category === 'custom');
      } else if (flags.standard && !flags.custom) {
        filtered = objects.filter((o: SalesforceObject) => o.category === 'standard');
      }

      // Sort alphabetically
      filtered.sort((a: SalesforceObject, b: SalesforceObject) => a.apiName.localeCompare(b.apiName));

      if (!flags.json) {
        this.log(`\n📦 ${filtered.length} objects in graph:\n`);

        // Group into custom and standard
        const customObjects = filtered.filter((o: SalesforceObject) => o.category === 'custom');
        const standardObjects = filtered.filter((o: SalesforceObject) => o.category === 'standard');

        if (standardObjects.length > 0) {
          this.log('Standard Objects:');
          for (const obj of standardObjects) {
            this.log(`  • ${obj.apiName} (${obj.label})`);
          }
        }

        if (customObjects.length > 0) {
          this.log('\nCustom Objects:');
          for (const obj of customObjects) {
            this.log(`  • ${obj.apiName} (${obj.label})`);
          }
        }
      }

      return {
        objects: filtered.map((o: SalesforceObject) => ({
          apiName: o.apiName,
          label: o.label,
          category: o.category,
        })),
        total: filtered.length,
      };
    } finally {
      await apiService.cleanup();
    }
  }
}

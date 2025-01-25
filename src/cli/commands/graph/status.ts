/**
 * sf graph status
 *
 * Check if the metadata graph has been populated and get sync status.
 */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { apiService } from '../../../core/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.status');

export type StatusResult = {
  populated: boolean;
  objectCount: number;
  lastSyncedAt?: string;
  orgId?: string;
};

export default class Status extends SfCommand<StatusResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.optionalOrg({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
      description: messages.getMessage('flags.target-org.description'),
    }),
  };

  public async run(): Promise<StatusResult> {
    try {
      const { flags } = await this.parse(Status);
      const org = flags['target-org'];
      const orgId = org?.getOrgId();

      const status = await apiService.getGraphStatus(orgId);

      if (status.populated) {
        this.log(`✅ Graph populated with ${status.objectCount} objects`);
        if (status.lastSyncedAt) {
          this.log(`   Last synced: ${status.lastSyncedAt}`);
        }
      } else {
        this.log('❌ Graph is empty. Run "sf graph sync" to populate it.');
      }

      return {
        populated: status.populated,
        objectCount: status.objectCount,
        lastSyncedAt: status.lastSyncedAt,
        orgId: status.orgId,
      };
    } finally {
      await apiService.cleanup();
    }
  }
}

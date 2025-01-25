/**
 * sf graph org list
 *
 * List authenticated orgs and their sync status.
 */

import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { apiService } from '../../../../core/index.js';
import type { OrgInfo, OrgStatus } from '../../../../core/types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.org.list');

export type OrgListResult = {
  authenticated: OrgInfo[];
  synced: OrgStatus[];
  total: number;
};

export default class List extends SfCommand<OrgListResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    synced: Flags.boolean({
      char: 's',
      summary: messages.getMessage('flags.synced.summary'),
      default: false,
    }),
    json: Flags.boolean({
      summary: 'Format output as json.',
      default: false,
    }),
  };

  public async run(): Promise<OrgListResult> {
    try {
      const { flags } = await this.parse(List);

      this.spinner.start('Loading orgs...');
      const result = await apiService.listOrgs();
      this.spinner.stop();

      const { authenticated, synced } = result;

      // Build a map of synced org details for quick lookup
      const syncedOrgMap = new Map(synced.map((s: OrgStatus) => [s.orgId, s]));

      if (!flags.json) {
        this.log(`\n🏢 ${authenticated.length} authenticated org(s):\n`);

        for (const org of authenticated) {
          const syncedOrg = org.orgId ? syncedOrgMap.get(org.orgId) : undefined;
          const isSynced = !!syncedOrg;
          
          let statusIcon = '⬜ Not synced';
          let details = '';

          if (isSynced && syncedOrg) {
            statusIcon = '✅ Synced    '; // Extra padding for alignment
            const timeAgo = syncedOrg.lastSyncedAt ? this.timeAgo(new Date(syncedOrg.lastSyncedAt)) : 'unknown time';
            const count = syncedOrg.objectCount || 0;
            const context = `${count} object${count !== 1 ? 's' : ''}, last synced ${timeAgo}`;
            details = ` (${context})`;
          }

          const defaultMarker = org.isDefault ? ' (default)' : '';
          
          // Pad alias/username for alignment
          const name = org.alias || org.username;
          
          this.log(`  ${statusIcon} ${name}${defaultMarker}${details}`);
        }

        if (synced.length > 0) {
          this.log(`\n📊 ${synced.length} org(s) synced to graph`);
        }

        this.log('');
      }

      return {
        authenticated,
        synced,
        total: authenticated.length,
      };
    } finally {
      await apiService.cleanup();
    }
  }

  private timeAgo(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + 'y ago';
    
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + 'mo ago';
    
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + 'd ago';
    
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + 'h ago';
    
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + 'm ago';
    
    return Math.floor(seconds) + 's ago';
  }
}

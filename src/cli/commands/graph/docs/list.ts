/**
 * sf graph docs list
 *
 * List available standard documentation versions.
 */

import { SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import {
  getVersionDetails,
  USER_DOCUMENTATION_DIR,
  BUNDLED_DOCUMENTATION_DIR,
  type VersionInfo,
} from '../../../../services/neo4j/standard-documentation.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.docs.list');

export interface ListResult {
  versions: VersionInfo[];
  userDir: string;
  bundledDir: string;
}

export default class List extends SfCommand<ListResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly enableJsonFlag = true;

  public async run(): Promise<ListResult> {
    const versions = getVersionDetails();
    
    if (versions.length === 0) {
      this.log(messages.getMessage('info.noVersions'));
      this.log(`\nRun: sf graph docs extract <version>`);
      return { versions: [], userDir: USER_DOCUMENTATION_DIR, bundledDir: BUNDLED_DOCUMENTATION_DIR };
    }

    this.log(messages.getMessage('info.header'));
    this.log('');
    
    const formatSize = (bytes: number): string => {
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };
    
    const formatDate = (iso: string): string => {
      try {
        return new Date(iso).toLocaleDateString('en-US', { 
          year: 'numeric', month: 'short', day: 'numeric' 
        });
      } catch {
        return iso;
      }
    };

    // Simple table
    this.log('  Version   Objects   Size      Updated');
    this.log('  ───────   ───────   ────────  ───────────────');
    
    for (const v of versions) {
      const version = `v${v.version}`.padEnd(8);
      const objects = v.objectCount.toString().padEnd(8);
      const size = formatSize(v.fileSize).padEnd(9);
      const updated = formatDate(v.lastUpdated);
      
      this.log(`  ${version}  ${objects}  ${size} ${updated}`);
    }

    return { versions, userDir: USER_DOCUMENTATION_DIR, bundledDir: BUNDLED_DOCUMENTATION_DIR };
  }
}

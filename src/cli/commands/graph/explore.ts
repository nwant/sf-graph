/**
 * sf graph explore
 *
 * Interactive CLI for navigating the Salesforce metadata graph.
 * Uses neo-blessed for a rich terminal UI with multi-pane layout.
 */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { createExplorer } from '../../explorer/index.js';
import { apiService } from '../../../core/api-service.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.explore');

export type ExploreResult = {
  success: boolean;
  history: string[];
};

export default class Explore extends SfCommand<ExploreResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.optionalOrg({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
      aliases: ['org'],
    }),
    'start-object': Flags.string({
      char: 's',
      summary: messages.getMessage('flags.start-object.summary'),
      default: 'Account',
    }),
  };

  public async run(): Promise<ExploreResult> {
    const { flags } = await this.parse(Explore);
    const orgId = flags['target-org']?.getOrgId();
    const startObject = flags['start-object'] || 'Account';

    // Suppress stdout/stderr during explorer to avoid terminal capability errors
    // (e.g., setulc on iTerm2 with xterm-256color terminfo)
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createSuppressor = (originalWrite: any) => (chunk: any, ...args: any[]) => {
      const str = typeof chunk === 'string' ? chunk : chunk?.toString?.() || '';
      // Suppress terminfo errors (setulc, escape sequences, stack manipulation code)
      if (str.includes('Setulc') || 
          str.includes('xterm-256color') || 
          str.includes('\u001b[58') ||
          str.includes('\\u001b[58') ||
          str.includes('%p1%{65536}') ||
          str.includes('stack.push') ||
          str.includes('out.push')) {
        return true;
      }
      return originalWrite(chunk, ...args);
    };

    try {
      // Create the explorer first (before suppression to allow blessed init output)
      const explorer = await createExplorer({ orgId, startObject });
      
      // Now enable suppression for the interactive session
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      process.stdout.write = createSuppressor(originalStdoutWrite) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      process.stderr.write = createSuppressor(originalStderrWrite) as any;
      
      await explorer.start(startObject);

      return {
        success: true,
        history: explorer.getHistory().map(node => node.objectName),
      };
    } finally {
      // Ensure Neo4j driver is closed
      await apiService.cleanup();
      
      // Wait for blessed cleanup to complete (it outputs debug info asynchronously)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Restore stdout/stderr for final output
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      
      // Clear screen to wipe away any debug output
      originalStdoutWrite('\x1b[2J\x1b[0;0H');
    }
  }
}

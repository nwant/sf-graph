import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages } from '@salesforce/core';
import { apiService } from '../../../../core/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.db.query');

export default class Query extends SfCommand<Record<string, unknown>[]> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    query: Args.string({
      description: messages.getMessage('flags.query.summary'),
      required: false,
    }),
  };

  public static readonly flags = {
    query: Flags.string({
      char: 'q',
      summary: messages.getMessage('flags.query.summary'),
    }),
    'target-org': Flags.optionalOrg({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
    }),
  };

  public async run(): Promise<Record<string, unknown>[]> {
    try {
      const { args, flags } = await this.parse(Query);
      let cypherQuery = args.query;

      if (flags.query) {
        if (cypherQuery) {
          throw new Error(
            'Please provide the query either as an argument or via the --query flag, but not both.'
          );
        }
        cypherQuery = flags.query;
      }

      if (!cypherQuery) {
        throw new Error('Please provide a Cypher query.');
      }

      const orgId = flags['target-org']?.getOrgId();
      const params: Record<string, unknown> = {};
      if (orgId) {
        params.orgId = orgId;
      }

      if (!this.jsonEnabled()) {
        this.spinner.start('Executing query...');
      }

      const results = await apiService.executeQuery(cypherQuery, params);

      if (!this.jsonEnabled()) {
        this.spinner.stop();

        if (results.length === 0) {
          this.log('No records found.');
        } else {
          // Dynamic table columns based on the first record
          const firstRecord = results[0];
          const columns = Object.keys(firstRecord);

          // Format data for display: stringify objects/arrays
          const tableData = results.map((row) => {
            const newRow: Record<string, string> = {};
            for (const [key, value] of Object.entries(row)) {
              if (value === null || value === undefined) {
                newRow[key] = '';
              } else if (typeof value === 'object') {
                newRow[key] = JSON.stringify(value);
              } else {
                newRow[key] = String(value);
              }
            }
            return newRow;
          });

          this.printTable(tableData, columns);
          this.log(`\nVisited ${results.length} records.`);
        }
      }

      return results;
    } finally {
      await apiService.cleanup();
    }
  }

  private printTable(rows: Record<string, string>[], columns: string[]): void {
    if (rows.length === 0 || columns.length === 0) return;

    // Calculate widths
    const widths = columns.map((col) => {
      let max = col.length;
      rows.forEach((row) => {
        const val = row[col] || '';
        if (val.length > max) max = val.length;
      });
      return max;
    });

    // Separator
    const separator = widths.map((w) => '-'.repeat(w)).join('  ');

    // Print Header
    this.log(columns.map((col, i) => col.toUpperCase().padEnd(widths[i])).join('  '));
    this.log(separator);

    // Print Rows
    rows.forEach((row) => {
      this.log(columns.map((col, i) => (row[col] || '').padEnd(widths[i])).join('  '));
    });
  }
}

/**
 * sf graph index create
 *
 * Create Neo4j indexes and constraints from config.
 */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { initNeo4jDriver, closeDriver } from '../../../../../services/neo4j/driver.js';
import { ensureIndexes, ensureConstraints, listIndexes } from '../../../../../services/neo4j/index-service.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.db.index.create');

export type IndexCreateResult = {
  success: boolean;
  indexesCreated: string[];
  indexesExisting: string[];
  constraintsCreated: string[];
  constraintsExisting: string[];
  error?: string;
};

export default class Create extends SfCommand<IndexCreateResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    show: Flags.boolean({
      summary: messages.getMessage('flags.show.summary'),
      description: 'Show current indexes without creating new ones',
      default: false,
    }),
  };

  public async run(): Promise<IndexCreateResult> {
    const { flags } = await this.parse(Create);

    try {
      // Initialize Neo4j
      const initialized = await initNeo4jDriver();
      if (!initialized) {
        this.error('Failed to connect to Neo4j. Check your configuration via "sf graph config".');
      }

      if (flags.show) {
        // Show mode: just list existing indexes
        this.spinner.start('Fetching indexes...');
        const indexes = await listIndexes();
        this.spinner.stop();

        this.log('\n📊 Current Indexes and Constraints:\n');

        const indexItems = indexes.filter(i => i.type === 'index');
        const constraintItems = indexes.filter(i => i.type === 'constraint');

        if (indexItems.length > 0) {
          this.log('Indexes:');
          for (const idx of indexItems) {
            this.log(`  • ${idx.name} on :${idx.label}(${idx.properties.join(', ')}) [${idx.state}]`);
          }
        }

        if (constraintItems.length > 0) {
          this.log('\nConstraints:');
          for (const con of constraintItems) {
            this.log(`  • ${con.name} on :${con.label}(${con.properties.join(', ')})`);
          }
        }

        if (indexes.length === 0) {
          this.log('  No indexes or constraints found.');
        }

        return {
          success: true,
          indexesCreated: [],
          indexesExisting: indexItems.map(i => i.name),
          constraintsCreated: [],
          constraintsExisting: constraintItems.map(c => c.name),
        };
      }

      // Create mode
      this.spinner.start('Creating indexes...');
      const indexResult = await ensureIndexes();
      this.spinner.stop();

      this.spinner.start('Creating constraints...');
      const constraintResult = await ensureConstraints();
      this.spinner.stop();

      // Report results
      this.log('\n✅ Index Management Complete:\n');

      if (indexResult.created.length > 0) {
        this.log('Created indexes:');
        for (const idx of indexResult.created) {
          this.log(`  + ${idx}`);
        }
      }

      if (constraintResult.created.length > 0) {
        this.log('\nCreated constraints:');
        for (const con of constraintResult.created) {
          this.log(`  + ${con}`);
        }
      }

      if (indexResult.existing.length > 0 || constraintResult.existing.length > 0) {
        this.log('\nAlready existing:');
        for (const idx of [...indexResult.existing, ...constraintResult.existing]) {
          this.log(`  = ${idx}`);
        }
      }

      if (indexResult.created.length === 0 && constraintResult.created.length === 0) {
        this.log('All indexes and constraints already exist.');
      }

      return {
        success: true,
        indexesCreated: indexResult.created,
        indexesExisting: indexResult.existing,
        constraintsCreated: constraintResult.created,
        constraintsExisting: constraintResult.existing,
      };
    } finally {
      await closeDriver();
    }
  }
}

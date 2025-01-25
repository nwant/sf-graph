import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { initNeo4jDriver, closeDriver } from '../../../services/neo4j/driver.js';
import { checkOrgData, detectDrift, DriftItem } from '../../../services/neo4j/drift-service.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.drift');

export type DriftResult = {
  success: boolean;
  sourceOrg: string;
  targetOrg: string;
  driftCount: number;
  items: DriftItem[];
  error?: string;
};

export default class Drift extends SfCommand<DriftResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'source-org': Flags.string({
      char: 's',
      summary: messages.getMessage('flags.source-org.summary'),
      required: true,
    }),
    'target-org': Flags.string({
      char: 't',
      summary: messages.getMessage('flags.target-org.summary'),
      required: true,
    }),
    objects: Flags.string({
      char: 'b',
      multiple: true,
      summary: 'Specific objects to compare (repeatable)',
    }),
  };

  public async run(): Promise<DriftResult> {
    const { flags } = await this.parse(Drift);
    const sourceOrg = flags['source-org'];
    const targetOrg = flags['target-org'];
    const objectFilter = flags.objects;

    try {
      // Initialize Neo4j
      const initialized = await initNeo4jDriver();
      if (!initialized) {
        this.error('Failed to connect to Neo4j. Check your configuration via "sf graph config".');
      }

      // Pre-flight check: verify both orgs have data
      this.spinner.start('Checking org data...');
      const hasData = await checkOrgData(sourceOrg, targetOrg);
      this.spinner.stop();

      if (!hasData.source) {
        this.error(`Source org "${sourceOrg}" has no synced objects. Run: sf graph sync --target-org ${sourceOrg}`);
      }
      if (!hasData.target) {
        this.error(`Target org "${targetOrg}" has no synced objects. Run: sf graph sync --target-org ${targetOrg}`);
      }

      // Detect drift
      this.spinner.start('Analyzing drift...');
      const items = await detectDrift(sourceOrg, targetOrg, objectFilter);
      this.spinner.stop();

      // Display results
      this.log(`\n📊 Schema Drift: ${sourceOrg} ↔ ${targetOrg}\n`);

      if (items.length === 0) {
        this.log('✅ No drift detected. Schemas are identical.');
      } else {
        const onlyInSource = items.filter(i => i.status === 'only-in-source');
        const onlyInTarget = items.filter(i => i.status === 'only-in-target');
        const different = items.filter(i => i.status === 'different');

        if (onlyInSource.length > 0) {
          this.log(`Only in ${sourceOrg}:`);
          for (const item of onlyInSource) {
            this.log(`  - ${item.apiName}`);
          }
        }

        if (onlyInTarget.length > 0) {
          this.log(`\nOnly in ${targetOrg}:`);
          for (const item of onlyInTarget) {
            this.log(`  + ${item.apiName}`);
          }
        }

        if (different.length > 0) {
          this.log(`\nDifferences:`);
          for (const item of different) {
            this.log(`  ~ ${item.apiName}: ${item.differences.join(', ')}`);
          }
        }

        this.log(`\nTotal: ${items.length} differences`);
      }

      return {
        success: true,
        sourceOrg,
        targetOrg,
        driftCount: items.length,
        items,
      };
    } finally {
      await closeDriver();
    }
  }
}


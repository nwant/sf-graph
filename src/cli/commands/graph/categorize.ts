/**
 * sf graph categorize
 *
 * Run heuristic categorization on graph objects.
 * Analyzes graph structure to assign semantic categories.
 */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { initNeo4jDriver, closeDriver } from '../../../services/neo4j/driver.js';
import {
  createSchemaCategorizationService,
  createCategorizationGraphExecutor,
  type CategorizationResult,
} from '../../../services/categorization/index.js';
import { SyncReporter } from '../../utils/sync-reporter.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.categorize');

export type CategorizeCommandResult = {
  success: boolean;
  processed: number;
  categorized: number;
  categoriesUsed: string[];
  durationMs: number;
  errors?: Array<{ element: string; error: string }>;
};

export default class Categorize extends SfCommand<CategorizeCommandResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly enableJsonFlag = true;

  public static readonly flags = {
    force: Flags.boolean({
      char: 'f',
      summary: messages.getMessage('flags.force.summary'),
      default: false,
    }),
    quiet: Flags.boolean({
      summary: messages.getMessage('flags.quiet.summary'),
      default: false,
    }),
  };

  public async run(): Promise<CategorizeCommandResult> {
    const { flags } = await this.parse(Categorize);
    const startTime = Date.now();

    try {
      // Initialize Neo4j
      const initialized = await initNeo4jDriver();
      if (!initialized) {
        this.error('Failed to connect to Neo4j. Check your configuration via "sf graph db config".');
      }

      // Use reporter for progress (unless quiet mode)
      const reporter = !flags.quiet ? new SyncReporter('Running categorization...\n') : null;

      // Create categorization service
      const graphExecutor = createCategorizationGraphExecutor();
      const categorizationService = createSchemaCategorizationService(graphExecutor);

      // Run categorization
      const result: CategorizationResult = await categorizationService.runHeuristicCategorization({
        onProgress: (current, total) => {
          reporter?.onProgress({ phase: 'categorization', current, total });
        },
      });

      reporter?.finish();

      const durationMs = Date.now() - startTime;

      if (result.categorized === 0) {
        if (!flags.quiet) {
          this.log(messages.getMessage('info.noCategorized'));
        }
      } else if (!flags.quiet) {
        this.log(`\n${messages.getMessage('info.complete')}`);
        this.log(`  Objects processed: ${result.processed}`);
        this.log(`  Objects categorized: ${result.categorized}`);
        this.log(`  Categories used: ${result.categoriesUsed.join(', ')}`);
        this.log(`  Duration: ${durationMs}ms`);
      }

      if (result.errors.length > 0 && !flags.quiet) {
        this.warn(`${result.errors.length} errors occurred during categorization.`);
      }

      return {
        success: true,
        processed: result.processed,
        categorized: result.categorized,
        categoriesUsed: result.categoriesUsed,
        durationMs,
        errors: result.errors.length > 0 ? result.errors : undefined,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (!flags.quiet) {
        this.error(`${messages.getMessage('error.failed')}: ${errorMessage}`);
      }

      return {
        success: false,
        processed: 0,
        categorized: 0,
        categoriesUsed: [],
        durationMs,
        errors: [{ element: 'categorization', error: errorMessage }],
      };
    } finally {
      await closeDriver();
    }
  }
}

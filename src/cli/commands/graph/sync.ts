/**
 * sf graph sync
 *
 * Sync Salesforce metadata to the Neo4j graph.
 * Supports parallel processing with configurable concurrency.
 */

import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages } from '@salesforce/core';
import confirm from '@inquirer/confirm';
import { apiService } from '../../../core/index.js';
import { DEFAULTS } from '../../../config/defaults.js';
import type { SyncResult } from '../../../core/types.js';
import { applyStandardDescriptions, hasDocumentation, MIN_API_VERSION } from '../../../services/neo4j/standard-documentation.js';
import { getDriver } from '../../../services/neo4j/driver.js';
import { SyncReporter } from '../../utils/sync-reporter.js';
import { getEmbeddingProvider } from '../../../services/embeddings/index.js';
import { createEmbeddingSyncService } from '../../../services/embeddings/embedding-sync.js';
import { createNeo4jGraphExecutor } from '../../../services/embeddings/neo4j-graph-executor.js';
import { checkVectorIndexes, initializeVectorIndexes } from '../../../services/vector/neo4j-vector-store.js';
import {
  createSchemaCategorizationService,
  createCategorizationGraphExecutor,
} from '../../../services/categorization/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.sync');

// Re-export for backward compatibility
export type { SyncResult };

export default class Sync extends SfCommand<SyncResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    objectApiName: Args.string({
      description: messages.getMessage('args.objectApiName.description'),
      required: false,
    }),
  };

  public static readonly flags = {
    'target-org': Flags.requiredOrg({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
      required: true,
    }),
    relationships: Flags.boolean({
      char: 'r',
      summary: messages.getMessage('flags.relationships.summary'),
      default: false,
    }),
    concurrency: Flags.integer({
      char: 'c',
      summary: `Number of parallel Salesforce API calls (default: ${DEFAULTS.CONCURRENCY})`,
      default: DEFAULTS.CONCURRENCY,
      min: 1,
      max: 25,
    }),
    'batch-size': Flags.integer({
      summary: `Neo4j batch write size (default: ${DEFAULTS.BATCH_SIZE})`,
      default: DEFAULTS.BATCH_SIZE,
      min: 10,
      max: 200,
    }),
    incremental: Flags.boolean({
      char: 'i',
      summary: 'Soft-delete missing objects instead of ignoring them',
      default: false,
    }),
    rebuild: Flags.boolean({
      summary: messages.getMessage('flags.rebuild.summary'),
      default: false,
    }),
    'docs': Flags.boolean({
      summary: messages.getMessage('flags.docs.summary'),
      description: messages.getMessage('flags.docs.description'),
      default: false,
      aliases: ['update-documentation', 'update-descriptions'],
    }),
    embeddings: Flags.boolean({
      char: 'e',
      summary: messages.getMessage('flags.embeddings.summary'),
      description: 'Generate vector embeddings for objects and fields after sync',
      default: false,
    }),
    categorize: Flags.boolean({
      summary: messages.getMessage('flags.categorize.summary'),
      description: 'Run heuristic categorization on objects after sync',
      default: false,
    }),
  };

  public async run(): Promise<SyncResult> {
    const { args, flags } = await this.parse(Sync);
    const objectApiName = args.objectApiName;
    const org = flags['target-org'];
    const connection = org.getConnection();
    const orgId = org.getOrgId();

    const rebuildMsg = flags.rebuild ? ' (rebuilding from scratch)' : '';
    const updateDescMsg = flags.docs ? ' + updating documentation' : '';
    const headerMsg = `Syncing${rebuildMsg}${updateDescMsg}...`;
    
    // Initialize reporter (handles header output)
    const reporter = new SyncReporter(headerMsg);

    let result: SyncResult;

    try {
      if (objectApiName) {
        // Single object sync (doesn't use parallelization)
        result = await apiService.syncObject(objectApiName, {
          orgId,
          connection,
          includeRelationships: flags.relationships,
        });
      } else {
        // Full sync with parallelization options
        result = await apiService.syncAll({
          orgId,
          connection,
          concurrency: flags.concurrency,
          batchSize: flags['batch-size'],
          onProgress: (p) => reporter.onProgress(p),
          incremental: flags.incremental,
          rebuild: flags.rebuild,
          excludeSystemObjects: true,
        });
      }

      // Complete the final phase
      reporter.finish();

      // Update descriptions if requested
      if (flags.docs) {
        const apiVersion = connection.version || '62.0';
        
        if (parseFloat(apiVersion) < parseFloat(MIN_API_VERSION)) {
          this.warn(messages.getMessage('warnings.apiVersionTooLow', [MIN_API_VERSION]));
        } else if (!hasDocumentation(apiVersion)) {
          // Documentation not available for this version
          this.log(`\n⚠️  No documentation available for API v${apiVersion}.`);
          
          const shouldExtract = await confirm({
            message: `Extract documentation for v${apiVersion} now? This may take 5-15 minutes.`,
            default: true,
          });
          
          if (shouldExtract) {
            this.log(`\nRun: sf graph docs extract ${apiVersion}\n`);
            this.log('Then re-run sync with --docs to apply the documentation.');
          } else {
            this.log('Skipping documentation update.');
          }
        } else {
          const docStart = Date.now();
          this.spinner.start('Documentation');
          try {
            const driver = getDriver();
            const updatedCount = await applyStandardDescriptions(driver, orgId, apiVersion);
            const docDuration = Date.now() - docStart;
            this.spinner.stop();
            this.log(`Documentation: ${updatedCount}/${updatedCount}...done [${docDuration}ms]`);
          } catch (error) {
            this.spinner.stop();
            this.warn(`Failed to update standard documentation: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      // Generate embeddings if requested
      if (flags.embeddings && result.success) {
        await this.generateEmbeddings(reporter);
      }

      // Run categorization if requested
      if (flags.categorize && result.success) {
        await this.runCategorization(reporter);
      }

      if (result.success) {
        this.log(`\n✅ Sync completed. Duration: ${result.duration}ms`);
        this.log(`   - Objects: ${result.objectCount}`);
        if (result.fieldCount !== undefined) this.log(`   - Fields: ${result.fieldCount}`);
        if (result.relationshipCount !== undefined) this.log(`   - Relationships: ${result.relationshipCount}`);
        if (result.picklistValueCount !== undefined) this.log(`   - Picklist Values: ${result.picklistValueCount}`);
        if (result.phaseStats?.picklistEnrichment?.count) this.log(`   - Picklist Enrichments: ${result.phaseStats.picklistEnrichment.count}`);
        if (result.dependencyCount !== undefined) this.log(`   - Field Dependencies: ${result.dependencyCount}`);

        // Report non-fatal errors
        if (result.errors && result.errors.length > 0) {
          this.warn(`\n   ${result.errors.length} non-fatal errors occurred:`);
          result.errors.slice(0, 5).forEach((e) => {
            this.warn(`     - ${e.phase}: ${e.objectName || 'unknown'}: ${e.error}`);
          });
          if (result.errors.length > 5) {
            this.warn(`     ... and ${result.errors.length - 5} more`);
          }
        }
      } else {
        this.error(`❌ Sync failed: ${result.error}`);
      }

      return result;
    } finally {
      const { closeDriver } = await import('../../../services/neo4j/driver.js');
      await closeDriver();
    }
  }

  /**
   * Generate embeddings for objects and fields.
   * Initializes vector indexes if they don't exist.
   */
  private async generateEmbeddings(reporter: SyncReporter): Promise<void> {
    this.log('');
    // Initialize embedding provider first (needed for dimensions)
    this.spinner.start('Initializing embedding provider...');
    let embeddingProvider;
    try {
      embeddingProvider = getEmbeddingProvider();
      const isAvailable = await embeddingProvider.isAvailable();
      if (!isAvailable) {
        this.spinner.stop();
        this.warn('Embedding provider not available. Skipping embeddings.');
        this.log('Configure with: sf graph embeddings config');
        return;
      }
    } catch {
      this.spinner.stop();
      this.warn('Failed to initialize embedding provider. Skipping embeddings.');
      this.log('Configure with: sf graph embeddings config');
      return;
    }
    this.spinner.stop();

    // Detect dimensions for unknown models (Ollama may need to probe the model)
    if ('detectDimensions' in embeddingProvider && typeof embeddingProvider.detectDimensions === 'function') {
      this.spinner.start('Detecting model dimensions...');
      await (embeddingProvider as { detectDimensions: () => Promise<number> }).detectDimensions();
      this.spinner.stop();
    }

    const dimensions = embeddingProvider.getDimensions();
    
    // Check/create vector indexes with correct dimensions
    this.spinner.start('Checking vector indexes...');
    const { missing } = await checkVectorIndexes();
    
    if (missing.length > 0) {
      this.spinner.status = 'Creating vector indexes...';
      await initializeVectorIndexes(dimensions);
    }
    this.spinner.stop();

    const providerType = embeddingProvider.providerType;
    reporter.startPostSyncPhases(`\n🔧 Generating embeddings with ${providerType} (${dimensions} dims)\n`);

    // Create sync service and generate embeddings
    const graphExecutor = createNeo4jGraphExecutor();
    const syncService = createEmbeddingSyncService(embeddingProvider, graphExecutor);

    // Generate object embeddings
    const objectResult = await syncService.syncObjectEmbeddings({
      force: false,
      batchSize: 50,
      onProgress: (completed, total) => {
        reporter.onProgress({ phase: 'objectEmbeddings', current: completed, total });
      },
    });

    // Generate field embeddings
    const fieldResult = await syncService.syncFieldEmbeddings({
      force: false,
      batchSize: 50,
      onProgress: (completed, total) => {
        reporter.onProgress({ phase: 'fieldEmbeddings', current: completed, total });
      },
    });

    reporter.finish();

    const totalEmbedded = objectResult.embedded + fieldResult.embedded;
    if (totalEmbedded > 0) {
      this.log(`\n✨ Generated ${totalEmbedded} embeddings.`);
    }
  }

  /**
   * Run heuristic categorization on objects.
   */
  private async runCategorization(reporter: SyncReporter): Promise<void> {
    reporter.startPostSyncPhases('\nRunning categorization...\n');

    try {
      const graphExecutor = createCategorizationGraphExecutor();
      const categorizationService = createSchemaCategorizationService(graphExecutor);

      const result = await categorizationService.runHeuristicCategorization({
        onProgress: (current, total) => {
          reporter.onProgress({ phase: 'categorization', current, total });
        },
      });

      reporter.finish();

      if (result.categorized > 0) {
        this.log(`\n✅ Categorized ${result.categorized} objects [${result.categoriesUsed.join(', ')}]`);
      } else {
        this.log('\nNo objects categorized.');
      }

      if (result.errors.length > 0) {
        this.warn(`${result.errors.length} categorization errors occurred.`);
      }
    } catch (error) {
      reporter.finish();
      this.warn(`Categorization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

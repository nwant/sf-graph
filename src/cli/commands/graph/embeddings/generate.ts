/**
 * sf graph embeddings generate
 *
 * Generate embeddings for graph nodes (objects and fields).
 * Uses content hashing to skip unchanged nodes.
 */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import confirm from '@inquirer/confirm';
import { initNeo4jDriver, closeDriver } from '../../../../services/neo4j/driver.js';
import { getEmbeddingProvider, createEmbeddingProvider, type EmbeddingConfig } from '../../../../services/embeddings/index.js';
import { loadConfig } from '../../../../agent/config.js';
import { createEmbeddingSyncService } from '../../../../services/embeddings/embedding-sync.js';
import { createNeo4jGraphExecutor } from '../../../../services/embeddings/neo4j-graph-executor.js';
import {
  checkVectorIndexes,
  getIndexDimensions,
  initializeVectorIndexes,
  getVectorStore,
  VECTOR_INDEX_NAMES,
} from '../../../../services/vector/neo4j-vector-store.js';
import { SyncReporter } from '../../../utils/sync-reporter.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.embeddings.generate');

export type EmbeddingsGenerateResult = {
  success: boolean;
  provider?: string;
  objects?: {
    processed: number;
    embedded: number;
    skipped: number;
    errors: number;
    durationMs: number;
  };
  fields?: {
    processed: number;
    embedded: number;
    skipped: number;
    errors: number;
    durationMs: number;
  };
  totalDurationMs?: number;
  error?: string;
};

export default class EmbeddingsGenerate extends SfCommand<EmbeddingsGenerateResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly enableJsonFlag = true;

  public static readonly flags = {
    force: Flags.boolean({
      char: 'f',
      summary: messages.getMessage('flags.force.summary'),
      description: 'Re-embed all nodes regardless of content hash',
      default: false,
    }),
    objects: Flags.string({
      summary: messages.getMessage('flags.objects.summary'),
      description: 'Comma-separated list of object API names to embed (default: all)',
    }),
    'skip-objects': Flags.boolean({
      summary: messages.getMessage('flags.skip-objects.summary'),
      description: 'Skip object embeddings, only generate field embeddings',
      default: false,
    }),
    'skip-fields': Flags.boolean({
      summary: messages.getMessage('flags.skip-fields.summary'),
      description: 'Skip field embeddings, only generate object embeddings',
      default: false,
    }),
    'batch-size': Flags.integer({
      summary: messages.getMessage('flags.batch-size.summary'),
      description: 'Number of items to embed per API call (default: 50)',
      default: 50,
      min: 1,
      max: 100,
    }),
    provider: Flags.string({
      summary: messages.getMessage('flags.provider.summary'),
      description: 'Override the configured embedding provider (ollama or openai)',
      options: ['ollama', 'openai'],
    }),
    model: Flags.string({
      char: 'm',
      summary: 'Override the embedding model (e.g., nomic-embed-text, text-embedding-3-small)',
      description: 'Override the configured embedding model',
    }),
    quiet: Flags.boolean({
      summary: messages.getMessage('flags.quiet.summary'),
      description: 'Suppress non-essential output for script-friendly usage',
      default: false,
    }),
    'target-org': Flags.optionalOrg({
      char: 'o',
      summary: 'Salesforce org to generate embeddings for',
      description: 'If specified, only generates embeddings for metadata from this org',
    }),
  };

  public async run(): Promise<EmbeddingsGenerateResult> {
    const { flags } = await this.parse(EmbeddingsGenerate);
    const startTime = Date.now();

    try {
      // Initialize Neo4j
      const initialized = await initNeo4jDriver();
      if (!initialized) {
        this.error('Failed to connect to Neo4j. Check your configuration via "sf graph db config".');
      }

      // Check vector indexes exist
      this.spinner.start('Checking vector indexes...');
      const { missing, existing } = await checkVectorIndexes();
      this.spinner.stop();

      if (missing.length > 0 && existing.length === 0) {
        this.warn(`Missing vector indexes: ${missing.join(', ')}`);
        this.log('Run "sf graph embeddings init" first to create indexes.\n');
        // Continue anyway - embeddings can be stored, just not searched until indexes exist
      }

      // Get embedding provider (with optional overrides from flags)
      this.spinner.start('Initializing embedding provider...');
      let embeddingProvider;
      try {
        if (flags.provider || flags.model) {
          // Build config with overrides
          const config = loadConfig();
          const embeddingConfig: EmbeddingConfig = {
            provider: (flags.provider ?? config.embeddingProvider ?? 'ollama') as 'ollama' | 'openai',
            model: flags.model ?? config.embeddingModel ?? 'nomic-embed-text',
            apiKey: config.openaiApiKey,
            baseUrl: config.baseUrl,
          };
          embeddingProvider = createEmbeddingProvider(embeddingConfig);
        } else {
          embeddingProvider = getEmbeddingProvider();
        }
      } catch (error) {
        this.spinner.stop();
        this.error(
          `Failed to initialize embedding provider: ${error instanceof Error ? error.message : String(error)}\n` +
            'Configure with: sf graph config set embeddingProvider=ollama'
        );
      }

      // Check provider availability
      const isAvailable = await embeddingProvider.isAvailable();
      if (!isAvailable) {
        this.spinner.stop();
        this.error(
          `Embedding provider "${embeddingProvider.providerType}" is not available.\n` +
            'For Ollama: Ensure Ollama is running and the model is pulled.\n' +
            'For OpenAI: Ensure OPENAI_API_KEY is set or configured.'
        );
      }
      this.spinner.stop();

      const providerType = embeddingProvider.providerType;
      
      // Detect dimensions for unknown models (Ollama may need to probe the model)
      if ('detectDimensions' in embeddingProvider && typeof embeddingProvider.detectDimensions === 'function') {
        this.spinner.start('Detecting model dimensions...');
        await (embeddingProvider as { detectDimensions: () => Promise<number> }).detectDimensions();
        this.spinner.stop();
      }
      
      const dimensions = embeddingProvider.getDimensions();

      // Check for dimension mismatch with existing indexes
      if (existing.length > 0) {
        const existingDimensions = await getIndexDimensions(VECTOR_INDEX_NAMES.OBJECT);
        
        if (existingDimensions !== null && existingDimensions !== dimensions) {
          this.log('');
          this.warn(
            `Embedding model dimension mismatch detected!\n` +
            `   Current indexes: ${existingDimensions} dimensions\n` +
            `   New model:       ${dimensions} dimensions (${providerType})\n`
          );
          
          const shouldRecreate = await confirm({
            message: 'Recreate vector indexes with new dimensions?',
            default: true,
          });
          
          if (shouldRecreate) {
            this.spinner.start('Dropping old indexes...');
            const vectorStore = getVectorStore();
            for (const indexName of existing) {
              await vectorStore.dropIndex(indexName);
            }
            this.spinner.stop();
            
            this.spinner.start('Creating new indexes...');
            await initializeVectorIndexes(dimensions);
            this.spinner.stop();
            
            this.log('✅ Vector indexes recreated with new dimensions.\n');
            this.log('   Note: All existing embeddings are now stale. Using --force to re-embed all nodes.\n');
            // Force re-embedding since old embeddings have wrong dimensions
            flags.force = true;
          } else {
            this.error(
              'Cannot generate embeddings with mismatched dimensions.\n' +
              'Either recreate indexes or switch back to the previous embedding model.'
            );
          }
        }
      }

      this.log(`\n🔧 Using ${providerType} embeddings (${dimensions} dimensions)\n`);

      // Create sync service with optional org filtering
      const orgId = flags['target-org']?.getOrgId();
      const graphExecutor = createNeo4jGraphExecutor(orgId);
      const syncService = createEmbeddingSyncService(embeddingProvider, graphExecutor);

      const result: EmbeddingsGenerateResult = {
        success: true,
        provider: providerType,
      };

      // Use reporter for progress (unless quiet mode)
      const reporter = !flags.quiet ? new SyncReporter(`Generating embeddings...\n`) : null;

      // Generate object embeddings
      if (!flags['skip-objects']) {
        const objectResult = await syncService.syncObjectEmbeddings({
          force: flags.force,
          batchSize: flags['batch-size'],
          onProgress: (completed, total) => {
            reporter?.onProgress({ phase: 'objectEmbeddings', current: completed, total });
          },
        });

        result.objects = objectResult;
      }

      // Generate field embeddings
      if (!flags['skip-fields']) {
        const fieldResult = await syncService.syncFieldEmbeddings({
          force: flags.force,
          batchSize: flags['batch-size'],
          onProgress: (completed, total) => {
            reporter?.onProgress({ phase: 'fieldEmbeddings', current: completed, total });
          },
        });

        result.fields = fieldResult;
      }

      reporter?.finish();

      result.totalDurationMs = Date.now() - startTime;

      // Summary
      this.log(`\n✅ Embedding generation complete [${result.totalDurationMs}ms]`);

      const totalEmbedded = (result.objects?.embedded ?? 0) + (result.fields?.embedded ?? 0);
      const totalSkipped = (result.objects?.skipped ?? 0) + (result.fields?.skipped ?? 0);

      if (totalEmbedded > 0) {
        this.log(`\nGenerated ${totalEmbedded} new embeddings.`);
      }
      if (totalSkipped > 0 && !flags.force) {
        this.log(`Skipped ${totalSkipped} unchanged nodes (use --force to re-embed all).`);
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        totalDurationMs: Date.now() - startTime,
      };
    } finally {
      await closeDriver();
    }
  }
}

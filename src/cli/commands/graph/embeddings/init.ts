/**
 * sf graph embeddings init
 *
 * Initialize Neo4j vector indexes for semantic search.
 * Requires Neo4j 5.11+ with vector index support.
 */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { initNeo4jDriver, closeDriver } from '../../../../services/neo4j/driver.js';
import { getEmbeddingProvider, createEmbeddingProvider, type EmbeddingConfig } from '../../../../services/embeddings/index.js';
import { loadConfig } from '../../../../agent/config.js';
import {
  getVectorStore,
  VECTOR_INDEX_NAMES,
  checkVectorIndexes,
} from '../../../../services/vector/neo4j-vector-store.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.embeddings.init');

export type EmbeddingsInitResult = {
  success: boolean;
  neo4jVersion?: string;
  dimensions?: number;
  provider?: string;
  indexesCreated: string[];
  indexesExisting: string[];
  error?: string;
};

export default class EmbeddingsInit extends SfCommand<EmbeddingsInitResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly enableJsonFlag = true;

  public static readonly flags = {
    force: Flags.boolean({
      char: 'f',
      summary: messages.getMessage('flags.force.summary'),
      description: 'Drop and recreate indexes if they already exist',
      default: false,
    }),
    show: Flags.boolean({
      summary: messages.getMessage('flags.show.summary'),
      description: 'Show current vector indexes without creating new ones',
      default: false,
    }),
    provider: Flags.string({
      summary: 'Override the configured embedding provider (ollama or openai)',
      options: ['ollama', 'openai'],
    }),
    model: Flags.string({
      char: 'm',
      summary: 'Override the embedding model (e.g., nomic-embed-text, text-embedding-3-small)',
    }),
  };

  public async run(): Promise<EmbeddingsInitResult> {
    const { flags } = await this.parse(EmbeddingsInit);

    try {
      // Initialize Neo4j
      const initialized = await initNeo4jDriver();
      if (!initialized) {
        this.error('Failed to connect to Neo4j. Check your configuration via "sf graph db config".');
      }

      const vectorStore = getVectorStore();

      // Check Neo4j version supports vector indexes
      const isAvailable = await vectorStore.isAvailable();
      if (!isAvailable) {
        this.error('Neo4j version does not support vector indexes. Requires Neo4j 5.11+.');
      }

      // Show mode: list existing indexes
      if (flags.show) {
        this.spinner.start('Checking vector indexes...');
        const { existing, missing } = await checkVectorIndexes();
        this.spinner.stop();

        this.log('\n📊 Vector Index Status:\n');

        if (existing.length > 0) {
          this.log('Existing indexes:');
          for (const idx of existing) {
            this.log(`  ✓ ${idx}`);
          }
        }

        if (missing.length > 0) {
          this.log('\nMissing indexes:');
          for (const idx of missing) {
            this.log(`  ✗ ${idx}`);
          }
          this.log(`\nRun "sf graph embeddings init" to create missing indexes.`);
        } else {
          this.log('\n✅ All vector indexes are configured.');
        }

        return {
          success: true,
          indexesCreated: [],
          indexesExisting: existing,
        };
      }

      // Get embedding provider to determine dimensions (with optional overrides)
      this.spinner.start('Checking embedding provider...');
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
      // Detect dimensions for unknown models (Ollama may need to probe the model)
      if ('detectDimensions' in embeddingProvider && typeof embeddingProvider.detectDimensions === 'function') {
        this.spinner.status = 'Detecting model dimensions...';
        await (embeddingProvider as { detectDimensions: () => Promise<number> }).detectDimensions();
      }

      const dimensions = embeddingProvider.getDimensions();
      const providerType = embeddingProvider.providerType;
      this.spinner.stop();

      this.log(`\n🔧 Using ${providerType} embeddings (${dimensions} dimensions)\n`);

      // Check existing indexes
      const { existing, missing } = await checkVectorIndexes();

      // Handle force flag
      if (flags.force && existing.length > 0) {
        this.spinner.start('Dropping existing indexes...');
        for (const indexName of existing) {
          await vectorStore.dropIndex(indexName);
        }
        this.spinner.stop();
        this.log(`Dropped ${existing.length} existing indexes.`);
      }

      // Create missing indexes
      const toCreate = flags.force ? Object.values(VECTOR_INDEX_NAMES) : missing;
      const created: string[] = [];

      if (toCreate.length === 0) {
        this.log('✅ All vector indexes already exist.');
        return {
          success: true,
          dimensions,
          provider: providerType,
          indexesCreated: [],
          indexesExisting: existing,
        };
      }

      this.spinner.start(`Creating ${toCreate.length} vector indexes...`);

      // Create each index
      for (const indexName of toCreate) {
        const config = getIndexConfig(indexName);
        if (config) {
          await vectorStore.createIndex(
            indexName,
            config.nodeLabel,
            'embedding',
            dimensions
          );
          created.push(indexName);
        }
      }

      this.spinner.stop();

      // Report results
      this.log('\n✅ Vector Index Initialization Complete:\n');

      if (created.length > 0) {
        this.log('Created indexes:');
        for (const idx of created) {
          this.log(`  + ${idx}`);
        }
      }

      const alreadyExisting = flags.force ? [] : existing;
      if (alreadyExisting.length > 0) {
        this.log('\nAlready existing:');
        for (const idx of alreadyExisting) {
          this.log(`  = ${idx}`);
        }
      }

      this.log(`\nNext step: Generate embeddings with "sf graph embeddings generate"`);

      return {
        success: true,
        dimensions,
        provider: providerType,
        indexesCreated: created,
        indexesExisting: alreadyExisting,
      };
    } finally {
      await closeDriver();
    }
  }
}

/**
 * Get the node label for a vector index name.
 */
function getIndexConfig(indexName: string): { nodeLabel: string } | null {
  switch (indexName) {
    case VECTOR_INDEX_NAMES.OBJECT:
      return { nodeLabel: 'Object' };
    case VECTOR_INDEX_NAMES.FIELD:
      return { nodeLabel: 'Field' };
    case VECTOR_INDEX_NAMES.PICKLIST_VALUE:
      return { nodeLabel: 'PicklistValue' };
    case VECTOR_INDEX_NAMES.CATEGORY:
      return { nodeLabel: 'Category' };
    default:
      return null;
  }
}

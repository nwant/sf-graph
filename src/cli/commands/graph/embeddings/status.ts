/**
 * sf graph embeddings status
 *
 * Show status of semantic search features and embeddings.
 */

import { SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { initNeo4jDriver, closeDriver, getDriver } from '../../../../services/neo4j/driver.js';
import { loadConfig } from '../../../../agent/config.js';
import { checkVectorIndexes, getVectorStore } from '../../../../services/vector/neo4j-vector-store.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.embeddings.status');

export type EmbeddingsStatusResult = {
  success: boolean;
  config: {
    embeddingProvider: string;
    embeddingModel: string;
  };
  neo4j: {
    connected: boolean;
    vectorSupported: boolean;
    version?: string;
  };
  indexes: {
    allExist: boolean;
    existing: string[];
    missing: string[];
  };
  embeddings: {
    objectsTotal: number;
    objectsWithEmbeddings: number;
    fieldsTotal: number;
    fieldsWithEmbeddings: number;
  };
  error?: string;
};

export default class EmbeddingsStatus extends SfCommand<EmbeddingsStatusResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly enableJsonFlag = true;

  public async run(): Promise<EmbeddingsStatusResult> {
    const config = loadConfig();

    const result: EmbeddingsStatusResult = {
      success: true,
      config: {
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
      },
      neo4j: {
        connected: false,
        vectorSupported: false,
      },
      indexes: {
        allExist: false,
        existing: [],
        missing: [],
      },
      embeddings: {
        objectsTotal: 0,
        objectsWithEmbeddings: 0,
        fieldsTotal: 0,
        fieldsWithEmbeddings: 0,
      },
    };

    this.log('\n📋 Configuration\n');
    this.log(`  Embedding Provider: ${config.embeddingProvider}`);
    this.log(`  Embedding Model:    ${config.embeddingModel}`);

    try {
      // Neo4j connection
      const initialized = await initNeo4jDriver();
      result.neo4j.connected = initialized;

      if (!initialized) {
        this.log('\n❌ Neo4j: Not connected');
        this.log('   Configure with: sf graph db config');
        return result;
      }

      // Check vector support
      const vectorStore = getVectorStore();
      result.neo4j.vectorSupported = await vectorStore.isAvailable();

      // Get Neo4j version
      const driver = getDriver();
      const session = driver.session();
      try {
        const versionResult = await session.executeRead(async (tx) => {
          return tx.run('CALL dbms.components() YIELD versions RETURN versions[0] as version');
        });
        if (versionResult.records.length > 0) {
          result.neo4j.version = versionResult.records[0].get('version') as string;
        }
      } finally {
        await session.close();
      }

      this.log('\n🗄️  Neo4j Database\n');
      this.log(`  Connected:       ✓`);
      this.log(`  Version:         ${result.neo4j.version ?? 'unknown'}`);
      this.log(`  Vector Support:  ${result.neo4j.vectorSupported ? '✓ available' : '✗ not available (requires 5.11+)'}`);

      // Vector indexes
      if (result.neo4j.vectorSupported) {
        const indexStatus = await checkVectorIndexes();
        result.indexes = indexStatus;

        this.log('\n📊 Vector Indexes\n');
        if (indexStatus.existing.length > 0) {
          this.log('  Existing:');
          for (const idx of indexStatus.existing) {
            this.log(`    ✓ ${idx}`);
          }
        }
        if (indexStatus.missing.length > 0) {
          this.log('  Missing:');
          for (const idx of indexStatus.missing) {
            this.log(`    ✗ ${idx}`);
          }
        }
        if (indexStatus.allExist) {
          this.log('  All indexes configured ✓');
        } else {
          this.log('\n  Run "sf graph embeddings init" to create missing indexes.');
        }
      }

      // Embedding counts
      const session2 = driver.session();
      try {
        // Count objects
        const objectCountResult = await session2.executeRead(async (tx) => {
          return tx.run(`
            MATCH (o:Object)
            RETURN count(o) as total,
                   count(o.embedding) as withEmbedding
          `);
        });

        if (objectCountResult.records.length > 0) {
          result.embeddings.objectsTotal = objectCountResult.records[0].get('total').toNumber();
          result.embeddings.objectsWithEmbeddings = objectCountResult.records[0].get('withEmbedding').toNumber();
        }

        // Count fields
        const fieldCountResult = await session2.executeRead(async (tx) => {
          return tx.run(`
            MATCH (f:Field)
            RETURN count(f) as total,
                   count(f.embedding) as withEmbedding
          `);
        });

        if (fieldCountResult.records.length > 0) {
          result.embeddings.fieldsTotal = fieldCountResult.records[0].get('total').toNumber();
          result.embeddings.fieldsWithEmbeddings = fieldCountResult.records[0].get('withEmbedding').toNumber();
        }
      } finally {
        await session2.close();
      }

      this.log('\n🔢 Embedding Coverage\n');
      const objPct = result.embeddings.objectsTotal > 0
        ? Math.round((result.embeddings.objectsWithEmbeddings / result.embeddings.objectsTotal) * 100)
        : 0;
      const fieldPct = result.embeddings.fieldsTotal > 0
        ? Math.round((result.embeddings.fieldsWithEmbeddings / result.embeddings.fieldsTotal) * 100)
        : 0;

      this.log(`  Objects: ${result.embeddings.objectsWithEmbeddings}/${result.embeddings.objectsTotal} (${objPct}%)`);
      this.log(`  Fields:  ${result.embeddings.fieldsWithEmbeddings}/${result.embeddings.fieldsTotal} (${fieldPct}%)`);

      if (result.embeddings.objectsWithEmbeddings === 0 && result.embeddings.fieldsWithEmbeddings === 0) {
        this.log('\n  Run "sf graph embeddings generate" to create embeddings.');
      }

      // Summary
      this.log('\n' + '─'.repeat(50));

      const allReady =
        result.neo4j.connected &&
        result.neo4j.vectorSupported &&
        result.indexes.allExist &&
        result.embeddings.objectsWithEmbeddings > 0;

      if (allReady) {
        this.log('✅ Semantic search is fully configured and ready.');
      } else {
        this.log('⚠️  Setup incomplete. Next steps:');
        if (!result.neo4j.vectorSupported) {
          this.log('   1. Upgrade Neo4j to 5.11+ for vector support');
        } else if (!result.indexes.allExist) {
          this.log('   1. sf graph embeddings init');
        }
        if (result.embeddings.objectsWithEmbeddings === 0) {
          this.log('   2. sf graph embeddings generate');
        }
      }

      return result;
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      this.error(`Failed to check status: ${result.error}`);
    } finally {
      await closeDriver();
    }
  }
}

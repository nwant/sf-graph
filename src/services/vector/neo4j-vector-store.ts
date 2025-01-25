/**
 * Neo4j Vector Store
 *
 * Implements VectorStore using Neo4j's native vector indexes (requires Neo4j 5.11+).
 * Handles index creation, vector search, and embedding storage.
 */

import neo4j from 'neo4j-driver';
import { getDriver } from '../neo4j/driver.js';
import { createLogger } from '../../core/index.js';
import type {
  VectorStore,
  VectorStoreType,
  VectorSearchResult,
  VectorIndexOptions,
  VectorSearchOptions,
} from './types.js';
import { VectorStoreError } from './types.js';

const log = createLogger('neo4j-vector-store');

// Default configuration
const DEFAULT_SIMILARITY_FUNCTION = 'cosine';
const DEFAULT_TOP_K = 10;
const DEFAULT_MIN_SCORE = 0;

/**
 * Neo4j vector store implementation.
 */
export class Neo4jVectorStore implements VectorStore {
  readonly storeType: VectorStoreType = 'neo4j';

  constructor() {
    log.debug('Neo4j vector store initialized');
  }

  /**
   * Create a vector index for a node label.
   * Uses dynamic dimensions from the embedding provider.
   */
  async createIndex(
    indexName: string,
    nodeLabel: string,
    property: string,
    dimensions: number,
    options: VectorIndexOptions = {}
  ): Promise<void> {
    const { similarityFunction = DEFAULT_SIMILARITY_FUNCTION } = options;

    const driver = getDriver();
    const session = driver.session();

    try {
      // Check if index already exists
      if (await this.indexExists(indexName)) {
        log.debug({ indexName }, 'Vector index already exists');
        return;
      }

      log.debug(
        { indexName, nodeLabel, property, dimensions, similarityFunction },
        'Creating vector index'
      );

      // Create vector index using Neo4j 5.11+ syntax
      await session.executeWrite(async (tx) => {
        await tx.run(
          `
          CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
          FOR (n:${nodeLabel})
          ON (n.${property})
          OPTIONS {
            indexConfig: {
              \`vector.dimensions\`: $dimensions,
              \`vector.similarity_function\`: $similarityFunction
            }
          }
          `,
          { dimensions: neo4j.int(dimensions), similarityFunction }
        );
      });

      log.debug({ indexName }, 'Vector index created successfully');
    } catch (error) {
      throw new VectorStoreError(
        `Failed to create vector index ${indexName}: ${(error as Error).message}`,
        'neo4j',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Check if a vector index exists.
   */
  async indexExists(indexName: string): Promise<boolean> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.executeRead(async (tx) => {
        return tx.run(
          `
          SHOW INDEXES
          WHERE name = $indexName AND type = 'VECTOR'
          `,
          { indexName }
        );
      });

      return result.records.length > 0;
    } catch (error) {
      throw new VectorStoreError(
        `Failed to check index existence: ${(error as Error).message}`,
        'neo4j',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Drop a vector index if it exists.
   */
  async dropIndex(indexName: string): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      await session.executeWrite(async (tx) => {
        await tx.run(`DROP INDEX ${indexName} IF EXISTS`);
      });

      log.info({ indexName }, 'Vector index dropped');
    } catch (error) {
      throw new VectorStoreError(
        `Failed to drop index ${indexName}: ${(error as Error).message}`,
        'neo4j',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * List all vector indexes.
   */
  async listIndexes(): Promise<string[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.executeRead(async (tx) => {
        return tx.run(`SHOW INDEXES WHERE type = 'VECTOR'`);
      });

      return result.records.map((record) => record.get('name') as string);
    } catch (error) {
      throw new VectorStoreError(
        `Failed to list indexes: ${(error as Error).message}`,
        'neo4j',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Search for similar vectors using a specific index.
   */
  async search(
    indexName: string,
    embedding: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const {
      topK = DEFAULT_TOP_K,
      minScore = DEFAULT_MIN_SCORE,
      filter,
    } = options;

    const driver = getDriver();
    const session = driver.session();

    try {
      // Build filter clause if provided
      let filterClause = '';
      const params: Record<string, unknown> = {
        embedding,
        topK,
      };

      if (filter && Object.keys(filter).length > 0) {
        const filterConditions = Object.entries(filter)
          .map(([key, value], index) => {
            const paramName = `filter_${index}`;
            params[paramName] = value;
            return `node.${key} = $${paramName}`;
          })
          .join(' AND ');
        filterClause = `WHERE ${filterConditions}`;
      }

      const result = await session.executeRead(async (tx) => {
        return tx.run(
          `
          CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
          YIELD node, score
          ${filterClause}
          ${minScore > 0 ? (filterClause ? 'AND score >= $minScore' : 'WHERE score >= $minScore') : ''}
          RETURN node, score, labels(node) as nodeLabels
          ORDER BY score DESC
          `,
          { ...params, indexName, minScore }
        );
      });

      return result.records.map((record) => {
        const node = record.get('node');
        const nodeLabels = record.get('nodeLabels') as string[];

        // Extract node ID (prefer apiName, fall back to element ID)
        const nodeId = node.properties.apiName ??
          node.properties.name ??
          node.elementId;

        return {
          nodeId: String(nodeId),
          nodeLabel: nodeLabels[0] ?? 'Unknown',
          score: record.get('score') as number,
          properties: { ...node.properties },
        };
      });
    } catch (error) {
      throw new VectorStoreError(
        `Failed to search index ${indexName}: ${(error as Error).message}`,
        'neo4j',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Store or update an embedding for a node.
   */
  async upsertEmbedding(
    nodeLabel: string,
    nodeId: string,
    nodeIdProperty: string,
    embedding: number[],
    contentHash: string
  ): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      await session.executeWrite(async (tx) => {
        await tx.run(
          `
          MATCH (n:${nodeLabel} {${nodeIdProperty}: $nodeId})
          SET n.embedding = $embedding, n.contentHash = $contentHash
          `,
          { nodeId, embedding, contentHash }
        );
      });

      log.debug({ nodeLabel, nodeId }, 'Embedding upserted');
    } catch (error) {
      throw new VectorStoreError(
        `Failed to upsert embedding for ${nodeLabel}:${nodeId}: ${(error as Error).message}`,
        'neo4j',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Get the content hash for a node.
   */
  async getContentHash(
    nodeLabel: string,
    nodeId: string,
    nodeIdProperty: string
  ): Promise<string | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.executeRead(async (tx) => {
        return tx.run(
          `
          MATCH (n:${nodeLabel} {${nodeIdProperty}: $nodeId})
          RETURN n.contentHash as contentHash
          `,
          { nodeId }
        );
      });

      if (result.records.length === 0) {
        return null;
      }

      return result.records[0].get('contentHash') as string | null;
    } catch (error) {
      throw new VectorStoreError(
        `Failed to get content hash for ${nodeLabel}:${nodeId}: ${(error as Error).message}`,
        'neo4j',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Batch upsert embeddings for multiple nodes.
   * Uses UNWIND for efficient batch operations.
   */
  async batchUpsertEmbeddings(
    nodeLabel: string,
    items: Array<{
      nodeId: string;
      nodeIdProperty: string;
      embedding: number[];
      contentHash: string;
    }>
  ): Promise<void> {
    if (items.length === 0) return;

    const driver = getDriver();
    const session = driver.session();

    try {
      // Group items by nodeIdProperty for efficient batch processing
      const groupedByProperty = new Map<string, typeof items>();

      for (const item of items) {
        const key = item.nodeIdProperty;
        if (!groupedByProperty.has(key)) {
          groupedByProperty.set(key, []);
        }
        groupedByProperty.get(key)!.push(item);
      }

      // Process each group
      for (const [nodeIdProperty, groupItems] of groupedByProperty) {
        const batchData = groupItems.map((item) => ({
          id: item.nodeId,
          embedding: item.embedding,
          contentHash: item.contentHash,
        }));

        await session.executeWrite(async (tx) => {
          await tx.run(
            `
            UNWIND $items AS item
            MATCH (n:${nodeLabel} {${nodeIdProperty}: item.id})
            SET n.embedding = item.embedding, n.contentHash = item.contentHash
            `,
            { items: batchData }
          );
        });
      }

      log.debug(
        { nodeLabel, count: items.length },
        'Batch embeddings upserted'
      );
    } catch (error) {
      throw new VectorStoreError(
        `Failed to batch upsert embeddings: ${(error as Error).message}`,
        'neo4j',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Check if Neo4j vector functionality is available.
   */
  async isAvailable(): Promise<boolean> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Check Neo4j version supports vector indexes (5.11+)
      const result = await session.executeRead(async (tx) => {
        return tx.run('CALL dbms.components() YIELD versions RETURN versions[0] as version');
      });

      if (result.records.length === 0) {
        return false;
      }

      const version = result.records[0].get('version') as string;
      const [major, minor] = version.split('.').map((v) => parseInt(v, 10));

      // Vector indexes require Neo4j 5.11+
      if (major < 5 || (major === 5 && minor < 11)) {
        log.warn(
          { version },
          'Neo4j version does not support vector indexes (requires 5.11+)'
        );
        return false;
      }

      return true;
    } catch (error) {
      log.warn({ error }, 'Neo4j vector store not available');
      return false;
    } finally {
      await session.close();
    }
  }
}

/**
 * Create a Neo4j vector store instance.
 */
export function createNeo4jVectorStore(): Neo4jVectorStore {
  return new Neo4jVectorStore();
}

// Singleton instance
let vectorStore: Neo4jVectorStore | null = null;

/**
 * Get the default Neo4j vector store instance.
 */
export function getVectorStore(): Neo4jVectorStore {
  if (!vectorStore) {
    vectorStore = createNeo4jVectorStore();
  }
  return vectorStore;
}

/**
 * Clear the singleton instance (for testing).
 */
export function clearVectorStore(): void {
  vectorStore = null;
}

// === Index Management Helpers ===

/**
 * Standard index names for the semantic knowledge graph.
 */
export const VECTOR_INDEX_NAMES = {
  OBJECT: 'object_embedding',
  FIELD: 'field_embedding',
  PICKLIST_VALUE: 'picklist_value_embedding',
  CATEGORY: 'category_embedding',
  FEW_SHOT_EXAMPLE: 'few_shot_example_embedding',
} as const;

/**
 * Initialize all vector indexes with the given dimensions.
 * Should be called after embedding provider is configured.
 */
export async function initializeVectorIndexes(dimensions: number): Promise<void> {
  const store = getVectorStore();

  log.debug({ dimensions }, 'Initializing vector indexes');

  await store.createIndex(VECTOR_INDEX_NAMES.OBJECT, 'Object', 'embedding', dimensions);
  await store.createIndex(VECTOR_INDEX_NAMES.FIELD, 'Field', 'embedding', dimensions);
  await store.createIndex(VECTOR_INDEX_NAMES.PICKLIST_VALUE, 'PicklistValue', 'embedding', dimensions);
  await store.createIndex(VECTOR_INDEX_NAMES.CATEGORY, 'Category', 'embedding', dimensions);

  log.debug('Vector indexes initialized');
}

/**
 * Check if all vector indexes exist.
 */
export async function checkVectorIndexes(): Promise<{
  allExist: boolean;
  existing: string[];
  missing: string[];
}> {
  const store = getVectorStore();
  const allIndexNames = Object.values(VECTOR_INDEX_NAMES);
  const existingIndexes = await store.listIndexes();

  const existing = allIndexNames.filter((name) => existingIndexes.includes(name));
  const missing = allIndexNames.filter((name) => !existingIndexes.includes(name));

  return {
    allExist: missing.length === 0,
    existing,
    missing,
  };
}

/**
 * Get the dimensions of an existing vector index.
 * Returns null if index doesn't exist.
 */
export async function getIndexDimensions(indexName: string): Promise<number | null> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const result = await session.executeRead(async (tx) => {
      return tx.run(
        `
        SHOW INDEXES
        WHERE name = $indexName AND type = 'VECTOR'
        `,
        { indexName }
      );
    });

    if (result.records.length === 0) {
      return null;
    }

    // Neo4j returns index config in the 'options' field
    const record = result.records[0];
    const options = record.get('options') as Record<string, unknown> | null;
    
    if (options && options.indexConfig) {
      const indexConfig = options.indexConfig as Record<string, unknown>;
      const dimensions = indexConfig['vector.dimensions'];
      if (typeof dimensions === 'number') {
        return dimensions;
      }
      // Neo4j integer type
      if (dimensions && typeof (dimensions as { toNumber?: () => number }).toNumber === 'function') {
        return (dimensions as { toNumber: () => number }).toNumber();
      }
    }

    return null;
  } catch (error) {
    log.debug({ indexName, error }, 'Failed to get index dimensions');
    return null;
  } finally {
    await session.close();
  }
}


/**
 * Vector Store Types
 *
 * Types for the pluggable vector store abstraction.
 * Currently supports Neo4j, designed for future extensibility (Pinecone, Weaviate, Chroma).
 */

export type VectorStoreType = 'neo4j' | 'pinecone' | 'weaviate' | 'chroma';

/**
 * Result from a vector similarity search.
 */
export interface VectorSearchResult {
  /** Unique node identifier (apiName for Objects, composite for Fields) */
  nodeId: string;
  /** Node label (Object, Field, PicklistValue, Category) */
  nodeLabel: string;
  /** Cosine similarity score (0-1, higher is more similar) */
  score: number;
  /** Node properties from the graph */
  properties: Record<string, unknown>;
}

/**
 * Options for vector index creation.
 */
export interface VectorIndexOptions {
  /** Similarity function: 'cosine' | 'euclidean' (default: 'cosine') */
  similarityFunction?: 'cosine' | 'euclidean';
}

/**
 * Options for vector search.
 */
export interface VectorSearchOptions {
  /** Number of results to return (default: 10) */
  topK?: number;
  /** Minimum similarity threshold (0-1, default: 0) */
  minScore?: number;
  /** Property filters to apply */
  filter?: Record<string, unknown>;
}

/**
 * Pluggable vector store interface.
 * Implementations handle vector index creation, search, and embedding storage.
 */
export interface VectorStore {
  /** Store type identifier */
  readonly storeType: VectorStoreType;

  /**
   * Create a vector index for a node label.
   * @param indexName - Unique name for the index
   * @param nodeLabel - Node label to index (e.g., 'Object', 'Field')
   * @param property - Property name storing embeddings (e.g., 'embedding')
   * @param dimensions - Vector dimensions (must match embedding provider)
   * @param options - Optional index configuration
   */
  createIndex(
    indexName: string,
    nodeLabel: string,
    property: string,
    dimensions: number,
    options?: VectorIndexOptions
  ): Promise<void>;

  /**
   * Check if a vector index exists.
   */
  indexExists(indexName: string): Promise<boolean>;

  /**
   * Drop a vector index if it exists.
   */
  dropIndex(indexName: string): Promise<void>;

  /**
   * List all vector indexes.
   */
  listIndexes(): Promise<string[]>;

  /**
   * Search for similar vectors using a specific index.
   * @param indexName - Name of the vector index to search
   * @param embedding - Query embedding vector
   * @param options - Search options
   * @returns Ranked search results
   */
  search(
    indexName: string,
    embedding: number[],
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult[]>;

  /**
   * Store or update an embedding for a node.
   * @param nodeLabel - Node label
   * @param nodeId - Property value to match for the node
   * @param nodeIdProperty - Property name to match (default: 'apiName')
   * @param embedding - Embedding vector
   * @param contentHash - Hash of the source content for change detection
   */
  upsertEmbedding(
    nodeLabel: string,
    nodeId: string,
    nodeIdProperty: string,
    embedding: number[],
    contentHash: string
  ): Promise<void>;

  /**
   * Get the content hash for a node (for change detection).
   * @param nodeLabel - Node label
   * @param nodeId - Property value to match for the node
   * @param nodeIdProperty - Property name to match (default: 'apiName')
   */
  getContentHash(
    nodeLabel: string,
    nodeId: string,
    nodeIdProperty: string
  ): Promise<string | null>;

  /**
   * Batch upsert embeddings for multiple nodes.
   * @param nodeLabel - Node label
   * @param items - Array of {nodeId, nodeIdProperty, embedding, contentHash}
   */
  batchUpsertEmbeddings(
    nodeLabel: string,
    items: Array<{
      nodeId: string;
      nodeIdProperty: string;
      embedding: number[];
      contentHash: string;
    }>
  ): Promise<void>;

  /**
   * Check if the vector store is available and configured.
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Error thrown by vector store operations.
 */
export class VectorStoreError extends Error {
  constructor(
    message: string,
    public readonly store: VectorStoreType,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'VectorStoreError';
  }
}

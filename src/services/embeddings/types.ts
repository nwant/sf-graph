/**
 * Embedding Service Types
 *
 * Core types for the pluggable embedding and vector store abstraction.
 * Supports multiple providers (OpenAI, Ollama) and vector stores (Neo4j, future: Pinecone, etc.)
 */

// === Embedding Provider Types ===

export type EmbeddingProviderType = 'openai' | 'ollama';

/**
 * Configuration for an embedding provider.
 */
export interface EmbeddingConfig {
  /** Provider type */
  provider: EmbeddingProviderType;
  /** Model name (e.g., 'text-embedding-3-small', 'nomic-embed-text') */
  model: string;
  /** API key for cloud providers */
  apiKey?: string;
  /** Base URL for self-hosted providers */
  baseUrl?: string;
}

/**
 * Options for batch embedding operations.
 */
export interface BatchOptions {
  /** Number of texts per API call (default: 100) */
  batchSize?: number;
  /** Maximum retry attempts on rate limit (default: 5) */
  maxRetries?: number;
  /** Initial backoff in ms for exponential backoff (default: 1000) */
  initialBackoffMs?: number;
  /** Progress callback */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Pluggable embedding provider interface.
 * Implementations must support single and batch embedding with smart rate limiting.
 */
export interface EmbeddingProvider {
  /** Provider type identifier */
  readonly providerType: EmbeddingProviderType;

  /** Model name for embedding versioning */
  readonly modelName: string;

  /**
   * Embed a single text string.
   * @param text - Text to embed
   * @returns Embedding vector
   */
  embed(text: string): Promise<number[]>;

  /**
   * Embed multiple texts with batching and rate limit handling.
   * @param texts - Texts to embed
   * @param options - Batch options including retry and progress handling
   * @returns Array of embedding vectors
   */
  embedBatch(texts: string[], options?: BatchOptions): Promise<number[][]>;

  /**
   * Get the embedding dimensions for this provider/model.
   * Critical: Must return correct value for vector index creation.
   */
  getDimensions(): number;

  /**
   * Check if the provider is available and configured correctly.
   */
  isAvailable(): Promise<boolean>;
}

// === Vector Store Types ===

export type VectorStoreType = 'neo4j' | 'pinecone' | 'weaviate' | 'chroma';

/**
 * Result from a vector similarity search.
 */
export interface VectorSearchResult {
  /** Node identifier */
  nodeId: string;
  /** Node label (Object, Field, etc.) */
  nodeLabel: string;
  /** Similarity score (0-1, higher is better) */
  score: number;
  /** Node properties */
  properties: Record<string, unknown>;
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
   * @param indexName - Name of the index
   * @param nodeLabel - Node label to index (e.g., 'Object', 'Field')
   * @param property - Property name storing embeddings (e.g., 'embedding')
   * @param dimensions - Vector dimensions (must match embedding provider)
   */
  createIndex(
    indexName: string,
    nodeLabel: string,
    property: string,
    dimensions: number
  ): Promise<void>;

  /**
   * Check if a vector index exists.
   */
  indexExists(indexName: string): Promise<boolean>;

  /**
   * Drop a vector index.
   */
  dropIndex(indexName: string): Promise<void>;

  /**
   * Search for similar vectors.
   * @param embedding - Query embedding vector
   * @param nodeLabel - Node label to search within
   * @param topK - Number of results to return
   * @param filter - Optional property filters
   * @returns Ranked search results
   */
  search(
    embedding: number[],
    nodeLabel: string,
    topK: number,
    filter?: Record<string, unknown>
  ): Promise<VectorSearchResult[]>;

  /**
   * Store or update an embedding for a node.
   * @param nodeLabel - Node label
   * @param nodeId - Unique identifier for the node
   * @param embedding - Embedding vector
   * @param contentHash - Hash of the source content for change detection
   */
  upsertEmbedding(
    nodeLabel: string,
    nodeId: string,
    embedding: number[],
    contentHash: string
  ): Promise<void>;

  /**
   * Get the content hash for a node (for change detection).
   */
  getContentHash(nodeLabel: string, nodeId: string): Promise<string | null>;
}

// === Embeddable Metadata Types ===

export type EmbeddableNodeType = 'Object' | 'Field' | 'PicklistValue' | 'Category';

/**
 * Metadata about content to be embedded.
 */
export interface EmbeddableMetadata {
  /** Type of node */
  nodeType: EmbeddableNodeType;
  /** Unique identifier for the node */
  nodeId: string;
  /** Composed text for embedding */
  text: string;
  /** SHA-256 hash of the text for change detection */
  contentHash: string;
  /** Computed embedding (if available) */
  embedding?: number[];
}

/**
 * Input for composing embeddable text from metadata.
 */
export interface MetadataInput {
  /** API name of the entity */
  apiName: string;
  /** Human-readable label */
  label?: string;
  /** Description text */
  description?: string;
  /** Help text (for fields) */
  helpText?: string;
  /** Data type (for fields) */
  type?: string;
  /** Parent object (for fields) */
  objectApiName?: string;
  /** Related entities (for context) */
  relatedEntities?: string[];
}

// === Error Types ===

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly provider: EmbeddingProviderType,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

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

export class RateLimitError extends EmbeddingError {
  constructor(
    provider: EmbeddingProviderType,
    public readonly retryAfterMs?: number
  ) {
    super(`Rate limit exceeded for ${provider}`, provider);
    this.name = 'RateLimitError';
  }
}

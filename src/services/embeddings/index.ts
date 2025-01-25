/**
 * Embeddings Service - Public API
 *
 * Provides embedding generation and vector search capabilities
 * with pluggable providers (OpenAI, Ollama) and stores (Neo4j, future: Pinecone).
 */

// Types
export type {
  EmbeddingProvider,
  EmbeddingProviderType,
  EmbeddingConfig,
  BatchOptions,
  VectorStore,
  VectorStoreType,
  VectorSearchResult,
  EmbeddableMetadata,
  EmbeddableNodeType,
  MetadataInput,
} from './types.js';

export { EmbeddingError, VectorStoreError, RateLimitError } from './types.js';

// Provider implementations
export { OpenAIEmbeddingProvider, createOpenAIProvider } from './openai-embeddings.js';
export { OllamaEmbeddingProvider, createOllamaProvider } from './ollama-embeddings.js';

// Service functions
export {
  createEmbeddingProvider,
  getEmbeddingProvider,
  clearEmbeddingProvider,
  composeEmbeddableText,
  computeContentHash,
  createEmbeddableMetadata,
  hasContentChanged,
  prepareObjectMetadata,
  prepareFieldMetadata,
  preparePicklistValueMetadata,
  batchPrepareMetadata,
} from './embedding-service.js';

// Embedding Sync
export {
  EmbeddingSyncService,
  createEmbeddingSyncService,
  type EmbeddingSyncOptions,
  type EmbeddingSyncResult,
  type EmbeddingGraphExecutor,
  type ObjectForEmbedding,
  type FieldForEmbedding,
} from './embedding-sync.js';

// Neo4j Graph Executor
export {
  Neo4jGraphExecutor,
  createNeo4jGraphExecutor,
} from './neo4j-graph-executor.js';

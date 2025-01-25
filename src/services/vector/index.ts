/**
 * Vector Store - Public API
 *
 * Provides vector storage and similarity search capabilities
 * with Neo4j as the primary implementation.
 */

// Types
export type {
  VectorStore,
  VectorStoreType,
  VectorSearchResult,
  VectorIndexOptions,
  VectorSearchOptions,
} from './types.js';

export { VectorStoreError } from './types.js';

// Neo4j implementation
export {
  Neo4jVectorStore,
  createNeo4jVectorStore,
  getVectorStore,
  clearVectorStore,
  VECTOR_INDEX_NAMES,
  initializeVectorIndexes,
  checkVectorIndexes,
} from './neo4j-vector-store.js';

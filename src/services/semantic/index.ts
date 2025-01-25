/**
 * Semantic Search Service - Public API
 *
 * Provides hybrid short-circuit semantic search for schema elements.
 * Exact match first (O(1)), vector search as fallback (~300ms).
 */

// Types
export type {
  SemanticMatchSource,
  SemanticMatch,
  ObjectSearchResult,
  FieldSearchResult,
  SemanticSearchOptions,
  ExactMatchIndex,
  ExactMatchEntry,
  SemanticSearchService,
  VectorSearchExecutor,
  EmbeddingGenerator,
} from './types.js';

export { DEFAULT_SEARCH_OPTIONS } from './types.js';

// Semantic Search Service
export {
  SemanticSearchServiceImpl,
  createSemanticSearchService,
  type SemanticGraphQueryExecutor,
} from './semantic-search-service.js';

// Semantic Graph Executor
export {
  Neo4jSemanticGraphExecutor,
  createSemanticGraphExecutor,
} from './semantic-graph-executor.js';

// Semantic Context Provider
export {
  SemanticSchemaContextProvider,
  createSemanticSchemaContextProvider,
  type SemanticContextGraphExecutor,
  type ObjectDetails,
  type FieldDetails,
  type ParentRelationship,
  type ChildRelationship,
} from './semantic-context-provider.js';

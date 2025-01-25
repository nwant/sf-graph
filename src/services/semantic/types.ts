/**
 * Semantic Search Types
 *
 * Types for the hybrid semantic search service.
 * Uses short-circuit strategy: exact match first, vector search as fallback.
 */

// === Search Result Types ===

/**
 * Source of a semantic match.
 */
export type SemanticMatchSource =
  | 'exact_match'      // O(1) exact lookup by label/apiName
  | 'fuzzy_match'      // Traditional fuzzy matching
  | 'semantic'         // Vector similarity search
  | 'combined';        // Combined from multiple sources

/**
 * A semantic match result.
 */
export interface SemanticMatch {
  /** API name of the matched object/field */
  apiName: string;
  /** Human-readable label */
  label: string;
  /** For fields, the parent object */
  sobjectType?: string;
  /** Similarity/confidence score (0-1) */
  similarity: number;
  /** How the match was found */
  source: SemanticMatchSource;
  /** Description (if available) */
  description?: string;
}

/**
 * Result from a semantic object search.
 */
export interface ObjectSearchResult extends SemanticMatch {
  /** Object category (if categorized) */
  category?: string;
  /** Key prefix for this object */
  keyPrefix?: string;
}

/**
 * Result from a semantic field search.
 */
export interface FieldSearchResult extends SemanticMatch {
  /** Parent object API name */
  sobjectType: string;
  /** Field type */
  type?: string;
  /** Whether the field is filterable */
  filterable?: boolean;
}

// === Search Options ===

/**
 * Options for semantic search.
 */
export interface SemanticSearchOptions {
  /** Organization ID */
  orgId?: string;
  /** Maximum number of results */
  topK?: number;
  /** Minimum similarity threshold (0-1) */
  minSimilarity?: number;
  /** Whether to use vector search (requires embeddings) */
  enableVectorSearch?: boolean;
  /** Whether to include exact matches only */
  exactOnly?: boolean;
  /** Filter by object category */
  categoryFilter?: string;
  /** Filter to specific objects (for field search) */
  objectFilter?: string[];
}

/**
 * Default search options.
 */
export const DEFAULT_SEARCH_OPTIONS: SemanticSearchOptions = {
  topK: 10,
  minSimilarity: 0.5,
  enableVectorSearch: true,
  exactOnly: false,
};

// === Index Types ===

/**
 * Exact match index entry.
 */
export interface ExactMatchEntry {
  apiName: string;
  label: string;
  description?: string;
  sobjectType?: string;
}

/**
 * Exact match index structure for O(1) lookups.
 */
export interface ExactMatchIndex {
  /** Maps normalized label → entry */
  byLabel: Map<string, ExactMatchEntry>;
  /** Maps normalized apiName → entry */
  byApiName: Map<string, ExactMatchEntry>;
  /** For fields: maps normalized label → array of entries (cross-object) */
  byLabelMulti?: Map<string, ExactMatchEntry[]>;
}

// === Service Interface ===

/**
 * Interface for the semantic search service.
 */
export interface SemanticSearchService {
  /**
   * Find objects matching a term using hybrid search.
   */
  findObjects(term: string, options?: SemanticSearchOptions): Promise<ObjectSearchResult[]>;

  /**
   * Find fields matching a term within an object or globally.
   */
  findFields(
    term: string,
    objectApiName?: string,
    options?: SemanticSearchOptions
  ): Promise<FieldSearchResult[]>;

  /**
   * Rebuild the exact match indexes.
   */
  rebuildIndexes(): Promise<void>;

  /**
   * Check if semantic search (vector) is available.
   */
  isVectorSearchAvailable(): Promise<boolean>;
}

// === Vector Search Interface ===

/**
 * Interface for vector search operations.
 * Implemented by the vector store service.
 */
export interface VectorSearchExecutor {
  /**
   * Search for similar objects by embedding.
   */
  searchObjects(
    queryEmbedding: number[],
    topK: number,
    filter?: Record<string, unknown>
  ): Promise<Array<{ apiName: string; label: string; score: number }>>;

  /**
   * Search for similar fields by embedding.
   */
  searchFields(
    queryEmbedding: number[],
    topK: number,
    filter?: Record<string, unknown>
  ): Promise<Array<{ apiName: string; sobjectType: string; label: string; score: number }>>;

  /**
   * Check if vector indexes exist and are populated.
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Interface for embedding generation.
 */
export interface EmbeddingGenerator {
  /**
   * Generate embedding for a query term.
   */
  embed(text: string): Promise<number[]>;

  /**
   * Check if embedding generation is available.
   */
  isAvailable(): Promise<boolean>;
}

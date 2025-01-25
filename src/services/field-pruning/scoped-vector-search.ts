/**
 * Scoped Field Vector Search (CHESS Strategy)
 *
 * Performs vector similarity search on field embeddings,
 * scoped to specific tables identified by the Decomposer.
 *
 * This implements the CHESS (Hierarchical Column Pruning) strategy:
 * 1. Restrict search to fields within target tables (not global index)
 * 2. Use semantic similarity to find query-relevant fields
 * 3. Always include CORE_FIELDS for query viability
 */

import { getVectorStore, VECTOR_INDEX_NAMES } from '../vector/index.js';
import { getEmbeddingProvider } from '../embeddings/index.js';
import { CORE_FIELDS } from '../soql-draft-utils.js';
import { createLogger } from '../../core/index.js';

const log = createLogger('scoped-vector-search');

/**
 * Options for scoped field search.
 */
export interface ScopedFieldSearchOptions {
  /** Tables to scope the search to (from Decomposer output) */
  targetTables: string[];
  /** Maximum fields to return per table (default: 15) */
  maxFieldsPerTable?: number;
  /** Minimum similarity score (0-1, default: 0.3) */
  minScore?: number;
  /** Original query for embedding */
  query: string;
  /** Org ID for multi-org support */
  orgId?: string;
}

/**
 * Result of scoped field search for a single table.
 */
export interface ScopedFieldResult {
  /** The object API name */
  objectApiName: string;
  /** All fields to include (vector matched + core fields) */
  fields: string[];
  /** Fields that matched via vector search (for debugging) */
  vectorMatched: string[];
  /** Vector similarity scores for each matched field */
  scores: Map<string, number>;
  /** Whether this result used fallback (no vector matches) */
  usedFallback: boolean;
}

/**
 * Search for relevant fields within scoped tables using vector similarity.
 *
 * Implementation:
 * 1. Generate query embedding
 * 2. For each target table, search field_embedding index with filter: { sobjectType: tableName }
 * 3. Merge results with CORE_FIELDS
 * 4. Return top N per table
 *
 * @param options - Search options
 * @returns Array of results, one per target table
 */
export async function searchFieldsScoped(
  options: ScopedFieldSearchOptions
): Promise<ScopedFieldResult[]> {
  const {
    targetTables,
    maxFieldsPerTable = 15,
    minScore = 0.3,
    query,
    // orgId is available for future multi-org vector store filtering
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    orgId: _orgId,
  } = options;

  if (targetTables.length === 0) {
    log.debug('No target tables provided, returning empty results');
    return [];
  }

  const vectorStore = getVectorStore();

  // Check if vector search is available
  const isAvailable = await vectorStore.isAvailable();
  if (!isAvailable) {
    log.warn('Vector store not available, returning core fields only');
    return targetTables.map((table) => ({
      objectApiName: table,
      fields: [...CORE_FIELDS],
      vectorMatched: [],
      scores: new Map(),
      usedFallback: true,
    }));
  }

  // Generate query embedding
  const embeddingProvider = getEmbeddingProvider();
  let queryEmbedding: number[];

  try {
    queryEmbedding = await embeddingProvider.embed(query);
    log.debug(
      { embeddingLength: queryEmbedding.length, query: query.substring(0, 50) },
      'Generated query embedding'
    );
  } catch (error) {
    log.error({ error }, 'Failed to generate query embedding, returning core fields only');
    return targetTables.map((table) => ({
      objectApiName: table,
      fields: [...CORE_FIELDS],
      vectorMatched: [],
      scores: new Map(),
      usedFallback: true,
    }));
  }

  // Search each table in parallel
  const results = await Promise.all(
    targetTables.map(async (tableName): Promise<ScopedFieldResult> => {
      try {
        // Use sobjectType filter to scope search to this table only
        // IMPORTANT: Neo4j vector search applies topK BEFORE the WHERE filter
        // With 13k+ fields, we must fetch many more than needed to get enough per table
        // Using a high topK (500) ensures we get results for smaller tables
        const searchTopK = 500;
        log.debug(
          { table: tableName, topK: searchTopK, minScore },
          'Searching vector index for table'
        );
        const searchResults = await vectorStore.search(
          VECTOR_INDEX_NAMES.FIELD,
          queryEmbedding,
          {
            topK: searchTopK, // Fetch many to ensure we get enough per table after filtering
            minScore,
            filter: { sobjectType: tableName }, // KEY: Scope to specific table
          }
        );
        log.debug(
          { table: tableName, resultCount: searchResults.length },
          'Vector search returned results'
        );

        // Extract field names and scores from results
        const vectorMatchedFields: string[] = [];
        const scores = new Map<string, number>();

        for (const result of searchResults) {
          const fieldName = result.properties.apiName as string;
          if (fieldName && !vectorMatchedFields.includes(fieldName)) {
            vectorMatchedFields.push(fieldName);
            scores.set(fieldName, result.score);
          }
        }

        // Calculate how many non-core slots we have
        const coreFieldsToInclude = CORE_FIELDS.filter(
          (f) => !vectorMatchedFields.includes(f)
        );
        const remainingSlots = Math.max(
          0,
          maxFieldsPerTable - coreFieldsToInclude.length
        );

        // Take top N vector-matched fields
        const topVectorFields = vectorMatchedFields.slice(0, remainingSlots);

        // Merge with core fields (deduplicated)
        const allFields = [...new Set([...CORE_FIELDS, ...topVectorFields])];

        log.debug(
          {
            table: tableName,
            vectorMatchCount: vectorMatchedFields.length,
            finalFieldCount: allFields.length,
          },
          'Scoped vector search completed for table'
        );

        return {
          objectApiName: tableName,
          fields: allFields,
          vectorMatched: vectorMatchedFields,
          scores,
          usedFallback: vectorMatchedFields.length === 0,
        };
      } catch (error) {
        log.warn(
          { error, table: tableName },
          'Vector search failed for table, returning core fields only'
        );
        return {
          objectApiName: tableName,
          fields: [...CORE_FIELDS],
          vectorMatched: [],
          scores: new Map(),
          usedFallback: true,
        };
      }
    })
  );

  // Log summary
  const totalVectorMatched = results.reduce(
    (sum, r) => sum + r.vectorMatched.length,
    0
  );
  const tablesWithFallback = results.filter((r) => r.usedFallback).length;

  log.info(
    {
      tableCount: targetTables.length,
      totalVectorMatched,
      tablesWithFallback,
      maxFieldsPerTable,
    },
    'Scoped vector search completed'
  );

  return results;
}

/**
 * Get the maximum score for a field across all search results.
 * Useful for debugging and logging.
 *
 * @param results - Array of scoped search results
 * @param fieldName - Field to look up
 * @returns Maximum score or null if not found
 */
export function getFieldMaxScore(
  results: ScopedFieldResult[],
  fieldName: string
): number | null {
  let maxScore: number | null = null;

  for (const result of results) {
    const score = result.scores.get(fieldName);
    if (score !== undefined && (maxScore === null || score > maxScore)) {
      maxScore = score;
    }
  }

  return maxScore;
}

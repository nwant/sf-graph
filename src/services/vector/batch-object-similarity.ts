/**
 * Batch Object Similarity
 *
 * Computes semantic similarity between a query and multiple objects
 * by fetching their embeddings directly (not via ANN search) and
 * computing cosine similarity in-memory.
 *
 * This approach guarantees every candidate gets scored, unlike ANN
 * search which might miss structurally important but semantically
 * distant objects due to topK cutoffs.
 */

import { getDriver } from '../neo4j/driver.js';
import { getEmbeddingProvider } from '../embeddings/index.js';
import { createLogger } from '../../core/index.js';

const log = createLogger('batch-object-similarity');

/**
 * Options for batch object similarity computation.
 */
export interface BatchObjectSimilarityOptions {
  /** The query to compare against */
  query: string;
  /** Object API names to compute similarity for */
  objectNames: string[];
  /** Optional org ID for multi-org support */
  orgId?: string;
}

/**
 * Compute cosine similarity between two vectors.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity (0 to 1 for normalized vectors)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * Compute semantic similarity between a query and specific objects.
 *
 * Uses exact embedding fetch (not ANN search) to guarantee every
 * candidate gets scored. This is important because:
 * - Structural neighbors (e.g., junction objects) may be semantically
 *   distant from the query
 * - ANN search with topK cutoff might miss them entirely
 * - Fetching 50 embeddings in one Cypher query is fast (~50ms)
 *
 * @param options - Computation options
 * @returns Map of objectApiName → similarity score (0 to 1)
 */
export async function batchComputeObjectSimilarity(
  options: BatchObjectSimilarityOptions
): Promise<Map<string, number>> {
  const { query, objectNames, orgId } = options;

  if (objectNames.length === 0) {
    return new Map();
  }

  const scores = new Map<string, number>();

  try {
    // 1. Get embedding provider and embed the query
    const embeddingProvider = getEmbeddingProvider();
    const isAvailable = await embeddingProvider.isAvailable();

    if (!isAvailable) {
      log.warn('Embedding provider not available - returning zero scores');
      for (const name of objectNames) {
        scores.set(name, 0);
      }
      return scores;
    }

    const queryEmbedding = await embeddingProvider.embed(query);

    // 2. Fetch embeddings for specific candidates (exact, not ANN)
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = orgId ? 'AND n.orgId = $orgId' : '';

      const cypher = `
        MATCH (n:Object)
        WHERE n.apiName IN $candidateNames ${orgFilter}
        RETURN n.apiName AS name, n.embedding AS embedding
      `;

      const result = await session.executeRead(async (tx) => {
        return tx.run(cypher, {
          candidateNames: objectNames,
          orgId,
        });
      });

      // 3. Compute cosine similarity in-memory for each candidate
      let embeddedCount = 0;
      let missingCount = 0;

      for (const record of result.records) {
        const name = record.get('name') as string;
        const embedding = record.get('embedding') as number[] | null;

        if (embedding && Array.isArray(embedding) && embedding.length > 0) {
          const similarity = cosineSimilarity(queryEmbedding, embedding);
          scores.set(name, similarity);
          embeddedCount++;
        } else {
          // No embedding = 0 semantic score (but graph signals may still boost it)
          scores.set(name, 0);
          missingCount++;
        }
      }

      // Fill in objects not found in database with 0 scores
      for (const name of objectNames) {
        if (!scores.has(name)) {
          scores.set(name, 0);
          missingCount++;
        }
      }

      log.debug(
        {
          queryLength: query.length,
          candidateCount: objectNames.length,
          embeddedCount,
          missingCount,
        },
        'Batch object similarity computed'
      );
    } finally {
      await session.close();
    }
  } catch (error) {
    log.error({ error, query, objectCount: objectNames.length }, 'Failed to compute batch similarity');
    // Return zero scores on error (graceful degradation)
    for (const name of objectNames) {
      scores.set(name, 0);
    }
  }

  return scores;
}

/**
 * Check if vector-based similarity is available.
 *
 * @returns true if embedding provider is available
 */
export async function checkVectorAvailability(): Promise<boolean> {
  try {
    const embeddingProvider = getEmbeddingProvider();
    const available = await embeddingProvider.isAvailable();
    if (!available) {
      log.warn('Vector store unavailable - falling back to Jaccard similarity');
    }
    return available;
  } catch (err) {
    log.warn({ err }, 'Vector availability check failed - falling back to Jaccard');
    return false;
  }
}

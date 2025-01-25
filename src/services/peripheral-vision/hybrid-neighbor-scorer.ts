/**
 * Hybrid Neighbor Scorer
 *
 * Scores neighboring objects using a combination of semantic similarity
 * and graph-based heuristics. Designed to solve the "junction object problem"
 * where structurally important objects have low semantic scores.
 *
 * Score = (semanticWeight × semantic) + (graphWeight × graphSignal) + bonuses
 */

import { createLogger } from '../../core/index.js';
import type { NeighborSummary } from '../neo4j/graph-service.js';
import { batchGetGraphSignals, computeGraphScore } from './batch-graph-signals.js';
import {
  batchComputeObjectSimilarity,
  checkVectorAvailability,
} from '../vector/batch-object-similarity.js';

const log = createLogger('hybrid-neighbor-scorer');

/**
 * Default scoring weights.
 */
export const HYBRID_SCORING_DEFAULTS = {
  /** Weight for semantic similarity component (0-1) */
  semanticWeight: 0.6,
  /** Weight for graph signal component (0-1) */
  graphWeight: 0.4,
  /** Bonus for junction objects that connect 2+ primary tables */
  junctionBonus: 0.15,
} as const;

/**
 * Options for hybrid neighbor scoring.
 */
export interface NeighborScoringOptions {
  /** The natural language query */
  query: string;
  /** Primary tables from the Decomposer plan */
  primaryTables: string[];
  /** Neighbor summaries to score */
  neighbors: NeighborSummary[];
  /** Optional org ID for multi-org support */
  orgId?: string;
  /** Weight for semantic similarity (default: 0.6) */
  semanticWeight?: number;
  /** Weight for graph signals (default: 0.4) */
  graphWeight?: number;
  /** Bonus for junction objects (default: 0.15) */
  junctionBonus?: number;
}

/**
 * A neighbor with hybrid scoring information.
 */
export interface ScoredNeighbor extends NeighborSummary {
  /** Final hybrid score (0-1+) */
  hybridScore: number;
  /** Semantic similarity component (0-1) */
  semanticScore: number;
  /** Graph heuristic component (0-1) */
  graphScore: number;
  /** Whether this object is a junction (connects 2+ primary tables) */
  isJunction: boolean;
  /** Score breakdown for debugging */
  scoreBreakdown: {
    semanticRaw: number;
    graphSignalRaw: number;
    junctionBonus: number;
  };
}

/**
 * Score neighbors using hybrid semantic + graph heuristics.
 *
 * The hybrid approach solves the "junction object problem" where objects
 * like `OpportunityContactRole` may not semantically match "Revenue" but
 * are structurally vital for connecting Account to Contact.
 *
 * @param options - Scoring options
 * @returns Array of scored neighbors, sorted by hybridScore descending
 */
export async function scoreNeighborsHybrid(
  options: NeighborScoringOptions
): Promise<ScoredNeighbor[]> {
  const {
    query,
    primaryTables,
    neighbors,
    orgId,
    semanticWeight = HYBRID_SCORING_DEFAULTS.semanticWeight,
    graphWeight = HYBRID_SCORING_DEFAULTS.graphWeight,
    junctionBonus = HYBRID_SCORING_DEFAULTS.junctionBonus,
  } = options;

  if (neighbors.length === 0) {
    return [];
  }

  // Deduplicate neighbor names (same object might appear from multiple sources)
  const uniqueNeighborNames = [...new Set(neighbors.map((n) => n.apiName))];

  // Batch fetch: semantic scores + graph signals (2 parallel queries)
  const [semanticScores, graphSignals] = await Promise.all([
    batchComputeObjectSimilarity({
      query,
      objectNames: uniqueNeighborNames,
      orgId,
    }),
    batchGetGraphSignals({
      neighborNames: uniqueNeighborNames,
      primaryTables,
      orgId,
    }),
  ]);

  // Compute hybrid scores for each neighbor
  const scoredNeighbors: ScoredNeighbor[] = neighbors.map((neighbor) => {
    const semanticRaw = semanticScores.get(neighbor.apiName) ?? 0;
    const signals = graphSignals.get(neighbor.apiName) ?? {
      relationshipCount: 0,
      isJunction: false,
      primaryLinkCount: 0,
    };

    const graphSignalRaw = computeGraphScore(signals.relationshipCount);
    const junctionBonusValue = signals.isJunction ? junctionBonus : 0;

    // Weighted combination + bonuses
    const hybridScore =
      semanticWeight * semanticRaw +
      graphWeight * graphSignalRaw +
      junctionBonusValue;

    return {
      ...neighbor,
      hybridScore,
      semanticScore: semanticRaw,
      graphScore: graphSignalRaw,
      isJunction: signals.isJunction,
      scoreBreakdown: {
        semanticRaw,
        graphSignalRaw,
        junctionBonus: junctionBonusValue,
      },
    };
  });

  // Sort by hybrid score descending
  scoredNeighbors.sort((a, b) => b.hybridScore - a.hybridScore);

  log.debug(
    {
      neighborCount: neighbors.length,
      uniqueCount: uniqueNeighborNames.length,
      junctionCount: scoredNeighbors.filter((n) => n.isJunction).length,
      topScores: scoredNeighbors.slice(0, 5).map((n) => ({
        name: n.apiName,
        hybrid: n.hybridScore.toFixed(3),
        semantic: n.semanticScore.toFixed(3),
        graph: n.graphScore.toFixed(3),
        isJunction: n.isJunction,
      })),
    },
    'Hybrid neighbor scoring completed'
  );

  return scoredNeighbors;
}

/**
 * Fallback scoring using Jaccard similarity when vectors are unavailable.
 *
 * @param query - The query string
 * @param candidate - The candidate string (apiName + label)
 * @returns Jaccard similarity (0-1)
 */
export function calculateJaccardSimilarity(query: string, candidate: string): number {
  const qTokens = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
  const cTokens = new Set(candidate.toLowerCase().split(/\W+/).filter(Boolean));

  if (qTokens.size === 0 || cTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  cTokens.forEach((t) => {
    if (qTokens.has(t)) intersection++;
  });

  return intersection / (qTokens.size + cTokens.size - intersection);
}

/**
 * Score neighbors with fallback to Jaccard when vectors unavailable.
 *
 * @param options - Scoring options
 * @returns Array of scored neighbors
 */
export async function scoreNeighborsWithFallback(
  options: NeighborScoringOptions
): Promise<ScoredNeighbor[]> {
  const vectorAvailable = await checkVectorAvailability();

  if (vectorAvailable) {
    return scoreNeighborsHybrid(options);
  }

  // Fallback: Jaccard + graph signals (no semantic embeddings)
  log.info('Using Jaccard fallback for neighbor scoring (vectors unavailable)');

  const {
    query,
    primaryTables,
    neighbors,
    orgId,
    semanticWeight = HYBRID_SCORING_DEFAULTS.semanticWeight,
    graphWeight = HYBRID_SCORING_DEFAULTS.graphWeight,
    junctionBonus = HYBRID_SCORING_DEFAULTS.junctionBonus,
  } = options;

  if (neighbors.length === 0) {
    return [];
  }

  const uniqueNeighborNames = [...new Set(neighbors.map((n) => n.apiName))];

  // Only fetch graph signals (no embeddings needed)
  const graphSignals = await batchGetGraphSignals({
    neighborNames: uniqueNeighborNames,
    primaryTables,
    orgId,
  });

  // Compute scores using Jaccard for semantic component
  const scoredNeighbors: ScoredNeighbor[] = neighbors.map((neighbor) => {
    // Jaccard similarity as "semantic" proxy
    const jaccardScore = calculateJaccardSimilarity(
      query,
      `${neighbor.apiName} ${neighbor.label || ''}`
    );

    const signals = graphSignals.get(neighbor.apiName) ?? {
      relationshipCount: 0,
      isJunction: false,
      primaryLinkCount: 0,
    };

    const graphSignalRaw = computeGraphScore(signals.relationshipCount);
    const junctionBonusValue = signals.isJunction ? junctionBonus : 0;

    // For fallback: use Jaccard in place of semantic, with same weighting
    const hybridScore =
      semanticWeight * jaccardScore + graphWeight * graphSignalRaw + junctionBonusValue;

    return {
      ...neighbor,
      hybridScore,
      semanticScore: jaccardScore, // Jaccard as semantic proxy
      graphScore: graphSignalRaw,
      isJunction: signals.isJunction,
      scoreBreakdown: {
        semanticRaw: jaccardScore,
        graphSignalRaw,
        junctionBonus: junctionBonusValue,
      },
    };
  });

  scoredNeighbors.sort((a, b) => b.hybridScore - a.hybridScore);

  return scoredNeighbors;
}

// Re-export for convenience
export { checkVectorAvailability };

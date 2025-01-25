/**
 * Peripheral Vision Module
 *
 * Provides hybrid scoring for schema neighbors using semantic similarity
 * and graph-based heuristics. Used to expand the Decomposer's plan with
 * related objects that might be needed for the query.
 */

export {
  scoreNeighborsHybrid,
  scoreNeighborsWithFallback,
  calculateJaccardSimilarity,
  checkVectorAvailability,
  HYBRID_SCORING_DEFAULTS,
  type NeighborScoringOptions,
  type ScoredNeighbor,
} from './hybrid-neighbor-scorer.js';

export {
  batchGetGraphSignals,
  computeGraphScore,
  type GraphSignals,
  type BatchGraphSignalsOptions,
} from './batch-graph-signals.js';

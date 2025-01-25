/**
 * Grounding Service - Public API
 *
 * Provides value-based grounding to replace hardcoded entity classification.
 * Uses tiered strategy: metadata (graph) first, instance data (SOSL) as fallback.
 */

// Types
export type {
  GroundingType,
  GroundingSource,
  GroundingEvidence,
  GroundingResult,
  GroundedEntity,
  GroundingOptions,
  TierConfig,
  PicklistMatch,
  SoslVerificationResult,
  PatternType,
  PatternMatch,
  ValueGroundingService,
} from './types.js';

export { DEFAULT_TIER_CONFIG } from './types.js';

// SOSL Fallback
export {
  sanitizeSoslTerm,
  isValidSoslTerm,
  buildSoslQuery,
  verifySoslEntity,
  recordExistsByName,
  findBestMatch,
  type SoslExecutor,
  type SoslSearchResponse,
  type SoslSearchRecord,
} from './sosl-fallback.js';

// Value Grounding Service
export {
  ValueGroundingServiceImpl,
  createValueGroundingService,
  type GraphQueryExecutor,
} from './value-grounding-service.js';

// Salesforce SOSL Executor
export {
  SalesforceSoslExecutor,
  createSoslExecutor,
} from './salesforce-sosl-executor.js';

// Graph Executor
export {
  Neo4jGroundingGraphExecutor,
  createGroundingGraphExecutor,
} from './grounding-graph-executor.js';

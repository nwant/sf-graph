/**
 * SOQL Validation Module
 *
 * Modular SOQL validation with focused sub-modules.
 */

// Utilities
export {
  levenshteinDistance,
  findClosestMatch,
  escapeRegex,
  replaceFieldInSelect,
} from './utils.js';

// Matching
export {
  findObjectMatch,
  findFieldMatch,
  findRelationshipMatch,
  findClosestPicklistValue,
  type MatchResult,
  type RelationshipMatchResult,
} from './matching.js';

// Relationships
export {
  validateParentLookup,
  validateSubquery,
} from './relationships.js';

// Aggregates
export {
  validateAggregates,
  isAggregateFunction,
  normalizeNode,
} from './aggregates.js';

// Syntax
export {
  checkSyntax,
  checkSuspiciousIds,
  checkIdFieldLikePatterns,
  validateSemiJoinsFromAst,
  validatePicklistValuesWithAst,
} from './syntax.js';

// Tooling API Constraints
export {
  checkToolingApiConstraints,
  TOOLING_API_OBJECTS,
} from './tooling-constraints.js';

// Governor Limits
export {
  checkGovernorLimits,
  applySuggestedLimit,
  DEFAULT_LIMIT,
  type GovernorLimitResult,
} from './governor-limits.js';

// AST Mutations
export {
  mutateMainObject,
  mutateFieldInSelect,
  mutateParentLookupPath,
  mutateWhereClauseField,
  mutateSubqueryField,
  recomposeQuery,
} from './ast-mutations.js';

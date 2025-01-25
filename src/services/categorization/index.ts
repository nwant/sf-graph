/**
 * Schema Categorization Service - Public API
 *
 * Provides auto-heuristic tagging and schema categorization
 * to replace negative constraints with positive taxonomy.
 */

// Types
export type {
  BuiltInCategory,
  CustomCategory,
  CategoryName,
  HeuristicRuleType,
  HeuristicRule,
  CategorySource,
  CategoryAssignment,
  CategorizedElement,
  CategoryNode,
  CategorySoqlPattern,
  CategorizationOptions,
  CategorizationResult,
  AntiPatternWarning,
  SchemaCategorization,
} from './types.js';

// Heuristic Tagger
export {
  DEFAULT_HEURISTIC_RULES,
  HeuristicTagger,
  createHeuristicTagger,
  type HeuristicGraphQueryExecutor,
  type ObjectProperties,
  type FieldProperties,
} from './heuristic-tagger.js';

// Schema Categorization Service
export {
  SchemaCategorizationServiceImpl,
  createSchemaCategorizationService,
} from './schema-categorization-service.js';

// Graph Executor
export {
  Neo4jCategorizationGraphExecutor,
  createCategorizationGraphExecutor,
} from './categorization-graph-executor.js';

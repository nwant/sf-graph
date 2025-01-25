import type { CategoryName } from '../categorization/types.js';
import type { PicklistMatch } from '../../core/types.js';
import type { GraphObject } from '../neo4j/graph-service.js';

// === Types ===

/**
 * Schema context for a single object.
 */
export interface ObjectSchema {
  apiName: string;
  label: string;
  description?: string;
  /** Category from the heuristic tagger (e.g., 'business_core', 'business_extended') */
  category?: CategoryName;
  fields: FieldSchema[];
  /** Child relationships (for subqueries) */
  childRelationships: Array<{
    relationshipName: string;
    childObject: string;
  }>;
  /** Parent relationships (for dot notation lookups) */
  parentRelationships: Array<{
    fieldApiName: string;
    relationshipName: string;
    targetObject: string;
  }>;
}

/**
 * Full schema context for LLM prompt enrichment.
 */
export interface SchemaContext {
  /** Objects relevant to the query */
  objects: ObjectSchema[];
  /** Summary stats for logging */
  stats: {
    objectCount: number;
    totalFields: number;
    totalRelationships: number;
  };
  /**
   * Discovered picklist matches to hint at specific filtering values.
   */
  picklistHints?: PicklistMatch[];
  /**
   * API names of context objects detected from the query.
   * Used to filter entity grounding to only context-relevant picklist matches.
   * Example: ["Opportunity", "Account"] for "show me Microsoft deals"
   */
  contextObjectNames?: string[];
}

/**
 * Interface for schema context providers.
 * Implementations can use different retrieval strategies:
 * - FuzzySchemaContextProvider (current): keyword extraction + fuzzy matching
 * - SemanticSchemaContextProvider (future): embedding-based similarity
 * - GraphRAGSchemaContextProvider (future): semantic + graph traversal
 */
export interface SchemaContextProvider {
  getContext(query: string, orgId?: string): Promise<SchemaContext>;
  invalidateCache(orgId?: string): void;
}

/**
 * Relationship intent detected from natural language.
 */
export interface RelationshipIntent {
  /** Type of relationship pattern detected */
  type: 'parent_lookup' | 'child_subquery' | 'unknown';
  /** Source entity (the FROM object) */
  sourceEntity: string;
  /** Target entity (the related object) */
  targetEntity: string;
  /** Original phrase matched */
  phrase: string;
}

/**
 * Extract potential entity names from a natural language query.
 * This is a simple keyword extraction for the fuzzy matching phase.
 */
export interface ExtractedTerms {
  entities: string[];
  potentialValues: string[];
}

/**
 * Object with its assigned category.
 */
export interface CategorizedObject {
  object: GraphObject;
  category: CategoryName | null;
}

/**
 * Result from findMatchingObjects including context object names.
 */
export interface MatchingObjectsResult {
  objects: CategorizedObject[];
  picklistMatches: PicklistMatch[];
  /**
   * API names of matched objects (e.g., ["Opportunity", "Account"]).
   * Used as context for entity grounding to filter irrelevant picklist matches.
   */
  contextObjectNames: string[];
}

/**
 * Schema definition for a single field in the metadata context.
 */
export interface FieldSchema {
  apiName: string;
  label: string;
  type: string;
  description?: string;
  picklistValues?: string[];
  
  // Polymorphic Support
  isPolymorphic?: boolean;
  relationshipName?: string;
  polymorphicTargets?: string[];
}

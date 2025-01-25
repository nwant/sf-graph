/**
 * Value Grounding Types
 *
 * Types for the value-based grounding service that replaces
 * hardcoded classification lists with dynamic graph-based grounding.
 */

// === Grounding Result Types ===

/**
 * Type of grounded entity.
 */
export type GroundingType =
  | 'account_name'
  | 'contact_name'
  | 'person_name'
  | 'company_name'
  | 'picklist_value'
  | 'object_reference'
  | 'field_reference'
  | 'status_value'
  | 'priority_value'
  | 'date_reference'
  | 'numeric_value'
  | 'id_reference'
  | 'unknown';

/**
 * Source of grounding evidence.
 */
export type GroundingSource =
  | 'exact_picklist'      // Exact match in PicklistValue node
  | 'category_match'      // Vector match against Category embedding
  | 'semantic_match'      // Vector match against Object/Field embedding
  | 'pattern_match'       // Regex pattern (dates, currencies, IDs)
  | 'sosl_verified'       // Verified via SOSL against live org data
  | 'heuristic'           // Traditional heuristic (company suffixes, person names)
  | 'graph_lookup';       // Direct graph lookup (object/field by name)

/**
 * Evidence supporting a grounding decision.
 */
export interface GroundingEvidence {
  /** How this grounding was determined */
  source: GroundingSource;
  /** Matched node identifier (e.g., "Account.Industry.Technology") */
  matchedNode?: string;
  /** Matched record ID for SOSL-verified results */
  matchedRecordId?: string;
  /** Similarity score for semantic matches (0-1) */
  similarityScore?: number;
  /** Pattern that matched (for pattern_match source) */
  matchedPattern?: string;
  /** Additional context */
  details?: string;
}

/**
 * A single grounding hypothesis for an entity.
 */
export interface GroundingResult {
  /** Type of entity this was grounded as */
  type: GroundingType;
  /** Confidence score (0-1) */
  confidence: number;
  /** Evidence supporting this grounding */
  evidence: GroundingEvidence;
  /** Suggested SOQL filter pattern */
  suggestedFilter: string;
  /** Fields involved in the filter */
  fields: string[];
  /** Human-readable description of the suggestion */
  description: string;
}

/**
 * Complete grounding for an entity value.
 */
export interface GroundedEntity {
  /** Original value being grounded */
  value: string;
  /** All grounding hypotheses, ranked by confidence */
  groundedAs: GroundingResult[];
  /** Best grounding (highest confidence) */
  bestMatch?: GroundingResult;
  /** Whether any grounding was found */
  isGrounded: boolean;
}

// === Grounding Options ===

/**
 * Options for grounding operations.
 */
export interface GroundingOptions {
  /** Organization ID for org-specific lookups */
  orgId?: string;
  /** Target object context (e.g., "Account" when querying accounts) */
  targetObject?: string;
  /** Whether to enable SOSL fallback for instance data */
  enableSoslFallback?: boolean;
  /** Maximum number of grounding hypotheses to return */
  maxResults?: number;
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Whether to use semantic search */
  enableSemanticSearch?: boolean;
  /**
   * Context objects detected from the query (e.g., ["Opportunity", "Account"]).
   * Used to filter picklist matches to only context-relevant objects.
   * Prevents false matches like AuthProvider.ProviderType='Microsoft' when
   * the query is about "Microsoft deals" (Opportunity context).
   */
  contextObjects?: string[];
}

// === Tier Configuration ===

/**
 * Configuration for grounding tiers.
 */
export interface TierConfig {
  /** Enable Tier 1: Metadata grounding (picklist, category, pattern, semantic) */
  enableMetadataTier: boolean;
  /** Enable Tier 2: Instance data grounding (SOSL) */
  enableInstanceTier: boolean;
  /** Objects to search in SOSL fallback */
  soslTargetObjects: string[];
  /** Maximum SOSL results per object */
  soslResultLimit: number;
}

/**
 * Default tier configuration.
 */
export const DEFAULT_TIER_CONFIG: TierConfig = {
  enableMetadataTier: true,
  enableInstanceTier: false, // Disabled by default, requires explicit enablement
  soslTargetObjects: ['Account', 'Contact', 'Lead', 'Opportunity'],
  soslResultLimit: 5,
};

// === Picklist Match Types ===

/**
 * Result from a picklist value lookup.
 */
export interface PicklistMatch {
  /** Object API name */
  objectApiName: string;
  /** Field API name */
  fieldApiName: string;
  /** Picklist value */
  value: string;
  /** Picklist label */
  label: string;
  /** Whether this is an exact match */
  isExact: boolean;
  /** Similarity score for fuzzy matches */
  similarity?: number;
}

// === SOSL Types ===

/**
 * Result from a SOSL verification query.
 */
export interface SoslVerificationResult {
  /** Object type of the matched record */
  objectType: string;
  /** Record ID */
  recordId: string;
  /** Record Name or other identifying field */
  recordName: string;
  /** Whether the search term was found */
  found: boolean;
}

// === Pattern Types ===

/**
 * Recognized pattern types for value classification.
 */
export type PatternType =
  | 'salesforce_id'       // 15 or 18 character Salesforce ID
  | 'date_literal'        // TODAY, LAST_WEEK, etc.
  | 'date_value'          // 2024-01-15
  | 'currency_value'      // $1,000.00
  | 'numeric_value'       // 1000, 1.5
  | 'email_address'       // user@example.com
  | 'phone_number'        // +1-555-123-4567
  | 'url'                 // https://example.com
  | 'priority_value'      // high, medium, low, critical, urgent
  | 'status_value';       // open, closed, new, active, etc.

/**
 * Result from pattern matching.
 */
export interface PatternMatch {
  /** Type of pattern matched */
  patternType: PatternType;
  /** Normalized value */
  normalizedValue: string;
  /** Original value */
  originalValue: string;
  /** Confidence of the pattern match */
  confidence: number;
}

// === Service Interface ===

/**
 * Interface for the value grounding service.
 */
export interface ValueGroundingService {
  /**
   * Ground a single value against org metadata and data.
   */
  groundValue(value: string, options?: GroundingOptions): Promise<GroundedEntity>;

  /**
   * Ground multiple values in batch.
   */
  groundValues(values: string[], options?: GroundingOptions): Promise<GroundedEntity[]>;

  /**
   * Check if a value exists as a picklist value.
   */
  findPicklistMatch(value: string, objectApiName?: string): Promise<PicklistMatch | null>;

  /**
   * Verify a value exists in instance data via SOSL.
   */
  verifySosl(term: string, targetObjects?: string[]): Promise<SoslVerificationResult[]>;
}

/**
 * Shared TypeScript types for sf-graph
 *
 * These types are used across CLI, MCP, and REST API interfaces.
 */

import type { ObjectCategory, ObjectSubtype } from './object-classifier.js';

// Re-export classifier types for convenience
export type { ObjectCategory, ObjectSubtype, ObjectClassification, FieldCategory, FieldClassification } from './object-classifier.js';

// === Salesforce Object Types ===

export interface SalesforceObject {
  apiName: string;
  label: string;
  category: ObjectCategory;
  subtype?: ObjectSubtype;
  namespace?: string;
  parentObjectName?: string;
  keyPrefix?: string;
  orgId?: string;
}

export interface SalesforceField {
  apiName: string;
  label: string;
  type: string;
  referenceTo?: string[];
  category: 'standard' | 'custom';
  namespace?: string;
  required: boolean;
  unique: boolean;
  externalId: boolean;
  // SOQL-relevant properties
  calculated?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  length?: number;
  precision?: number;
  scale?: number;
  // Relationship metadata
  relationshipName?: string;
  relationshipType?: 'Lookup' | 'MasterDetail' | 'Hierarchical';
  // Picklist metadata
  controllerName?: string;
  picklistValues?: PicklistValue[];
}

export interface PicklistValue {
  value: string;
  label: string;
  active: boolean;
  defaultValue: boolean;
  validFor?: string;
}

export interface ObjectDetails extends SalesforceObject {
  fields: SalesforceField[];
  relationships: ObjectRelationship[];
}

export interface ObjectRelationship {
  fieldApiName: string;
  fieldLabel?: string;
  fieldDescription?: string;
  relationshipName: string;
  referenceTo: string[];
  relationshipType: 'Lookup' | 'MasterDetail' | 'Hierarchical';
  direction: 'incoming' | 'outgoing';
  relatedObject: string;
}

export interface RelatedObject {
  apiName: string;
  label: string;
  relationshipType: string;
  depth: number;
}

export interface PicklistMatch {
  object: {
    apiName: string;
    label: string;
    description: string;
    category: string;
    name: string;
    orgId: string | null;
    lastRefreshed: string | null;
  };
  field: {
    apiName: string;
    sobjectType: string;
    label: string;
    type: string;
    description: string;
    helpText: string;
    nillable: boolean;
    unique: boolean;
    category: string;
    name: string;
    lastRefreshed: string | null;
  };
  value: string;
}

// === Path Finding Types ===

export interface PathHopField {
  apiName: string;
  label: string;
  toObject: string;
  referenceTo: string[]; // Array for polymorphic lookups
  category: 'standard' | 'custom';
  relationshipName: string;
  relationshipType: 'Lookup' | 'MasterDetail' | 'Hierarchical';
  direction: 'up' | 'down';
}

export interface PathHop {
  fromObject: string;
  toObject: string;
  direction: 'up' | 'down'; // up = parent lookup, down = child lookup
  fields: PathHopField[];
}

export interface DetailedPath {
  objects: string[];
  hops: PathHop[];
  hopCount: number;
}

export interface PathFindingResult {
  fromObject: string;
  toObject: string;
  pathCount: number;
  minHops: number;
  maxHops: number;
  paths: DetailedPath[]; // Sorted ascending by hopCount
}

export interface ObjectPath {
  path: string[];
  relationships: string[];
}

export interface NavigationNode {
  objectName: string;
  fieldName?: string; // Field used to navigate TO this object
  direction?: 'parent' | 'child'; // parent = navigated FROM child TO parent (Up), child = navigated FROM parent TO child (Down)
  isCycle: boolean;
  // Metadata for rich display
  relationshipType?: string; // e.g., 'Lookup', 'MasterDetail'
  relationshipName?: string; // e.g., 'Contacts'
}

// === SOQL Path Types (for relationship query generation) ===

/**
 * A single segment in a SOQL path, representing one relationship hop.
 * Contains all metadata needed to generate SOQL relationship syntax.
 */
export interface SoqlPathSegment {
  fromObject: string;
  toObject: string;
  direction: 'up' | 'down';
  /** The lookup field on the source object (e.g., 'AccountId') */
  fieldApiName: string;
  /** For 'up' direction: relationship name for dot notation (e.g., 'Account' for Contact.Account.Name) */
  relationshipName: string;
  /** For 'down' direction: child relationship name for subqueries (e.g., 'Contacts' for SELECT FROM Contacts) */
  childRelationshipName?: string;
  relationshipType: 'Lookup' | 'MasterDetail' | 'Hierarchical';
}

/**
 * A complete path between two objects with SOQL-generation metadata.
 */
export interface SoqlPath {
  objects: string[];
  segments: SoqlPathSegment[];
  hopCount: number;
  /**
   * Pre-computed dot notation for child-to-parent traversal.
   * Example: 'Account.Owner' for Contact -> Account -> User path
   * Only populated when all segments are 'up' direction.
   */
  dotNotation?: string;
  /** True if all segments are 'down' direction (can use subquery syntax) */
  canUseSubquery: boolean;
  /** True if path exceeds SOQL's 5-level relationship depth limit */
  exceedsDepthLimit: boolean;
}

/**
 * Result of finding SOQL-ready paths between two objects.
 */
export interface SoqlPathResult {
  fromObject: string;
  toObject: string;
  paths: SoqlPath[];
  /** Shortest valid path (doesn't exceed depth limit) */
  shortestPath?: SoqlPath;
  /** Recommended path for SOQL queries (shortest that respects limits) */
  recommendedPath?: SoqlPath;
}

// === Sync Types ===

/**
 * Progress information for sync operations
 */
export interface SyncProgress {
  phase: 'listing' | 'describing' | 'objects' | 'fields' | 'picklistValues' | 'picklistEnrichment' | 'dependencies' | 'relationships' | 'cleanup' | 'objectEmbeddings' | 'fieldEmbeddings' | 'categorization';
  current: number;
  total: number;
  objectName?: string;
  message?: string;
}

/**
 * Callback for sync progress updates
 */
export type SyncProgressCallback = (progress: SyncProgress) => void;

/**
 * Error that occurred during a specific sync phase
 */
export interface SyncPhaseError {
  phase: string;
  objectName?: string;
  fieldName?: string;
  error: string;
  retryable: boolean;
}

/**
 * Statistics for a single sync phase
 */
export interface SyncPhaseStats {
  duration: number;
  count: number;
  errors: number;
}

export interface SyncOptions {
  orgId?: string;
  objectApiName?: string;
  objectFilter?: string[];        // Only sync these specific objects
  includeFields?: boolean;        // Sync field nodes for each object
  includeRelationships?: boolean; // Create REFERENCES edges between objects
  includeRecordTypes?: boolean;
  excludeSystemObjects?: boolean; // Skip __Share, __Feed, __History, __ChangeEvent
  categoryFilter?: ObjectCategory[]; // Only sync specific categories
  connection?: unknown;
  // Parallelization options
  concurrency?: number;           // Max parallel SF API calls (default: 10)
  batchSize?: number;             // Neo4j batch write size (default: 50)
  onProgress?: SyncProgressCallback;
  retryAttempts?: number;         // Max retries for transient errors (default: 3)
  retryDelayMs?: number;          // Initial retry delay (default: 1000)
  incremental?: boolean;          // Soft-delete missing objects instead of removing
  rebuild?: boolean;              // Delete all org data before syncing
}

export interface SyncResult {
  success: boolean;
  objectCount: number;
  fieldCount?: number;
  relationshipCount?: number;
  picklistValueCount?: number;
  dependencyCount?: number;
  deletedCount?: number;
  syncedAt: string;
  duration?: number;
  message?: string;
  error?: string;
  // Phase breakdown for parallel sync
  phaseStats?: {
    describing?: SyncPhaseStats;
    objects?: SyncPhaseStats;
    fields?: SyncPhaseStats;
    picklistValues?: SyncPhaseStats;
    picklistEnrichment?: SyncPhaseStats;
    dependencies?: SyncPhaseStats;
    relationships?: SyncPhaseStats;
  };
  errors?: SyncPhaseError[];  // Non-fatal errors collected during sync
}

// === SOQL Types ===

export interface SoqlOptions {
  objectApiName: string;
  fields?: string[];
  whereClause?: string;
  orderBy?: string;
  limit?: number;
}

export interface SoqlResult {
  soql: string;
  mainObject: string;
  selectedFields: string[];
  conditions?: string[];
  orderBy?: string;
  limit?: number;
  isValid: boolean;
  validationMessages?: string[];
  llmAnalysis?: string;
}

export interface QueryResult {
  totalSize: number;
  done: boolean;
  records: Record<string, unknown>[];
}

// === SOQL Validation Types (LLM + Graph architecture) ===

/**
 * A single validation message from SOQL validation.
 */
export interface SoqlValidationMessage {
  type: 'error' | 'warning' | 'correction';
  message: string;
  /** Original value if corrected */
  original?: string;
  /** Corrected value if applicable */
  corrected?: string;
}

/**
 * Result of validating a SOQL query against the metadata graph.
 */
export interface SoqlValidationResult {
  /** Whether the query is valid (no errors) */
  isValid: boolean;
  /** The original or corrected SOQL query */
  soql: string;
  /** Whether any corrections were made */
  wasCorrected: boolean;
  /** Validation messages (warnings, errors, corrections) */
  messages: SoqlValidationMessage[];
  /** Parsed components for transparency */
  parsed?: {
    mainObject: string;
    fields: string[];
    subqueries: string[];
    whereClause?: string;
    orderBy?: string;
    limit?: number;
  };
}

/**
 * Result of natural language to SOQL generation.
 * Uses LLM for generation and graph for validation.
 */
export interface SoqlGenerationResult {
  /** The final validated SOQL query */
  soql: string;
  /** Whether the query is valid and can be executed */
  isValid: boolean;
  /** The draft SOQL generated by LLM (before validation) */
  draftSoql: string;
  /** Validation result with messages */
  validation: SoqlValidationResult;
  /** Main object being queried */
  mainObject: string;
  /** Schema context statistics for UX */
  contextStats?: {
    objectCount: number;
    totalFields: number;
  };
}

// === Org Types ===

export interface OrgInfo {
  orgId?: string;
  alias: string;
  username: string;
  instanceUrl: string;
  isScratch: boolean;
  isDefault: boolean;
  syncedToGraph: boolean;
}

export interface OrgStatus {
  orgId: string;
  synced: boolean;
  objectCount?: number;
  lastSyncedAt?: string;
  message: string;
}

export interface SchemaComparison {
  sourceOrg: string;
  targetOrg: string;
  summary: {
    objectsOnlyInSource: number;
    objectsOnlyInTarget: number;
    objectsWithDifferences: number;
    objectsInBoth: number;
  };
  differences: SchemaDifference[];
  message?: string;
}

export interface SchemaDifference {
  objectApiName: string;
  status: 'only_in_source' | 'only_in_target' | 'different';
  fieldDifferences?: FieldDifference[];
}

export interface FieldDifference {
  fieldApiName: string;
  status: 'only_in_source' | 'only_in_target' | 'type_mismatch';
  sourceType?: string;
  targetType?: string;
}

// === Graph Status Types ===

export interface GraphStatus {
  populated: boolean;
  objectCount: number;
  lastSyncedAt?: string;
  orgId?: string;
}

// === LLM Types ===

export interface LlmStatus {
  available: boolean;
  defaultModel: string;
  availableModels: LlmModel[];
}

export interface LlmModel {
  name: string;
  modified_at?: string;
  size?: number;
}

// === Sample Data Types ===

export interface SampleDataResult {
  objectApiName: string;
  count: number;
  records: Record<string, unknown>[];
  relatedRecords?: Record<string, Record<string, unknown>[]>;
}

// === Entity Classification Types ===

/**
 * Classification of an entity extracted from natural language.
 * Used to determine appropriate SOQL filter patterns.
 */
export type EntityType =
  | 'company_name'      // Microsoft, Acme -> Account.Name LIKE 'X%'
  | 'person_name'       // John Doe -> Contact.Name or Owner.Name
  | 'status_value'      // Open, Closed, High -> Picklist field filter
  | 'priority_value'    // High, Low, Critical -> Priority picklist
  | 'object_reference'  // Account, Contact -> FROM clause
  | 'date_reference'    // today, this week -> Date field filter
  | 'numeric_value'     // 100k, 50000 -> Amount or numeric field
  | 'unknown';

/**
 * A suggested SOQL filter pattern for an entity.
 */
export interface SoqlFilterPattern {
  /** Human-readable description */
  description: string;
  /** The SOQL pattern to use */
  pattern: string;
  /** Fields involved */
  fields: string[];
  /** Confidence this is the right pattern (0-1) */
  confidence: number;
}

/**
 * An entity extracted and classified from natural language.
 */
export interface ClassifiedEntity {
  /** The raw value extracted from the query */
  value: string;
  /** Classification of what type of entity this is */
  type: EntityType;
  /** Confidence score 0-1 */
  confidence: number;
  /** Suggested SOQL patterns for this entity */
  suggestedPatterns: SoqlFilterPattern[];
  /** If object_reference, the matched object API name */
  matchedObject?: string;
  /** If status/priority, the matched picklist field and value */
  picklistMatch?: {
    objectApiName: string;
    fieldApiName: string;
    matchedValue: string;
  };
}

// === Query Intent Analysis Types ===

/**
 * Full analysis of a natural language query's intent.
 */
export interface QueryIntentAnalysis {
  /** Original query */
  query: string;
  /** Classified entities with their types */
  entities: ClassifiedEntity[];
  /** Detected Salesforce objects */
  detectedObjects: Array<{
    apiName: string;
    label: string;
    confidence: number;
    role: 'primary' | 'related' | 'filter_target';
  }>;
  /** Relationship intents */
  relationships: Array<{
    type: 'parent_lookup' | 'child_subquery' | 'semi_join';
    sourceObject: string;
    targetObject: string;
    phrase: string;
    suggestedSoql: string;
  }>;
  /** Picklist matches found */
  picklistMatches: PicklistMatch[];
  /** Suggested filter patterns */
  suggestedFilters: SoqlFilterPattern[];
}

// === Enhanced Validation Types ===

/**
 * An enhanced validation error with smart entity detection.
 */
export interface EnhancedValidationError {
  /** The problematic path (e.g., "Account.ProviderType") */
  path: string;
  /** What type of error */
  errorType: 'invalid_field' | 'invalid_relationship' | 'invalid_object' | 'hallucinated_entity';
  /** The original error message */
  message: string;
  /** Smart detection: is this likely an entity name misused as a field? */
  likelyEntityMisuse?: {
    detectedEntityType: EntityType;
    suggestedPattern: string;
    explanation: string;
  };
  /** Available alternatives */
  suggestions: string[];
  /** Exact SOQL snippet to use instead */
  correctedSnippet?: string;
}

/**
 * Enhanced validation result with smart suggestions.
 */
export interface EnhancedValidationResult extends SoqlValidationResult {
  /** Enhanced errors with smart suggestions */
  enhancedErrors: EnhancedValidationError[];
  /** If corrections were applied, the corrected SOQL */
  correctedSoql?: string;
  /** Actionable hints for the LLM */
  hints: string[];
}

// === Structured SOQL Response Types (Chain of Thought Validation) ===

/**
 * Structured response from LLM for SOQL generation.
 * Enforces Chain of Thought validation by requiring explicit entity mappings
 * and relationship claims that will be verified against the graph.
 */
export interface StructuredSoqlResponse {
  /** Entity mappings - LLM must address every extracted entity */
  mappings: Array<{
    /** The entity extracted from the query */
    entity: string;
    /** MAP = use in SOQL, IGNORE = not relevant to the query */
    action: 'MAP' | 'IGNORE';
    /** The SOQL pattern (required if MAP) */
    resolvedTo?: string;
    /** Target object (required if MAP) */
    objectUsed?: string;
    /** Reason for ignoring (required if IGNORE) */
    reason?: string;
  }>;
  /** Relationship claims - will be verified against graph, NOT trusted */
  relationships: Array<{
    /** Source object */
    from: string;
    /** Target object */
    to: string;
    /** Field used for the relationship (e.g., "AccountId") */
    field: string;
  }>;
  /** Primary object for FROM clause */
  primaryObject: string;
  /** Generated SOQL query */
  soql: string;
  /** Optional notes for complex decisions */
  notes?: string;
}

/**
 * Result of parsing an LLM response for structured SOQL.
 */
export interface StructuredSoqlParseResult {
  /** Whether parsing succeeded */
  success: boolean;
  /** Parsed response (if successful) */
  response?: StructuredSoqlResponse;
  /** Error message (if failed) */
  error?: string;
  /** Fallback SOQL extracted via regex (if JSON failed but SELECT found) */
  fallbackSoql?: string;
}

/**
 * Result of validating the LLM's reasoning.
 */
export interface ReasoningValidation {
  /** Whether reasoning is valid */
  valid: boolean;
  /** Errors that must be fixed */
  errors: string[];
  /** Warnings (non-blocking) */
  warnings: string[];
}

// === Multi-Agent Types ===

/**
 * Output from the Decomposer Agent.
 * Represents the "Implementation Plan" for the query.
 */
export interface DecomposerPlan {
  /** Natural language summary of the plan */
  summary: string;
  /** List of tables (objects) strictly required for the query */
  relevantTables: string[];
  /** List of columns (fields) strictly required, scoped by object (e.g. "Account.Name") */
  relevantColumns: string[];
  /** Any join logic or complex filter requirements identified */
  joinLogic?: string;
  /** Global context or domain knowledge applied */
  globalContext?: string;
}

/**
 * Relaxed response for the Coder Agent.
 * Allows for Chain-of-Thought reasoning + Code Block.
 */
export interface RelaxedSoqlResponse {
  /** The full text response (CoT + Code) */
  fullResponse: string;
  /** The extracted SOQL query */
  soql: string;
  /** Extracted thought process (CoT) */
  thoughtProcess?: string;
}

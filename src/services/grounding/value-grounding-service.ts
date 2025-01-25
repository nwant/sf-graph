/**
 * Value Grounding Service
 *
 * Implements tiered grounding strategy to replace hardcoded classification.
 *
 * Tier 1: Metadata (Graph)
 *   1. Exact Picklist Match - Query :PicklistValue nodes (highest confidence)
 *   2. Category Match - Vector search against :Category embeddings
 *   3. Pattern Match - Detect dates, currencies, IDs via regex
 *   4. Semantic Similarity - Vector search against :Object/:Field embeddings
 *
 * Tier 2: Instance Data (SOSL Fallback)
 *   If Tier 1 identifies target object but no picklist match,
 *   verify the record exists via SOSL.
 */

import { createLogger } from '../../core/index.js';
import type {
  GroundedEntity,
  GroundingResult,
  GroundingOptions,
  PicklistMatch,
  PatternMatch,
  TierConfig,
  SoslVerificationResult,
} from './types.js';
import { DEFAULT_TIER_CONFIG } from './types.js';
import {
  sanitizeSoslTerm,
  verifySoslEntity,
  type SoslExecutor,
} from './sosl-fallback.js';
import type { CategoryName } from '../categorization/types.js';
import {
  createSchemaCategorizationService,
  type SchemaCategorizationServiceImpl,
} from '../categorization/schema-categorization-service.js';
import { createCategorizationGraphExecutor } from '../categorization/categorization-graph-executor.js';

const log = createLogger('value-grounding');

// === Category Confidence Modifiers ===

/**
 * Confidence multipliers based on object category.
 *
 * This prevents system objects like AuthProvider from winning over
 * business objects when both have matching picklist values.
 *
 * Example: AuthProvider.ProviderType='Microsoft' gets 0.3 × 0.95 = 0.285
 * instead of 0.95, allowing SOSL fallback to find Account.Name='Microsoft'.
 */
const CATEGORY_CONFIDENCE_MODIFIERS: Partial<Record<CategoryName, number>> = {
  business_core: 1.0,      // Full confidence for core CRM objects
  business_extended: 0.9,  // Slight penalty for extended custom objects
  system: 0.3,             // Heavy penalty for system/tooling objects
  system_derived: 0.3,     // Heavy penalty for Feed/History/Share objects
  managed_package: 0.7,    // Moderate penalty for managed package objects
  custom_metadata: 0.4,    // Low - metadata types rarely queried for data
  platform_event: 0.2,     // Very low - can't even be queried with SOQL
  external_object: 0.6,    // Moderate for external OData objects
  big_object: 0.6,         // Moderate for big objects
};

/**
 * Default modifier for unknown categories.
 */
const DEFAULT_CATEGORY_MODIFIER = 0.8;

// === Pattern Definitions ===

/**
 * Salesforce ID pattern (15 or 18 character case-sensitive/insensitive ID)
 */
const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

/**
 * SOQL date literals
 */
const DATE_LITERALS = new Set([
  'TODAY',
  'YESTERDAY',
  'TOMORROW',
  'LAST_WEEK',
  'THIS_WEEK',
  'NEXT_WEEK',
  'LAST_MONTH',
  'THIS_MONTH',
  'NEXT_MONTH',
  'LAST_QUARTER',
  'THIS_QUARTER',
  'NEXT_QUARTER',
  'LAST_YEAR',
  'THIS_YEAR',
  'NEXT_YEAR',
  'LAST_90_DAYS',
  'NEXT_90_DAYS',
  'LAST_N_DAYS',
  'NEXT_N_DAYS',
]);

/**
 * Natural language date references mapped to SOQL literals
 */
const DATE_NATURAL_MAP: Record<string, string> = {
  'today': 'TODAY',
  'yesterday': 'YESTERDAY',
  'tomorrow': 'TOMORROW',
  'this week': 'THIS_WEEK',
  'last week': 'LAST_WEEK',
  'next week': 'NEXT_WEEK',
  'this month': 'THIS_MONTH',
  'last month': 'LAST_MONTH',
  'next month': 'NEXT_MONTH',
  'this quarter': 'THIS_QUARTER',
  'last quarter': 'LAST_QUARTER',
  'next quarter': 'NEXT_QUARTER',
  'this year': 'THIS_YEAR',
  'last year': 'LAST_YEAR',
  'next year': 'NEXT_YEAR',
};

/**
 * ISO date pattern (YYYY-MM-DD)
 */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Currency pattern ($1,234.56 or 1234.56)
 */
const CURRENCY_PATTERN = /^\$?[\d,]+(\.\d{2})?$/;

/**
 * Email pattern
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Phone pattern (various formats)
 */
const PHONE_PATTERN = /^[\d\s\-\+\(\)\.]{7,}$/;

/**
 * URL pattern
 */
const URL_PATTERN = /^https?:\/\/.+/i;

/**
 * Priority keywords with normalized values
 */
const PRIORITY_KEYWORDS: Record<string, string> = {
  'high': 'High',
  'medium': 'Medium',
  'low': 'Low',
  'critical': 'Critical',
  'urgent': 'Urgent',
  'highest': 'Highest',
  'lowest': 'Lowest',
  'normal': 'Normal',
};

/**
 * Status keywords with normalized values
 */
const STATUS_KEYWORDS: Record<string, string> = {
  'open': 'Open',
  'closed': 'Closed',
  'new': 'New',
  'active': 'Active',
  'inactive': 'Inactive',
  'pending': 'Pending',
  'in progress': 'In Progress',
  'completed': 'Completed',
  'cancelled': 'Cancelled',
  'on hold': 'On Hold',
  'escalated': 'Escalated',
  'resolved': 'Resolved',
  'won': 'Closed Won',
  'lost': 'Closed Lost',
};

// === Graph Query Interface ===

/**
 * Interface for querying the Neo4j graph.
 */
export interface GraphQueryExecutor {
  /**
   * Find picklist values matching a term.
   */
  findPicklistValues(
    term: string,
    objectApiName?: string
  ): Promise<PicklistMatch[]>;

  /**
   * Find object by name (exact or fuzzy).
   */
  findObject(term: string): Promise<{ apiName: string; label: string; confidence: number } | null>;

  /**
   * Semantic search for objects.
   */
  semanticSearchObjects?(
    term: string,
    topK: number
  ): Promise<Array<{ apiName: string; label: string; similarity: number }>>;

  /**
   * Semantic search for fields.
   */
  semanticSearchFields?(
    term: string,
    objectApiName: string,
    topK: number
  ): Promise<Array<{ apiName: string; label: string; similarity: number }>>;
}

// === Pattern Matching ===

/**
 * Match a value against known patterns.
 */
function matchPattern(value: string): PatternMatch | null {
  const trimmed = value.trim();

  // Check Salesforce ID
  if (SALESFORCE_ID_PATTERN.test(trimmed)) {
    return {
      patternType: 'salesforce_id',
      normalizedValue: trimmed,
      originalValue: value,
      confidence: 0.95,
    };
  }

  // Check date literals (exact match, case-insensitive)
  const upperValue = trimmed.toUpperCase();
  if (DATE_LITERALS.has(upperValue)) {
    return {
      patternType: 'date_literal',
      normalizedValue: upperValue,
      originalValue: value,
      confidence: 0.98,
    };
  }

  // Check natural language dates
  const lowerValue = trimmed.toLowerCase();
  if (DATE_NATURAL_MAP[lowerValue]) {
    return {
      patternType: 'date_literal',
      normalizedValue: DATE_NATURAL_MAP[lowerValue],
      originalValue: value,
      confidence: 0.95,
    };
  }

  // Check ISO date
  if (ISO_DATE_PATTERN.test(trimmed)) {
    return {
      patternType: 'date_value',
      normalizedValue: trimmed,
      originalValue: value,
      confidence: 0.95,
    };
  }

  // Check currency
  if (CURRENCY_PATTERN.test(trimmed)) {
    const numericValue = parseFloat(trimmed.replace(/[$,]/g, ''));
    if (!isNaN(numericValue)) {
      return {
        patternType: 'currency_value',
        normalizedValue: numericValue.toString(),
        originalValue: value,
        confidence: 0.9,
      };
    }
  }

  // Check numeric with K/M suffix
  const numericMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*([kKmMbB])?$/);
  if (numericMatch) {
    let numValue = parseFloat(numericMatch[1]);
    const suffix = numericMatch[2]?.toLowerCase();
    if (suffix === 'k') numValue *= 1000;
    else if (suffix === 'm') numValue *= 1000000;
    else if (suffix === 'b') numValue *= 1000000000;

    return {
      patternType: 'numeric_value',
      normalizedValue: numValue.toString(),
      originalValue: value,
      confidence: 0.9,
    };
  }

  // Check email
  if (EMAIL_PATTERN.test(trimmed)) {
    return {
      patternType: 'email_address',
      normalizedValue: trimmed.toLowerCase(),
      originalValue: value,
      confidence: 0.95,
    };
  }

  // Check phone
  if (PHONE_PATTERN.test(trimmed) && trimmed.replace(/\D/g, '').length >= 7) {
    return {
      patternType: 'phone_number',
      normalizedValue: trimmed.replace(/\D/g, ''),
      originalValue: value,
      confidence: 0.85,
    };
  }

  // Check URL
  if (URL_PATTERN.test(trimmed)) {
    return {
      patternType: 'url',
      normalizedValue: trimmed,
      originalValue: value,
      confidence: 0.95,
    };
  }

  // Check priority keywords (case-insensitive)
  // Note: lowerValue is already declared above for natural language dates
  if (PRIORITY_KEYWORDS[lowerValue]) {
    return {
      patternType: 'priority_value',
      normalizedValue: PRIORITY_KEYWORDS[lowerValue],
      originalValue: value,
      confidence: 0.9,
    };
  }

  // Check status keywords (case-insensitive)
  if (STATUS_KEYWORDS[lowerValue]) {
    return {
      patternType: 'status_value',
      normalizedValue: STATUS_KEYWORDS[lowerValue],
      originalValue: value,
      confidence: 0.85,
    };
  }

  return null;
}

/**
 * Convert pattern match to grounding result.
 */
function patternToGrounding(pattern: PatternMatch): GroundingResult {
  switch (pattern.patternType) {
    case 'salesforce_id':
      return {
        type: 'id_reference',
        confidence: pattern.confidence,
        evidence: {
          source: 'pattern_match',
          matchedPattern: 'Salesforce ID (15/18 char)',
        },
        suggestedFilter: `Id = '${pattern.normalizedValue}'`,
        fields: ['Id'],
        description: 'Filter by Salesforce record ID',
      };

    case 'date_literal':
      return {
        type: 'date_reference',
        confidence: pattern.confidence,
        evidence: {
          source: 'pattern_match',
          matchedPattern: 'SOQL Date Literal',
        },
        suggestedFilter: `CreatedDate = ${pattern.normalizedValue}`,
        fields: ['CreatedDate', 'CloseDate', 'LastModifiedDate'],
        description: `Filter by date using ${pattern.normalizedValue}`,
      };

    case 'date_value':
      return {
        type: 'date_reference',
        confidence: pattern.confidence,
        evidence: {
          source: 'pattern_match',
          matchedPattern: 'ISO Date (YYYY-MM-DD)',
        },
        suggestedFilter: `CreatedDate = ${pattern.normalizedValue}`,
        fields: ['CreatedDate', 'CloseDate', 'LastModifiedDate'],
        description: `Filter by specific date ${pattern.normalizedValue}`,
      };

    case 'currency_value':
    case 'numeric_value':
      return {
        type: 'numeric_value',
        confidence: pattern.confidence,
        evidence: {
          source: 'pattern_match',
          matchedPattern: pattern.patternType === 'currency_value' ? 'Currency' : 'Numeric',
        },
        suggestedFilter: `Amount >= ${pattern.normalizedValue}`,
        fields: ['Amount', 'AnnualRevenue', 'ExpectedRevenue'],
        description: `Filter by numeric value ${pattern.originalValue}`,
      };

    case 'email_address':
      return {
        type: 'field_reference',
        confidence: pattern.confidence,
        evidence: {
          source: 'pattern_match',
          matchedPattern: 'Email Address',
        },
        suggestedFilter: `Email = '${pattern.normalizedValue}'`,
        fields: ['Email'],
        description: 'Filter by email address',
      };

    case 'phone_number':
      return {
        type: 'field_reference',
        confidence: pattern.confidence,
        evidence: {
          source: 'pattern_match',
          matchedPattern: 'Phone Number',
        },
        suggestedFilter: `Phone LIKE '%${pattern.normalizedValue.slice(-10)}%'`,
        fields: ['Phone', 'MobilePhone'],
        description: 'Filter by phone number',
      };

    case 'url':
      return {
        type: 'field_reference',
        confidence: pattern.confidence,
        evidence: {
          source: 'pattern_match',
          matchedPattern: 'URL',
        },
        suggestedFilter: `Website = '${pattern.normalizedValue}'`,
        fields: ['Website'],
        description: 'Filter by website URL',
      };

    case 'priority_value':
      return {
        type: 'priority_value',
        confidence: pattern.confidence,
        evidence: {
          source: 'pattern_match',
          matchedPattern: 'Priority Keyword',
        },
        suggestedFilter: `Priority = '${pattern.normalizedValue}'`,
        fields: ['Priority'],
        description: `Filter by priority level: ${pattern.normalizedValue}`,
      };

    case 'status_value':
      return {
        type: 'status_value',
        confidence: pattern.confidence,
        evidence: {
          source: 'pattern_match',
          matchedPattern: 'Status Keyword',
        },
        suggestedFilter: `Status = '${pattern.normalizedValue}'`,
        fields: ['Status', 'StageName'],
        description: `Filter by status: ${pattern.normalizedValue}`,
      };

    default:
      return {
        type: 'unknown',
        confidence: 0.3,
        evidence: { source: 'pattern_match' },
        suggestedFilter: `Name LIKE '${pattern.originalValue}%'`,
        fields: ['Name'],
        description: 'Unknown pattern type',
      };
  }
}

// === Value Grounding Service ===

/**
 * Value grounding service implementation.
 */
export class ValueGroundingServiceImpl {
  private graphExecutor: GraphQueryExecutor;
  private soslExecutor?: SoslExecutor;
  private tierConfig: TierConfig;
  private categorizationService: SchemaCategorizationServiceImpl;
  private categorizationGraphExecutor: ReturnType<typeof createCategorizationGraphExecutor>;
  private categoryCache: Map<string, CategoryName | null> = new Map();

  constructor(
    graphExecutor: GraphQueryExecutor,
    soslExecutor?: SoslExecutor,
    tierConfig: Partial<TierConfig> = {}
  ) {
    this.graphExecutor = graphExecutor;
    this.soslExecutor = soslExecutor;
    this.tierConfig = { ...DEFAULT_TIER_CONFIG, ...tierConfig };

    // Initialize categorization services for category-based confidence adjustments
    this.categorizationGraphExecutor = createCategorizationGraphExecutor();
    this.categorizationService = createSchemaCategorizationService(this.categorizationGraphExecutor);
  }

  /**
   * Get the category for an object, with caching.
   */
  private async getObjectCategory(apiName: string): Promise<CategoryName | null> {
    if (this.categoryCache.has(apiName)) {
      return this.categoryCache.get(apiName) ?? null;
    }

    try {
      const category = await this.categorizationService.getObjectCategory(apiName);
      this.categoryCache.set(apiName, category);
      return category;
    } catch {
      // If categorization fails, don't block grounding
      this.categoryCache.set(apiName, null);
      return null;
    }
  }

  /**
   * Get the confidence modifier for an object based on its category.
   */
  private async getCategoryConfidenceModifier(objectApiName: string): Promise<number> {
    const category = await this.getObjectCategory(objectApiName);
    if (!category) {
      return DEFAULT_CATEGORY_MODIFIER;
    }

    return CATEGORY_CONFIDENCE_MODIFIERS[category] ?? DEFAULT_CATEGORY_MODIFIER;
  }

  /**
   * Check if an object is related to the context objects using the graph.
   * Replaces the hardcoded relationship map with dynamic graph queries.
   */
  private async isRelatedToContextFromGraph(
    objectApiName: string,
    contextObjects: string[]
  ): Promise<boolean> {
    for (const contextObj of contextObjects) {
      // Check if objectApiName has a lookup to the context object
      const hasLookupToContext = await this.categorizationGraphExecutor.hasLookupTo(
        objectApiName,
        contextObj
      );
      if (hasLookupToContext) {
        return true;
      }

      // Check reverse: does context object have lookup to objectApiName
      const contextHasLookup = await this.categorizationGraphExecutor.hasLookupTo(
        contextObj,
        objectApiName
      );
      if (contextHasLookup) {
        return true;
      }
    }

    // Also check if they share the same primary category (e.g., both business_core)
    const objectCategory = await this.getObjectCategory(objectApiName);
    if (objectCategory && ['business_core', 'business_extended'].includes(objectCategory)) {
      for (const contextObj of contextObjects) {
        const contextCategory = await this.getObjectCategory(contextObj);
        if (contextCategory && ['business_core', 'business_extended'].includes(contextCategory)) {
          return true; // Both are business objects, consider them related
        }
      }
    }

    return false;
  }

  /**
   * Ground a single value against org metadata and data.
   */
  async groundValue(
    value: string,
    options: GroundingOptions = {}
  ): Promise<GroundedEntity> {
    const trimmed = value.trim();
    const results: GroundingResult[] = [];

    log.debug({ value: trimmed, options }, 'Grounding value');

    // === Tier 1: Metadata Grounding ===

    if (this.tierConfig.enableMetadataTier) {
      // 1. Pattern Match (highest priority for structured data)
      const patternMatch = matchPattern(trimmed);
      if (patternMatch) {
        results.push(patternToGrounding(patternMatch));
      }

      // 2. Exact Picklist Match with Category-Based Confidence
      const picklistMatches = await this.graphExecutor.findPicklistValues(
        trimmed,
        options.targetObject
      );

      // Process all picklist matches and apply category-based confidence modifiers.
      // This prevents system objects like AuthProvider from winning over business objects.
      for (const match of picklistMatches) {
        // Get the category confidence modifier for this object
        const categoryModifier = await this.getCategoryConfidenceModifier(match.objectApiName);
        const baseConfidence = match.isExact ? 0.95 : 0.8 * (match.similarity || 0.8);
        const adjustedConfidence = baseConfidence * categoryModifier;

        // Also apply context filtering if context objects are provided
        let isContextRelevant = true;
        if (options.contextObjects?.length) {
          isContextRelevant =
            options.contextObjects.includes(match.objectApiName) ||
            await this.isRelatedToContextFromGraph(match.objectApiName, options.contextObjects);
        }

        // Log category-based confidence adjustment for debugging
        if (categoryModifier < 1.0) {
          const category = await this.getObjectCategory(match.objectApiName);
          log.debug(
            {
              value: trimmed,
              objectApiName: match.objectApiName,
              fieldApiName: match.fieldApiName,
              category,
              categoryModifier,
              baseConfidence,
              adjustedConfidence,
              isContextRelevant,
            },
            'Applied category modifier to picklist match'
          );
        }

        // Only include context-relevant matches
        if (isContextRelevant) {
          results.push({
            type: 'picklist_value',
            confidence: adjustedConfidence,
            evidence: {
              source: 'exact_picklist',
              matchedNode: `${match.objectApiName}.${match.fieldApiName}.${match.value}`,
            },
            suggestedFilter: `${match.fieldApiName} = '${match.value}'`,
            fields: [match.fieldApiName],
            description: `Use picklist value "${match.label}" for ${match.fieldApiName}`,
          });
        } else {
          log.debug(
            {
              value: trimmed,
              objectApiName: match.objectApiName,
              contextObjects: options.contextObjects,
            },
            'Filtered out-of-context picklist match'
          );
        }
      }

      // 3. Object Reference Check
      const objectMatch = await this.graphExecutor.findObject(trimmed);
      if (objectMatch && objectMatch.confidence > 0.7) {
        results.push({
          type: 'object_reference',
          confidence: objectMatch.confidence,
          evidence: {
            source: 'graph_lookup',
            matchedNode: objectMatch.apiName,
          },
          suggestedFilter: `FROM ${objectMatch.apiName}`,
          fields: [],
          description: `Use ${objectMatch.apiName} in FROM clause`,
        });
      }

      // 4. Semantic Search (if enabled and available)
      if (
        options.enableSemanticSearch &&
        this.graphExecutor.semanticSearchObjects
      ) {
        const semanticMatches = await this.graphExecutor.semanticSearchObjects(
          trimmed,
          3
        );
        for (const match of semanticMatches) {
          if (match.similarity > 0.7) {
            results.push({
              type: 'object_reference',
              confidence: match.similarity * 0.9, // Slight penalty for semantic vs exact
              evidence: {
                source: 'semantic_match',
                matchedNode: match.apiName,
                similarityScore: match.similarity,
              },
              suggestedFilter: `FROM ${match.apiName}`,
              fields: [],
              description: `Semantic match: ${match.label} (${match.apiName})`,
            });
          }
        }
      }
    }

    // === Tier 2: Instance Data Grounding (SOSL) ===

    if (
      this.tierConfig.enableInstanceTier &&
      options.enableSoslFallback &&
      this.soslExecutor
    ) {
      // Only use SOSL if we have some indication this might be an entity name
      // but haven't found a definitive picklist/object match
      const hasHighConfidenceMatch = results.some((r) => r.confidence > 0.85);

      if (!hasHighConfidenceMatch) {
        const soslResults = await verifySoslEntity(
          this.soslExecutor,
          trimmed,
          this.tierConfig.soslTargetObjects,
          this.tierConfig.soslResultLimit
        );

        for (const result of soslResults) {
          const groundingType = this.getGroundingTypeForObject(result.objectType);
          results.push({
            type: groundingType,
            confidence: 0.85, // SOSL-verified is high confidence
            evidence: {
              source: 'sosl_verified',
              matchedNode: result.objectType,
              matchedRecordId: result.recordId,
              details: `Found record: ${result.recordName}`,
            },
            suggestedFilter: `${result.objectType}.Name LIKE '${sanitizeSoslTerm(trimmed)}%'`,
            fields: ['Name'],
            description: `Verified ${result.objectType} record: ${result.recordName}`,
          });
        }
      }
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence);

    // Apply minimum confidence filter
    const minConfidence = options.minConfidence || 0;
    const filteredResults = results.filter((r) => r.confidence >= minConfidence);

    // Apply max results limit
    const maxResults = options.maxResults || 10;
    const limitedResults = filteredResults.slice(0, maxResults);

    return {
      value: trimmed,
      groundedAs: limitedResults,
      bestMatch: limitedResults[0] || undefined,
      isGrounded: limitedResults.length > 0,
    };
  }

  /**
   * Ground multiple values in batch.
   */
  async groundValues(
    values: string[],
    options: GroundingOptions = {}
  ): Promise<GroundedEntity[]> {
    // Process in parallel with a concurrency limit
    const results = await Promise.all(
      values.map((v) => this.groundValue(v, options))
    );
    return results;
  }

  /**
   * Find picklist match for a value.
   */
  async findPicklistMatch(
    value: string,
    objectApiName?: string
  ): Promise<PicklistMatch | null> {
    const matches = await this.graphExecutor.findPicklistValues(value, objectApiName);
    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * Verify a value exists via SOSL.
   */
  async verifySosl(
    term: string,
    targetObjects?: string[]
  ): Promise<SoslVerificationResult[]> {
    if (!this.soslExecutor) {
      return [];
    }
    return verifySoslEntity(
      this.soslExecutor,
      term,
      targetObjects || this.tierConfig.soslTargetObjects,
      this.tierConfig.soslResultLimit
    );
  }

  /**
   * Determine grounding type based on Salesforce object type.
   */
  private getGroundingTypeForObject(objectType: string): GroundingResult['type'] {
    switch (objectType) {
      case 'Account':
        return 'account_name';
      case 'Contact':
        return 'contact_name';
      case 'Lead':
        return 'person_name';
      case 'User':
        return 'person_name';
      default:
        return 'company_name';
    }
  }

}

/**
 * Create a value grounding service.
 */
export function createValueGroundingService(
  graphExecutor: GraphQueryExecutor,
  soslExecutor?: SoslExecutor,
  tierConfig?: Partial<TierConfig>
): ValueGroundingServiceImpl {
  return new ValueGroundingServiceImpl(graphExecutor, soslExecutor, tierConfig);
}

/**
 * Schema Categorization Service
 *
 * Main service for schema categorization using heuristic tagging.
 * Replaces negative constraints in prompts with positive taxonomy.
 */

import { createLogger } from '../../core/index.js';
import type {
  CategoryName,
  CategoryAssignment,
  CategorizedElement,
  CategorySoqlPattern,
  AntiPatternWarning,
  CategorizationOptions,
  CategorizationResult,
  SchemaCategorization,
} from './types.js';
import {
  HeuristicTagger,
  createHeuristicTagger,
  type HeuristicGraphQueryExecutor,
} from './heuristic-tagger.js';

const log = createLogger('schema-categorization');

// === SOQL Pattern Templates ===

/**
 * SOQL patterns by category.
 */
const CATEGORY_SOQL_PATTERNS: Record<CategoryName, CategorySoqlPattern[]> = {
  business_core: [
    {
      category: 'business_core',
      pattern: "SELECT Id, Name, {fields} FROM {object} WHERE {filter}",
      description: 'Standard query pattern for core CRM objects',
      fields: ['Id', 'Name', 'CreatedDate', 'LastModifiedDate'],
      example: "SELECT Id, Name, Industry FROM Account WHERE Name LIKE 'Acme%'",
    },
  ],
  business_extended: [
    {
      category: 'business_extended',
      pattern: "SELECT Id, Name, {lookupField} FROM {object} WHERE {lookupField} = '{lookupValue}'",
      description: 'Query custom objects via their relationship to core objects',
      fields: ['Id', 'Name'],
      example: "SELECT Id, Name, Account__c FROM Invoice__c WHERE Account__c = '001xx000003DGb1AAG'",
    },
  ],
  system: [
    {
      category: 'system',
      pattern: "SELECT Id, {fields} FROM {object} WHERE CreatedDate = TODAY",
      description: 'Query system objects (typically for debugging/monitoring)',
      fields: ['Id', 'Status', 'CreatedDate'],
    },
  ],
  system_derived: [
    {
      category: 'system_derived',
      pattern: "SELECT Id, ParentId, {fields} FROM {object}Feed WHERE ParentId = '{parentId}'",
      description: 'Query feed/history for a parent record',
      fields: ['Id', 'ParentId', 'CreatedDate'],
    },
  ],
  managed_package: [
    {
      category: 'managed_package',
      pattern: "SELECT Id, Name, {namespace}__{field} FROM {namespace}__{object}",
      description: 'Query managed package objects with namespace prefix',
      fields: ['Id', 'Name'],
    },
  ],
  custom_metadata: [
    {
      category: 'custom_metadata',
      pattern: "SELECT Id, DeveloperName, MasterLabel, {fields} FROM {object}",
      description: 'Query Custom Metadata Type for configuration data',
      fields: ['Id', 'DeveloperName', 'MasterLabel'],
      example: "SELECT Id, DeveloperName, MasterLabel FROM My_Setting__mdt",
    },
  ],
  platform_event: [
    {
      category: 'platform_event',
      pattern: "// Platform Events are published, not queried",
      description: 'Platform Events cannot be queried with SOQL (use EventBus)',
      fields: [],
    },
  ],
  big_object: [
    {
      category: 'big_object',
      pattern: "SELECT Id, {fields} FROM {object} WHERE {indexedField} = '{value}'",
      description: 'Big Objects require indexed field filters',
      fields: [],
    },
  ],
  external_object: [
    {
      category: 'external_object',
      pattern: "SELECT Id, ExternalId, {fields} FROM {object}",
      description: 'Query external objects (OData connection)',
      fields: ['Id', 'ExternalId'],
    },
  ],
  lifecycle: [
    {
      category: 'lifecycle',
      pattern: "{field} = '{value}'",
      description: 'Filter by lifecycle/status field',
      fields: ['Status', 'StageName', 'Phase'],
      example: "Status = 'Open'",
    },
  ],
  user_context: [
    {
      category: 'user_context',
      pattern: "OwnerId = '{userId}' OR OwnerId IN (SELECT Id FROM User WHERE {filter})",
      description: 'Filter by user ownership or user criteria',
      fields: ['OwnerId', 'CreatedById', 'LastModifiedById'],
    },
  ],
  temporal: [
    {
      category: 'temporal',
      pattern: "{field} {operator} {date_literal}",
      description: 'Filter by date/time fields',
      fields: ['CreatedDate', 'LastModifiedDate', 'CloseDate'],
      example: "CreatedDate = THIS_MONTH",
    },
  ],
  financial: [
    {
      category: 'financial',
      pattern: "{field} {operator} {value}",
      description: 'Filter by currency/amount fields',
      fields: ['Amount', 'AnnualRevenue', 'ExpectedRevenue'],
      example: "Amount > 100000",
    },
  ],
  identity: [
    {
      category: 'identity',
      pattern: "Id = '{recordId}' OR Id IN ({subquery})",
      description: 'Filter by record ID',
      fields: ['Id'],
    },
  ],
  content: [
    {
      category: 'content',
      pattern: "SELECT Id, Title, {fields} FROM ContentDocument WHERE {filter}",
      description: 'Query content/documents',
      fields: ['Id', 'Title', 'FileType', 'ContentSize'],
    },
  ],
};

// === Anti-Pattern Detection ===

/**
 * Keywords indicating business intent.
 */
const BUSINESS_INTENT_KEYWORDS = [
  'customer',
  'client',
  'sale',
  'deal',
  'opportunity',
  'lead',
  'contact',
  'account',
  'revenue',
  'pipeline',
  'forecast',
  'quota',
];

/**
 * Keywords indicating system/technical intent.
 */
const SYSTEM_INTENT_KEYWORDS = [
  'debug',
  'log',
  'error',
  'trace',
  'monitor',
  'audit',
  'system',
  'admin',
  'setup',
  'metadata',
];

/**
 * Detect intent from user query.
 */
function detectIntent(userIntent: string): 'business' | 'system' | 'unknown' {
  const lower = userIntent.toLowerCase();

  const businessScore = BUSINESS_INTENT_KEYWORDS.filter((kw) =>
    lower.includes(kw)
  ).length;
  const systemScore = SYSTEM_INTENT_KEYWORDS.filter((kw) =>
    lower.includes(kw)
  ).length;

  if (businessScore > systemScore) return 'business';
  if (systemScore > businessScore) return 'system';
  return 'unknown';
}

// === Service Implementation ===

/**
 * Schema categorization service implementation.
 */
export class SchemaCategorizationServiceImpl implements SchemaCategorization {
  private heuristicTagger: HeuristicTagger;
  private graphExecutor: HeuristicGraphQueryExecutor;
  private categoryCache: Map<string, CategoryAssignment[]> = new Map();

  constructor(graphExecutor: HeuristicGraphQueryExecutor) {
    this.graphExecutor = graphExecutor;
    this.heuristicTagger = createHeuristicTagger(graphExecutor);
  }

  /**
   * Categorize an object based on heuristics.
   */
  async categorizeObject(
    apiName: string,
    options: CategorizationOptions = {}
  ): Promise<CategorizedElement> {
    // Check cache first
    const cacheKey = `object:${apiName}`;
    const cached = this.categoryCache.get(cacheKey);
    if (cached && !options.enableSemanticMatching) {
      return {
        nodeType: 'Object',
        apiName,
        categories: cached,
        primaryCategory: cached[0],
      };
    }

    // Run heuristic categorization
    const result = await this.heuristicTagger.categorizeObject(apiName);

    // Cache the result
    if (result.categories.length > 0) {
      this.categoryCache.set(cacheKey, result.categories);
    }

    return result;
  }

  /**
   * Categorize a field based on heuristics.
   */
  async categorizeField(
    apiName: string,
    sobjectType: string,
    options: CategorizationOptions = {}
  ): Promise<CategorizedElement> {
    const cacheKey = `field:${sobjectType}.${apiName}`;
    const cached = this.categoryCache.get(cacheKey);
    if (cached && !options.enableSemanticMatching) {
      return {
        nodeType: 'Field',
        apiName,
        sobjectType,
        categories: cached,
        primaryCategory: cached[0],
      };
    }

    const result = await this.heuristicTagger.categorizeField(apiName, sobjectType);

    if (result.categories.length > 0) {
      this.categoryCache.set(cacheKey, result.categories);
    }

    return result;
  }

  /**
   * Get the primary category for an object.
   */
  async getObjectCategory(apiName: string): Promise<CategoryName | null> {
    const categorized = await this.categorizeObject(apiName);
    return categorized.primaryCategory?.category || null;
  }

  /**
   * Get SOQL pattern suggestions for a category.
   */
  getSoqlPatternForCategory(
    category: CategoryName,
    value?: string
  ): CategorySoqlPattern[] {
    const patterns = CATEGORY_SOQL_PATTERNS[category] || [];

    if (!value) {
      return patterns;
    }

    // Substitute value into patterns
    return patterns.map((p) => ({
      ...p,
      pattern: p.pattern.replace(/\{value\}/g, value),
    }));
  }

  /**
   * Detect anti-patterns in SOQL intent.
   */
  async detectAntiPatterns(
    objects: string[],
    userIntent: string
  ): Promise<AntiPatternWarning[]> {
    const warnings: AntiPatternWarning[] = [];
    const detectedIntentType = detectIntent(userIntent);

    for (const obj of objects) {
      const category = await this.getObjectCategory(obj);

      if (!category) {
        continue;
      }

      // Warn if querying system objects when user intent is business
      if (
        (category === 'system_derived' || category === 'system') &&
        detectedIntentType === 'business'
      ) {
        warnings.push({
          type: 'system_object_query',
          element: obj,
          detectedCategory: category,
          expectedCategory: 'business_core',
          message: `Object "${obj}" is a system object (${category}). Did you mean to query a business object?`,
          severity: 'warning',
          suggestion: this.suggestBusinessAlternative(obj),
        });
      }

      // Error if querying Custom Metadata Type for data queries
      if (
        category === 'custom_metadata' &&
        !userIntent.toLowerCase().includes('metadata') &&
        !userIntent.toLowerCase().includes('configuration') &&
        !userIntent.toLowerCase().includes('setting')
      ) {
        warnings.push({
          type: 'metadata_type_data_query',
          element: obj,
          detectedCategory: category,
          message: `Object "${obj}" is a Custom Metadata Type, not a data object. These store configuration, not transactional data.`,
          severity: 'error',
          suggestion: 'Custom Metadata Types are for configuration. For business data, use standard or custom objects.',
        });
      }

      // Warn if querying Platform Events (can't be queried)
      if (category === 'platform_event') {
        warnings.push({
          type: 'category_mismatch',
          element: obj,
          detectedCategory: category,
          message: `Object "${obj}" is a Platform Event and cannot be queried with SOQL. Use the EventBus for subscribing to events.`,
          severity: 'error',
        });
      }
    }

    return warnings;
  }

  /**
   * Run heuristic categorization on all objects.
   */
  async runHeuristicCategorization(
    options: CategorizationOptions = {}
  ): Promise<CategorizationResult> {
    const result: CategorizationResult = {
      processed: 0,
      categorized: 0,
      categoriesCreated: 0,
      categoriesUsed: [],
      errors: [],
    };

    const categoriesUsed = new Set<CategoryName>();

    try {
      // Get all objects for categorization (standard and custom)
      const allObjects = await this.graphExecutor.getAllObjects();
      const total = allObjects.length;

      for (let i = 0; i < allObjects.length; i++) {
        const apiName = allObjects[i];
        options.onProgress?.(i + 1, total);
        try {
          const categorized = await this.categorizeObject(apiName, options);
          result.processed++;

          if (categorized.categories.length > 0) {
            result.categorized++;

            for (const cat of categorized.categories) {
              categoriesUsed.add(cat.category);

              // Store in graph if we have assignment capability
              if (categorized.primaryCategory) {
                await this.graphExecutor.assignObjectCategory(
                  apiName,
                  categorized.primaryCategory,
                  categorized.primaryCategory.rule || 'heuristic'
                );
              }
            }
          }
        } catch (error) {
          result.errors.push({
            element: apiName,
            error: (error as Error).message,
          });
        }
      }

      result.categoriesUsed = Array.from(categoriesUsed);

      log.debug(
        {
          processed: result.processed,
          categorized: result.categorized,
          categories: result.categoriesUsed.length,
        },
        'Heuristic categorization complete'
      );
    } catch (error) {
      log.error({ error }, 'Heuristic categorization failed');
      throw error;
    }

    return result;
  }

  /**
   * Suggest a business object alternative for a system object.
   */
  private suggestBusinessAlternative(systemObject: string): string | undefined {
    // Extract parent object from derived objects
    for (const suffix of ['Feed', 'History', 'Share', 'ChangeEvent']) {
      if (systemObject.endsWith(suffix)) {
        const parent = systemObject.slice(0, -suffix.length);
        return `Query the parent object "${parent}" instead, or use a subquery if you need ${suffix.toLowerCase()} data.`;
      }
    }

    return undefined;
  }

  /**
   * Clear the category cache.
   */
  clearCache(): void {
    this.categoryCache.clear();
  }
}

/**
 * Create a schema categorization service.
 */
export function createSchemaCategorizationService(
  graphExecutor: HeuristicGraphQueryExecutor
): SchemaCategorizationServiceImpl {
  return new SchemaCategorizationServiceImpl(graphExecutor);
}

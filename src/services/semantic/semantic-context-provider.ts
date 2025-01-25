/**
 * Semantic Schema Context Provider
 *
 * Implements SchemaContextProvider using semantic search capabilities.
 * Uses hybrid short-circuit strategy: exact match first, vector search as fallback.
 */

import { createLogger } from '../../core/index.js';
import type {
  SchemaContext,
  ObjectSchema,
  SchemaContextProvider,
} from '../schema-context/index.js';
import type {
  SemanticSearchOptions,
  ObjectSearchResult,
} from './types.js';
import { SemanticSearchServiceImpl } from './semantic-search-service.js';
import { createSchemaCategorizationService, type SchemaCategorizationServiceImpl } from '../categorization/index.js';
import type { HeuristicGraphQueryExecutor } from '../categorization/heuristic-tagger.js';

const log = createLogger('semantic-context');

// === Constants ===

const CONTEXT_LIMITS = {
  MAX_OBJECTS: 5,
  MAX_FIELDS_PER_OBJECT: 25,
  MIN_SIMILARITY: 0.5,
};

// === Graph Query Interface ===

/**
 * Extended graph query executor for semantic context.
 */
export interface SemanticContextGraphExecutor extends HeuristicGraphQueryExecutor {
  /**
   * Get full object details including fields, relationships.
   */
  getObjectDetails(apiName: string): Promise<ObjectDetails | null>;

  /**
   * Get fields for an object.
   */
  getObjectFields(apiName: string): Promise<FieldDetails[]>;

  /**
   * Get parent relationships for an object.
   */
  getParentRelationships(apiName: string): Promise<ParentRelationship[]>;

  /**
   * Get child relationships for an object.
   */
  getChildRelationships(apiName: string): Promise<ChildRelationship[]>;

  /**
   * Get picklist values for a field.
   */
  getPicklistValues(objectApiName: string, fieldApiName: string): Promise<string[]>;
}

/**
 * Object details from graph.
 */
export interface ObjectDetails {
  apiName: string;
  label: string;
  description?: string;
  category?: string;
}

/**
 * Field details from graph.
 */
export interface FieldDetails {
  apiName: string;
  label: string;
  type: string;
  description?: string;
  filterable?: boolean;
  sortable?: boolean;
}

/**
 * Parent relationship (for dot notation lookups).
 */
export interface ParentRelationship {
  fieldApiName: string;
  relationshipName: string;
  targetObject: string;
}

/**
 * Child relationship (for subqueries).
 */
export interface ChildRelationship {
  relationshipName: string;
  childObject: string;
}

// === Term Extraction ===

/**
 * Extract search terms from a natural language query.
 */
function extractSearchTerms(query: string): string[] {
  const stopwords = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
    'from', 'by', 'show', 'me', 'get', 'all', 'find', 'list', 'that', 'have',
    'what', 'is', 'are', 'was', 'were', 'who', 'which', 'where', 'when',
    'their', 'our', 'your', 'my', 'its',
  ]);

  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w));

  // Also extract capitalized words as potential entity names
  const capitalizedPattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)*)\b/g;
  let match;
  while ((match = capitalizedPattern.exec(query)) !== null) {
    const word = match[1].toLowerCase();
    if (!words.includes(word) && word.length > 2) {
      words.push(word);
    }
  }

  // Deduplicate
  return [...new Set(words)];
}

/**
 * Calculate field relevance to query terms.
 */
function calculateFieldRelevance(
  field: FieldDetails,
  queryTerms: string[]
): number {
  let score = 0;
  const apiName = field.apiName.toLowerCase();
  const label = field.label.toLowerCase();

  for (const term of queryTerms) {
    if (term.length < 3) continue;

    if (apiName === term || label === term) {
      score += 10; // Exact match
    } else if (apiName.includes(term) || label.includes(term)) {
      score += 5; // Partial match
    } else if (field.description?.toLowerCase().includes(term)) {
      score += 2; // Description match
    }
  }

  // Boost reference fields slightly
  if (field.type === 'reference') {
    score += 1;
  }

  return score;
}

/**
 * Filter and rank fields by relevance.
 */
function filterRelevantFields(
  fields: FieldDetails[],
  queryTerms: string[]
): FieldDetails[] {
  // Always include these fields
  const alwaysInclude = new Set(['Id', 'Name', 'CreatedDate', 'LastModifiedDate', 'OwnerId']);

  const mustHave = fields.filter((f) => alwaysInclude.has(f.apiName));
  const others = fields.filter((f) => !alwaysInclude.has(f.apiName));

  // Score and sort other fields
  const scored = others
    .map((f) => ({
      field: f,
      score: calculateFieldRelevance(f, queryTerms),
    }))
    .sort((a, b) => b.score - a.score);

  // Take top fields to fill remaining slots
  const remainingSlots = Math.max(0, CONTEXT_LIMITS.MAX_FIELDS_PER_OBJECT - mustHave.length);
  const topFields = scored.slice(0, remainingSlots).map((s) => s.field);

  return [...mustHave, ...topFields];
}

// === Semantic Context Provider ===

/**
 * Semantic schema context provider implementation.
 */
export class SemanticSchemaContextProvider implements SchemaContextProvider {
  private searchService: SemanticSearchServiceImpl;
  private categorizationService: SchemaCategorizationServiceImpl;
  private graphExecutor: SemanticContextGraphExecutor;

  constructor(
    searchService: SemanticSearchServiceImpl,
    graphExecutor: SemanticContextGraphExecutor
  ) {
    this.searchService = searchService;
    this.graphExecutor = graphExecutor;
    this.categorizationService = createSchemaCategorizationService(graphExecutor);
  }

  /**
   * Get schema context for a query using semantic search.
   */
  async getContext(query: string, orgId?: string): Promise<SchemaContext> {
    log.debug({ query }, 'Getting semantic schema context');

    // Extract search terms from query
    const searchTerms = extractSearchTerms(query);
    log.debug({ searchTerms }, 'Extracted search terms');

    // Find matching objects using semantic search
    const matchedObjects = await this.findRelevantObjects(searchTerms, orgId);
    log.debug({ count: matchedObjects.length }, 'Found matching objects');

    if (matchedObjects.length === 0) {
      return {
        objects: [],
        stats: { objectCount: 0, totalFields: 0, totalRelationships: 0 },
      };
    }

    // Build schema for each matched object
    const objectSchemas: ObjectSchema[] = [];
    let totalFields = 0;
    let totalRelationships = 0;

    for (const obj of matchedObjects.slice(0, CONTEXT_LIMITS.MAX_OBJECTS)) {
      try {
        const schema = await this.buildObjectSchema(obj.apiName, searchTerms);
        if (schema) {
          objectSchemas.push(schema);
          totalFields += schema.fields.length;
          totalRelationships +=
            schema.parentRelationships.length + schema.childRelationships.length;
        }
      } catch (error) {
        log.warn({ error, object: obj.apiName }, 'Failed to build object schema');
      }
    }

    // Check for anti-patterns
    const objectNames = objectSchemas.map((o) => o.apiName);
    const warnings = await this.categorizationService.detectAntiPatterns(
      objectNames,
      query
    );

    if (warnings.length > 0) {
      log.debug({ warnings }, 'Detected anti-patterns in query');
    }

    return {
      objects: objectSchemas,
      stats: {
        objectCount: objectSchemas.length,
        totalFields,
        totalRelationships,
      },
    };
  }

  /**
   * Invalidate cache (no-op for semantic provider currently).
   */
  invalidateCache(_orgId?: string): void {
    // Semantic provider relies on underlying search service caching
    // which is managed separately.
  }

  /**
   * Find relevant objects using semantic search.
   */
  private async findRelevantObjects(
    terms: string[],
    orgId?: string
  ): Promise<ObjectSearchResult[]> {
    const allResults: ObjectSearchResult[] = [];
    const seenObjects = new Set<string>();

    // Search for each term
    for (const term of terms) {
      const options: SemanticSearchOptions = {
        orgId,
        topK: 5,
        minSimilarity: CONTEXT_LIMITS.MIN_SIMILARITY,
        enableVectorSearch: true,
      };

      const results = await this.searchService.findObjects(term, options);

      for (const result of results) {
        if (!seenObjects.has(result.apiName)) {
          allResults.push(result);
          seenObjects.add(result.apiName);
        }
      }
    }

    // Sort by similarity (best matches first)
    allResults.sort((a, b) => b.similarity - a.similarity);

    return allResults;
  }

  /**
   * Build full object schema from graph.
   */
  private async buildObjectSchema(
    apiName: string,
    queryTerms: string[]
  ): Promise<ObjectSchema | null> {
    // Get object details
    const obj = await this.graphExecutor.getObjectDetails(apiName);
    if (!obj) {
      return null;
    }

    // Get fields
    const allFields = await this.graphExecutor.getObjectFields(apiName);
    const relevantFields = filterRelevantFields(allFields, queryTerms);

    // Get relationships
    const parentRels = await this.graphExecutor.getParentRelationships(apiName);
    const childRels = await this.graphExecutor.getChildRelationships(apiName);

    // Build field schemas with picklist values
    const fieldSchemas = await Promise.all(
      relevantFields.map(async (f) => {
        let picklistValues: string[] | undefined;

        if (f.type === 'picklist' || f.type === 'multipicklist') {
          try {
            picklistValues = await this.graphExecutor.getPicklistValues(apiName, f.apiName);
            // Limit to top 50 values
            if (picklistValues.length > 50) {
              picklistValues = picklistValues.slice(0, 50);
            }
          } catch {
            // Picklist values not available
          }
        }

        return {
          apiName: f.apiName,
          label: f.label,
          type: f.type,
          description: f.description,
          picklistValues,
        };
      })
    );

    return {
      apiName: obj.apiName,
      label: obj.label,
      description: obj.description,
      fields: fieldSchemas,
      parentRelationships: parentRels,
      childRelationships: childRels,
    };
  }
}

/**
 * Create a semantic schema context provider.
 */
export function createSemanticSchemaContextProvider(
  searchService: SemanticSearchServiceImpl,
  graphExecutor: SemanticContextGraphExecutor
): SemanticSchemaContextProvider {
  return new SemanticSchemaContextProvider(searchService, graphExecutor);
}

/**
 * Semantic Search Service
 *
 * Implements hybrid short-circuit strategy for schema element search:
 * 1. Exact match first (O(1), 100% confidence) - SHORT CIRCUIT
 * 2. Fuzzy match second (fast, high confidence)
 * 3. Vector similarity search as fallback (~300ms, semantic understanding)
 *
 * This replaces manual synonym dictionaries with dynamic graph-based search.
 */

import { createLogger } from '../../core/index.js';
import type {
  ObjectSearchResult,
  FieldSearchResult,
  SemanticSearchOptions,
  ExactMatchIndex,
  ExactMatchEntry,
  VectorSearchExecutor,
  EmbeddingGenerator,
} from './types.js';
import { DEFAULT_SEARCH_OPTIONS } from './types.js';
import { STANDARD_OBJECT_SYNONYMS } from '../../config/synonyms.js';

const log = createLogger('semantic-search');

// === Graph Query Interface ===

/**
 * Interface for querying the Neo4j graph for index building.
 */
export interface SemanticGraphQueryExecutor {
  /**
   * Get all objects with their labels and descriptions.
   */
  getAllObjects(): Promise<Array<{
    apiName: string;
    label: string;
    description?: string;
    category?: string;
    keyPrefix?: string;
  }>>;

  /**
   * Get all fields for an object with their labels.
   */
  getFieldsForObject(objectApiName: string): Promise<Array<{
    apiName: string;
    label: string;
    description?: string;
    type?: string;
    filterable?: boolean;
  }>>;

  /**
   * Get all fields across all objects.
   */
  getAllFields(): Promise<Array<{
    apiName: string;
    sobjectType: string;
    label: string;
    description?: string;
    type?: string;
    filterable?: boolean;
  }>>;
}

// === Normalization ===

/**
 * Normalize a string for exact match lookup.
 */
function normalize(input: string): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate variants of a term for fuzzy matching.
 */
function getVariants(term: string): string[] {
  const variants: string[] = [];
  const normalized = normalize(term);

  // Singular/plural variants
  if (normalized.endsWith('s') && normalized.length > 3) {
    variants.push(normalized.slice(0, -1));
  }
  if (normalized.endsWith('es') && normalized.length > 4) {
    variants.push(normalized.slice(0, -2));
  }
  if (normalized.endsWith('ies') && normalized.length > 5) {
    variants.push(normalized.slice(0, -3) + 'y');
  }
  if (!normalized.endsWith('s')) {
    variants.push(normalized + 's');
  }

  // Common abbreviations and synonyms from config
  const synonymMap = STANDARD_OBJECT_SYNONYMS;

  for (const [full, synonyms] of Object.entries(synonymMap)) {
    // Check if the input normalized term matches the full object name (e.g. "opportunity" -> "deal")
    const fullNormalized = normalize(full);
    
    // If the input is the full name, suggest synonyms
    if (normalized === fullNormalized) {
      variants.push(...synonyms.map(s => normalize(s)));
    }
    
    // If the input is one of the synonyms, suggest the full name
    // (e.g. "deal" -> "Opportunity")
    // Note: synonyms in config might not be fully normalized, so we normalize them here
    if (synonyms.some(s => normalize(s) === normalized)) {
      variants.push(normalize(full)); // Suggest the API name
    }
  }

  return variants.filter((v) => v !== normalized);
}

// === Semantic Search Service Implementation ===

/**
 * Semantic search service with hybrid short-circuit strategy.
 */
export class SemanticSearchServiceImpl {
  private graphExecutor: SemanticGraphQueryExecutor;
  private vectorExecutor?: VectorSearchExecutor;
  private embeddingGenerator?: EmbeddingGenerator;

  private objectIndex: ExactMatchIndex | null = null;
  private fieldIndex: ExactMatchIndex | null = null;
  private fieldsByObject: Map<string, ExactMatchIndex> = new Map();

  private indexBuildPromise: Promise<void> | null = null;

  constructor(
    graphExecutor: SemanticGraphQueryExecutor,
    vectorExecutor?: VectorSearchExecutor,
    embeddingGenerator?: EmbeddingGenerator
  ) {
    this.graphExecutor = graphExecutor;
    this.vectorExecutor = vectorExecutor;
    this.embeddingGenerator = embeddingGenerator;
  }

  /**
   * Find objects matching a term using hybrid search.
   */
  async findObjects(
    term: string,
    options: SemanticSearchOptions = {}
  ): Promise<ObjectSearchResult[]> {
    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };
    const normalized = normalize(term);

    if (!normalized) {
      return [];
    }

    log.debug({ term, normalized }, 'Searching for objects');

    // Ensure indexes are built
    await this.ensureIndexesBuilt();

    // === SHORT CIRCUIT CHECK 1: Exact Match ===
    const exactMatch = this.findExactObjectMatch(normalized);
    if (exactMatch) {
      log.debug({ term, match: exactMatch.apiName }, 'Exact object match found');
      return [{
        ...exactMatch,
        similarity: 1.0,
        source: 'exact_match',
      }];
    }

    // === CHECK 2: Fuzzy/Variant Match ===
    if (!opts.exactOnly) {
      const variants = getVariants(normalized);
      for (const variant of variants) {
        const variantMatch = this.findExactObjectMatch(variant);
        if (variantMatch) {
          log.debug({ term, variant, match: variantMatch.apiName }, 'Variant object match found');
          return [{
            ...variantMatch,
            similarity: 0.85,
            source: 'fuzzy_match',
          }];
        }
      }
    }

    // === CHECK 3: Vector Similarity Search ===
    if (
      opts.enableVectorSearch &&
      this.vectorExecutor &&
      this.embeddingGenerator
    ) {
      try {
        const isAvailable = await this.isVectorSearchAvailable();
        if (isAvailable) {
          const embedding = await this.embeddingGenerator.embed(term);
          const vectorResults = await this.vectorExecutor.searchObjects(
            embedding,
            opts.topK || 10,
            opts.categoryFilter ? { category: opts.categoryFilter } : undefined
          );

          const results: ObjectSearchResult[] = vectorResults
            .filter((r) => r.score >= (opts.minSimilarity || 0.5))
            .map((r) => ({
              apiName: r.apiName,
              label: r.label,
              similarity: r.score,
              source: 'semantic' as const,
            }));

          if (results.length > 0) {
            log.debug({ term, resultCount: results.length }, 'Vector search results found');
            return results;
          }
        }
      } catch (error) {
        log.warn({ error, term }, 'Vector search failed, returning empty results');
      }
    }

    return [];
  }

  /**
   * Find fields matching a term within an object or globally.
   */
  async findFields(
    term: string,
    objectApiName?: string,
    options: SemanticSearchOptions = {}
  ): Promise<FieldSearchResult[]> {
    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };
    const normalized = normalize(term);

    if (!normalized) {
      return [];
    }

    log.debug({ term, normalized, objectApiName }, 'Searching for fields');

    // Ensure indexes are built
    await this.ensureIndexesBuilt();

    // === SHORT CIRCUIT CHECK 1: Exact Match ===
    if (objectApiName) {
      // Search within specific object
      const exactMatch = this.findExactFieldMatch(normalized, objectApiName);
      if (exactMatch) {
        log.debug({ term, objectApiName, match: exactMatch.apiName }, 'Exact field match found');
        return [{
          ...exactMatch,
          sobjectType: objectApiName,
          similarity: 1.0,
          source: 'exact_match',
        }];
      }
    } else {
      // Global field search
      const exactMatches = this.findExactFieldMatchGlobal(normalized);
      if (exactMatches.length > 0) {
        log.debug({ term, matchCount: exactMatches.length }, 'Exact global field matches found');
        return exactMatches.map((m) => ({
          ...m,
          similarity: 1.0,
          source: 'exact_match' as const,
        }));
      }
    }

    // === CHECK 2: Fuzzy/Variant Match ===
    if (!opts.exactOnly) {
      const variants = getVariants(normalized);
      for (const variant of variants) {
        if (objectApiName) {
          const variantMatch = this.findExactFieldMatch(variant, objectApiName);
          if (variantMatch) {
            return [{
              ...variantMatch,
              sobjectType: objectApiName,
              similarity: 0.85,
              source: 'fuzzy_match',
            }];
          }
        } else {
          const variantMatches = this.findExactFieldMatchGlobal(variant);
          if (variantMatches.length > 0) {
            return variantMatches.map((m) => ({
              ...m,
              similarity: 0.85,
              source: 'fuzzy_match' as const,
            }));
          }
        }
      }
    }

    // === CHECK 3: Vector Similarity Search ===
    if (
      opts.enableVectorSearch &&
      this.vectorExecutor &&
      this.embeddingGenerator
    ) {
      try {
        const isAvailable = await this.isVectorSearchAvailable();
        if (isAvailable) {
          const embedding = await this.embeddingGenerator.embed(term);
          const filter: Record<string, unknown> = {};
          if (objectApiName) {
            filter.sobjectType = objectApiName;
          } else if (opts.objectFilter && opts.objectFilter.length > 0) {
            filter.sobjectType = opts.objectFilter;
          }

          const vectorResults = await this.vectorExecutor.searchFields(
            embedding,
            opts.topK || 10,
            Object.keys(filter).length > 0 ? filter : undefined
          );

          const results: FieldSearchResult[] = vectorResults
            .filter((r) => r.score >= (opts.minSimilarity || 0.5))
            .map((r) => ({
              apiName: r.apiName,
              label: r.label,
              sobjectType: r.sobjectType,
              similarity: r.score,
              source: 'semantic' as const,
            }));

          if (results.length > 0) {
            log.debug({ term, resultCount: results.length }, 'Vector field search results found');
            return results;
          }
        }
      } catch (error) {
        log.warn({ error, term }, 'Vector field search failed');
      }
    }

    return [];
  }

  /**
   * Rebuild the exact match indexes from the graph.
   */
  async rebuildIndexes(): Promise<void> {
    log.debug('Rebuilding semantic search indexes');
    const startTime = Date.now();

    // Build object index
    const objects = await this.graphExecutor.getAllObjects();
    const objectIndex: ExactMatchIndex = {
      byLabel: new Map(),
      byApiName: new Map(),
    };

    for (const obj of objects) {
      const entry: ExactMatchEntry = {
        apiName: obj.apiName,
        label: obj.label,
        description: obj.description,
      };

      // Index by normalized label
      const normalizedLabel = normalize(obj.label);
      if (normalizedLabel && !objectIndex.byLabel.has(normalizedLabel)) {
        objectIndex.byLabel.set(normalizedLabel, entry);
      }

      // Index by normalized API name (without __c)
      const normalizedApiName = normalize(obj.apiName.replace(/__c$/i, ''));
      if (!objectIndex.byApiName.has(normalizedApiName)) {
        objectIndex.byApiName.set(normalizedApiName, entry);
      }

      // Also index full API name
      const fullNormalizedApiName = normalize(obj.apiName);
      if (!objectIndex.byApiName.has(fullNormalizedApiName)) {
        objectIndex.byApiName.set(fullNormalizedApiName, entry);
      }
    }

    this.objectIndex = objectIndex;

    // Build field index (global and per-object)
    const allFields = await this.graphExecutor.getAllFields();
    const fieldIndex: ExactMatchIndex = {
      byLabel: new Map(),
      byApiName: new Map(),
      byLabelMulti: new Map(),
    };
    this.fieldsByObject = new Map();

    for (const field of allFields) {
      const entry: ExactMatchEntry = {
        apiName: field.apiName,
        label: field.label,
        description: field.description,
        sobjectType: field.sobjectType,
      };

      // Global field index (multi-entry per label)
      const normalizedLabel = normalize(field.label);
      if (normalizedLabel) {
        const existing = fieldIndex.byLabelMulti!.get(normalizedLabel) || [];
        existing.push(entry);
        fieldIndex.byLabelMulti!.set(normalizedLabel, existing);
      }

      // Per-object field index
      if (!this.fieldsByObject.has(field.sobjectType)) {
        this.fieldsByObject.set(field.sobjectType, {
          byLabel: new Map(),
          byApiName: new Map(),
        });
      }
      const objFieldIndex = this.fieldsByObject.get(field.sobjectType)!;

      if (normalizedLabel && !objFieldIndex.byLabel.has(normalizedLabel)) {
        objFieldIndex.byLabel.set(normalizedLabel, entry);
      }

      const normalizedApiName = normalize(field.apiName.replace(/__c$/i, ''));
      if (!objFieldIndex.byApiName.has(normalizedApiName)) {
        objFieldIndex.byApiName.set(normalizedApiName, entry);
      }
    }

    this.fieldIndex = fieldIndex;

    const duration = Date.now() - startTime;
    log.debug(
      { objectCount: objects.length, fieldCount: allFields.length, duration },
      'Semantic search indexes rebuilt'
    );
  }

  /**
   * Check if semantic (vector) search is available.
   */
  async isVectorSearchAvailable(): Promise<boolean> {
    if (!this.vectorExecutor || !this.embeddingGenerator) {
      return false;
    }

    try {
      const [vectorAvailable, embeddingAvailable] = await Promise.all([
        this.vectorExecutor.isAvailable(),
        this.embeddingGenerator.isAvailable(),
      ]);
      return vectorAvailable && embeddingAvailable;
    } catch {
      return false;
    }
  }

  /**
   * Ensure indexes are built before searching.
   */
  private async ensureIndexesBuilt(): Promise<void> {
    if (this.objectIndex && this.fieldIndex) {
      return;
    }

    // Avoid concurrent rebuilds
    if (!this.indexBuildPromise) {
      this.indexBuildPromise = this.rebuildIndexes().finally(() => {
        this.indexBuildPromise = null;
      });
    }

    await this.indexBuildPromise;
  }

  /**
   * Find exact object match by normalized term.
   */
  private findExactObjectMatch(normalized: string): ExactMatchEntry | null {
    if (!this.objectIndex) return null;

    // Check by label first (more natural language matches)
    const byLabel = this.objectIndex.byLabel.get(normalized);
    if (byLabel) return byLabel;

    // Check by API name
    const byApiName = this.objectIndex.byApiName.get(normalized);
    if (byApiName) return byApiName;

    return null;
  }

  /**
   * Find exact field match within a specific object.
   */
  private findExactFieldMatch(
    normalized: string,
    objectApiName: string
  ): ExactMatchEntry | null {
    const objIndex = this.fieldsByObject.get(objectApiName);
    if (!objIndex) return null;

    const byLabel = objIndex.byLabel.get(normalized);
    if (byLabel) return byLabel;

    const byApiName = objIndex.byApiName.get(normalized);
    if (byApiName) return byApiName;

    return null;
  }

  /**
   * Find exact field matches globally (across all objects).
   */
  private findExactFieldMatchGlobal(normalized: string): Array<ExactMatchEntry & { sobjectType: string }> {
    if (!this.fieldIndex?.byLabelMulti) return [];

    const matches = this.fieldIndex.byLabelMulti.get(normalized);
    if (!matches) return [];

    return matches.map((m) => ({
      ...m,
      sobjectType: m.sobjectType!,
    }));
  }
}

/**
 * Create a semantic search service.
 */
export function createSemanticSearchService(
  graphExecutor: SemanticGraphQueryExecutor,
  vectorExecutor?: VectorSearchExecutor,
  embeddingGenerator?: EmbeddingGenerator
): SemanticSearchServiceImpl {
  return new SemanticSearchServiceImpl(graphExecutor, vectorExecutor, embeddingGenerator);
}

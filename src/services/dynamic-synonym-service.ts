/**
 * Dynamic Synonym Service
 *
 * Provides schema element resolution using the Semantic Knowledge Graph.
 * Uses hybrid short-circuit strategy:
 * 1. Exact match (O(1), 100% confidence) - SHORT CIRCUIT
 * 2. Fuzzy match (fast, high confidence)
 * 3. Vector similarity search as fallback (~300ms, semantic understanding)
 *
 * This replaces manual synonym dictionaries with graph-based semantic search.
 */

import { createLogger } from '../core/index.js';
import {
  createSemanticSearchService,
  createSemanticGraphExecutor,
  type SemanticSearchServiceImpl,
} from './semantic/index.js';
import { getVectorStore } from './vector/neo4j-vector-store.js';
import { getEmbeddingProvider } from './embeddings/index.js';

const log = createLogger('dynamic-synonyms');

// === Types ===

export interface SynonymIndex {
  /** Maps normalized object label → apiName (e.g., "invoice" → "Invoice__c") */
  objectsByLabel: Map<string, string>;

  /** Maps normalized field label → array of apiNames (cross-object) */
  fieldsByLabel: Map<string, string[]>;

  /** Maps objectApiName → Map of normalized field label → field apiName */
  fieldsByObject: Map<string, Map<string, string>>;

  /** Metadata about the index */
  meta: {
    orgId: string;
    builtAt: Date;
    objectCount: number;
    fieldCount: number;
  };
}

export interface ObjectMatch {
  apiName: string;
  confidence: number;
  source: 'exact' | 'fuzzy' | 'semantic';
}

export interface FieldMatch {
  apiName: string;
  objectApiName: string;
  confidence: number;
  source: 'exact' | 'fuzzy' | 'semantic';
}

// === Semantic Search Service Singleton ===

let searchService: SemanticSearchServiceImpl | null = null;

/**
 * Get or create the semantic search service.
 */
async function getSearchService(): Promise<SemanticSearchServiceImpl> {
  if (!searchService) {
    const graphExecutor = createSemanticGraphExecutor();

    // Try to get vector search capabilities
    let vectorExecutor;
    let embeddingGenerator;

    try {
      const vectorStore = getVectorStore();
      const isVectorAvailable = await vectorStore.isAvailable();

      if (isVectorAvailable) {
        vectorExecutor = {
          isAvailable: () => vectorStore.isAvailable(),
          searchObjects: async (embedding: number[], topK: number, _filter?: Record<string, unknown>) => {
            const results = await vectorStore.search('object_embedding', embedding, { topK });
            return results.map((r) => ({
              apiName: r.properties.apiName as string,
              label: r.properties.label as string,
              score: r.score,
            }));
          },
          searchFields: async (embedding: number[], topK: number, _filter?: Record<string, unknown>) => {
            const results = await vectorStore.search('field_embedding', embedding, { topK });
            return results.map((r) => ({
              apiName: r.properties.apiName as string,
              label: r.properties.label as string,
              sobjectType: r.properties.sobjectType as string,
              score: r.score,
            }));
          },
        };

        try {
          const provider = getEmbeddingProvider();
          const providerAvailable = await provider.isAvailable();

          if (providerAvailable) {
            embeddingGenerator = {
              embed: (text: string) => provider.embed(text),
              isAvailable: () => provider.isAvailable(),
            };
          }
        } catch (e) {
          log.debug({ error: e }, 'Embedding provider not available');
        }
      }
    } catch (e) {
      log.debug({ error: e }, 'Vector store not available');
    }

    searchService = createSemanticSearchService(graphExecutor, vectorExecutor, embeddingGenerator);
  }

  return searchService;
}

/**
 * Reset the search service (e.g., after sync).
 */
export function resetSearchService(): void {
  searchService = null;
}

// === Legacy Index Interface (for backward compatibility) ===

/**
 * Get the synonym index for an org.
 * This triggers an index build via the semantic search service.
 * @deprecated Use findObject/findField directly instead.
 */
export async function getSynonymIndex(orgId?: string): Promise<SynonymIndex> {
  const service = await getSearchService();
  await service.rebuildIndexes();

  // Return a stub - callers should use findObject/findField instead
  return {
    objectsByLabel: new Map(),
    fieldsByLabel: new Map(),
    fieldsByObject: new Map(),
    meta: {
      orgId: orgId || 'default',
      builtAt: new Date(),
      objectCount: 0,
      fieldCount: 0,
    },
  };
}

/**
 * Build a fresh synonym index from the graph.
 * @deprecated Use rebuildSearchService instead.
 */
export async function buildSynonymIndex(orgId?: string): Promise<SynonymIndex> {
  return getSynonymIndex(orgId);
}

/**
 * Rebuild the search service indexes.
 */
export async function rebuildSynonymIndex(_orgId?: string): Promise<void> {
  resetSearchService();
  const service = await getSearchService();
  await service.rebuildIndexes();
}

/**
 * Clear all cached indexes.
 */
export function clearSynonymCache(): void {
  resetSearchService();
}

// === Object Resolution ===

/**
 * Find an object API name from a natural language term.
 * Uses hybrid search: exact match → fuzzy → semantic.
 */
export async function findObject(
  term: string,
  orgId?: string
): Promise<ObjectMatch | null> {
  if (!term) return null;

  log.debug({ term, orgId }, 'Finding object via semantic search');

  try {
    const service = await getSearchService();
    const results = await service.findObjects(term, {
      topK: 1,
      enableVectorSearch: true,
    });

    if (results.length === 0) {
      return null;
    }

    const best = results[0];
    return {
      apiName: best.apiName,
      confidence: best.similarity,
      source: best.source === 'exact_match' ? 'exact' :
              best.source === 'fuzzy_match' ? 'fuzzy' : 'semantic',
    };
  } catch (error) {
    log.debug({ error, term }, 'Semantic search failed for object');
    return null;
  }
}

// === Field Resolution ===

/**
 * Find a field API name for a specific object from a natural language term.
 * Uses hybrid search: exact match → fuzzy → semantic.
 */
export async function findField(
  term: string,
  objectApiName: string,
  orgId?: string
): Promise<FieldMatch | null> {
  if (!term || !objectApiName) return null;

  log.debug({ term, objectApiName, orgId }, 'Finding field via semantic search');

  try {
    const service = await getSearchService();
    const results = await service.findFields(term, objectApiName, {
      topK: 1,
      enableVectorSearch: true,
    });

    if (results.length === 0) {
      return null;
    }

    const best = results[0];
    return {
      apiName: best.apiName,
      objectApiName: best.sobjectType,
      confidence: best.similarity,
      source: best.source === 'exact_match' ? 'exact' :
              best.source === 'fuzzy_match' ? 'fuzzy' : 'semantic',
    };
  } catch (error) {
    log.debug({ error, term, objectApiName }, 'Semantic search failed for field');
    return null;
  }
}

/**
 * Find all possible field matches across all objects for a term.
 */
export async function findFieldsGlobal(
  term: string,
  orgId?: string
): Promise<FieldMatch[]> {
  if (!term) return [];

  log.debug({ term, orgId }, 'Finding fields globally via semantic search');

  try {
    const service = await getSearchService();
    const results = await service.findFields(term, undefined, {
      topK: 10,
      enableVectorSearch: true,
    });

    return results.map((r) => ({
      apiName: r.apiName,
      objectApiName: r.sobjectType,
      confidence: r.similarity,
      source: r.source === 'exact_match' ? 'exact' :
              r.source === 'fuzzy_match' ? 'fuzzy' : 'semantic',
    }));
  } catch (error) {
    log.debug({ error, term }, 'Global field search failed');
    return [];
  }
}

// === Normalization Utilities (for backward compatibility) ===

/**
 * Normalize a string for synonym lookup.
 * Converts to lowercase, removes special characters, trims whitespace.
 */
export function normalizeForLookup(input: string): string {
  if (!input) return '';

  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

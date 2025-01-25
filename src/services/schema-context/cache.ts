/**
 * Schema Context Cache Service
 * 
 * Provides session-scoped caching for schema context to avoid redundant graph queries.
 * Features:
 * - Fuzzy matching based on Jaccard similarity of query terms
 * - Configurable TTL (Time-To-Live)
 * - LRU-style eviction (max entries)
 * - Org-scoped storage
 */

import { createLogger } from '../../core/logger.js';
import type { SchemaContext } from './types.js';

const log = createLogger('schema-context-cache');

export interface SchemaContextCacheConfig {
  /** Time-to-live in milliseconds (default: 5 minutes) */
  ttl: number;
  /** Maximum entries per org (default: 100) */
  maxEntries: number;
}

interface CacheEntry {
  context: SchemaContext;
  createdAt: number;
  termSet: Set<string>; 
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'from', 'by', 'show', 'me', 'get', 'all', 'find', 'list', 'that', 'have',
  'what', 'is', 'are', 'was', 'were', 'my', 'our', 'their', 'describe', 'tell',
  'about', 'records', 'objects'
]);

/**
 * Normalize and tokenize a query for cache matching.
 */
function normalizeQuery(query: string): Set<string> {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/**
 * Calculate Jaccard similarity between two term sets.
 */
function termSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;
  
  const intersection = [...a].filter(t => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

export class SchemaContextCache {
  private cache = new Map<string, CacheEntry[]>();  // orgId → entries
  private config: SchemaContextCacheConfig;

  constructor(config: Partial<SchemaContextCacheConfig> = {}) {
    this.config = {
      ttl: config.ttl ?? 300_000,  // 5 minutes
      maxEntries: config.maxEntries ?? 100,
    };
  }

  /**
   * Get cached context if a similar query exists.
   * Returns null if no suitable cache entry found.
   */
  get(query: string, orgId?: string): SchemaContext | null {
    const key = orgId ?? 'default';
    const entries = this.cache.get(key);
    if (!entries || entries.length === 0) return null;

    const queryTerms = normalizeQuery(query);
    const now = Date.now();

    // Find best matching entry (80%+ term overlap)
    // iterate backwards to find most recent matches first
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      
      // Check TTL
      if (now - entry.createdAt > this.config.ttl) {
        // Since we append news, older ones are at the start, but we iterate backward.
        // We can't prune here easily without disrupting iteration, so we skip.
        // Lazy pruning happens on set() or maintenance.
        continue;
      }

      // Check similarity
      const similarity = termSimilarity(queryTerms, entry.termSet);
      if (similarity >= 0.8) {
        log.debug({ 
          query, 
          cachedTerms: [...entry.termSet], 
          currentTerms: [...queryTerms],
          similarity 
        }, 'Schema context cache hit');
        return entry.context;
      }
    }

    return null;
  }

  /**
   * Cache a schema context for a query.
   */
  set(query: string, context: SchemaContext, orgId?: string): void {
    const key = orgId ?? 'default';
    let entries = this.cache.get(key);
    
    if (!entries) {
      entries = [];
      this.cache.set(key, entries);
    }

    const now = Date.now();
    
    // Lazy Pruning: remove expired entries first
    const freshEntries = entries.filter(e => now - e.createdAt <= this.config.ttl);
    
    // Evict oldest entries if at capacity
    while (freshEntries.length >= this.config.maxEntries) {
      freshEntries.shift();
    }

    freshEntries.push({
      context,
      createdAt: now,
      termSet: normalizeQuery(query),
    });

    // Update cache
    this.cache.set(key, freshEntries);

    log.debug({ query, orgId: key, entryCount: freshEntries.length }, 'Cached schema context');
  }

  /**
   * Invalidate all cache entries for an org.
   */
  invalidateForOrg(orgId: string): void {
    this.cache.delete(orgId);
    log.info({ orgId }, 'Invalidated schema context cache');
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    this.cache.clear();
    log.info('Cleared all schema context cache');
  }
}

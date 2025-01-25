/**
 * SOSL Fallback Service
 *
 * Provides Tier 2 grounding by querying Salesforce instance data
 * via SOSL to verify that entities actually exist in the org.
 *
 * SECURITY: All search terms are sanitized to prevent SOSL injection.
 */

import { createLogger } from '../../core/index.js';
import type { SoslVerificationResult } from './types.js';

const log = createLogger('sosl-fallback');

// === SOSL Injection Prevention ===

/**
 * Characters that must be escaped or removed in SOSL FIND clauses.
 * SOSL uses {} for the search term boundary, so these are dangerous.
 *
 * Reference: https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_sosl_find.htm
 */
const SOSL_DANGEROUS_CHARS = /[{}\\'"?&|!()^~*:]/g;

/**
 * Reserved SOSL operators that should not appear in search terms.
 */
const SOSL_RESERVED_WORDS = ['AND', 'OR', 'NOT'];

/**
 * Sanitize a search term for safe use in SOSL FIND clause.
 *
 * This prevents SOSL injection attacks where malicious input like
 * `Microsoft}` could break out of the FIND clause.
 *
 * @param term - Raw search term from user input
 * @returns Sanitized term safe for SOSL
 */
export function sanitizeSoslTerm(term: string): string {
  if (!term || typeof term !== 'string') {
    return '';
  }

  // Remove dangerous characters that could break SOSL syntax
  let sanitized = term.replace(SOSL_DANGEROUS_CHARS, '');

  // Remove reserved words that could alter query logic
  for (const reserved of SOSL_RESERVED_WORDS) {
    // Only remove if it's a standalone word
    const regex = new RegExp(`\\b${reserved}\\b`, 'gi');
    sanitized = sanitized.replace(regex, '');
  }

  // Collapse multiple spaces and trim
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // SOSL requires at least 2 characters for a search
  if (sanitized.length < 2) {
    return '';
  }

  return sanitized;
}

/**
 * Validate that a sanitized term is safe and usable for SOSL.
 *
 * @param term - Sanitized term
 * @returns true if term is valid for SOSL search
 */
export function isValidSoslTerm(term: string): boolean {
  // Must be at least 2 characters
  if (!term || term.length < 2) {
    return false;
  }

  // Must contain at least one alphanumeric character
  if (!/[a-zA-Z0-9]/.test(term)) {
    return false;
  }

  // Should not be only whitespace
  if (!term.trim()) {
    return false;
  }

  return true;
}

// === SOSL Query Builder ===

/**
 * Build a SOSL query for verifying entity existence.
 *
 * @param term - Sanitized search term
 * @param objects - Objects to search in
 * @param limit - Maximum results per object
 * @returns SOSL query string
 */
export function buildSoslQuery(
  term: string,
  objects: string[],
  limit: number = 5
): string {
  if (!isValidSoslTerm(term)) {
    throw new Error(`Invalid SOSL term: "${term}"`);
  }

  // Build RETURNING clause for each object
  const returningClauses = objects.map((obj) => {
    // Standard searchable fields per object type
    const fields = getSoslFieldsForObject(obj);
    return `${obj}(${fields.join(', ')} LIMIT ${limit})`;
  });

  // Use IN NAME FIELDS for name-based searches
  // This is more efficient than IN ALL FIELDS
  return `FIND {${term}} IN NAME FIELDS RETURNING ${returningClauses.join(', ')}`;
}

/**
 * Get the fields to return for a given object in SOSL results.
 */
function getSoslFieldsForObject(objectName: string): string[] {
  // Core fields that exist on most objects
  const baseFields = ['Id', 'Name'];

  // Object-specific additional fields
  const objectFields: Record<string, string[]> = {
    Account: ['Industry', 'Type'],
    Contact: ['Email', 'Title'],
    Lead: ['Company', 'Status'],
    Opportunity: ['StageName', 'Amount'],
    Case: ['Subject', 'Status'],
    User: ['Email', 'IsActive'],
  };

  return [...baseFields, ...(objectFields[objectName] || [])];
}

// === SOSL Execution Interface ===

/**
 * Interface for executing SOSL queries against Salesforce.
 * This is implemented by the Salesforce connection service.
 */
export interface SoslExecutor {
  /**
   * Execute a SOSL query and return results.
   */
  searchSosl(query: string): Promise<SoslSearchResponse>;
}

/**
 * SOSL search response structure.
 */
export interface SoslSearchResponse {
  searchRecords: SoslSearchRecord[];
}

/**
 * Individual record from SOSL search.
 */
export interface SoslSearchRecord {
  attributes: {
    type: string;
    url: string;
  };
  Id: string;
  Name?: string;
  [key: string]: unknown;
}

// === SOSL Verification Service ===

/**
 * Verify that an entity exists in Salesforce via SOSL search.
 *
 * @param executor - SOSL query executor
 * @param term - Search term (will be sanitized)
 * @param targetObjects - Objects to search
 * @param limit - Maximum results per object
 * @returns Verification results
 */
export async function verifySoslEntity(
  executor: SoslExecutor,
  term: string,
  targetObjects: string[] = ['Account', 'Contact', 'Lead', 'Opportunity'],
  limit: number = 5
): Promise<SoslVerificationResult[]> {
  // Sanitize the search term
  const sanitized = sanitizeSoslTerm(term);

  if (!isValidSoslTerm(sanitized)) {
    log.warn({ term, sanitized }, 'Invalid SOSL term after sanitization');
    return [];
  }

  try {
    // Build and execute the query
    const query = buildSoslQuery(sanitized, targetObjects, limit);
    log.debug({ query, originalTerm: term, sanitizedTerm: sanitized }, 'Executing SOSL verification');

    const response = await executor.searchSosl(query);

    // Transform results
    const results: SoslVerificationResult[] = response.searchRecords.map((record) => ({
      objectType: record.attributes.type,
      recordId: record.Id,
      recordName: (record.Name as string) || record.Id,
      found: true,
    }));

    log.debug({ term, resultCount: results.length }, 'SOSL verification complete');

    return results;
  } catch (error) {
    log.error({ error, term }, 'SOSL verification failed');
    // Return empty results on error - don't block grounding
    return [];
  }
}

/**
 * Check if a specific record exists by searching for its name.
 *
 * @param executor - SOSL query executor
 * @param name - Name to search for
 * @param objectType - Specific object type to search
 * @returns true if a matching record was found
 */
export async function recordExistsByName(
  executor: SoslExecutor,
  name: string,
  objectType: string
): Promise<boolean> {
  const results = await verifySoslEntity(executor, name, [objectType], 1);
  return results.length > 0;
}

/**
 * Find the best matching record for a term.
 *
 * @param executor - SOSL query executor
 * @param term - Search term
 * @param targetObjects - Objects to search
 * @returns Best matching result or null
 */
export async function findBestMatch(
  executor: SoslExecutor,
  term: string,
  targetObjects: string[]
): Promise<SoslVerificationResult | null> {
  const results = await verifySoslEntity(executor, term, targetObjects, 1);

  if (results.length === 0) {
    return null;
  }

  // Return the first result (most relevant)
  return results[0];
}

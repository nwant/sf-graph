/**
 * Lexical Scoring Utilities
 *
 * Shared lexical relevance scoring for field selection.
 * Used by both schema-context and soql-generator.
 */

import type { GraphField } from '../neo4j/graph-service.js';

/**
 * Scoring weights for lexical matching.
 */
export const LEXICAL_SCORING = {
  /** Exact match on apiName or label */
  EXACT_MATCH: 10,
  /** Partial match (contains) on apiName or label */
  PARTIAL_MATCH: 5,
  /** Match found in description */
  DESCRIPTION_MATCH: 2,
  /** Bonus for reference fields (useful for joins) */
  REFERENCE_BOOST: 1,
} as const;

/**
 * Calculate lexical relevance of a field to query terms.
 *
 * Scoring:
 * - Exact match (apiName or label equals term): +10
 * - Partial match (apiName or label contains term): +5
 * - Description match: +2
 * - Reference field bonus: +1
 *
 * @param field - The field to score
 * @param queryTerms - Tokenized query terms (lowercase)
 * @param minTermLength - Minimum term length to consider (default: 3)
 * @returns Relevance score (0 = no match)
 */
export function calculateFieldRelevanceLexical(
  field: GraphField,
  queryTerms: string[],
  minTermLength = 3
): number {
  let score = 0;
  const apiName = field.apiName.toLowerCase();
  const label = field.label.toLowerCase();

  for (const term of queryTerms) {
    if (term.length < minTermLength) continue;

    // Exact match (highest priority)
    if (apiName === term || label === term) {
      score += LEXICAL_SCORING.EXACT_MATCH;
    }
    // Partial match (high priority)
    else if (apiName.includes(term) || label.includes(term)) {
      score += LEXICAL_SCORING.PARTIAL_MATCH;
    }
    // Description match (medium priority)
    else if (field.description?.toLowerCase().includes(term)) {
      score += LEXICAL_SCORING.DESCRIPTION_MATCH;
    }
  }

  // Reference fields are useful for joins
  if (field.type === 'reference') {
    score += LEXICAL_SCORING.REFERENCE_BOOST;
  }

  return score;
}

/**
 * Tokenize a query string into lowercase terms.
 * Removes non-alphanumeric characters and splits on whitespace.
 *
 * @param query - The query string to tokenize
 * @returns Array of lowercase terms
 */
export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Score and rank fields by lexical relevance.
 *
 * @param fields - Fields to score
 * @param query - Query string
 * @param maxFields - Maximum fields to return
 * @returns Sorted array of field API names with scores > 0
 */
export function rankFieldsByLexicalRelevance(
  fields: GraphField[],
  query: string,
  maxFields: number
): string[] {
  const queryTerms = tokenizeQuery(query);

  if (queryTerms.length === 0) {
    return [];
  }

  return fields
    .map((f) => ({
      apiName: f.apiName,
      score: calculateFieldRelevanceLexical(f, queryTerms),
    }))
    .filter((sf) => sf.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFields)
    .map((sf) => sf.apiName);
}

/**
 * SOQL Validator Utilities
 *
 * String matching and manipulation utilities for SOQL validation.
 */

/**
 * Calculate Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Find the closest matching string using Levenshtein distance.
 */
export function findClosestMatch(input: string, candidates: string[]): string | null {
  const inputLower = input.toLowerCase();

  // Exact match (shouldn't happen, but check anyway)
  const exact = candidates.find(c => c.toLowerCase() === inputLower);
  if (exact) return exact;

  // Starts with match
  const startsWith = candidates.find(c => c.toLowerCase().startsWith(inputLower));
  if (startsWith) return startsWith;

  // Contains match
  const contains = candidates.find(c => c.toLowerCase().includes(inputLower));
  if (contains) return contains;

  // Levenshtein distance for close matches
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = levenshteinDistance(inputLower, candidate.toLowerCase());
    if (distance < bestDistance && distance <= 3) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

/**
 * Escape special regex characters in a string.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace a field name in the SELECT clause only.
 *
 * @deprecated Use `mutateFieldInSelect()` from `ast-mutations.ts` instead.
 * This regex-based approach can corrupt string literals and aliases.
 * It will be removed in a future version.
 */
export function replaceFieldInSelect(soql: string, oldField: string, newField: string): string {
  // Extract SELECT clause
  const selectMatch = soql.match(/^(SELECT\s+)(.+?)(\s+FROM\s+)/i);
  if (!selectMatch) return soql;

  const prefix = selectMatch[1];
  const selectClause = selectMatch[2];
  const suffix = selectMatch[3];
  const rest = soql.slice(selectMatch[0].length);

  // Replace field in SELECT clause only
  const newSelectClause = selectClause.replace(
    new RegExp(`\\b${escapeRegex(oldField)}\\b`, 'gi'),
    newField
  );

  return prefix + newSelectClause + suffix + rest;
}

/**
 * SOQL Draft Utilities
 *
 * Token-based extraction for fast model drafts that may have syntax errors.
 * Unlike soql-ast-parser.ts which requires valid syntax, this module
 * robustly captures "intent" from potentially malformed SOQL.
 */

import { createLogger } from '../core/index.js';

const log = createLogger('soql-draft-utils');

/**
 * Core fields that must always be included regardless of pruning.
 * These ensure basic query viability.
 */
export const CORE_FIELDS = ['Id', 'Name', 'CreatedDate', 'SystemModstamp'] as const;

/**
 * SQL keywords and function names to ignore during token extraction.
 * Defined at module level for performance (avoid recreating on each call).
 */
const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE',
  'NULL', 'TRUE', 'FALSE', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT',
  'OFFSET', 'GROUP', 'HAVING', 'AS', 'NULLS', 'FIRST', 'LAST',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT',
  'CALENDAR_MONTH', 'CALENDAR_QUARTER', 'CALENDAR_YEAR',
  'DAY_IN_MONTH', 'DAY_IN_WEEK', 'DAY_IN_YEAR', 'DAY_ONLY',
  'FISCAL_MONTH', 'FISCAL_QUARTER', 'FISCAL_YEAR',
  'HOUR_IN_DAY', 'WEEK_IN_MONTH', 'WEEK_IN_YEAR',
  'INCLUDES', 'EXCLUDES', 'TYPEOF', 'WHEN', 'THEN', 'ELSE', 'END',
  'WITH', 'DATA', 'CATEGORY', 'ABOVE', 'BELOW', 'AT',
  'ROLLUP', 'CUBE', 'FOR', 'VIEW', 'REFERENCE', 'UPDATE', 'TRACKING', 'VIEWSTAT',
  'USING', 'SCOPE', 'EVERYTHING', 'DELEGATED', 'MINE', 'MY_TEAM_TERRITORY', 'MY_TERRITORY', 'TEAM',
  'FORMAT', 'TOLABEL', 'CONVERTCURRENCY', 'CONVERTTZ', 'DISTANCE', 'GEOLOCATION',
]);

export type CoreField = (typeof CORE_FIELDS)[number];

/**
 * Token-based column extraction (NOT grammar-based regex).
 * Validates tokens against known schema fields.
 *
 * This approach:
 * - Handles syntax errors gracefully (missing commas, invalid syntax)
 * - Filters out aliases (AS X) because X won't be in validFields
 * - Filters out SQL keywords and function names
 * - Handles dot notation (Account.Name -> Name)
 *
 * @param draftSoql - The draft SOQL (may have syntax errors)
 * @param validFieldsForTable - Set of valid field API names for the target table
 * @returns Array of validated field names found in the draft
 */
export function extractColumnsLoose(
  draftSoql: string,
  validFieldsForTable: Set<string>
): string[] {
  if (!draftSoql || validFieldsForTable.size === 0) {
    return [];
  }

  // 1. Remove string literals to avoid matching content as field names
  //    e.g., WHERE Name = 'Account.Name' should not extract 'Account.Name' as a field
  const cleanSql = draftSoql
    .replace(/'[^']*'/g, "''") // Replace single-quoted strings
    .replace(/"[^"]*"/g, '""'); // Replace double-quoted strings

  // 2. Tokenize: Find all potential identifiers
  //    Pattern matches: word characters, underscores, and dot notation
  //    Examples: Name, Account__c, Account.Name, Custom_Field__c
  const tokens = cleanSql.match(/\b[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)?\b/g) || [];

  // 3. Filter: Only keep tokens that match known valid fields
  const matchedFields = new Set<string>();

  for (const token of tokens) {
    const upperToken = token.toUpperCase();

    // Skip SQL keywords
    if (SQL_KEYWORDS.has(upperToken)) {
      continue;
    }

    // Handle dot notation: Account.Name -> extract 'Name'
    // Also handles Parent.Child.Field -> extract 'Field'
    const parts = token.split('.');
    const fieldName = parts[parts.length - 1];

    // Check if this field exists in the valid fields set
    if (validFieldsForTable.has(fieldName)) {
      matchedFields.add(fieldName);
    }
  }

  log.debug(
    { tokenCount: tokens.length, matchedCount: matchedFields.size },
    'Extracted columns from draft SOQL'
  );

  return Array.from(matchedFields);
}

/**
 * Merge extracted fields with core fields.
 * Ensures core fields are always present in the result.
 *
 * @param extracted - Fields extracted from draft SOQL
 * @param validFields - Set of all valid fields for the table (to verify core fields exist)
 * @returns Deduplicated array of fields including core fields
 */
export function mergeWithCoreFields(
  extracted: string[],
  validFields: Set<string>
): string[] {
  const result = new Set(extracted);

  // Add core fields if they exist in the schema
  for (const core of CORE_FIELDS) {
    if (validFields.has(core)) {
      result.add(core);
    }
  }

  return Array.from(result);
}

/**
 * Extract the main FROM object from a draft SOQL.
 * Handles malformed queries gracefully.
 *
 * @param draftSoql - The draft SOQL (may have syntax errors)
 * @returns The main object name or null if not found
 */
export function extractMainObject(draftSoql: string): string | null {
  if (!draftSoql) {
    return null;
  }

  // Pattern: FROM <ObjectName>
  // Handles: FROM Account, FROM Custom_Object__c, FROM Account WHERE...
  const fromMatch = draftSoql.match(/\bFROM\s+([a-zA-Z][a-zA-Z0-9_]*)\b/i);

  return fromMatch ? fromMatch[1] : null;
}


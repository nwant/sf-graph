/**
 * Governor Limit Safety Checks
 *
 * Protects against queries that can trigger governor limit errors:
 * - Leading wildcards (LIKE '%...') cause non-selective query errors
 * - Missing LIMIT clauses can return too many rows
 */

import type { ParsedSoqlAst } from '../soql-ast-parser.js';
import { extractWhereComparisons } from '../soql-ast-parser.js';
import type { SoqlValidationMessage } from '../../core/types.js';
import { TOOLING_API_OBJECTS } from './tooling-constraints.js';

/**
 * Default LIMIT to auto-apply for safety.
 */
export const DEFAULT_LIMIT = 1000;

/**
 * Result of governor limit checks, including potential corrections.
 */
export interface GovernorLimitResult {
  messages: SoqlValidationMessage[];
  suggestedLimit?: number;
}

/**
 * Check for leading wildcards in LIKE patterns.
 */
function checkLeadingWildcards(ast: ParsedSoqlAst): SoqlValidationMessage[] {
  const messages: SoqlValidationMessage[] = [];
  
  if (!ast.whereClause) return messages;
  
  const comparisons = extractWhereComparisons(ast.whereClause);
  
  for (const cmp of comparisons) {
    if (cmp.operator === 'LIKE' && typeof cmp.value === 'string') {
      if (cmp.value.startsWith('%')) {
        messages.push({
          type: 'warning',
          message: `Leading wildcard in "${cmp.field} LIKE '${cmp.value}'" may cause non-selective query errors on large datasets. Consider using a suffix wildcard instead.`,
        });
      }
    }
  }
  
  return messages;
}

/**
 * Check for governor limit issues and suggest corrections.
 * 
 * - For Tooling API objects: Only checks wildcards (LIMIT is forbidden)
 * - For standard objects: Warns about missing LIMIT and suggests adding one
 */
export function checkGovernorLimits(
  ast: ParsedSoqlAst,
  mainObject: string
): GovernorLimitResult {
  const messages: SoqlValidationMessage[] = [];
  let suggestedLimit: number | undefined;

  // Always check for leading wildcards (applies to all objects)
  messages.push(...checkLeadingWildcards(ast));

  // Skip auto-limit enforcement for Tooling API objects (LIMIT is forbidden)
  if (TOOLING_API_OBJECTS.has(mainObject)) {
    return { messages };
  }

  // For standard objects, warn and suggest LIMIT if missing
  if (ast.limit === undefined) {
    suggestedLimit = DEFAULT_LIMIT;
    messages.push({
      type: 'correction',
      message: `Query has no LIMIT clause. Adding "LIMIT ${DEFAULT_LIMIT}" for safety.`,
      original: undefined,
      corrected: `LIMIT ${DEFAULT_LIMIT}`,
    });
  }

  return { messages, suggestedLimit };
}

/**
 * Apply the suggested LIMIT to a SOQL query string.
 */
export function applySuggestedLimit(soql: string, limit: number): string {
  // Check if already has LIMIT (shouldn't happen if we get here, but safety first)
  if (/\bLIMIT\s+\d+/i.test(soql)) {
    return soql;
  }
  
  // Insert LIMIT before any trailing whitespace or at end
  return soql.trimEnd() + ` LIMIT ${limit}`;
}

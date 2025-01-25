/**
 * Tooling API Constraints
 *
 * Validates queries against Tooling API virtual table restrictions.
 * EntityDefinition, FieldDefinition, and related objects have strict limits:
 * - No COUNT()
 * - No GROUP BY
 * - No OR in WHERE
 * - No != (not equals)
 * - No LIMIT
 * - No OFFSET
 */

import type { ParsedSoqlAst } from '../soql-ast-parser.js';
import type { SoqlValidationMessage } from '../../core/types.js';

/**
 * Set of Tooling API virtual table object names with special constraints.
 */
export const TOOLING_API_OBJECTS = new Set([
  'EntityDefinition',
  'FieldDefinition',
  'EntityParticle',
  'Publisher',
  'RelationshipInfo',
  'SearchLayout',
  'StandardAction',
  'UserEntityAccess',
  'UserFieldAccess',
]);

/**
 * Generic helper to check if a WHERE clause contains any of the specified operators.
 */
function whereClauseHasOperator(node: any, operators: string[]): boolean {
  if (!node) return false;
  
  if (operators.includes(node.operator)) {
    return true;
  }
  
  if (node.left && whereClauseHasOperator(node.left, operators)) return true;
  if (node.right && whereClauseHasOperator(node.right, operators)) return true;
  if (node.conditions) {
    for (const cond of node.conditions) {
      if (whereClauseHasOperator(cond, operators)) return true;
    }
  }
  
  return false;
}

/** Check if WHERE clause contains OR operator. */
const hasOrOperator = (node: any) => whereClauseHasOperator(node, ['OR']);

/** Check if WHERE clause contains != or <> operator. */
const hasNotEqualsOperator = (node: any) => whereClauseHasOperator(node, ['!=', '<>']);

/**
 * Validate a query against Tooling API constraints.
 * Only applies when mainObject is a Tooling API virtual table.
 */
export function checkToolingApiConstraints(
  ast: ParsedSoqlAst,
  mainObject: string
): SoqlValidationMessage[] {
  // Skip if not a Tooling API object
  if (!TOOLING_API_OBJECTS.has(mainObject)) {
    return [];
  }

  const messages: SoqlValidationMessage[] = [];

  // Check for COUNT()
  const hasCount = ast.aggregates.some(
    (agg) => agg.fn.toUpperCase() === 'COUNT'
  );
  if (hasCount) {
    messages.push({
      type: 'error',
      message: `COUNT() is not supported when querying ${mainObject}. Remove the aggregate function.`,
    });
  }

  // Check for GROUP BY
  if (ast.groupBy && ast.groupBy.length > 0) {
    messages.push({
      type: 'error',
      message: `GROUP BY is not supported when querying ${mainObject}. Remove the GROUP BY clause.`,
    });
  }

  // Check for LIMIT
  if (ast.limit !== undefined) {
    messages.push({
      type: 'error',
      message: `LIMIT is not supported when querying ${mainObject}. Remove the LIMIT clause.`,
    });
  }

  // Check for OFFSET
  if (ast.offset !== undefined) {
    messages.push({
      type: 'error',
      message: `OFFSET is not supported when querying ${mainObject}. Remove the OFFSET clause.`,
    });
  }

  // Check for OR in WHERE
  if (ast.whereClause && hasOrOperator(ast.whereClause)) {
    messages.push({
      type: 'error',
      message: `OR operators are not supported when querying ${mainObject}. Use multiple queries or AND conditions.`,
    });
  }

  // Check for != in WHERE
  if (ast.whereClause && hasNotEqualsOperator(ast.whereClause)) {
    messages.push({
      type: 'error',
      message: `Not-equals operators (!= or <>) are not supported when querying ${mainObject}. Use positive filters only.`,
    });
  }

  return messages;
}

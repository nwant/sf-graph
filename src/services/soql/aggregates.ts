/**
 * SOQL Aggregate Validation
 *
 * GROUP BY enforcement and aggregate function validation.
 */

import type { ParsedSoqlAst } from '../soql-ast-parser.js';
import type { SoqlValidationMessage } from '../../core/types.js';

const AGGREGATE_FUNCTIONS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT']);

/**
 * Validates aggregate usage.
 * Rule: If ANY aggregate function is used, all non-aggregated fields must 
 * be included in the GROUP BY clause.
 */
export function validateAggregates(ast: ParsedSoqlAst): SoqlValidationMessage[] {
  const messages: SoqlValidationMessage[] = [];
  const fields = ast.fields || [];
  
  const hasAggregates = ast.aggregates.some(agg => {
    const fn = (agg.fn || '').toUpperCase();
    return AGGREGATE_FUNCTIONS.has(fn) || fn.startsWith('COUNT');
  });

  if (!hasAggregates) {
    return messages;
  }

  const groupBySignatures = new Set(
    (ast.groupBy || []).map(node => normalizeNode(node))
  );

  for (const field of fields) {
    if (field.type === 'FieldTypeof') {
      messages.push({
        type: 'error',
        message: `TYPEOF clauses cannot be used with aggregate functions.`
      });
      continue;
    }

    if (isAggregateFunction(field)) continue;

    const signature = normalizeNode(field);

    if (!groupBySignatures.has(signature)) {
       messages.push({
         type: 'error',
         message: `Field '${signature}' is selected but not present in the GROUP BY clause. When using aggregate functions, all non-aggregated fields must be included in the GROUP BY clause.`
       });
    }
  }

  return messages;
}

/**
 * Helper to identify if a field node is an aggregate function.
 */
export function isAggregateFunction(field: any): boolean {
  if (field.type !== 'FieldFunctionExpression') return false;
  const fn = (field.functionName || '').toUpperCase();
  return ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT'].includes(fn);
}

/**
 * Helper to convert AST node to comparable string signature.
 * Handles: Fields, Date Functions, Parent Lookups.
 * Ignores: Aliases.
 * Strips: Transparent wrappers (toLabel, convertCurrency, format).
 */
export function normalizeNode(node: any): string {
   if (typeof node === 'string') return node.toLowerCase();
   if (!node) return '';

   if (node.type === 'Field') {
     return (node.name || node.field || '').toLowerCase();
   }
   
   if (node.fn && node.fn.functionName) {
      const fnName = (node.fn.functionName || '').toLowerCase();
      const params = (node.fn.parameters || []).map((p: any) => normalizeNode(p)).join(', ');
      return `${fnName}(${params})`;
   }

   if (node.type === 'FieldFunctionExpression' || (node.functionName && node.parameters)) {
       const fnName = (node.functionName || '').toLowerCase();

       // Transparent wrappers: strip function, return inner field signature
       if (['tolabel', 'convertcurrency', 'format'].includes(fnName)) {
           if (node.parameters && node.parameters.length > 0) {
             return normalizeNode(node.parameters[0]);
           }
       }

       const params = (node.parameters || []).map((p: any) => normalizeNode(p)).join(', ');
       return `${fnName}(${params})`;
   }
   
   return '';
}

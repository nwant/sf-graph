/**
 * SOQL AST Parser Service
 * 
 * Wraps @jetstreamapp/soql-parser-js to provide typed AST parsing
 * and visitor utilities for WHERE clause validation.
 */

import { parseQuery, isQueryValid, composeQuery, Query, WhereClause, FormatOptions } from '@jetstreamapp/soql-parser-js';
import { createLogger } from '../core/index.js';

const log = createLogger('soql-ast-parser');

// === Types ===

export interface FieldInfo {
  name: string;
  alias?: string;
  type?: 'Field' | 'FieldRelationship' | 'FieldFunctionExpression' | 'FieldSubquery' | 'FieldTypeof';
  functionName?: string; // COUNT, SUM, etc.
  parameters?: any[]; // For FunctionCall expressions
}

export interface SubqueryInfo {
  relationshipName: string;
  fields: string[];
  sObject?: string;
}

export interface ParentLookupInfo {
  path: string;
  field: string;
}

export interface AggregateInfo {
  fn: string; // COUNT, SUM, AVG, MAX, MIN
  field?: string; // null for COUNT(*)
  alias?: string;
}

export interface WhereComparison {
  field: string;
  operator: string;
  value: any;
  isSubquery?: boolean;
}

export interface SemiJoinInfo {
  field: string;
  operator: 'IN' | 'NOT IN';
  subquery: {
    sObject: string;
    field: string;
  };
}

export interface TypeofClauseInfo {
  objectField: string;  // e.g., "What" or "Who"
  whenBranches: Array<{
    objectType: string;   // e.g., "Account", "Contact"
    fields: string[];
  }>;
  elseFields?: string[];
}

export interface ParsedSoqlAst {
  mainObject: string;
  fields: FieldInfo[];
  subqueries: SubqueryInfo[];
  parentLookups: ParentLookupInfo[];
  whereClause?: WhereClause;
  aggregates: AggregateInfo[];
  typeofClauses: TypeofClauseInfo[];
  groupBy?: string[];
  having?: WhereClause;
  orderBy?: Array<{ field: string; order?: 'ASC' | 'DESC' }>;
  limit?: number;
  offset?: number;
  raw: Query; // Original parsed query for advanced use
}

// === Parser Functions ===

/**
 * Parse SOQL string to AST.
 */
export function parseSoqlToAst(soql: string): ParsedSoqlAst | null {
  try {
    const query = parseQuery(soql);
    
    const fields: FieldInfo[] = [];
    const subqueries: SubqueryInfo[] = [];
    const parentLookups: ParentLookupInfo[] = [];
    const aggregates: AggregateInfo[] = [];
    const typeofClauses: TypeofClauseInfo[] = [];
    
    // Process fields - use 'any' to handle library type variations
    for (const field of (query.fields || []) as any[]) {
      if (field.type === 'Field') {
        const fieldName = field.field;
        
        // Check for parent lookup (dot notation)
        if (field.relationships?.length > 0) {
          parentLookups.push({
            path: field.relationships.join('.'),
            field: fieldName
          });
        }
        
        fields.push({ name: fieldName, type: 'Field' });
      } else if (field.type === 'FieldRelationship') {
        // Parent lookup with relationships array (e.g., Account.Name)
        const fieldName = field.field;
        if (field.relationships?.length > 0) {
          parentLookups.push({
            path: field.relationships.join('.'),
            field: fieldName
          });
          // Use full path for name (e.g. Account.Name)
          const fullPath = [...field.relationships, fieldName].join('.');
          fields.push({ name: fullPath, type: 'Field' });
        } else {
          fields.push({ name: field.rawValue || fieldName, type: 'Field' });
        }
      } else if (field.type === 'FieldFunctionExpression') {
        // Aggregate function
        const aggField = field.parameters?.[0];
        aggregates.push({
          fn: field.functionName || '',
          field: typeof aggField === 'object' && 'field' in aggField ? aggField.field : undefined,
          alias: field.alias
        });
        fields.push({ 
          name: field.functionName || '', 
          type: 'FieldFunctionExpression',
          functionName: field.functionName,
          parameters: field.parameters
        });
      } else if (field.type === 'FieldSubquery') {
        // Child subquery in SELECT
        const subquery = field.subquery;
        if (subquery) {
          subqueries.push({
            relationshipName: subquery.relationshipName || subquery.sObject || '',
            fields: (subquery.fields || []).map((f: any) => 
              f.type === 'Field' ? f.field : f.functionName || ''
            ),
            sObject: subquery.sObject
          });
        }
        fields.push({ name: field.subquery?.relationshipName || '', type: 'FieldSubquery' });
      } else if (field.type === 'FieldTypeof') {
        // Polymorphic TYPEOF clause - extract WHEN branches
        typeofClauses.push({
          objectField: field.field || '',
          whenBranches: ((field as any).conditions || []).map((cond: any) => ({
            objectType: cond.objectType || '',
            fields: (cond.fieldList || []).map((f: any) => 
              typeof f === 'string' ? f : f.field || ''
            )
          })),
          elseFields: (field as any).else?.map((f: any) => 
            typeof f === 'string' ? f : f.field || ''
          )
        });
        fields.push({ 
          name: field.field || 'TYPEOF', 
          type: 'FieldTypeof' 
        });
      }
    }
    
    // Extract GROUP BY - handle various formats
    let groupBy: string[] | undefined;
    const gb = query.groupBy as any;
    if (gb) {
      if (typeof gb.field === 'string') {
        groupBy = [gb.field];
      } else if (Array.isArray(gb.fields)) {
        groupBy = gb.fields.map((f: any) => typeof f === 'string' ? f : f.field);
      } else if (Array.isArray(gb)) {
        groupBy = gb.map((g: any) => g.field || g);
      }
    }
    
    // Extract ORDER BY - handle various formats
    let orderBy: Array<{ field: string; order?: 'ASC' | 'DESC' }> | undefined;
    const ob = query.orderBy as any;
    if (ob) {
      const obArray = Array.isArray(ob) ? ob : [ob];
      orderBy = obArray.map((o: any) => ({
        field: o.field || '',
        order: o.order || 'ASC'
      }));
    }
    
    return {
      mainObject: query.sObject || '',
      fields,
      subqueries,
      parentLookups,
      whereClause: query.where,
      aggregates,
      typeofClauses,
      groupBy,
      having: query.having,
      orderBy,
      limit: query.limit,
      offset: query.offset,
      raw: query
    };
  } catch (error) {
    log.debug({ err: error, soql }, 'Failed to parse SOQL with AST parser');
    return null;
  }
}

/**
 * Check if SOQL is syntactically valid.
 */
export function isValidSoqlSyntax(soql: string): boolean {
  return isQueryValid(soql);
}

/**
 * Format SOQL query for readability.
 */
export function formatSoqlQuery(soql: string): string {
  try {
    const query = parseQuery(soql);
    const formatOptions: FormatOptions = { 
      numIndent: 2, 
      fieldMaxLineLength: 80 
    };
    return composeQuery(query, { format: true, formatOptions });
  } catch {
    return soql; // Return original if formatting fails
  }
}

/**
 * Robustly extract SOQL from markdown code blocks or raw text.
 * Uses AST parsing to validate candidates before accepting them.
 * 
 * Handles:
 * - ```soql ... ``` (preferred)
 * - ```sql ... ```
 * - Raw SELECT ... FROM ... (with AST validation)
 */
export function extractSoqlBlock(text: string): string | null {
  // 1. Try explicit code blocks first (highest confidence)
  const codeBlockRegex = /```(?:soql|sql)?\s*([\s\S]*?)\s*```/gi;
  let match;
  const candidates: string[] = [];
  
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const content = match[1].trim();
    if (content && content.match(/SELECT\s+[\s\S]+?\s+FROM\s+/i)) {
      candidates.push(content);
    }
  }
  
  // Validate candidates with AST parser - return first valid one
  for (const candidate of candidates) {
    if (isQueryValid(candidate)) {
      log.debug({ source: 'code_block' }, 'Extracted valid SOQL from code block');
      return candidate;
    }
  }
  
  // 2. Fallback: Find SELECT ... FROM pattern in raw text
  // Look for all potential SELECT statements (not just the first)
  const selectRegex = /SELECT\s[\s\S]+?\sFROM\s[\w]+(?:[\s\S]*?)(?=SELECT\s|$)/gi;
  const rawCandidates: string[] = [];
  
  let rawMatch;
  while ((rawMatch = selectRegex.exec(text)) !== null) {
    const content = rawMatch[0].trim();
    // Remove trailing explanation text by looking for common patterns
    const cleaned = content
      .replace(/\n\n[\s\S]*$/, '')  // Stop at double newline
      .replace(/\n[A-Z][a-z][\s\S]*$/, '') // Stop at sentence-like text
      .trim();
    rawCandidates.push(cleaned);
  }
  
  // Validate with AST parser - return first valid one
  for (const candidate of rawCandidates) {
    if (isQueryValid(candidate)) {
      log.debug({ source: 'raw_text' }, 'Extracted valid SOQL from raw text');
      return candidate;
    }
  }
  
  // 3. Last resort: Return first candidate even if invalid (let validator handle it)
  if (candidates.length > 0) {
    log.debug({ source: 'code_block_unvalidated' }, 'Returning unvalidated code block candidate');
    return candidates[0];
  }
  
  log.debug('No SOQL block found in text');
  return null;
}

// === WHERE Clause Visitors ===

/**
 * Check if a node is a literal value.
 */
function isLiteralNode(node: any): boolean {
  return typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean' ||
         node?.type === 'string' || node?.type === 'number' || node?.literalType !== undefined;
}

/**
 * Extract the value from a literal node, stripping quotes from strings.
 */
function getLiteralValue(node: any): any {
  let value: any;
  
  if (typeof node === 'string') {
    value = node;
  } else if (typeof node === 'number' || typeof node === 'boolean') {
    return node;
  } else {
    value = node?.value ?? node;
  }
  
  // Strip surrounding quotes from string literals
  if (typeof value === 'string' && value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return value.slice(1, -1);
    }
  }
  
  return value;
}
/**
 * Get field name from a node, including relationship path.
 */
function getFieldName(node: any): string {
  if (typeof node?.field === 'string') {
    if (node.relationships?.length) {
      return `${node.relationships.join('.')}.${node.field}`;
    }
    return node.field;
  }
  return '';
}

/**
 * Recursively extracts field comparisons from WHERE clause AST.
 * Handles: simple equality, IN lists, INCLUDES/EXCLUDES for multi-select.
 */
export function extractWhereComparisons(whereAst: WhereClause | undefined): WhereComparison[] {
  const comparisons: WhereComparison[] = [];
  
  if (!whereAst) return comparisons;
  
  function visitCondition(node: any) {
    if (!node) return;
    
    // Handle AND/OR with left and right conditions
    if (node.left && node.right && (node.operator === 'AND' || node.operator === 'OR')) {
      visitCondition(node.left);
      visitCondition(node.right);
      return;
    }
    
    // Handle wrapper case: {left: valueCondition} without AND/OR
    if (node.left && !node.right && !node.operator) {
      visitCondition(node.left);
      return;
    }
    
    // Handle ValueCondition (Field op Value)
    if (node.field !== undefined && node.operator) {
      const field = getFieldName(node);
      const operator = node.operator;
      const value = node.value;
      
      // Skip subqueries (they're handled by extractSemiJoins)
      if (node.literalType === 'SUBQUERY' || node.valueQuery) {
        comparisons.push({
          field,
          operator,
          value: null,
          isSubquery: true
        });
        return;
      }
      
      // Case 1: Simple comparison (Status = 'Open')
      if (isLiteralNode(value)) {
        comparisons.push({
          field,
          operator,
          value: getLiteralValue(value)
        });
      }
      // Case 2: IN list (Status IN ('Open', 'Closed'))
      else if (Array.isArray(value)) {
        for (const val of value) {
          comparisons.push({
            field,
            operator,
            value: getLiteralValue(val)
          });
        }
      }
    }
    
    // Handle nested conditions array
    if (node.conditions) {
      for (const cond of node.conditions) {
        visitCondition(cond);
      }
    }
  }
  
  visitCondition(whereAst);
  return comparisons;
}

/**
 * Extract semi-join subqueries from WHERE clause.
 * Detects: WHERE Id IN (SELECT AccountId FROM Contact)
 */
export function extractSemiJoins(whereAst: WhereClause | undefined): SemiJoinInfo[] {
  const semiJoins: SemiJoinInfo[] = [];
  
  if (!whereAst) return semiJoins;
  
  function visitCondition(node: any) {
    if (!node) return;
    
    // Handle AND/OR
    if (node.left && node.right && (node.operator === 'AND' || node.operator === 'OR')) {
      visitCondition(node.left);
      visitCondition(node.right);
      return;
    }
    
    // Handle wrapper case: {left: valueCondition} without AND/OR
    if (node.left && !node.right && !node.operator) {
      visitCondition(node.left);
      return;
    }
    
    // Semi-join: IN/NOT IN with a subquery (literalType: 'SUBQUERY')
    if ((node.operator === 'IN' || node.operator === 'NOT IN') && 
        (node.valueQuery || node.literalType === 'SUBQUERY')) {
      const subquery = node.valueQuery;
      if (subquery) {
        const selectField = subquery.fields?.[0];
        
        semiJoins.push({
          field: node.field || '',
          operator: node.operator as 'IN' | 'NOT IN',
          subquery: {
            sObject: (subquery.sObject || '').split(' ')[0],
            field: typeof selectField === 'object' && 'field' in selectField 
              ? selectField.field 
              : String(selectField || '')
          }
        });
      }
    }
    
    // Handle nested conditions
    if (node.conditions) {
      for (const cond of node.conditions) {
        visitCondition(cond);
      }
    }
  }
  
  visitCondition(whereAst);
  return semiJoins;
}

// === Field Name Extraction ===

/**
 * Recursively extract field names from AST FieldInfo array.
 * Handles standard fields, dot-notation, and fields inside aggregate functions
 * including nested functions like FORMAT(convertCurrency(Amount)).
 */
export function getFieldNames(fields: FieldInfo[]): string[] {
  const extracted: string[] = [];

  function extractFromParam(param: any): void {
    if (!param) return;
    
    // Direct field reference
    if (param.field) {
      extracted.push(param.field);
      return;
    }
    
    // String literal (non-quoted) could be a field name
    if (typeof param === 'string' && !param.startsWith("'") && !param.startsWith('"')) {
      extracted.push(param);
      return;
    }
    
    // Nested function expression - recurse into parameters
    if (param.type === 'FieldFunctionExpression' && param.parameters) {
      for (const nestedParam of param.parameters) {
        extractFromParam(nestedParam);
      }
    }
  }

  for (const f of fields) {
    if (f.type === 'Field' || f.type === 'FieldRelationship') {
      extracted.push(f.name);
    } else if (f.type === 'FieldFunctionExpression' && f.parameters) {
      // Extract fields from aggregate/function parameters (e.g., AVG(Amount), MAX(CloseDate))
      for (const param of f.parameters) {
        extractFromParam(param);
      }
    }
    // Note: FieldSubquery and FieldTypeof handled separately
  }
  return extracted;
}

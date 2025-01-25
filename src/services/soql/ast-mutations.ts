/**
 * AST Mutation Utilities for SOQL Query Repair
 *
 * Provides safe, AST-based transformations for correcting invalid SOQL queries.
 * These functions mutate the parsed AST in-place and use composeQuery() to
 * regenerate syntactically valid SOQL, avoiding the pitfalls of regex-based
 * string replacement (which can corrupt string literals, comments, and aliases).
 */

import {
  Query,
  FieldType,
  WhereClause,
  composeQuery,
  Subquery,
} from '@jetstreamapp/soql-parser-js';

// === Helper Functions ===

/**
 * Extract the canonical field name from any field AST node.
 * Handles type guards for the FieldType union.
 */
function getFieldNameFromAst(field: FieldType): string {
  if (field.type === 'Field') {
    return field.field;
  }
  if (field.type === 'FieldRelationship') {
    return [...field.relationships, field.field].join('.');
  }
  // FieldFunctionExpression, FieldSubquery, FieldTypeof don't have simple names
  return '';
}

/**
 * Build the correct AST node type based on whether the field path contains dots.
 * Handles "type metamorphosis" - converting between Field and FieldRelationship.
 */
function buildFieldNode(fieldPath: string, alias?: string): FieldType {
  const isRelationship = fieldPath.includes('.');

  if (isRelationship) {
    const parts = fieldPath.split('.');
    return {
      type: 'FieldRelationship',
      field: parts[parts.length - 1],
      relationships: parts.slice(0, -1),
      rawValue: fieldPath,
      ...(alias && { alias }),
    } as FieldType;
  }

  return {
    type: 'Field',
    field: fieldPath,
    ...(alias && { alias }),
  } as FieldType;
}

// === Mutation Functions ===

/**
 * Mutate the main object (FROM clause) in the query.
 * @returns true if mutation was applied, false if no change needed
 */
export function mutateMainObject(query: Query, newName: string): boolean {
  if (query.sObject === newName) {
    return false;
  }
  query.sObject = newName;
  return true;
}

/**
 * Mutate a field in the SELECT clause.
 * Handles type metamorphosis (Field <-> FieldRelationship) and preserves aliases.
 * @returns true if mutation was applied, false if field not found
 */
export function mutateFieldInSelect(
  query: Query,
  oldField: string,
  newField: string
): boolean {
  let found = false;
  const oldLower = oldField.toLowerCase();

  query.fields = (query.fields || []).map((f) => {
    const currentName = getFieldNameFromAst(f);
    if (currentName.toLowerCase() === oldLower) {
      found = true;
      // Extract alias if present (exists on Field and FieldRelationship)
      const alias = (f as { alias?: string }).alias;
      // Rebuild node with correct type, preserving alias
      return buildFieldNode(newField, alias);
    }
    return f;
  });

  return found;
}

/**
 * Mutate a parent lookup path in the SELECT clause.
 * This is an alias for mutateFieldInSelect since the logic is identical.
 */
export function mutateParentLookupPath(
  query: Query,
  oldPath: string,
  newPath: string
): boolean {
  return mutateFieldInSelect(query, oldPath, newPath);
}

/**
 * Mutate a field in the WHERE clause.
 * Recursively visits all conditions (AND, OR, NOT, nested groups).
 * @returns true if any mutation was applied
 */
export function mutateWhereClauseField(
  where: WhereClause | undefined,
  oldPath: string,
  newPath: string
): boolean {
  if (!where) {
    return false;
  }

  let mutated = false;
  const oldLower = oldPath.toLowerCase();

  function visitCondition(node: unknown): void {
    if (!node || typeof node !== 'object') {
      return;
    }

    const n = node as Record<string, unknown>;

    // Handle AND/OR (binary operators with left and right)
    if (
      (n.operator === 'AND' || n.operator === 'OR') &&
      n.left &&
      n.right
    ) {
      visitCondition(n.left);
      visitCondition(n.right);
      return;
    }

    // Handle NOT (unary operator)
    // NOT can have the condition in either left or right (parser dependent)
    if (n.operator === 'NOT') {
      if (n.left) {
        visitCondition(n.left);
      }
      if (n.right) {
        visitCondition(n.right);
      }
      return;
    }

    // Handle wrapper case: {left: condition} without operator
    if (n.left && !n.right && !n.operator) {
      visitCondition(n.left);
      return;
    }

    // Handle value condition (field comparison)
    if (n.field !== undefined) {
      // In soql-parser-js, WHERE fields can be stored as:
      // 1. Simple field: "field": "Name"
      // 2. Dot-notation string: "field": "Account.Name" (no relationships array)
      // 3. With relationships array: "field": "Name", "relationships": ["Account"]
      const relationships = n.relationships as string[] | undefined;
      let currentPath = n.field as string;
      if (relationships?.length) {
        currentPath = [...relationships, n.field].join('.');
      }

      if (currentPath.toLowerCase() === oldLower) {
        // Apply correction - the field property in WHERE is stored as full path string
        // We need to update it directly
        n.field = newPath;
        // Clear relationships if they exist since we're setting the full path
        if (relationships?.length) {
          n.relationships = undefined;
        }
        mutated = true;
      }
    }

    // Handle nested conditions array (for grouped conditions)
    if (Array.isArray(n.conditions)) {
      for (const cond of n.conditions) {
        visitCondition(cond);
      }
    }
  }

  visitCondition(where);
  return mutated;
}

/**
 * Mutate a field in a child subquery.
 * @param query The parent query containing the subquery
 * @param relationshipName The relationship name of the subquery (e.g., "Contacts")
 * @param oldField The field to replace
 * @param newField The replacement field
 * @returns true if mutation was applied
 */
export function mutateSubqueryField(
  query: Query,
  relationshipName: string,
  oldField: string,
  newField: string
): boolean {
  const relLower = relationshipName.toLowerCase();

  for (const field of query.fields || []) {
    if (field.type === 'FieldSubquery') {
      const subq = field.subquery as Subquery;
      if (subq?.relationshipName?.toLowerCase() === relLower) {
        // Subquery has a similar structure to Query for fields
        // Cast to Query-compatible type for mutation
        return mutateFieldInSelect(subq as unknown as Query, oldField, newField);
      }
    }
  }

  return false;
}

/**
 * Regenerate SOQL string from a mutated AST.
 * Uses composeQuery from @jetstreamapp/soql-parser-js.
 */
export function recomposeQuery(query: Query): string {
  return composeQuery(query, { format: false });
}

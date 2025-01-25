/**
 * Relationship Type Inference
 *
 * Determines the type of relationship for reference fields.
 */

import type { Field } from 'jsforce';

/**
 * Get relationship type for a field
 * @param field - The field to check
 * @param objectName - The object this field belongs to (for hierarchical detection)
 */
export function getRelationshipType(
  field: Field,
  objectName?: string
): string | null {
  if (field.type !== 'reference') {
    return null;
  }

  // Check for hierarchical (self-referential) relationship
  if (objectName && field.referenceTo?.includes(objectName)) {
    return 'Hierarchical';
  }

  return field.relationshipOrder !== undefined &&
    field.relationshipOrder !== null
    ? 'MasterDetail'
    : 'Lookup';
}

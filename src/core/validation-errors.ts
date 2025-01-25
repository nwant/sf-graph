/**
 * Centralized Validation Error Patterns
 *
 * This module provides a single source of truth for validation error messages.
 * Both the validator (which generates errors) and the resolver (which parses them)
 * use these patterns to ensure consistency.
 *
 * CRITICAL: If you change a template, the regex MUST still match it.
 * Run the validation error tests after any modification.
 */

/**
 * Type of missing entity extracted from validation errors
 */
export type MissingEntityType = 'object' | 'relationship' | 'field';

/**
 * Structure for a validation error pattern
 */
export interface ValidationErrorPattern<T extends MissingEntityType = MissingEntityType> {
  /** Function to generate the error message */
  template: (...args: string[]) => string;
  /** Regex to parse the error message (must use named groups: name, context) */
  regex: RegExp;
  /** Type of entity this error refers to */
  type: T;
}

/**
 * Centralized validation error patterns used by both validator and resolver.
 *
 * IMPORTANT: The regex MUST match the output of the template function.
 * Use named capture groups: (?<name>...) and (?<context>...) for extraction.
 */
export const VALIDATION_ERROR_PATTERNS = {
  /**
   * Object not found in the metadata graph
   * Example: Object "Accountt" not found in the metadata graph
   */
  OBJECT_NOT_FOUND: {
    template: (name: string) => `Object "${name}" not found in the metadata graph`,
    regex: /Object\s+["'](?<name>[\w_]+)["']\s+not found/i,
    type: 'object' as const,
  },

  /**
   * Object not found with correction suggestion
   * Example: Object "Accountt" not found, using "Account"
   */
  OBJECT_NOT_FOUND_WITH_SUGGESTION: {
    template: (name: string, suggestion: string) =>
      `Object "${name}" not found, using "${suggestion}"`,
    regex: /Object\s+["'](?<name>[\w_]+)["']\s+not found,\s+using\s+["'](?<context>[\w_]+)["']/i,
    type: 'object' as const,
  },

  /**
   * Relationship not found on parent object
   * Example: Relationship "Contacts__r" not found on Account
   */
  RELATIONSHIP_NOT_FOUND: {
    template: (name: string, parentObject: string) =>
      `Relationship "${name}" not found on ${parentObject}`,
    regex: /Relationship\s+["'](?<name>[\w_]+)["']\s+not found(?:\s+on\s+(?<context>[\w_]+))?/i,
    type: 'relationship' as const,
  },

  /**
   * Child relationship not found on parent object
   * Example: Child relationship "Contacts__r" not found on Account
   */
  CHILD_RELATIONSHIP_NOT_FOUND: {
    template: (name: string, parentObject: string) =>
      `Child relationship "${name}" not found on ${parentObject}`,
    regex:
      /Child relationship\s+["'](?<name>[\w_]+)["']\s+not found(?:\s+on\s+(?<context>[\w_]+))?/i,
    type: 'relationship' as const,
  },

  /**
   * Child relationship not found with suggestion
   * Example: Child relationship "Contacts__r" not found on Account. Did you mean "Contacts"?
   */
  CHILD_RELATIONSHIP_NOT_FOUND_WITH_SUGGESTION: {
    template: (name: string, parentObject: string, suggestion: string) =>
      `Child relationship "${name}" not found on ${parentObject}. Did you mean "${suggestion}"?`,
    regex:
      /Child relationship\s+["'](?<name>[\w_]+)["']\s+not found(?:\s+on\s+(?<context>[\w_]+))?/i,
    type: 'relationship' as const,
  },

  /**
   * Field not found on object
   * Example: Field "Namee" not found on Account
   */
  FIELD_NOT_FOUND: {
    template: (name: string, objectName: string) =>
      `Field "${name}" not found on ${objectName} - check spelling or use available fields`,
    regex: /Field\s+["'](?<name>[\w_]+)["']\s+not found(?:\s+on\s+(?<context>[\w_]+))?/i,
    type: 'field' as const,
  },

  /**
   * Field not found with correction suggestion
   * Example: Field "Namee" not found on Account, using "Name"
   */
  FIELD_NOT_FOUND_WITH_SUGGESTION: {
    template: (name: string, objectName: string, suggestion: string) =>
      `Field "${name}" not found on ${objectName}, using "${suggestion}"`,
    regex:
      /Field\s+["'](?<name>[\w_]+)["']\s+not found(?:\s+on\s+(?<context>[\w_]+))?,\s+using\s+["'][\w_]+["']/i,
    type: 'field' as const,
  },

  /**
   * Unknown object type in TYPEOF clause
   * Example: Unknown object type "Accountt" in TYPEOF clause
   */
  TYPEOF_UNKNOWN_OBJECT: {
    template: (name: string) => `Unknown object type "${name}" in TYPEOF clause`,
    regex: /Unknown object type\s+["'](?<name>[\w_]+)["']\s+in TYPEOF/i,
    type: 'object' as const,
  },

  /**
   * Field not found on subtype in TYPEOF clause
   * Example: Field "Namee" not found on subtype "Account" in TYPEOF clause
   */
  TYPEOF_FIELD_NOT_FOUND: {
    template: (fieldName: string, objectType: string) =>
      `Field "${fieldName}" not found on subtype "${objectType}" in TYPEOF clause`,
    regex:
      /Field\s+["'](?<name>[\w_]+)["']\s+not found on subtype\s+["'](?<context>[\w_]+)["']\s+in TYPEOF/i,
    type: 'field' as const,
  },
} as const;

/**
 * Type for the keys of VALIDATION_ERROR_PATTERNS
 */
export type ValidationErrorPatternKey = keyof typeof VALIDATION_ERROR_PATTERNS;

/**
 * Extracted missing entity from a validation error
 */
export interface MissingEntity {
  type: MissingEntityType;
  name: string;
  context?: string; // e.g., parent object name for relationships/fields
}

/**
 * Extract a missing entity from validation error messages.
 * Tries all patterns and returns the first match.
 *
 * @param messages Array of error messages to parse
 * @returns The extracted missing entity, or null if no pattern matches
 */
export function extractMissingEntityFromMessage(messages: string[]): MissingEntity | null {
  for (const message of messages) {
    for (const pattern of Object.values(VALIDATION_ERROR_PATTERNS)) {
      const match = message.match(pattern.regex);
      if (match?.groups) {
        return {
          type: pattern.type,
          name: match.groups.name,
          context: match.groups.context,
        };
      }
    }
  }
  return null;
}

/**
 * Check if an error message indicates a missing object
 */
export function isObjectNotFoundError(message: string): boolean {
  return (
    VALIDATION_ERROR_PATTERNS.OBJECT_NOT_FOUND.regex.test(message) ||
    VALIDATION_ERROR_PATTERNS.TYPEOF_UNKNOWN_OBJECT.regex.test(message)
  );
}

/**
 * Check if an error message indicates a missing relationship
 */
export function isRelationshipNotFoundError(message: string): boolean {
  return (
    VALIDATION_ERROR_PATTERNS.RELATIONSHIP_NOT_FOUND.regex.test(message) ||
    VALIDATION_ERROR_PATTERNS.CHILD_RELATIONSHIP_NOT_FOUND.regex.test(message)
  );
}

/**
 * Check if an error message indicates a missing field
 */
export function isFieldNotFoundError(message: string): boolean {
  return (
    VALIDATION_ERROR_PATTERNS.FIELD_NOT_FOUND.regex.test(message) ||
    VALIDATION_ERROR_PATTERNS.TYPEOF_FIELD_NOT_FOUND.regex.test(message)
  );
}

/**
 * Object Classification Module
 *
 * Provides comprehensive classification of Salesforce objects and fields
 * based on API name conventions (suffixes and namespace prefixes).
 */

// === Object Category Types ===

/**
 * Primary category of a Salesforce object
 */
export type ObjectCategory =
  | 'standard'       // Standard Salesforce objects (Account, Contact, etc.)
  | 'custom'         // Custom objects ending in __c
  | 'external'       // External objects ending in __x
  | 'metadata_type'  // Custom Metadata Types ending in __mdt
  | 'platform_event' // Platform Events ending in __e
  | 'system';        // System-derived objects (__Share, __Feed, __History, __ChangeEvent)

/**
 * Subtype for system-derived objects
 */
export type ObjectSubtype = 'share' | 'feed' | 'history' | 'change_event' | null;

/**
 * Complete classification of a Salesforce object
 */
export interface ObjectClassification {
  /** Primary category of the object */
  category: ObjectCategory;
  /** Subtype for system-derived objects, null otherwise */
  subtype: ObjectSubtype;
  /** Managed package namespace prefix, undefined if not from a package */
  namespace?: string;
  /** For derived objects, the parent object's API name */
  parentObjectName?: string;
}

// === Field Category Types ===

/**
 * Category for Salesforce fields (simpler than objects)
 */
export type FieldCategory = 'standard' | 'custom';

/**
 * Classification of a Salesforce field
 */
export interface FieldClassification {
  category: FieldCategory;
  namespace?: string;
}

// === Classification Functions ===

/**
 * Suffix patterns for object classification
 * Order matters - derived object suffixes checked first.
 * We include both custom (__Suffix) and standard (Suffix) variations.
 */
const DERIVED_SUFFIXES: Array<{ suffix: string; subtype: ObjectSubtype }> = [
  // Custom/Managed derived objects (Double underscore)
  { suffix: '__Share', subtype: 'share' },
  { suffix: '__Feed', subtype: 'feed' },
  { suffix: '__History', subtype: 'history' },
  { suffix: '__ChangeEvent', subtype: 'change_event' },
  
  // Standard derived objects (No double underscore)
  // These must come AFTER the double-underscore versions to ensure greedy matching
  { suffix: 'Share', subtype: 'share' },
  { suffix: 'Feed', subtype: 'feed' },
  { suffix: 'History', subtype: 'history' },
  { suffix: 'ChangeEvent', subtype: 'change_event' },
];

const PRIMARY_SUFFIXES: Array<{ suffix: string; category: ObjectCategory }> = [
  { suffix: '__c', category: 'custom' },
  { suffix: '__x', category: 'external' },
  { suffix: '__mdt', category: 'metadata_type' },
  { suffix: '__e', category: 'platform_event' },
];

/**
 * Extract namespace from API name if present
 *
 * Managed package objects follow the pattern: Namespace__ObjectName__suffix
 * We detect this by looking for 3+ parts when split by '__'
 *
 * Examples:
 * - npsp__Allocation__c -> namespace: 'npsp'
 * - Invoice__c -> namespace: undefined
 * - Account -> namespace: undefined
 */
export function extractNamespace(apiName: string): string | undefined {
  const parts = apiName.split('__');

  // Need at least 3 parts for a namespaced object: [namespace, name, suffix]
  // e.g., 'npsp__Allocation__c' splits to ['npsp', 'Allocation', 'c']
  if (parts.length >= 3) {
    // First part is the namespace
    return parts[0];
  }

  return undefined;
}

/**
 * Extract parent object name from a derived object
 *
 * Examples:
 * - Invoice__Share -> Invoice__c (for custom objects)
 * - AccountShare -> Account (for standard objects)
 * - npsp__Trigger_Handler__Share -> npsp__Trigger_Handler__c
 */
export function extractParentObjectName(apiName: string, suffix: string): string {
  const baseName = apiName.slice(0, -suffix.length);

  // If the suffix started with '__', it implies a custom/managed object parent.
  // We generally need to append '__c' to the base name if it's not present.
  if (suffix.startsWith('__')) {
    if (!baseName.endsWith('__c')) {
      return `${baseName}__c`;
    }
  }

  // For standard suffixes (e.g., 'Share'), the base name matches the parent (e.g., 'Account')
  return baseName;
}

/**
 * Classify a Salesforce object based on its API name
 *
 * @param apiName - The full API name of the object
 * @returns Complete classification including category, subtype, namespace, and parent
 */
export function classifyObject(apiName: string): ObjectClassification {
  // Check for derived/supporting object suffixes first
  for (const { suffix, subtype } of DERIVED_SUFFIXES) {
    if (apiName.endsWith(suffix)) {
      const parentObjectName = extractParentObjectName(apiName, suffix);
      
      // Namespace comes from the parent object name
      const namespace = extractNamespace(parentObjectName);

      return {
        category: 'system',
        subtype,
        namespace,
        parentObjectName,
      };
    }
  }

  // Check for primary object type suffixes
  for (const { suffix, category } of PRIMARY_SUFFIXES) {
    if (apiName.endsWith(suffix)) {
      const namespace = extractNamespace(apiName);
      return {
        category,
        subtype: null,
        namespace,
      };
    }
  }

  // No suffix match - it's a standard object
  // Standard objects don't have namespaces or subtypes
  return {
    category: 'standard',
    subtype: null,
  };
}

/**
 * Classify a Salesforce field based on its API name
 *
 * @param fieldApiName - The API name of the field
 * @returns Field classification with category and namespace
 */
export function classifyField(fieldApiName: string): FieldClassification {
  if (fieldApiName.endsWith('__c')) {
    const namespace = extractNamespace(fieldApiName);
    return {
      category: 'custom',
      namespace,
    };
  }

  return {
    category: 'standard',
  };
}

/**
 * Check if an object is a system-derived object (Share, Feed, History, ChangeEvent)
 */
export function isSystemDerivedObject(apiName: string): boolean {
  return DERIVED_SUFFIXES.some(({ suffix }) => apiName.endsWith(suffix));
}

/**
 * Check if an object matches a given category filter
 *
 * @param apiName - Object API name
 * @param categories - Array of categories to match against
 * @returns true if the object's category is in the filter list
 */
export function matchesCategory(
  apiName: string,
  categories: ObjectCategory[]
): boolean {
  const classification = classifyObject(apiName);
  return categories.includes(classification.category);
}

/**
 * Get a human-readable display name for an object category
 */
export function getCategoryDisplayName(category: ObjectCategory): string {
  const displayNames: Record<ObjectCategory, string> = {
    standard: 'Standard Objects',
    custom: 'Custom Objects',
    external: 'External Objects',
    metadata_type: 'Custom Metadata Types',
    platform_event: 'Platform Events',
    system: 'System Objects',
  };
  return displayNames[category];
}

/**
 * Get a human-readable display name for an object subtype
 */
export function getSubtypeDisplayName(subtype: ObjectSubtype): string {
  if (!subtype) return '';

  const displayNames: Record<Exclude<ObjectSubtype, null>, string> = {
    share: 'Sharing Object',
    feed: 'Feed Object',
    history: 'History Object',
    change_event: 'Change Event',
  };
  return displayNames[subtype];
}

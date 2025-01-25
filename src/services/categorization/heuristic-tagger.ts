/**
 * Heuristic Tagger
 *
 * Auto-derives categories from graph structure during sync.
 * Replaces static JSON taxonomy with dynamic graph-based rules.
 */

import { createLogger } from '../../core/index.js';
import type {
  HeuristicRule,
  CategoryName,
  CategoryAssignment,
  CategorizedElement,
} from './types.js';

const log = createLogger('heuristic-tagger');

// === Constants ===

/**
 * Core CRM objects that form the center of business data.
 * Used by isCoreBusinessObject() and the core_business_objects rule.
 */
const CORE_BUSINESS_OBJECTS = new Set([
  'Account',
  'Contact',
  'Lead',
  'Opportunity',
  'Case',
  'Campaign',
  'Contract',
  'Order',
  'Quote',
  'Product2',
  'Pricebook2',
  'Asset',
  'Task',
  'Event',
  'User',
  'ContentDocument',
  'ContentVersion',
]);

/**
 * System/Tooling namespace prefixes.
 * Used to exclude from managed_package category.
 */
const SYSTEM_NAMESPACES = new Set([
  'Tooling',
  'Metadata',
  'ApexLog',
  'AsyncApexJob',
  'CronTrigger',
  'CronJobDetail',
]);

/**
 * Setup/Admin standard objects that should be categorized as 'system'.
 * These are standard objects used for org configuration, not business data.
 * This prevents them from appearing in business query contexts.
 */
const SETUP_ADMIN_OBJECTS = new Set([
  'AuthProvider',
  'AuthSession',
  'LoginHistory',
  'LoginGeo',
  'SetupAuditTrail',
  'PermissionSet',
  'PermissionSetAssignment',
  'PermissionSetGroup',
  'PermissionSetLicense',
  'PermissionSetLicenseAssign',
  'Profile',
  'UserRole',
  'TwoFactorInfo',
  'SessionPermSetActivation',
  'ConnectedApplication',
  'OauthToken',
  'VerificationHistory',
  'ApexClass',
  'ApexTrigger',
  'ApexPage',
  'ApexComponent',
  'CustomField',
  'CustomObject',
  'CustomTab',
  'CustomPermission',
  'FieldPermissions',
  'ObjectPermissions',
  'SetupEntityAccess',
  'UserPackageLicense',
  'PackageLicense',
  'TenantSecret',
  'NamedCredential',
  'ExternalDataSource',
  'PlatformCachePartition',
]);

/**
 * Regex pattern for setup/admin objects.
 */
const SETUP_ADMIN_PATTERN = `^(${Array.from(SETUP_ADMIN_OBJECTS).join('|')})$`;

/**
 * System-derived object suffixes.
 * Used by isDerivedObject() for quick suffix checks.
 */
const DERIVED_OBJECT_SUFFIXES = ['Feed', 'History', 'Share', 'ChangeEvent'];

/**
 * Regex pattern for core business objects (derived from CORE_BUSINESS_OBJECTS set).
 */
const CORE_BUSINESS_PATTERN = `^(${Array.from(CORE_BUSINESS_OBJECTS).join('|')})$`;

/**
 * Default heuristic rules for auto-categorization.
 *
 * These rules leverage o.category from object-classifier.ts (synced from Describe API)
 * rather than re-parsing API name suffixes. This avoids duplication and ensures
 * consistency with the structural classification already in the graph.
 *
 * Rules are applied in priority order (highest first).
 */
export const DEFAULT_HEURISTIC_RULES: HeuristicRule[] = [
  // === STRUCTURAL CATEGORIES (from o.category) ===
  // These use OBJECT_CATEGORY to leverage the existing classification from object-classifier.ts

  // Core business objects (highest priority - explicit list)
  {
    id: 'core_business_objects',
    type: 'APINAME_PATTERN',
    target: CORE_BUSINESS_PATTERN,
    assignCategory: 'business_core',
    confidence: 0.98,
    priority: 100,
    description: 'Core Salesforce CRM objects',
    appliesTo: 'object',
  },

  // Setup/Admin objects (high priority - these are standard objects used for org config)
  // This catches AuthProvider, PermissionSet, Profile, etc. that would otherwise
  // fall through to 'standard_business_objects' rule
  {
    id: 'setup_admin_objects',
    type: 'APINAME_PATTERN',
    target: SETUP_ADMIN_PATTERN,
    assignCategory: 'system',
    confidence: 0.95,
    priority: 98,
    description: 'Setup/Admin standard objects (AuthProvider, PermissionSet, etc.)',
    appliesTo: 'object',
  },

  // System-derived objects (from o.category = 'system' AND o.subtype)
  // The object-classifier already identifies these from suffixes
  {
    id: 'system_derived_from_category',
    type: 'OBJECT_CATEGORY',
    target: 'system',
    assignCategory: 'system_derived',
    confidence: 0.95,
    priority: 95,
    description: 'System-derived objects (Feed, History, Share, ChangeEvent)',
    appliesTo: 'object',
  },

  // Custom Metadata Types (from o.category = 'metadata_type')
  {
    id: 'custom_metadata_from_category',
    type: 'OBJECT_CATEGORY',
    target: 'metadata_type',
    assignCategory: 'custom_metadata',
    confidence: 0.99,
    priority: 95,
    description: 'Custom Metadata Type objects',
    appliesTo: 'object',
  },

  // Platform Events (from o.category = 'platform_event')
  {
    id: 'platform_event_from_category',
    type: 'OBJECT_CATEGORY',
    target: 'platform_event',
    assignCategory: 'platform_event',
    confidence: 0.99,
    priority: 95,
    description: 'Platform Event objects',
    appliesTo: 'object',
  },

  // External Objects (from o.category = 'external')
  {
    id: 'external_object_from_category',
    type: 'OBJECT_CATEGORY',
    target: 'external',
    assignCategory: 'external_object',
    confidence: 0.99,
    priority: 95,
    description: 'External Object (OData/etc)',
    appliesTo: 'object',
  },

  // === NAMESPACE-BASED CATEGORIES ===

  // System/Tooling namespace objects
  {
    id: 'system_namespace',
    type: 'NAMESPACE',
    target: 'Tooling|Metadata',
    assignCategory: 'system',
    confidence: 0.95,
    priority: 85,
    description: 'System/Tooling API objects',
    appliesTo: 'object',
  },

  // Managed package objects (any non-empty namespace not in system list)
  {
    id: 'managed_package',
    type: 'NAMESPACE',
    target: '.+', // Any non-empty namespace (will check against system list)
    assignCategory: 'managed_package',
    confidence: 0.9,
    priority: 80,
    description: 'Managed package objects',
    appliesTo: 'object',
  },

  // === SEMANTIC CATEGORIES (from graph relationships) ===

  // Objects with lookup to core business objects
  {
    id: 'business_extended_account',
    type: 'HAS_LOOKUP_TO',
    target: 'Account',
    assignCategory: 'business_extended',
    confidence: 0.85,
    priority: 70,
    description: 'Custom object linked to Account',
    appliesTo: 'object',
  },
  {
    id: 'business_extended_contact',
    type: 'HAS_LOOKUP_TO',
    target: 'Contact',
    assignCategory: 'business_extended',
    confidence: 0.85,
    priority: 70,
    description: 'Custom object linked to Contact',
    appliesTo: 'object',
  },
  {
    id: 'business_extended_opportunity',
    type: 'HAS_LOOKUP_TO',
    target: 'Opportunity',
    assignCategory: 'business_extended',
    confidence: 0.85,
    priority: 70,
    description: 'Custom object linked to Opportunity',
    appliesTo: 'object',
  },

  // Standard objects that are queryable business data (fallback for non-core standards)
  // This catches standard objects like Activity, Note, Attachment, etc.
  {
    id: 'standard_business_objects',
    type: 'OBJECT_CATEGORY',
    target: 'standard',
    assignCategory: 'business_core',
    confidence: 0.7,
    priority: 50,
    description: 'Standard Salesforce objects (general)',
    appliesTo: 'object',
  },

  // Custom objects without business relationships (lowest priority for objects)
  {
    id: 'custom_unlinked',
    type: 'OBJECT_CATEGORY',
    target: 'custom',
    assignCategory: 'business_extended',
    confidence: 0.6,
    priority: 40,
    description: 'Custom objects (unlinked)',
    appliesTo: 'object',
  },

  // === FIELD CATEGORIES ===

  // Field patterns - Lifecycle (Status/Stage)
  {
    id: 'field_lifecycle_status',
    type: 'FIELD_PATTERN',
    target: 'Status',
    assignCategory: 'lifecycle',
    confidence: 0.9,
    priority: 75,
    description: 'Status/lifecycle field',
    appliesTo: 'field',
  },
  {
    id: 'field_lifecycle_stage',
    type: 'FIELD_PATTERN',
    target: 'Stage',
    assignCategory: 'lifecycle',
    confidence: 0.9,
    priority: 75,
    description: 'Stage/lifecycle field',
    appliesTo: 'field',
  },
  {
    id: 'field_lifecycle_phase',
    type: 'FIELD_PATTERN',
    target: 'Phase',
    assignCategory: 'lifecycle',
    confidence: 0.85,
    priority: 74,
    description: 'Phase/lifecycle field',
    appliesTo: 'field',
  },

  // Field patterns - Financial
  {
    id: 'field_financial_amount',
    type: 'FIELD_PATTERN',
    target: 'Amount',
    assignCategory: 'financial',
    confidence: 0.9,
    priority: 75,
    description: 'Amount/currency field',
    appliesTo: 'field',
  },
  {
    id: 'field_financial_revenue',
    type: 'FIELD_PATTERN',
    target: 'Revenue',
    assignCategory: 'financial',
    confidence: 0.9,
    priority: 75,
    description: 'Revenue field',
    appliesTo: 'field',
  },
  {
    id: 'field_financial_price',
    type: 'FIELD_PATTERN',
    target: 'Price',
    assignCategory: 'financial',
    confidence: 0.85,
    priority: 74,
    description: 'Price field',
    appliesTo: 'field',
  },

  // Field patterns - Temporal
  {
    id: 'field_temporal_date',
    type: 'FIELD_TYPE',
    target: 'date',
    assignCategory: 'temporal',
    confidence: 0.95,
    priority: 70,
    description: 'Date field',
    appliesTo: 'field',
  },
  {
    id: 'field_temporal_datetime',
    type: 'FIELD_TYPE',
    target: 'datetime',
    assignCategory: 'temporal',
    confidence: 0.95,
    priority: 70,
    description: 'DateTime field',
    appliesTo: 'field',
  },
];

// === Graph Query Interface ===

/**
 * Interface for querying graph for heuristic evaluation.
 */
export interface HeuristicGraphQueryExecutor {
  /**
   * Get object properties for categorization.
   */
  getObjectProperties(apiName: string): Promise<ObjectProperties | null>;

  /**
   * Get field properties for categorization.
   */
  getFieldProperties(apiName: string, sobjectType: string): Promise<FieldProperties | null>;

  /**
   * Check if object has lookup to target.
   */
  hasLookupTo(objectApiName: string, targetObjectApiName: string): Promise<boolean>;

  /**
   * Get all categories assigned to an object.
   */
  getObjectCategories(apiName: string): Promise<CategoryAssignment[]>;

  /**
   * Assign category to object in graph.
   */
  assignObjectCategory(
    apiName: string,
    assignment: CategoryAssignment,
    rule: string
  ): Promise<void>;

  /**
   * Get all objects that match criteria.
   */
  getObjectsByCategory(category: string): Promise<string[]>;

  /**
   * Get custom objects (those ending in __c).
   */
  getCustomObjects(): Promise<string[]>;

  /**
   * Get all objects for categorization.
   */
  getAllObjects(): Promise<string[]>;
}

/**
 * Object properties for heuristic evaluation.
 */
export interface ObjectProperties {
  apiName: string;
  label: string;
  namespace?: string;
  category?: string;
  subtype?: string;
  parentObjectName?: string;
}

/**
 * Field properties for heuristic evaluation.
 */
export interface FieldProperties {
  apiName: string;
  sobjectType: string;
  label: string;
  type: string;
  namespace?: string;
  category?: string;
  referenceTo?: string[];
}

// === Heuristic Tagger ===

/**
 * Heuristic tagger for auto-categorization.
 */
export class HeuristicTagger {
  private rules: HeuristicRule[];
  private graphExecutor: HeuristicGraphQueryExecutor;

  constructor(
    graphExecutor: HeuristicGraphQueryExecutor,
    customRules: HeuristicRule[] = []
  ) {
    this.graphExecutor = graphExecutor;
    // Merge custom rules with defaults, custom takes priority
    this.rules = [...customRules, ...DEFAULT_HEURISTIC_RULES].sort(
      (a, b) => b.priority - a.priority
    );
  }

  /**
   * Evaluate all rules against an object and return matching categories.
   */
  async categorizeObject(apiName: string): Promise<CategorizedElement> {
    const props = await this.graphExecutor.getObjectProperties(apiName);
    if (!props) {
      return {
        nodeType: 'Object',
        apiName,
        categories: [],
      };
    }

    const categories: CategoryAssignment[] = [];
    const now = new Date();

    for (const rule of this.rules) {
      if (rule.appliesTo !== 'object' && rule.appliesTo !== 'both') {
        continue;
      }

      const matches = await this.evaluateObjectRule(rule, props);
      if (matches) {
        categories.push({
          category: rule.assignCategory,
          confidence: rule.confidence,
          source: 'heuristic',
          rule: rule.id,
          assignedAt: now,
        });

        log.debug(
          { apiName, rule: rule.id, category: rule.assignCategory },
          'Heuristic rule matched'
        );
      }
    }

    // Deduplicate by category, keeping highest confidence
    const dedupedCategories = this.deduplicateCategories(categories);

    return {
      nodeType: 'Object',
      apiName,
      categories: dedupedCategories,
      primaryCategory: dedupedCategories[0],
    };
  }

  /**
   * Evaluate all rules against a field and return matching categories.
   */
  async categorizeField(
    apiName: string,
    sobjectType: string
  ): Promise<CategorizedElement> {
    const props = await this.graphExecutor.getFieldProperties(apiName, sobjectType);
    if (!props) {
      return {
        nodeType: 'Field',
        apiName,
        sobjectType,
        categories: [],
      };
    }

    const categories: CategoryAssignment[] = [];
    const now = new Date();

    for (const rule of this.rules) {
      if (rule.appliesTo !== 'field' && rule.appliesTo !== 'both') {
        continue;
      }

      const matches = await this.evaluateFieldRule(rule, props);
      if (matches) {
        categories.push({
          category: rule.assignCategory,
          confidence: rule.confidence,
          source: 'heuristic',
          rule: rule.id,
          assignedAt: now,
        });
      }
    }

    const dedupedCategories = this.deduplicateCategories(categories);

    return {
      nodeType: 'Field',
      apiName,
      sobjectType,
      categories: dedupedCategories,
      primaryCategory: dedupedCategories[0],
    };
  }

  /**
   * Evaluate a rule against object properties.
   */
  private async evaluateObjectRule(
    rule: HeuristicRule,
    props: ObjectProperties
  ): Promise<boolean> {
    switch (rule.type) {
      case 'APINAME_PATTERN': {
        const regex = new RegExp(rule.target, 'i');
        return regex.test(props.apiName);
      }

      case 'NAMESPACE': {
        if (!props.namespace) {
          return false;
        }
        // For managed_package rule, exclude system namespaces
        if (rule.id === 'managed_package') {
          return !SYSTEM_NAMESPACES.has(props.namespace);
        }
        const regex = new RegExp(rule.target, 'i');
        return regex.test(props.namespace);
      }

      case 'DERIVED_FROM': {
        return props.parentObjectName !== undefined && props.parentObjectName !== null;
      }

      case 'OBJECT_SUBTYPE': {
        return props.subtype === rule.target;
      }

      case 'OBJECT_CATEGORY': {
        return props.category === rule.target;
      }

      case 'HAS_LOOKUP_TO': {
        return await this.graphExecutor.hasLookupTo(props.apiName, rule.target);
      }

      default:
        return false;
    }
  }

  /**
   * Evaluate a rule against field properties.
   */
  private async evaluateFieldRule(
    rule: HeuristicRule,
    props: FieldProperties
  ): Promise<boolean> {
    switch (rule.type) {
      case 'FIELD_PATTERN': {
        // Check if field name contains the pattern (case-insensitive)
        return props.apiName.toLowerCase().includes(rule.target.toLowerCase());
      }

      case 'FIELD_TYPE': {
        return props.type?.toLowerCase() === rule.target.toLowerCase();
      }

      case 'APINAME_PATTERN': {
        const regex = new RegExp(rule.target, 'i');
        return regex.test(props.apiName);
      }

      case 'NAMESPACE': {
        if (!props.namespace) {
          return false;
        }
        const regex = new RegExp(rule.target, 'i');
        return regex.test(props.namespace);
      }

      default:
        return false;
    }
  }

  /**
   * Deduplicate categories by name, keeping highest confidence.
   */
  private deduplicateCategories(
    categories: CategoryAssignment[]
  ): CategoryAssignment[] {
    const byCategory = new Map<CategoryName, CategoryAssignment>();

    for (const cat of categories) {
      const existing = byCategory.get(cat.category);
      if (!existing || cat.confidence > existing.confidence) {
        byCategory.set(cat.category, cat);
      }
    }

    return Array.from(byCategory.values()).sort(
      (a, b) => b.confidence - a.confidence
    );
  }

  /**
   * Get the list of rules being used.
   */
  getRules(): HeuristicRule[] {
    return [...this.rules];
  }

  /**
   * Check if an object is a core business object.
   */
  isCoreBusinessObject(apiName: string): boolean {
    return CORE_BUSINESS_OBJECTS.has(apiName);
  }

  /**
   * Check if an object is a derived system object.
   */
  isDerivedObject(apiName: string): boolean {
    return DERIVED_OBJECT_SUFFIXES.some((suffix) => apiName.endsWith(suffix));
  }
}

/**
 * Create a heuristic tagger.
 */
export function createHeuristicTagger(
  graphExecutor: HeuristicGraphQueryExecutor,
  customRules?: HeuristicRule[]
): HeuristicTagger {
  return new HeuristicTagger(graphExecutor, customRules);
}

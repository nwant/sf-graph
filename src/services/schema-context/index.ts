/**
 * Schema Context Provider
 * 
 * Provides schema context from the metadata graph for LLM prompt enrichment.
 * Designed with a pluggable interface for future semantic search and GraphRAG.
 */

import {
  getAllObjects,
  getObjectFields,
  getObjectRelationships,
  getChildRelationships,
  type GraphObject,
  type GraphField,
  type GraphRelationship,
  type ChildRelationshipInfo,
  getPicklistValues,
  findObjectsByPicklistValue,
} from '../neo4j/graph-service.js';
import { findObject } from '../dynamic-synonym-service.js';
import type { PicklistMatch, ClassifiedEntity } from '../../core/types.js';
import { createLogger } from '../../core/logger.js';
import { createSchemaCategorizationService } from '../categorization/schema-categorization-service.js';
import { createCategorizationGraphExecutor } from '../categorization/categorization-graph-executor.js';
import type { CategoryName } from '../categorization/types.js';
import { SchemaContextCache } from './cache.js';
import { KNOWN_POLYMORPHIC_FIELDS } from '../../config/polymorphic-fields.js';
import { getVectorStore, VECTOR_INDEX_NAMES } from '../vector/index.js';
import { getEmbeddingProvider } from '../embeddings/index.js';
import { CORE_FIELDS } from '../soql-draft-utils.js';
import {
  calculateFieldRelevanceLexical,
  tokenizeQuery as tokenizeQueryArray,
} from '../soql/lexical-scoring.js';

const log = createLogger('schema-context');

// === Constants ===

const CONTEXT_LIMITS = {
  MAX_FIELDS_PER_OBJECT: 25,
  MIN_TERM_LENGTH: 3,
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 
  'from', 'by', 'show', 'me', 'get', 'all', 'find', 'list', 'that', 'have',
  'what', 'is', 'are', 'was', 'were'
]);

// === Types ===

export * from './types.js';
import type {
  SchemaContext,
  ObjectSchema,
  SchemaContextProvider,
  RelationshipIntent,
  ExtractedTerms,
  CategorizedObject,
  MatchingObjectsResult,
  FieldSchema
} from './types.js';

// === Entity Extraction ===

/**
 * Extract potential entity names and picklist values from a natural language query.
 *
 * Note: Object resolution is now handled dynamically by the semantic search service
 * in findMatchingObjects(). This function only extracts syntactic patterns that
 * can't be resolved via the knowledge graph (custom object patterns, capitalized words,
 * status keywords, company name patterns).
 */
export function extractPotentialEntities(query: string): ExtractedTerms {
  const entities: string[] = [];
  const potentialValues: string[] = [];
  const words = query.toLowerCase().split(/\s+/);

  // Extract known status/priority keywords (commonly lowercase in natural language)
  const statusKeywords = ['high', 'medium', 'low', 'critical', 'urgent', 'normal',
    'open', 'closed', 'new', 'pending', 'escalated', 'won', 'lost', 'active', 'inactive'];
  for (const word of words) {
    const cleaned = word.replace(/[^a-z0-9_]/g, '');
    if (statusKeywords.includes(cleaned)) {
      // Capitalize for graph matching (picklist values are often capitalized)
      potentialValues.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
    }
  }

  // Extract company names from patterns like "for X deals", "X accounts", "X opportunities"
  const companyPatterns = [
    /(?:for|from)\s+(\w+)\s+(?:deals?|accounts?|opportunities?|cases?)/gi,
    /(\w+)\s+(?:deals?|accounts?|opportunities?|cases?)\s+(?:owned|with|where)/gi,
  ];
  for (const pattern of companyPatterns) {
    let match;
    while ((match = pattern.exec(query)) !== null) {
      const companyName = match[1];
      // Skip common words that aren't company names
      if (!['the', 'all', 'my', 'our', 'their', 'some', 'any', 'open', 'closed', 'new'].includes(companyName.toLowerCase())) {
        potentialValues.push(companyName);
      }
    }
  }

  // Look for custom object patterns (word__c, word_word__c) - these are explicit API names
  const customObjectPattern = /\b(\w+__c)\b/gi;
  let match;
  while ((match = customObjectPattern.exec(query)) !== null) {
    entities.push(match[1]);
  }

  // Extract capitalized words that might be object names or picklist values
  const capitalizedPattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)*)\b/g;
  while ((match = capitalizedPattern.exec(query)) !== null) {
    const word = match[1];
    if (word.length > 2 && !['The', 'Show', 'Get', 'Find', 'All', 'With', 'From', 'And', 'For'].includes(word)) {
      entities.push(word);
      // Also treat capitalized words as potential picklist values (e.g. "Electronics", "California")
      potentialValues.push(word);
    }
  }

  return {
    entities: [...new Set(entities)],
    potentialValues: [...new Set(potentialValues)]
  };
}

/**
 * Detect relationship intent from natural language patterns.
 * Identifies whether the query implies parent lookups (dot notation) or child subqueries.
 *
 * Note: Object name normalization is now minimal - just capitalizes the first letter.
 * The semantic search service handles synonym resolution (e.g., "deals" → "Opportunity").
 *
 * @example
 * "contacts with their account name" → parent_lookup (Contact → Account)
 * "accounts with their opportunities" → child_subquery (Account → Opportunities)
 */
export function detectRelationshipIntent(query: string): RelationshipIntent[] {
  const intents: RelationshipIntent[] = [];
  const q = query.toLowerCase();

  // Simple normalization - just capitalize first letter
  // Semantic search handles synonym resolution (deals→Opportunity, etc.)
  const normalizeObject = (str: string): string => {
    const cleaned = str.replace(/[^a-z0-9_]/gi, '');
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  };

  // Parent lookup patterns: "contacts with their account", "contacts including account name"
  // Pattern: source "with their/with/including" target (singular target suggests parent lookup)
  const parentPatterns = [
    /(\w+)\s+with\s+(?:their\s+)?(\w+)\s+(?:name|id|details?|info(?:rmation)?)/gi,
    /(\w+)\s+including\s+(\w+)\s+(?:name|id|details?)/gi,
    /(\w+)\s+and\s+(?:their\s+)?(\w+)\s+(?:name|id)/gi,
  ];

  for (const pattern of parentPatterns) {
    let match;
    while ((match = pattern.exec(q)) !== null) {
      const source = normalizeObject(match[1]);
      const target = normalizeObject(match[2]);
      if (source !== target) {
        intents.push({
          type: 'parent_lookup',
          sourceEntity: source,
          targetEntity: target,
          phrase: match[0],
        });
      }
    }
  }

  // Child subquery patterns: "accounts with their opportunities", "accounts that have contacts"
  // Pattern: source "with their/that have" targets (plural target suggests child subquery)
  const childPatterns = [
    // "that have contacts/opportunities/etc"
    /(\w+)\s+that\s+have\s+(\w+s)\b/gi,
    // "with their opportunities" (but not "with their account name")
    /(\w+)\s+with\s+(?:their\s+)?(?:all\s+)?(\w+s)\b(?!\s+(?:name|id|details?))/gi,
    // "and their opportunities"
    /(\w+)\s+and\s+(?:their\s+)?(\w+s)\b(?!\s+(?:name|id))/gi,
    // "including/showing related contacts"
    /(\w+)\s+(?:including|showing)\s+(?:all\s+)?(?:related\s+)?(\w+s)\b/gi,
  ];

  for (const pattern of childPatterns) {
    let match;
    while ((match = pattern.exec(q)) !== null) {
      const source = normalizeObject(match[1]);
      // Keep plural form for child relationship matching
      const targetRaw = match[2].toLowerCase();
      const target = normalizeObject(targetRaw);
      if (source !== target) {
        intents.push({
          type: 'child_subquery',
          sourceEntity: source,
          targetEntity: target,
          phrase: match[0],
        });
      }
    }
  }

  // Remove duplicate intents
  const seen = new Set<string>();
  return intents.filter(intent => {
    const key = `${intent.type}:${intent.sourceEntity}:${intent.targetEntity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// === Fuzzy Matching ===

/**
 * Find objects in the graph that match extracted entities.
 * Uses fuzzy matching to handle typos and partial names.
 */

export async function findMatchingObjects(
  terms: ExtractedTerms,
  orgId?: string,
  query?: string
): Promise<MatchingObjectsResult> {
  const { entities, potentialValues } = terms;

  // Track objects matched via entity/synonym (e.g., "deals" → Opportunity)
  const entityMatchedObjects = new Set<string>();
  
  // Cache of all objects for hydration
  let allObjects: GraphObject[] = [];
  let objectMap: Map<string, GraphObject> | undefined;

  const ensureObjectsLoaded = async () => {
    if (allObjects.length === 0) {
      allObjects = await getAllObjects({ orgId });
      objectMap = new Map(allObjects.map(o => [o.apiName, o]));
    }
  };

  // Ensure hydration cache is ready
  await ensureObjectsLoaded();

  // === Parallel Search Execution ===
  
  // 1. Vector Search Promise (Semantic)
  const vectorSearchPromise = (async () => {
    if (!query) return [];
    try {
      const vectorStore = getVectorStore();
      if (!(await vectorStore.isAvailable())) return [];
      
      const results = await vectorStore.search(
        VECTOR_INDEX_NAMES.OBJECT,
        await (await getEmbeddingProvider()).embed(query),
        { topK: 5, minScore: 0.7 } 
      );
      
      return results.map(r => r.nodeId); // Return API Names
    } catch (err) {
      // Fail gracefully -> Fallback to heuristics only
      log.warn({ err }, 'Vector search failed during schema context retrieval');
      return [];
    }
  })();

  // 2. Heuristic Search Promise (Exact/Fuzzy/Synonyms)
  const heuristicSearchPromise = (async () => {
    const localMatches: GraphObject[] = [];
    const localMatchedNames = new Set<string>();
    
    const addLocalMatch = (obj: GraphObject, isEntityMatch = false) => {
      if (!localMatchedNames.has(obj.apiName)) {
        localMatches.push(obj);
        localMatchedNames.add(obj.apiName);
        if (isEntityMatch) {
          entityMatchedObjects.add(obj.apiName);
        }
      }
    };

    // 2a. Dynamic Synonyms
    if (query) {
      const tokens = query.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(t => t.length > 2 && !STOPWORDS.has(t));

      const dynamicMatches = await Promise.all(
        tokens.map(t => findObject(t, orgId).catch(() => null))
      );

      const validMatches = dynamicMatches.filter((m): m is NonNullable<typeof m> => !!m);
      for (const match of validMatches) {
        const obj = objectMap!.get(match.apiName);
        if (obj) addLocalMatch(obj, true);
      }
    }

    // 2b. Entities (Exact/Partial)
    if (entities.length > 0) {
      for (const entity of entities) {
        const entityLower = entity.toLowerCase();
        // Exact
        const exactMatch = allObjects.find(
          o => o.apiName.toLowerCase() === entityLower || 
               o.label?.toLowerCase() === entityLower
        );
        if (exactMatch) {
           addLocalMatch(exactMatch, true);
           continue;
        }
        // Partial
        const partialMatch = allObjects.find(
          o => (o.apiName.toLowerCase().includes(entityLower) ||
                o.label?.toLowerCase().includes(entityLower)) &&
               !localMatchedNames.has(o.apiName)
        );
        if (partialMatch) {
          addLocalMatch(partialMatch, true);
        }
      }
    }
    
    // 2c. Picklist Values
    const picklistMatches: PicklistMatch[] = [];
    if (potentialValues.length > 0) {
      const lookupPromises = potentialValues.map(val => findObjectsByPicklistValue(val, orgId));
      const results = await Promise.all(lookupPromises);

      for (const batch of results) {
         for (const match of batch) {
            picklistMatches.push(match);
            addLocalMatch(match.object);
         }
      }
    }
    
    return { matches: localMatches, picklistMatches };
  })();

  // === Merge Results (Deduplication & Hydration) ===
  
  const [vectorApiNames, heuristicResult] = await Promise.all([vectorSearchPromise, heuristicSearchPromise]);
  
  // Deduplication Map: Key = Lowercase API Name
  const mergedObjects = new Map<string, GraphObject>();

  // Add Heuristic Results (High Precision)
  heuristicResult.matches.forEach(obj => {
    mergedObjects.set(obj.apiName.toLowerCase(), obj);
  });

  // Add Vector Results (High Recall) - Hydrate from Map
  vectorApiNames.forEach(apiName => {
    const key = apiName.toLowerCase();
    if (!mergedObjects.has(key)) {
      const cachedObj = objectMap!.get(apiName);
      if (cachedObj) {
        mergedObjects.set(key, cachedObj);
        entityMatchedObjects.add(apiName); // Treat vector matches as explicit entities
      }
    }
  });

  const matches = Array.from(mergedObjects.values());

  // === Category-Based Filtering ===
  // Instead of a hardcoded blocklist, use the categorization service to filter
  // objects based on their semantic category. System objects get filtered out
  // for business queries, allowing the graph to handle new objects automatically.

  const categorizationGraphExecutor = createCategorizationGraphExecutor(orgId);
  const categorizationService = createSchemaCategorizationService(categorizationGraphExecutor);

  // Categories that should be excluded from business query context
  const EXCLUDED_CATEGORIES: Set<CategoryName> = new Set([
    'system',
    'system_derived',
    'platform_event',
    'custom_metadata',
  ]);

  // Filter objects by category - exclude system/derived objects
  const categoryFilterPromises = matches.map(async (obj) => {
    try {
      const category = await categorizationService.getObjectCategory(obj.apiName);
      // Include if no category assigned (fallback to allowing unknown objects)
      // or if the category is not in the excluded set
      const shouldInclude = !category || !EXCLUDED_CATEGORIES.has(category);

      if (!shouldInclude) {
        log.debug(
          { objectApiName: obj.apiName, category },
          'Filtered out object based on category'
        );
      }

      return { obj, shouldInclude, category };
    } catch {
      // If categorization fails, include the object (fail-open)
      return { obj, shouldInclude: true, category: null };
    }
  });

  const categoryResults = await Promise.all(categoryFilterPromises);

  // Build categorized objects with their categories
  const filteredMatches: CategorizedObject[] = categoryResults
    .filter(r => r.shouldInclude)
    .map(r => ({ object: r.obj, category: r.category }));

  // Create a set of excluded object names for filtering picklist matches
  const excludedObjectNames = new Set(
    categoryResults.filter(r => !r.shouldInclude).map(r => r.obj.apiName)
  );

  // Also filter picklistMatches from heuristic search
  const filteredPicklistMatches = heuristicResult.picklistMatches.filter(
    match => !excludedObjectNames.has(match.object.apiName)
  );

  // Extract API names for use as context in entity grounding
  const contextObjectNames = [...entityMatchedObjects].filter(
    name => !excludedObjectNames.has(name)
  );

  return { objects: filteredMatches, picklistMatches: filteredPicklistMatches, contextObjectNames };
}

// === Context Building ===

/**
 * Build full schema context for matched objects.
 */
async function buildObjectSchema(
  object: GraphObject,
  query: string,
  orgId?: string,
  category?: CategoryName | null
): Promise<ObjectSchema> {
  // Fetch fields
  const fields = await getObjectFields(object.apiName, { orgId });
  
  // Fetch relationships
  const relationships = await getObjectRelationships(object.apiName, { orgId });
  
  // Fetch child relationships
  let childRels: ChildRelationshipInfo[] = [];
  try {
    childRels = await getChildRelationships(object.apiName, { orgId });
  } catch {
    // Child relationships might not exist
  }

  // Build field list (limit to important fields for prompt size)
  const importantFields = filterImportantFields(fields, query);

  // Build parent relationships from outgoing reference fields
  const parentRelationships = relationships
    .filter((r): r is GraphRelationship & { relationshipName: string } => 
      r.direction === 'outgoing' && !!r.relationshipName && !!r.fieldApiName
    )
    .map(r => ({
      fieldApiName: r.fieldApiName!,
      relationshipName: r.relationshipName,
      targetObject: r.targetObject,
    }));

  // Build child relationships
  const childRelationships = childRels
    .filter(r => r.relationshipName)
    .map(r => ({
      relationshipName: r.relationshipName,
      childObject: r.childObject,
    }));

  // Fetch picklist values for relevant fields
  const fieldSchemas = await Promise.all(importantFields.map(async (f) => {
    let picklistValues: string[] | undefined;
    
    if (f.type === 'picklist' || f.type === 'multipicklist') {
      try {
        const values = await getPicklistValues(object.apiName, f.apiName, orgId);
        // Only include active values, limit to top 50 to avoid prompt overflow
        picklistValues = values
          .filter(v => v.active)
          .map(v => v.value)
          .slice(0, 50);
      } catch (e) {
        log.warn({ err: e, field: f.apiName }, 'Failed to fetch picklist values');
      }
    }

    return {
      apiName: f.apiName,
      label: f.label,
      type: f.type,
      description: f.description || undefined,
      picklistValues,
    };
  }));

  // Post-process fields to add polymorphic info
  const enrichedFields = fieldSchemas.map(f => {
    const originalField = fields.find(gf => gf.apiName === f.apiName);
    return enrichPolymorphicField(f, originalField);
  });

  return {
    apiName: object.apiName,
    label: object.label,
    description: object.description || undefined,
    category: category || undefined,
    fields: enrichedFields,
    parentRelationships,
    childRelationships,
  };
}

// === Relevance Scoring ===

/**
 * Filter to important/commonly used fields, prioritizing those relevant to the query.
 * Uses the shared lexical scoring utility for consistency with soql-generator.
 */
function filterImportantFields(fields: GraphField[], query?: string): GraphField[] {
  // Always include these field types (using shared CORE_FIELDS + OwnerId)
  const alwaysInclude = [...CORE_FIELDS, 'OwnerId'];

  // Parse query terms using shared tokenizer
  const queryTerms = query ? tokenizeQueryArray(query) : [];

  // 1. Separate "Must Haves" from the rest
  const mustHaveFields = fields.filter(f => alwaysInclude.includes(f.apiName));
  const otherFields = fields.filter(f => !alwaysInclude.includes(f.apiName));

  // 2. Score the other fields using shared lexical scoring
  const scoredFields = otherFields.map(f => ({
    field: f,
    score: calculateFieldRelevanceLexical(f, queryTerms, CONTEXT_LIMITS.MIN_TERM_LENGTH),
  }));

  // 3. Sort by Score DESC, then by Name ASC
  scoredFields.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.field.apiName.localeCompare(b.field.apiName);
  });

  // 4. Select top candidates to fill remaining slots
  // We want to keep the total context reasonable (e.g. ~25 fields max per object)
  const remainingSlots = Math.max(0, CONTEXT_LIMITS.MAX_FIELDS_PER_OBJECT - mustHaveFields.length);
  const topCandidates = scoredFields.slice(0, remainingSlots).map(sf => sf.field);

  return [...mustHaveFields, ...topCandidates];
}

/**
 * Enriches a field schema with polymorphic information.
 */
function enrichPolymorphicField(fieldSchema: FieldSchema, originalField?: GraphField): FieldSchema {
  // Detect polymorphism based on referenceTo array
  const isReference = fieldSchema.type === 'reference';
  const referenceTo = originalField?.referenceTo || [];
  const isPolymorphic = isReference && referenceTo.length > 1;
  
  let relationshipName: string | undefined = undefined;
  
  if (isPolymorphic) {
    // 1. Try to get from graph data directly
    relationshipName = originalField?.relationshipName || undefined;
    
    // 2. Fallback: Check known config
    if (!relationshipName && KNOWN_POLYMORPHIC_FIELDS[fieldSchema.apiName]) {
      relationshipName = KNOWN_POLYMORPHIC_FIELDS[fieldSchema.apiName].relationshipName;
    } 
    
    // 3. Heuristic fallback: strip 'Id' (WhoId -> Who)
    if (!relationshipName && fieldSchema.apiName.endsWith('Id')) {
      relationshipName = fieldSchema.apiName.substring(0, fieldSchema.apiName.length - 2);
    }
  }

  return {
    ...fieldSchema,
    isPolymorphic,
    relationshipName,
    polymorphicTargets: isPolymorphic ? referenceTo : undefined
  };
}

// === Main Provider ===

/**
 * Fuzzy schema context provider.
 * Extracts entities from query and matches them against the graph using fuzzy matching.
 */
export class FuzzySchemaContextProvider implements SchemaContextProvider {
  private cache = new SchemaContextCache({ ttl: 300_000, maxEntries: 100 });

  async getContext(query: string, orgId?: string): Promise<SchemaContext> {
    // Check cache first
    const cached = this.cache.get(query, orgId);
    if (cached) {
      return cached;
    }

    // Build context (cache miss)
    const context = await this.buildContext(query, orgId);

    // Cache result
    this.cache.set(query, context, orgId);
    return context;
  }

  private async buildContext(query: string, orgId?: string): Promise<SchemaContext> {
    log.debug({ query }, 'Extracting schema context for query');

    // Step 1: Extract potential entity names from query
    const terms = extractPotentialEntities(query);
    log.debug({ terms }, 'Extracted potential entities');

    // Step 2: Find matching objects in graph
    const { objects: matchedObjects, picklistMatches, contextObjectNames } = await findMatchingObjects(terms, orgId, query);
    log.debug({ count: matchedObjects.length, picklistCount: picklistMatches.length, contextObjectNames }, 'Found matching objects');

    // If no objects matched, try a broader search
    if (matchedObjects.length === 0) {
      log.debug('No objects matched, returning empty context');
      return {
        objects: [],
        stats: { objectCount: 0, totalFields: 0, totalRelationships: 0 },
      };
    }

    // Step 3: Build full schema for each matched object (with category)
    const objectSchemas: ObjectSchema[] = [];
    let totalFields = 0;
    let totalRelationships = 0;

    for (const { object: obj, category } of matchedObjects) {
      try {
        const schema = await buildObjectSchema(obj, query, orgId, category);
        objectSchemas.push(schema);
        totalFields += schema.fields.length;
        totalRelationships += schema.parentRelationships.length + schema.childRelationships.length;
      } catch (error) {
        log.warn({ err: error, object: obj.apiName }, 'Failed to build schema for object');
      }
    }

    log.debug({
      objectCount: objectSchemas.length,
      totalFields,
      totalRelationships,
    }, 'Built schema context');

    return {
      objects: objectSchemas,
      contextObjectNames,
      picklistHints: picklistMatches,
      stats: {
        objectCount: objectSchemas.length,
        totalFields,
        totalRelationships,
      },
    };
  }

  /**
   * Invalidate cache for an org (called on drift detection).
   */
  invalidateCache(orgId?: string): void {
    if (orgId) {
      this.cache.invalidateForOrg(orgId);
    } else {
      this.cache.clear();
    }
  }
}

// === Default Provider Instance ===

export const defaultSchemaContextProvider = new FuzzySchemaContextProvider();

// === Prompt Formatting ===

/**
 * SOQL relationship efficiency rules for LLM guidance.
 * These are injected into the schema context to help LLMs generate efficient queries.
 */
const SOQL_EFFICIENCY_RULES = `
1. PARENT LOOKUP [LOW COST - ALWAYS PREFER]:
   Use dot notation directly in SELECT.
   Example: SELECT Id, Account.Name, Account.Industry FROM Contact
   ❌ NEVER use subquery for parent: (SELECT Name FROM Account) is INVALID

2. SEMI-JOIN FILTER [LOW COST - FOR FILTERING BY CHILD]:
   When filtering parents by child criteria (NOT retrieving child data):
   Example: SELECT Id, Name FROM Account WHERE Id IN (SELECT AccountId FROM Case WHERE Status = 'Open')
   ✓ Returns only Accounts that have open Cases, no duplicate rows

3. CHILD SUBQUERY [MODERATE COST - ONLY FOR LISTING CHILDREN]:
   Only use when user explicitly wants a LIST of related child records.
   Example: SELECT Id, Name, (SELECT Id, Subject FROM Cases) FROM Account
   ⚠ Returns parent rows even if no matching children (may have empty subquery results)
`.trim();

const DATE_LITERAL_GUIDANCE = `
GUIDANCE FOR DATE FIELDS:
- Use standard SOQL date literals (TODAY, YESTERDAY, LAST_N_DAYS:30, THIS_MONTH, etc.) whenever possible.
- Do not calculate specific dates unless absolutely necessary.
`;

const POLYMORPHIC_RULES = `
POLYMORPHIC FIELD RULES:
- WhoId/WhatId are Foreign Key fields; Who/What are Relationship names.
- ❌ NEVER use dot notation on polymorphic FK fields: Task.WhoId.Name is INVALID
- ✅ USE 'TYPEOF' ON THE RELATIONSHIP NAME (not the Id field):
  CORRECT: SELECT TYPEOF Who WHEN Contact THEN FirstName, LastName END FROM Task
  WRONG:   SELECT TYPEOF WhoId WHEN Contact THEN FirstName END FROM Task
- ✅ Use Relationship.Type to filter: WHERE What.Type = 'Account'
`;


/**
 * Format schema context for LLM prompt injection.
 * Includes explicit SOQL syntax examples for relationships with cost indicators.
 */
export interface FormatSchemaOptions {
  /** Original query for token-based field scoring */
  query?: string;
  /** Entities identified from the query (for selective field inclusion) */
  entities?: ClassifiedEntity[];
  /** Maximum fields per object (default: 15 for skeleton mode) */
  maxFieldsPerObject?: number;
  /** Enable skeleton mode (compact format) */
  skeletonMode?: boolean;
}

/**
 * Tokenize query, removing stopwords and short words.
 */
function tokenizeQuery(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .split(/[\s,.?!]+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w))
  );
}

/**
 * Format schema context for LLM prompt injection.
 * Includes explicit SOQL syntax examples for relationships with cost indicators.
 */
export function formatSchemaForPrompt(
  context: SchemaContext,
  options: FormatSchemaOptions = {}
): string {
  if (context.objects.length === 0) {
    return 'No specific schema context available. Use standard Salesforce object names.';
  }

  const {
    query = '',
    entities = [],
    maxFieldsPerObject = 15,
    skeletonMode = true // Default to skeleton mode for performance
  } = options;

  if (skeletonMode && query) {
    return formatSkeletonSchema(context, entities, maxFieldsPerObject, query);
  }

  // Check for special field types to conditionally add guidance
  const hasDateFields = context.objects.some(o => 
    o.fields.some(f => f.apiName === 'CreatedDate' || f.apiName === 'LastModifiedDate' || f.type === 'date' || f.type === 'datetime')
  );
  
  const hasPolymorphicFields = context.objects.some(o => 
    o.fields.some(f => f.isPolymorphic)
  );

  let rules = SOQL_EFFICIENCY_RULES;
  if (hasDateFields) {
    rules += `\n${DATE_LITERAL_GUIDANCE}`;
  }
  if (hasPolymorphicFields) {
    rules += `\n${POLYMORPHIC_RULES}`;
  }

  const baseSchema = formatFullSchema(context);
  return `${rules}\n\n${baseSchema}`;
}

/**
 * Format schema in skeleton mode with intelligent field prioritization.
 */
function formatSkeletonSchema(
  context: SchemaContext,
  entities: ClassifiedEntity[],
  maxFields: number,
  originalQuery: string
): string {
  const lines: string[] = ['SCHEMA (Skeleton Mode):'];

  // Extract entity terms for matching
  const entityTerms = new Set(
    entities.flatMap(e => [
      e.value.toLowerCase(),
      ...(e.picklistMatch ? [e.picklistMatch.fieldApiName.toLowerCase()] : [])
    ])
  );

  // Tokenize the original query for field matching
  const queryTokens = tokenizeQuery(originalQuery);

  for (const obj of context.objects) {
    const categoryHint = obj.category ? ` [${obj.category}]` : '';
    lines.push(`\n${obj.apiName} (${obj.label})${categoryHint}:`);

    // Score and prioritize fields
    const scoredFields = obj.fields.map(f => {
      let score = 0;
      const fName = f.apiName.toLowerCase();
      const fLabel = f.label.toLowerCase();

       // 1. Core fields always included
       if (fName === 'id' || fName === 'name') score += 20;
       
       // Boost polymorphic fields (complex but important)
       if (f.isPolymorphic) score += 15;
 
       // 2. Matches an entity value (e.g., "Microsoft" -> Account.Name)
      if (entityTerms.has(fName) || entityTerms.has(fLabel)) score += 10;

      // 3. Matches a query word (e.g., "Revenue" -> Account.AnnualRevenue)
      for (const token of queryTokens) {
        if (fName.includes(token) || fLabel.includes(token)) {
          score += 5;
          break;
        }
      }

      // 4. Slight boost for picklist/reference fields (useful for filtering)
      if (f.type === 'picklist' || f.type === 'reference') score += 1;

      return { field: f, score };
    });

    // Sort by score descending, then by apiName for stability
    scoredFields.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.field.apiName.localeCompare(b.field.apiName);
    });

    // Take top N fields
    const topFields = scoredFields.slice(0, maxFields).map(sf => sf.field);

    // Logging for debug
    log.debug({ 
      object: obj.apiName, 
      topFields: topFields.map(f => f.apiName), 
      scoreBreakdown: scoredFields.slice(0, 5).map(s => `${s.field.apiName}:${s.score}`)
    }, 'Skeleton schema field selection');

    // Compact field format: Name (type)
    const fieldList = topFields.map(f => {
      if (f.picklistValues && f.picklistValues.length > 0) {
        const values = f.picklistValues.slice(0, 5).join('|');
        return `${f.apiName}(${f.type}:${values})`;
      }
      if (f.isPolymorphic) {
         const targets = f.polymorphicTargets ? f.polymorphicTargets.slice(0, 3).join('/') : 'Multiple';
         const relName = f.relationshipName || 'RELATIONSHIP';
         return `${f.apiName}(POLYMORPHIC:${relName}->${targets})`;
      }
      return `${f.apiName}(${f.type})`;
    });
    lines.push(`  Fields: ${fieldList.join(', ')}`);

    // Only include relationships relevant to context objects
    const contextObjectSet = new Set(context.objects.map(o => o.apiName));
    
    const relevantParentRels = obj.parentRelationships
      .filter(r => contextObjectSet.has(r.targetObject));
    if (relevantParentRels.length > 0) {
      lines.push(`  Parents: ${relevantParentRels.map(r => `${r.relationshipName}→${r.targetObject}`).join(', ')}`);
    }

    const relevantChildRels = obj.childRelationships
      .filter(r => contextObjectSet.has(r.childObject));
    if (relevantChildRels.length > 0) {
      lines.push(`  Children: ${relevantChildRels.map(r => `${r.relationshipName}→${r.childObject}`).join(', ')}`);
    }
  }

  // Add SOQL rules (abbreviated for skeleton mode)
  lines.push('\nRULES: Use Parent.Field for lookups. Use (SELECT FROM Children) for subqueries. No ID literals.');

  return lines.join('\n');
}

function formatFullSchema(context: SchemaContext): string {
  const lines: string[] = ['AVAILABLE SCHEMA:'];

  for (const obj of context.objects) {
    lines.push('');
    // Include category hint for LLM guidance
    const categoryHint = obj.category ? ` [${obj.category}]` : '';
    lines.push(`Object: ${obj.apiName} (${obj.label})${categoryHint}`);

    // Fields
    if (obj.fields.length > 0) {
      lines.push('  Fields:');
      for (const f of obj.fields) {
        let fieldLine = `    - ${f.apiName} (${f.type})`;
        if (f.picklistValues && f.picklistValues.length > 0) {
          fieldLine += ` - Values: ${f.picklistValues.join(', ')}`;
        }
        
        // Add polymorphic info
        if (f.isPolymorphic) {
          const relName = f.relationshipName || 'UnknownRel';
          const targets = f.polymorphicTargets ? f.polymorphicTargets.slice(0, 5).join('|') : 'Multiple';
          const extra = f.polymorphicTargets && f.polymorphicTargets.length > 5 ? '...' : '';
          fieldLine += `\n    ℹ️ POLYMORPHIC: Use TYPEOF ${relName} WHEN... (Targets: ${targets}${extra})`;
          
          if (KNOWN_POLYMORPHIC_FIELDS[f.apiName]) {
               fieldLine += ` - ${KNOWN_POLYMORPHIC_FIELDS[f.apiName].description}`;
          }
        }
        
        lines.push(fieldLine);
      }
    }

    // Parent relationships (for dot notation) - with explicit syntax and cost
    if (obj.parentRelationships.length > 0) {
      lines.push('  Parent lookups [LOW COST - PREFERRED]:');
      for (const r of obj.parentRelationships) {
        // Show the syntax pattern: Account.Name, Account.Industry, etc.
        lines.push(`    - ${r.relationshipName}.FieldName → access ${r.targetObject} fields (e.g., ${r.relationshipName}.Name)`);
      }
    }

    // Child relationships (for subqueries) - with explicit syntax and cost
    if (obj.childRelationships.length > 0) {
      lines.push('  Child relationships [MODERATE COST - only when listing child items]:');
      for (const r of obj.childRelationships) {
        // Show the subquery pattern
        lines.push(`    - (SELECT fields FROM ${r.relationshipName}) → get related ${r.childObject} records`);
      }
    }
  }

  lines.push('');
  lines.push('SOQL RELATIONSHIP RULES (by efficiency):');
  lines.push('');
  lines.push(SOQL_EFFICIENCY_RULES);
  lines.push('');
  lines.push('Use ONLY the objects, fields, and relationships listed above.');
  lines.push('');
  lines.push('NEGATIVE CONSTRAINTS (Validation Hard Failures):');
  lines.push('1. ❌ NEVER use 15/18-char ID literals (e.g., OwnerId = \'005...\'). This will fail validation.');
  lines.push('2. ❌ NEVER use subqueries for parent fields (e.g., (SELECT Name FROM Account)). Use Account.Name.');
  lines.push('3. ❌ NEVER use "IS NOT EMPTY". Use "Id IN (SELECT ...)"');

  // Add Picklist Hints
  if (context.picklistHints && context.picklistHints.length > 0) {
    lines.push('');
    lines.push('QUERY HINTS (Matched Picklist Values):');
    // Group hints by object.field
    const hints = new Map<string, Set<string>>();
    for (const hint of context.picklistHints) {
       const key = `${hint.object.apiName}.${hint.field.apiName}`;
       const val = `value "${hint.value}"`;
       if (!hints.has(key)) hints.set(key, new Set());
       hints.get(key)!.add(val);
    }
    
    for (const [field, values] of hints.entries()) {
       lines.push(`> FOUND FILTER CRITERIA: ${Array.from(values).join(', ')} matches field ${field}`);
    }
  }

  return lines.join('\n');
}

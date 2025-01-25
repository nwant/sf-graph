/**
 * SOQL Generator Service
 *
 * Generates SOQL queries from natural language using a Multi-Agent Architecture (MAC-SQL).
 *
 * Architecture:
 *   1. GraphRAG Lite: Detects global intent and provides high-level context.
 *   2. Decomposer Agent (Fast LLM): Analyzes query, identifies relevant tables/columns.
 *   3. Schema Pruning: Fetches only the relevant sub-graph to prevent hallucinations.
 *   4. Coder Agent (Strong LLM): Translation to SOQL using CoT and pruned schema.
 *   5. Validation: Enhanced graph validation + AST parsing.
 */

import { isLLMAvailable } from './llm-service.js';
import { getLLMConfigForTask, llmConfig } from '../config/llm-config.js';
import { validateAndCorrectSoqlEnhanced } from './soql-validator.js';
import { Agent } from '../agent/index.js';
import type { LlmProviderType } from '../llm/index.js';

import {
  extractPotentialEntities
} from './schema-context/index.js';
import { classifyEntities, buildDecomposerGroundingContext } from './entity-classifier.js';
import { extractMissingEntityFromErrors, resolveMissingEntity } from './entity-resolver.js';
import {
  getObjectByApiName,
  getObjectFields,
  get1HopNeighborSummaries,
  type NeighborSummary,
  type GraphObject,
} from './neo4j/graph-service.js';
import { extractSoqlBlock } from './soql-ast-parser.js';
import { graphRagService } from './graph-rag-service.js';
import { FewShotExampleService } from './few-shot/index.js';
import { searchFieldsScoped } from './field-pruning/index.js';
import { runDraftPhase, shouldRunDraftPhase } from './soql-generator-draft.js';
import { CORE_FIELDS } from './soql-draft-utils.js';
import { DECOMPOSER_PROMPT, CODER_PROMPT } from './soql/prompts.js';
import {
  scoreNeighborsWithFallback,
  calculateJaccardSimilarity as jaccardSimilarity,
  type ScoredNeighbor,
} from './peripheral-vision/index.js';
import { rankFieldsByLexicalRelevance } from './soql/lexical-scoring.js';

import type {
  SoqlGenerationResult,
  DecomposerPlan
} from '../core/types.js';
import { createLogger } from '../core/index.js';

const log = createLogger('soql-generator');



// === Peripheral Vision Helper ===

/**
 * Hub object threshold - objects with more than this many relationships
 * get special handling to prevent context flooding.
 */
const HUB_OBJECT_THRESHOLD = 50;
const HUB_OBJECT_MAX_NEIGHBORS = 10;

/**
 * Minimum relevance threshold for peripheral neighbors.
 * Raised from 0.1 (Jaccard) to 0.15 for hybrid scores which are more meaningful.
 */
const MIN_PERIPHERAL_RELEVANCE = 0.15;

/**
 * Expand the Decomposer's plan with "peripheral vision" - related objects
 * that might be needed for the query but weren't explicitly mentioned.
 *
 * Uses hybrid scoring (semantic + graph heuristics) to identify relevant
 * neighbors. Falls back to Jaccard when embeddings are unavailable.
 *
 * @param query - The natural language query
 * @param tables - The tables from the Decomposer plan
 * @param options - Options including orgId and context budget
 * @returns Expanded tables and formatted peripheral context
 */
async function expandWithPeripheralVision(
  query: string,
  tables: string[],
  options: { orgId?: string; contextBudgetPercent?: number } = {}
): Promise<{
  expandedTables: string[];
  peripheralContext: string;
}> {
  const { orgId, contextBudgetPercent = 0.1 } = options;

  if (tables.length === 0) {
    return { expandedTables: [], peripheralContext: '' };
  }

  // Phase 1: Gather all neighbors from all tables
  const allNeighbors: Array<NeighborSummary & { sourceTable: string }> = [];

  await Promise.all(
    tables.map(async (table) => {
      try {
        const neighbors = await get1HopNeighborSummaries(table, { orgId, limit: 30 });

        // Check if this is a hub object
        const isHubObject = neighbors.length >= HUB_OBJECT_THRESHOLD;
        const effectiveLimit = isHubObject ? HUB_OBJECT_MAX_NEIGHBORS : neighbors.length;

        // For hub objects, do initial filtering by Jaccard before hybrid scoring
        // This prevents fetching embeddings for 50+ neighbors
        const toProcess = isHubObject
          ? neighbors
              .map((n) => ({
                ...n,
                sourceTable: table,
                preScore: jaccardSimilarity(query, `${n.apiName} ${n.label || ''}`),
              }))
              .sort((a, b) => b.preScore - a.preScore)
              .slice(0, effectiveLimit)
          : neighbors.map((n) => ({ ...n, sourceTable: table }));

        allNeighbors.push(...toProcess);
      } catch (err) {
        log.debug({ err, table }, 'Failed to get neighbors for table');
      }
    })
  );

  if (allNeighbors.length === 0) {
    return { expandedTables: [], peripheralContext: '' };
  }

  // Phase 2: Score all neighbors using hybrid approach (semantic + graph signals)
  const scoredNeighbors = await scoreNeighborsWithFallback({
    query,
    primaryTables: tables,
    neighbors: allNeighbors,
    orgId,
  });

  // Phase 3: Deduplicate by apiName (keep highest score)
  const deduplicated = new Map<string, ScoredNeighbor & { sourceTable: string }>();
  for (const neighbor of scoredNeighbors) {
    // Skip neighbors with missing apiName (defensive check for mocked/incomplete data)
    if (!neighbor.apiName) continue;

    const key = neighbor.apiName.toLowerCase();
    const existing = deduplicated.get(key);
    if (!existing || neighbor.hybridScore > existing.hybridScore) {
      deduplicated.set(key, neighbor as ScoredNeighbor & { sourceTable: string });
    }
  }

  // Phase 4: Filter by relevance threshold and sort
  const relevant = Array.from(deduplicated.values())
    .filter((n) => n.hybridScore >= MIN_PERIPHERAL_RELEVANCE)
    .sort((a, b) => b.hybridScore - a.hybridScore);

  // Calculate dynamic limit based on context budget
  // Estimate ~30 tokens per neighbor entry
  const contextWindow = 8000; // Approximate context window
  const maxNeighbors = Math.min(30, Math.floor((contextWindow * contextBudgetPercent) / 30));

  const topNeighbors = relevant.slice(0, maxNeighbors);

  if (topNeighbors.length === 0) {
    return { expandedTables: [], peripheralContext: '' };
  }

  // Phase 5: Build peripheral context string with scoring info
  const lines = topNeighbors.map((n) => {
    const dirLabel = n.direction === 'outgoing' ? 'has parent' : 'has child';
    const relInfo = n.relationshipName ? ` (via ${n.relationshipName})` : '';
    const junctionTag = n.isJunction ? ' [junction]' : '';
    return `- ${n.sourceTable} ${dirLabel}: ${n.apiName}${relInfo}${junctionTag}`;
  });

  // Collect expanded table names (neighbors not already in the plan)
  const existingTables = new Set(tables.map((t) => t.toLowerCase()));
  const expandedTables = topNeighbors
    .map((n) => n.apiName)
    .filter((name) => !existingTables.has(name.toLowerCase()));

  const peripheralContext =
    lines.length > 0 ? `PERIPHERAL CONTEXT (related tables):\n${lines.join('\n')}` : '';

  log.debug(
    {
      originalTables: tables.length,
      neighborsFound: allNeighbors.length,
      scoredNeighbors: scoredNeighbors.length,
      relevantNeighbors: topNeighbors.length,
      junctionObjects: topNeighbors.filter((n) => n.isJunction).length,
      expandedTables: expandedTables.length,
      topScores: topNeighbors.slice(0, 3).map((n) => ({
        name: n.apiName,
        hybrid: n.hybridScore.toFixed(3),
        semantic: n.semanticScore.toFixed(3),
        graph: n.graphScore.toFixed(3),
      })),
    },
    'Peripheral vision expansion completed (hybrid scoring)'
  );

  return { expandedTables, peripheralContext };
}

// === Options ===

export interface GenerateSoqlOptions {
  /** Org ID for multi-org support */
  orgId?: string;
  /** Skip schema context injection (for testing/debugging) */
  skipContext?: boolean;
  /** LLM Provider to use */
  provider?: LlmProviderType;
  /** Model to use for the Coder (Strong Model) */
  model?: string;
  /** Model to use for the Decomposer (Fast Model) */
  decomposerModel?: string;
  /** Number of few-shot examples to include (default: 3) */
  exampleCount?: number;
  /** Skip few-shot example injection */
  skipFewShot?: boolean;
  /** Callback for few-shot initialization progress messages */
  onFewShotProgress?: (message: string) => void;
  /** Use ensemble decomposition (3 parallel runs) for higher recall */
  ensembleDecomposition?: boolean;
  /** Enable CHESS (scoped vector search) field pruning (default: true) */
  enableChessPruning?: boolean;
  /** Enable RSL-SQL (draft phase) backward pruning (default: false, opt-in) */
  enableDraftPhase?: boolean;
  /** Maximum fields per object after pruning (default: 15) */
  maxFieldsPerObject?: number;
}

// === Main Generation Function ===

export async function generateSoqlFromNaturalLanguage(
  naturalLanguageQuery: string,
  options: GenerateSoqlOptions = {}
): Promise<SoqlGenerationResult> {
  // Check LLM availability
  const llmAvailable = await isLLMAvailable();
  if (!llmAvailable) {
    throw new Error('LLM not available. Please ensure Ollama is running.');
  }

  try {
    log.debug({ query: naturalLanguageQuery }, 'Starting MAC-SQL Generation');

    // 1. GraphRAG Lite: Global Intent Detection
    let globalContextMsg = '';
    const globalContext = await graphRagService.getGlobalContext(naturalLanguageQuery);
    if (globalContext) {
      log.info('Global intent detected, injecting global context');
      globalContextMsg = `\nGLOBAL CONTEXT:\n${globalContext}\n`;
    }

    // 1.5 Semantic RAG: Pre-seed table hints from vector search
    const semanticHints = await getSemanticTableHints(naturalLanguageQuery, options.orgId);
    if (semanticHints.length > 0) {
      log.debug({ hints: semanticHints }, 'Semantic table hints detected');
      globalContextMsg += `\nSEMANTIC HINTS: Consider these tables that semantically match the query: ${semanticHints.join(', ')}\n`;
    }

    // 1.6 Pre-Generation Value Grounding: Ground proper nouns before decomposition
    const extractedTerms = extractPotentialEntities(naturalLanguageQuery);
    const allEntities = [...extractedTerms.entities, ...extractedTerms.potentialValues];
    if (allEntities.length > 0) {
      const groundingNotes = await buildDecomposerGroundingContext(allEntities, {
        orgId: options.orgId,
        timeoutMs: 2000, // Don't block for too long
      });
      if (groundingNotes) {
        log.debug({ entityCount: allEntities.length }, 'Value grounding notes generated');
        // Prepend grounding notes to the context so they appear first
        globalContextMsg = `${groundingNotes}\n${globalContextMsg}`;
      }
    }

    // 2. Decomposer Agent (or Ensemble)
    const plan = options.ensembleDecomposition
      ? await runDecomposerEnsemble(naturalLanguageQuery, options, globalContextMsg)
      : await runDecomposer(naturalLanguageQuery, options, globalContextMsg);

    // 2.5 Peripheral Vision: Expand plan with related tables
    const { expandedTables, peripheralContext } = await expandWithPeripheralVision(
      naturalLanguageQuery,
      plan.relevantTables,
      { orgId: options.orgId }
    );

    // Merge expanded tables into the plan (avoid duplicates)
    if (expandedTables.length > 0) {
      const existingTables = new Set(plan.relevantTables.map((t) => t.toLowerCase()));
      for (const table of expandedTables) {
        if (!existingTables.has(table.toLowerCase())) {
          plan.relevantTables.push(table);
          log.debug({ table }, 'Added peripheral table to plan');
        }
      }
    }

    // 3. Schema Pruning & Entity Classification
    const { prunedSchemaString, entityHints, contextObjects, totalFields } = await buildPrunedSchemaContext(
      naturalLanguageQuery,
      plan,
      options
    );

    // Inject peripheral context into schema string for Coder visibility
    const fullSchemaContext = peripheralContext
      ? `${peripheralContext}\n\n${prunedSchemaString}`
      : prunedSchemaString;

    // 4. Coder Agent
    return await runCoder(naturalLanguageQuery, plan, fullSchemaContext, entityHints, contextObjects, totalFields, options);

  } catch (error) {
    log.error({ err: error }, 'Error generating SOQL');
    throw new Error(`Failed to generate SOQL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// === Semantic RAG Helper ===

/**
 * Get semantic table hints using vector search on table descriptions.
 * Cold-start safe: Returns empty array if embeddings aren't available.
 */
async function getSemanticTableHints(query: string, orgId?: string): Promise<string[]> {
  try {
    const { createSemanticSearchService, createSemanticGraphExecutor } = await import('./semantic/index.js');
    
    const graphExecutor = createSemanticGraphExecutor(orgId);
    const semanticService = createSemanticSearchService(graphExecutor);
    
    if (!(await semanticService.isVectorSearchAvailable())) {
      log.debug('Vector search not available, skipping semantic hints');
      return [];
    }
    
    const results = await semanticService.findObjects(query, { topK: 5 });
    return results.map(r => r.apiName);
  } catch (err) {
    log.debug({ err }, 'Semantic hints unavailable, continuing without');
    return [];
  }
}

// === Helper Functions ===

async function runDecomposer(
  query: string,
  options: GenerateSoqlOptions,
  globalContextMsg: string
): Promise<DecomposerPlan> {
  const { detectCapabilities } = await import('../mcp/index.js');
  const capabilities = await detectCapabilities();

  // Model Hierarchy: CLI > Task Config > Default Config
  const taskConfig = getLLMConfigForTask('decomposer');
  const modelToUse = options.decomposerModel || taskConfig.model || llmConfig.defaultParams.model;
  const providerToUse = options.provider || taskConfig.provider || llmConfig.defaultParams.provider;

  const decomposer = Agent.createWithInProcessTools({
    provider: providerToUse,
    model: modelToUse,
    systemPrompt: DECOMPOSER_PROMPT,
    capabilities,
    toolFilter: (tool) => [
      'list-objects', 'find-object', 'resolve-entity', 'mediate-query-intent', 'explore-relationships'
    ].includes(tool.name),
    verbose: true,
    onVerbose: (msg) => log.debug(`[Decomposer] ${msg}`)
  });

  try {
    await decomposer.initialize();
    const decomposerPrompt = `${globalContextMsg}\nRequest: "${query}"`;
    log.info({ decomposerPrompt }, 'Decomposer Prompt Sent');
    const response = await decomposer.chat(decomposerPrompt);
    
    // Parse Plan JSON
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
       log.error({ response }, 'Decomposer failed to return JSON plan');
       throw new Error('Decomposer failed to return JSON plan');
    }
    
    const rawPlan = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    
    // Sanitize plan to ensure arrays exist
    const plan: DecomposerPlan = {
      summary: rawPlan.summary || 'No summary provided',
      relevantTables: Array.isArray(rawPlan.relevantTables) ? rawPlan.relevantTables : [],
      relevantColumns: Array.isArray(rawPlan.relevantColumns) ? rawPlan.relevantColumns : [],
      joinLogic: rawPlan.joinLogic,
      globalContext: rawPlan.globalContext
    };

    log.info({ plan }, 'Decomposer Plan Created');
    return plan;
  } finally {
    await decomposer.disconnect();
  }
}

/**
 * Run Decomposer 3 times in parallel with varied prompts, then union the results.
 * This increases recall by capturing tables that any single run might miss.
 * 
 * Trade-off: 3x LLM API calls, but it's safer to over-fetch than under-fetch.
 */
async function runDecomposerEnsemble(
  query: string,
  options: GenerateSoqlOptions,
  globalContextMsg: string
): Promise<DecomposerPlan> {
  log.info('Running ensemble decomposition (3 parallel runs)');
  
  // Run 3 decomposers with slightly varied prompts
  const variations = [
    globalContextMsg,                                                    // Standard
    globalContextMsg + '\nFocus on finding ALL related tables, even indirect ones.',  // Expansive
    globalContextMsg + '\nBe thorough - consider junction objects and parent lookups.',  // Thorough
  ];
  
  const runs = await Promise.allSettled(
    variations.map((contextMsg) => runDecomposer(query, options, contextMsg))
  );
  
  // Collect successful results
  const successfulPlans = runs
    .filter((r): r is PromiseFulfilledResult<DecomposerPlan> => r.status === 'fulfilled')
    .map(r => r.value);
  
  if (successfulPlans.length === 0) {
    log.warn('All ensemble runs failed, falling back to single run');
    return runDecomposer(query, options, globalContextMsg);
  }
  
  // Union all relevantTables and relevantColumns
  const mergedTables = [...new Set(successfulPlans.flatMap(p => p.relevantTables))];
  const mergedColumns = [...new Set(successfulPlans.flatMap(p => p.relevantColumns))];
  
  log.info({ tableCount: mergedTables.length, tables: mergedTables }, 'Ensemble decomposition merged tables');
  
  return {
    summary: successfulPlans[0].summary,
    relevantTables: mergedTables,
    relevantColumns: mergedColumns,
    joinLogic: successfulPlans[0].joinLogic,
    globalContext: successfulPlans[0].globalContext,
  };
}

async function buildPrunedSchemaContext(
  query: string,
  plan: DecomposerPlan,
  options: GenerateSoqlOptions
): Promise<{ prunedSchemaString: string; entityHints: string; contextObjects: string[]; totalFields: number }> {
  const contextObjects: string[] = plan.relevantTables || [];
  const maxFieldsPerObject = options.maxFieldsPerObject || 15;
  const enableChessPruning = options.enableChessPruning !== false; // Default ON
  const enableDraftPhase = shouldRunDraftPhase(options.enableDraftPhase);

  let prunedSchemaString = '';
  let totalFields = 0;

  // Parallel fetch: entity classification and object validation
  const [classifiedEntities, ...schemaObjects] = await Promise.all([
    classifyEntities(extractPotentialEntities(query).entities, { orgId: options.orgId, contextObjects }),
    ...contextObjects.map(objName => getObjectByApiName(objName, { orgId: options.orgId }))
  ]);

  // Filter to only objects that actually exist in the graph
  const validObjects: GraphObject[] = [];
  schemaObjects.forEach((obj, index) => {
    if (obj) {
      validObjects.push(obj);
    } else {
        log.warn(`Decomposer requested table "${contextObjects[index]}" but it was not found in the graph (Org: ${options.orgId}). It will be excluded from the schema context.`);
    }
  });

  // RECOVERY: If plan yielded no valid objects (e.g. hallucinated or missing tables), try to recover from query entities
  if (validObjects.length === 0) {
    log.warn('No valid objects found from Decomposer plan. Attempting recovery from classified entities.');
    const potentialObjects = classifiedEntities
      .filter(e => e.type === 'object_reference' && e.matchedObject)
      .map(e => e.matchedObject!);
    
    // De-duplicate
    const uniqueObjects = [...new Set(potentialObjects)];
    
    if (uniqueObjects.length > 0) {
       log.info({ recoveredObjects: uniqueObjects }, 'Recovered objects from entity classification');
       const recovered = await Promise.all(uniqueObjects.map(name => getObjectByApiName(name, { orgId: options.orgId })));
       recovered.forEach(obj => {
         if (obj) validObjects.push(obj);
       });
    }
  }

  const validObjectNames = validObjects.map(o => o.apiName);

  if (validObjects.length > 0) {
    // Fetch ALL fields for each object (needed for validation and fallback)
    const objectsWithAllFieldsRaw = await Promise.all(
      validObjects.map(async (obj) => {
        const fields = await getObjectFields(obj.apiName, { orgId: options.orgId });
        return { ...obj, fields };
      })
    );

    // Filter out objects with no fields (likely sync failures or disabled features)
    const objectsWithAllFields = objectsWithAllFieldsRaw.filter(obj => {
         if (!obj.fields || obj.fields.length === 0) {
             log.warn(`Object ${obj.apiName} exists but has 0 fields. Excluding from schema context.`);
             return false;
         }
         return true;
    });

    // Build validFieldsByTable map for token validation
    const validFieldsByTable = new Map<string, Set<string>>();
    for (const obj of objectsWithAllFields) {
      validFieldsByTable.set(obj.apiName, new Set(obj.fields.map(f => f.apiName)));
    }

    // === FIELD PRUNING STRATEGIES ===

    // Strategy 1: CHESS (Scoped Vector Search) - Default ON
    let chessFields = new Map<string, string[]>();
    if (enableChessPruning) {
      try {
        const chessResults = await searchFieldsScoped({
          targetTables: validObjectNames,
          maxFieldsPerTable: maxFieldsPerObject,
          query,
          orgId: options.orgId,
        });
        for (const result of chessResults) {
          chessFields.set(result.objectApiName, result.fields);
        }
        log.debug({ tableCount: chessFields.size }, 'CHESS field pruning completed');
      } catch (err) {
        log.warn({ err }, 'CHESS field pruning failed, using fallback');
      }
    }

    // Strategy 2: RSL-SQL Draft Phase (Opt-in)
    let draftFields = new Map<string, string[]>();
    if (enableDraftPhase) {
      // Build a larger schema context for the draft model
      const largeSchemaContext = objectsWithAllFields.map(obj => {
        return `OBJECT: ${obj.apiName} (${obj.label})\nFIELDS:\n` +
          obj.fields.slice(0, 50).map(f => `  - ${f.apiName} (${f.type})`).join('\n');
      }).join('\n\n');

      const draftResult = await runDraftPhase({
        query,
        schemaContext: largeSchemaContext,
        relevantTables: validObjectNames,
        validFieldsByTable,
        orgId: options.orgId,
        provider: options.provider,
      });

      if (draftResult.success) {
        draftFields = draftResult.extractedColumns;
        log.debug({ tableCount: draftFields.size }, 'RSL-SQL draft phase completed');
      }
    }

    // Strategy 3: Lexical (Keyword) Scoring - Always runs for fallback recall
    // This ensures exact field name matches are captured even if semantic search misses them
    const lexicalFields = new Map<string, string[]>();
    for (const obj of objectsWithAllFields) {
      const ranked = rankFieldsByLexicalRelevance(obj.fields, query, maxFieldsPerObject);
      if (ranked.length > 0) {
        lexicalFields.set(obj.apiName, ranked);
      }
    }
    log.debug({ tableCount: lexicalFields.size }, 'Lexical field scoring completed');

    // === MERGE STRATEGIES (Priority-Ordered Union) ===
    const finalFields = mergeFieldStrategies(
      chessFields,
      draftFields,
      lexicalFields,
      validObjectNames,
      validFieldsByTable,
      maxFieldsPerObject
    );

    // Build schema string with pruned fields only
    prunedSchemaString = objectsWithAllFields.map(obj => {
      const prunedFieldNames = finalFields.get(obj.apiName) || [...CORE_FIELDS];
      const prunedFields = obj.fields.filter(f => prunedFieldNames.includes(f.apiName));

      // If pruning returned fewer fields than expected, add some from the full list
      if (prunedFields.length < 4 && obj.fields.length > 0) {
        const additionalFields = obj.fields
          .filter(f => !prunedFieldNames.includes(f.apiName))
          .slice(0, maxFieldsPerObject - prunedFields.length);
        prunedFields.push(...additionalFields);
      }

      return `OBJECT: ${obj.apiName} (${obj.label})\nFIELDS:\n` +
        prunedFields.map(f => `  - ${f.apiName} (${f.type})`).join('\n');
    }).join('\n\n');

    totalFields = [...finalFields.values()].reduce((sum, fields) => sum + fields.length, 0);

    log.info(
      {
        originalFieldCount: objectsWithAllFields.reduce((sum, obj) => sum + obj.fields.length, 0),
        prunedFieldCount: totalFields,
        chessPruning: enableChessPruning,
        draftPhase: enableDraftPhase,
      },
      'Field pruning completed'
    );

    // === NEIGHBORHOOD EXPANSION: Add lightweight neighbor metadata for "peripheral vision" ===
    const neighborSummaries = await Promise.all(
      validObjectNames.map(async (objName) => {
        const neighbors = await get1HopNeighborSummaries(objName, { orgId: options.orgId, limit: 15 });
        return { objectName: objName, neighbors };
      })
    );

    const neighborSection = neighborSummaries
      .filter(ns => ns.neighbors.length > 0)
      .map(ns => {
        const neighborList = ns.neighbors
          .map(n => `  - ${n.apiName} (via ${n.relationshipName || n.fieldApiName || 'relationship'})`)
          .join('\n');
        return `\nRELATED TO ${ns.objectName} (use if needed):\n${neighborList}`;
      })
      .join('\n');

    if (neighborSection) {
      prunedSchemaString += '\n' + neighborSection;
    }
  }

  const entityHints = classifiedEntities
    .filter(e => e.confidence > 0.6 && e.suggestedPatterns.length > 0)
    .map(e => `FILTER HINT: For "${e.value}", use: ${e.suggestedPatterns[0].pattern}`)
    .join('\n');

  // Return only validated object names, not the full plan.relevantTables
  return { prunedSchemaString, entityHints, contextObjects: validObjectNames, totalFields };
}

/**
 * Merge CHESS, Draft, and Lexical field sets using Priority-Ordered Union strategy.
 *
 * Priority order (highest to lowest):
 * 1. Core fields: Always included (query viability)
 * 2. CHESS fields: Semantic vector search (high precision)
 * 3. Draft fields: LLM-extracted from draft SOQL (high precision)
 * 4. Lexical fields: Keyword matching (high recall, fills remaining slots)
 *
 * Note: We use Union (not Intersection) to avoid context starvation
 * when any single strategy misses fields. Lexical fields only fill
 * remaining slots after CHESS and Draft to prevent crowding out
 * semantic hits with low-value keyword matches.
 */
function mergeFieldStrategies(
  chessFields: Map<string, string[]>,
  draftFields: Map<string, string[]>,
  lexicalFields: Map<string, string[]>,
  tables: string[],
  validFieldsByTable: Map<string, Set<string>>,
  maxFieldsPerObject: number
): Map<string, string[]> {
  const merged = new Map<string, Set<string>>();

  // Step 1: Initialize with CORE_FIELDS for each table
  for (const table of tables) {
    const validFields = validFieldsByTable.get(table) || new Set();
    const initialFields = new Set<string>();

    // Add core fields that exist in this table's schema
    for (const core of CORE_FIELDS) {
      if (validFields.has(core)) {
        initialFields.add(core);
      }
    }

    merged.set(table, initialFields);
  }

  // Step 2: Add CHESS Fields (Scoped Vector Search) - High Precision Semantic
  for (const [table, fields] of chessFields.entries()) {
    const tableFields = merged.get(table);
    if (tableFields) {
      for (const field of fields) {
        tableFields.add(field);
      }
    }
  }

  // Step 3: Add Draft Fields (LLM-extracted) - High Precision
  for (const [table, fields] of draftFields.entries()) {
    const tableFields = merged.get(table);
    if (tableFields) {
      for (const field of fields) {
        tableFields.add(field);
      }
    }
  }

  // Step 4: Add Lexical Fields - Only if slots remain (High Recall, Lower Priority)
  // This prevents low-value lexical matches from crowding out semantic hits
  for (const [table, fields] of lexicalFields.entries()) {
    const tableFields = merged.get(table);
    if (tableFields && tableFields.size < maxFieldsPerObject) {
      const remainingSlots = maxFieldsPerObject - tableFields.size;
      const lexicalToAdd = fields.filter((f) => !tableFields.has(f)).slice(0, remainingSlots);
      for (const field of lexicalToAdd) {
        tableFields.add(field);
      }
    }
  }

  // Convert to arrays and apply max limit (safety check)
  const result = new Map<string, string[]>();
  for (const [table, fieldSet] of merged.entries()) {
    const fields = Array.from(fieldSet);
    result.set(table, fields.slice(0, maxFieldsPerObject));
  }

  return result;
}

async function runCoder(
  query: string,
  plan: DecomposerPlan,
  prunedSchemaString: string,
  entityHints: string,
  contextObjects: string[],
  totalFields: number,
  options: GenerateSoqlOptions
): Promise<SoqlGenerationResult> {
  const { detectCapabilities } = await import('../mcp/index.js');
  const capabilities = await detectCapabilities();

  // Fetch few-shot examples (singleton, cold-start safe)
  let systemPrompt = CODER_PROMPT;
  if (!options.skipFewShot) {
    try {
      const fewShotService = FewShotExampleService.getInstance();
      const examples = await fewShotService.findSimilarExamples(
        query, 
        options.exampleCount ?? 3,
        options.onFewShotProgress
      );
      
      if (examples.length > 0) {
        const exampleBlock = fewShotService.formatExamplesForPrompt(examples);
        systemPrompt = systemPrompt.replace(
          '{FEW_SHOT_EXAMPLES}',
          `### Few-Shot Examples\nUse these similar queries as reference for syntax and logic:\n${exampleBlock}`
        );
        log.debug({ count: examples.length }, 'Injected few-shot examples into prompt');
      } else {
        // Remove placeholder entirely when no examples
        systemPrompt = systemPrompt.replace('{FEW_SHOT_EXAMPLES}', '');
      }
    } catch (err) {
      log.warn({ err }, 'Failed to fetch few-shot examples, continuing without');
      systemPrompt = systemPrompt.replace('{FEW_SHOT_EXAMPLES}', '');
    }
  } else {
    systemPrompt = systemPrompt.replace('{FEW_SHOT_EXAMPLES}', '');
  }

  const taskConfig = getLLMConfigForTask('coder');
  const modelToUse = options.model || taskConfig.model || llmConfig.defaultParams.model;
  const providerToUse = options.provider || taskConfig.provider || llmConfig.defaultParams.provider;

  const coder = Agent.createWithInProcessTools({
    provider: providerToUse,
    model: modelToUse,
    systemPrompt,
    capabilities,
    toolFilter: (tool) => [
      'validate-soql', 'explore-relationships'
    ].includes(tool.name),
    verbose: true,
    onVerbose: (msg) => log.debug(`[Coder] ${msg}`)
  });

  try {
    await coder.initialize();
    
    const coderPrompt = `
PLAN SUMMARY: ${plan.summary}
RELEVANT TABLES: ${plan.relevantTables.join(', ')}
${entityHints ? `\nENTITY HINTS:\n${entityHints}` : ''}
${prunedSchemaString ? `\nPRUNED SCHEMA CONTEXT:\n${prunedSchemaString}` : ''}

Request: "${query}"
Generate the SOQL now.
    `;

    let attempts = 0;
    const MAX_RETRIES = 3;
    let lastValidation: Awaited<ReturnType<typeof validateAndCorrectSoqlEnhanced>> | null = null;
    let currentSoql: string | null = null;
    let finalContextObjects = contextObjects; // Track final context including expansions
    let finalTotalFields = totalFields;

    // Recovery Tracker: Prevents infinite loops by limiting schema expansions per entity type
    const recoveryTracker = {
      resolvedObjects: new Set<string>(), // Objects already injected
      resolvedRelationships: new Set<string>(), // Relationships already injected
      objectAttempts: 0, // Max 2
      relationshipAttempts: 0, // Max 2
      MAX_PER_TYPE: 2,
    };

    while (attempts <= MAX_RETRIES) {
      attempts++;
      log.debug({ attempt: attempts }, 'Requesting SOQL from Coder...');

      const response = await coder.chat(coderPrompt);
      currentSoql = extractSoqlBlock(response);

      if (!currentSoql) {
        await coder.chat('ERROR: No valid SOQL block found. Please output ```soql ... ```');
        continue;
      }

      lastValidation = await validateAndCorrectSoqlEnhanced(currentSoql, options.orgId);

      if (lastValidation.isValid) {
        break;
      }

      const errorMessages = lastValidation.messages.filter((m) => m.type === 'error');

      // === FEEDBACK LOOP: Attempt to expand schema if missing object detected ===
      const missingEntity = extractMissingEntityFromErrors(errorMessages);
      if (missingEntity) {
        // Check if we've already tried to resolve this entity
        const entityKey = `${missingEntity.type}:${missingEntity.name.toLowerCase()}`;
        const alreadyResolved =
          missingEntity.type === 'relationship'
            ? recoveryTracker.resolvedRelationships.has(entityKey)
            : recoveryTracker.resolvedObjects.has(entityKey);

        if (alreadyResolved) {
          log.debug({ entity: missingEntity.name }, 'Entity already resolved, skipping');
        } else {
          // Check if we've hit the max attempts for this entity type
          const atMaxAttempts =
            missingEntity.type === 'relationship'
              ? recoveryTracker.relationshipAttempts >= recoveryTracker.MAX_PER_TYPE
              : recoveryTracker.objectAttempts >= recoveryTracker.MAX_PER_TYPE;

          if (atMaxAttempts) {
            log.warn(
              { entity: missingEntity.name, type: missingEntity.type },
              'Max recovery attempts reached for entity type'
            );
          } else {
            const resolvedObject = await resolveMissingEntity(missingEntity.name, options.orgId);

            if (resolvedObject && !plan.relevantTables.includes(resolvedObject)) {
              plan.relevantTables.push(resolvedObject);
              const expanded = await buildPrunedSchemaContext(query, plan, options);

              // Track this resolution
              if (missingEntity.type === 'relationship') {
                recoveryTracker.resolvedRelationships.add(entityKey);
                recoveryTracker.relationshipAttempts++;
              } else {
                recoveryTracker.resolvedObjects.add(entityKey);
                recoveryTracker.objectAttempts++;
              }

              log.info(
                {
                  missingEntity: missingEntity.name,
                  type: missingEntity.type,
                  resolved: resolvedObject,
                  recoveryAttempts: {
                    objects: recoveryTracker.objectAttempts,
                    relationships: recoveryTracker.relationshipAttempts,
                  },
                },
                'Expanded plan with missing entity'
              );

              // CRITICAL: Inject the NEW schema into the chat so the LLM sees it
              const entityTypeLabel =
                missingEntity.type === 'relationship' ? 'Relationship' : 'Object';
              await coder.chat(
                `CORRECTION CONTEXT:\n` +
                  `- Error: ${entityTypeLabel} "${missingEntity.name}" was not found` +
                  (missingEntity.context ? ` on ${missingEntity.context}` : '') +
                  `\n` +
                  `- Resolution: Resolved to object "${resolvedObject}"\n` +
                  `- Schema for ${resolvedObject}:\n\n${expanded.prunedSchemaString}\n\n` +
                  `Please regenerate the query using this new schema information.\n` +
                  `Validation Errors:\n${errorMessages.map((e) => e.message).join('\n')}`
              );
              finalContextObjects = expanded.contextObjects; // Update tracked context
              finalTotalFields = expanded.totalFields;
              continue;
            }
          }
        }
      }
      
      // Standard error without schema expansion
      await coder.chat(`ERROR: Invalid SOQL.\n${errorMessages.map(e => e.message).join('\n')}\nPlease fix.`);
    }

    if (!currentSoql || !lastValidation) {
      throw new Error('Failed to generate valid SOQL after retries');
    }

    return {
      soql: lastValidation.soql,
      isValid: lastValidation.isValid,
      draftSoql: currentSoql,
      validation: lastValidation,
      mainObject: lastValidation.parsed?.mainObject || 'Unknown',
      contextStats: { objectCount: finalContextObjects.length, totalFields: finalTotalFields }
    };

  } finally {
    await coder.disconnect();
  }
}

export { validateAndCorrectSoqlEnhanced } from './soql-validator.js';

/**
 * SOQL Draft Phase Service (RSL-SQL Strategy)
 *
 * Uses a fast model to generate a "draft" SOQL query,
 * then extracts the columns actually used to further prune the schema.
 *
 * This implements the RSL-SQL (Backward Pruning) strategy:
 * 1. Fast model generates rough SOQL structure
 * 2. Token-based extraction captures fields (tolerates syntax errors)
 * 3. Validates tokens against known schema fields
 * 4. Returns only fields that the LLM actually tried to use
 */

import { Agent } from '../agent/index.js';
import { getLLMConfigForTask, llmConfig } from '../config/llm-config.js';
import {
  extractColumnsLoose,
  extractMainObject,
  mergeWithCoreFields,
  CORE_FIELDS,
} from './soql-draft-utils.js';
import { createLogger } from '../core/index.js';
import type { LlmProviderType } from '../llm/types.js';

const log = createLogger('soql-draft-phase');

/**
 * System prompt for the draft phase.
 * Emphasizes quick, rough output over perfection.
 */
const DRAFT_PROMPT = `You are a SOQL query assistant. Given a natural language query and a schema, write a QUICK DRAFT of the SOQL query.

IMPORTANT: This is a DRAFT. Don't worry about perfect syntax. Focus on:
1. Identifying the correct fields to SELECT
2. Identifying the correct objects in FROM
3. Basic WHERE clause structure

Output ONLY the SOQL query, no explanations. It's okay if it has minor syntax issues.`;

/**
 * Options for the draft phase.
 */
export interface DraftPhaseOptions {
  /** Original natural language query */
  query: string;
  /** Schema context (CHESS-pruned or larger initial context) */
  schemaContext: string;
  /** Tables identified by Decomposer */
  relevantTables: string[];
  /** Valid fields per table (for token validation) */
  validFieldsByTable: Map<string, Set<string>>;
  /** Provider override */
  provider?: LlmProviderType;
  /** Model override (default: fast model from 'draft' or 'decomposer' config) */
  model?: string;
  /** Org ID for multi-org support */
  orgId?: string;
}

/**
 * Result of the draft phase.
 */
export interface DraftPhaseResult {
  /** The draft SOQL (may have syntax errors) */
  draftSoql: string;
  /** Extracted and validated columns per table */
  extractedColumns: Map<string, string[]>;
  /** Whether draft phase succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Execution time in milliseconds */
  durationMs?: number;
}

/**
 * Run the draft phase using a fast model.
 *
 * Flow:
 * 1. Fast model (e.g., qwen2.5:3b) generates draft SOQL
 * 2. extractColumnsLoose() extracts fields using token-based approach
 * 3. Validates tokens against known schema fields
 * 4. Merges with CORE_FIELDS
 * 5. Returns pruned column set for strong model
 *
 * @param options - Draft phase configuration
 * @returns Draft phase result with extracted columns
 */
export async function runDraftPhase(
  options: DraftPhaseOptions
): Promise<DraftPhaseResult> {
  const { query, schemaContext, relevantTables, validFieldsByTable } = options;
  const startTime = Date.now();

  // Get fast model config - try 'draft' task first, fall back to 'decomposer'
  let taskConfig = getLLMConfigForTask('draft');
  // If 'draft' doesn't exist in taskParams, it will fall back to defaults
  // So we check if the model looks like a fallback and use decomposer instead
  if (!taskConfig.model || taskConfig.model === llmConfig.defaultParams.model) {
    taskConfig = getLLMConfigForTask('decomposer');
  }

  const model = options.model || taskConfig.model || 'qwen2.5:3b';
  const provider = options.provider || taskConfig.provider || 'ollama';

  log.debug(
    { model, provider, tableCount: relevantTables.length },
    'Starting draft phase'
  );

  try {
    // Create a minimal agent with no tools (just generation)
    // Empty capabilities + no-op toolFilter ensures no tools are provided
    const draftAgent = Agent.createWithInProcessTools({
      provider,
      model,
      systemPrompt: DRAFT_PROMPT,
      capabilities: {}, // Empty capabilities
      toolFilter: () => false, // Filter out all tools - draft only generates text
      verbose: false,
    });

    await draftAgent.initialize();

    // Build the prompt with schema context
    const prompt = `SCHEMA:
${schemaContext}

QUERY: "${query}"

Write a draft SOQL query:`;

    const response = await draftAgent.chat(prompt);
    await draftAgent.disconnect();

    // Extract the draft SOQL from the response
    // Handle cases where the model wraps it in a code block
    let draftSoql = response.trim();
    const codeBlockMatch = draftSoql.match(/```(?:soql|sql)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      draftSoql = codeBlockMatch[1].trim();
    }

    // Extract columns using token-based approach (validates against schema)
    const extractedColumns = new Map<string, string[]>();

    // Determine main object from draft
    const mainObject = extractMainObject(draftSoql);

    // For each table we know about, extract its fields from the draft
    for (const tableName of relevantTables) {
      const validFields = validFieldsByTable.get(tableName);
      if (!validFields || validFields.size === 0) {
        // No known fields for this table, use core fields as fallback
        extractedColumns.set(tableName, [...CORE_FIELDS]);
        continue;
      }

      // Extract columns that match valid fields
      const extracted = extractColumnsLoose(draftSoql, validFields);

      // Merge with core fields
      const merged = mergeWithCoreFields(extracted, validFields);

      extractedColumns.set(tableName, merged);
    }

    const durationMs = Date.now() - startTime;

    log.info(
      {
        mainObject,
        extractedTables: [...extractedColumns.keys()],
        fieldCounts: Object.fromEntries(
          [...extractedColumns.entries()].map(([k, v]) => [k, v.length])
        ),
        durationMs,
      },
      'Draft phase completed'
    );

    return {
      draftSoql,
      extractedColumns,
      success: true,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    log.warn(
      { error, durationMs },
      'Draft phase failed, CHESS pruning will be used alone'
    );

    return {
      draftSoql: '',
      extractedColumns: new Map(),
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    };
  }
}

/**
 * Check if draft phase should be run based on options and configuration.
 *
 * @param enableDraftPhase - Explicit option from GenerateSoqlOptions
 * @returns Whether to run the draft phase
 */
export function shouldRunDraftPhase(enableDraftPhase?: boolean): boolean {
  // Draft phase is opt-in by default
  // Only run if explicitly enabled
  return enableDraftPhase === true;
}

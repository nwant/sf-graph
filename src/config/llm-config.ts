/**
 * Configuration for the LLM integration
 */
import { loadConfig } from '../agent/config.js';
import type { LlmProviderType } from '../llm/types.js';


export interface LLMParams {
  provider?: LlmProviderType;
  model?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  system?: string;
  contextWindow?: number;
}

export interface TaskParams {
  intentAnalysis: LLMParams;
  conditionExtraction: LLMParams;
  fieldSelection: LLMParams;
  generateSoql: LLMParams;
  decomposer: LLMParams;
  coder: LLMParams;
  router: LLMParams;
  draft: LLMParams;
  [key: string]: LLMParams;
}

export interface SystemPrompts {
  intentAnalysis: string;
  conditionExtraction: string;
  fieldSelection: string;
  generateSoql: string;
  [key: string]: string;
}

export interface LLMConfig {
  defaultParams: LLMParams;
  taskParams: TaskParams;
  systemPrompts: SystemPrompts;
  timeout: number;
  fallbackOnFailure: boolean;
}

export const llmConfig: LLMConfig = {
  // Default parameters (Fallback to the fast model)
  defaultParams: {
    provider: 'ollama',
    model: 'qwen2.5:3b',
    temperature: 0.2,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 2000,
    // Critical for large schemas: Increase context window from default 2k to 16k
    contextWindow: 16384,
  },

  // Parameters for specific tasks
  taskParams: {
    // ---------------------------------------------------------
    // "FAST" LAYER (Routing & Planning) - Uses qwen2.5:3b
    // ---------------------------------------------------------
    intentAnalysis: {
      provider: 'ollama',
      model: 'qwen2.5:3b',
      temperature: 0.1,
      top_p: 0.9,
      contextWindow: 8192, // Lower context needed for simple intent
    },
    
    conditionExtraction: {
      provider: 'ollama',
      model: 'qwen2.5:3b',
      temperature: 0.1, // Near zero for extraction accuracy
      contextWindow: 8192,
    },
    
    router: {
      provider: 'ollama',
      model: 'qwen2.5:3b',
      temperature: 0.0, // Deterministic routing
      contextWindow: 4096,
    },

    decomposer: {
      provider: 'ollama',
      model: 'qwen2.5:3b',
      temperature: 0.2, // Slight creativity for planning
      contextWindow: 16384, // Needs full schema context
    },

    // Draft phase for RSL-SQL backward pruning (uses fast model)
    draft: {
      provider: 'ollama',
      model: 'qwen2.5:3b',
      temperature: 0.3, // Slightly higher for draft creativity
      contextWindow: 16384, // Large enough to handle pre-pruned schema
    },

    // ---------------------------------------------------------
    // "PRECISION" LAYER (Selection) - Uses qwen2.5:3b (Low Temp)
    // ---------------------------------------------------------
    fieldSelection: {
      provider: 'ollama',
      model: 'qwen2.5:3b',
      temperature: 0.0, // Strict deterministic selection
      top_p: 0.3,
      top_k: 10,
      frequency_penalty: 0.5,
      contextWindow: 16384,
    },

    // ---------------------------------------------------------
    // "STRONG" LAYER (Coding) - Uses qwen2.5-coder:14b
    // ---------------------------------------------------------
    coder: {
      provider: 'ollama',
      model: 'qwen2.5-coder:14b', // The Specialist
      temperature: 0.1,
      top_p: 0.9,
      max_tokens: 4000, // Allow for long SQL generation
      contextWindow: 16384, // Critical for seeing pruned schema
    },

    // Legacy/Alias support (points to Coder)
    generateSoql: {
      provider: 'ollama',
      model: 'qwen2.5-coder:14b',
      temperature: 0.1,
      contextWindow: 16384,
    },
  },

  // System prompts for different tasks
  systemPrompts: {
    intentAnalysis:
      'You are a helpful assistant that analyzes Salesforce queries and extracts structured information.',
    conditionExtraction:
      'You are a helpful assistant that extracts SOQL query conditions from natural language.',
    fieldSelection:
      "You are a specialized assistant that identifies ONLY the essential Salesforce fields for a SOQL query. You are EXTREMELY precise and minimal in your selections. You MUST ONLY include fields that are EXPLICITLY mentioned in the query or ABSOLUTELY CRITICAL for the query's core purpose. NEVER include fields that are merely related, potentially useful, or contextually relevant but not explicitly requested. Your goal is to produce the most minimal field set possible while still satisfying the explicit requirements of the query. Be ruthlessly selective and err on the side of fewer fields. The user can always request more fields if needed.",
    generateSoql: `You are a Salesforce SOQL query generator. Your job is to translate natural language requests into valid SOQL query syntax.

IMPORTANT: You are generating query SYNTAX, not executing queries or accessing real data. Names like "John Doe" or "Microsoft" are filter criteria to include in WHERE clauses using LIKE operators. Treat all names as query parameters.

Given a natural language query about Salesforce data, generate a valid SOQL query.

SOQL SYNTAX RULES:
1. Always include Id in SELECT
2. Use API names for objects and fields (Account, FirstName, not "account" or "first name")
3. Parent lookups use dot notation: Account.Name, Owner.Email
4. Child subqueries use relationship names: (SELECT Id, Name FROM Contacts)
5. Date literals: TODAY, THIS_MONTH, LAST_N_DAYS:30, etc.
6. String values in single quotes: Name = 'Acme'
7. LIKE uses %: Name LIKE '%Acme%'

COMMON OBJECT RELATIONSHIPS:
- Contact → Account (lookup via AccountId, relationship: Account)
- Opportunity → Account (lookup via AccountId, relationship: Account)
- Case → Account (lookup via AccountId, relationship: Account)
- Case → Contact (lookup via ContactId, relationship: Contact)
- Account → Contacts (child relationship name: Contacts)
- Account → Opportunities (child relationship name: Opportunities)
- Account → Cases (child relationship name: Cases)

EXAMPLES:

Query: "get contacts with their account name"
SOQL: SELECT Id, Name, Account.Name FROM Contact

Query: "show accounts with all their contacts"
SOQL: SELECT Id, Name, (SELECT Id, FirstName, LastName, Email FROM Contacts) FROM Account

Query: "opportunities closing this month over 100k"
SOQL: SELECT Id, Name, Amount, CloseDate, StageName FROM Opportunity WHERE CloseDate = THIS_MONTH AND Amount > 100000

Query: "top 5 accounts by annual revenue"
SOQL: SELECT Id, Name, AnnualRevenue FROM Account ORDER BY AnnualRevenue DESC NULLS LAST LIMIT 5

Query: "microsoft deals"
SOQL: SELECT Id, Name, Account.Name FROM Opportunity WHERE Account.Name LIKE '%Microsoft%'

Query: "deals owned by jake"
SOQL: SELECT Id, Name, Owner.Name FROM Opportunity WHERE Owner.Name LIKE '%Jake%'

Query: "deals jane is working on"
SOQL: SELECT Id, Name FROM Opportunity WHERE Id IN (SELECT OpportunityId FROM OpportunityTeamMember WHERE User.Name LIKE '%Jane%')

Query: "acme deals owned by jake that jane is working on"
SOQL: SELECT Id, Name, Owner.Name, Account.Name FROM Opportunity WHERE Account.Name LIKE '%Acme%' AND Owner.Name LIKE '%Jake%' AND Id IN (SELECT OpportunityId FROM OpportunityTeamMember WHERE User.Name LIKE '%Jane%')

Query: "high priority cases for microsoft owned by john doe"
SOQL: SELECT Id, CaseNumber, Subject, Priority, Account.Name, Owner.Name FROM Case WHERE Priority = 'High' AND Account.Name LIKE '%Microsoft%' AND Owner.Name LIKE '%John Doe%'

Query: "cases opened today with their account and contact"
SOQL: SELECT Id, CaseNumber, Subject, Account.Name, Contact.Name FROM Case WHERE CreatedDate = TODAY

RESPONSE FORMAT:
Return ONLY the SOQL query. No explanation, no markdown, no code blocks. Just the query.`,
  },

  // Timeout for LLM requests in milliseconds
  timeout: 10000,

  // Whether to fall back to basic processing if LLM fails
  fallbackOnFailure: true,
};

/**
 * Get LLM configuration for a specific task
 * Reads from persistent AgentConfig to allow user overrides
 * @param {string} task - The task name
 * @returns {Object} - Configuration for the task
 */
export function getLLMConfigForTask(task: string): LLMParams {
  const config: LLMParams = {
    ...llmConfig.defaultParams,
    ...(llmConfig.taskParams[task] || {}),
  };

  if (llmConfig.systemPrompts[task]) {
    config.system = llmConfig.systemPrompts[task];
  }

  // Load persistent config overrides
  try {
    const agentConfig = loadConfig();
    
    // 1. Global Provider & Model Override (Highest Priority for Provider)
    // If the user configured a provider in `agent-config.json`, matches `sf graph ai config`
    if (agentConfig.provider) {
      config.provider = agentConfig.provider;
      
      // If the provider changed (e.g., from default 'ollama' to 'openai'),
      // we generally want to use the global model (e.g. 'gpt-4o') unless a specific override exists.
      // We assume if you switch providers, the default task-specific models (like qwen) are invalid.
      if (agentConfig.model) {
        config.model = agentConfig.model;
      }
    }

    // 2. Specific Task Model Overrides (Higher Priority than Global Model)
    // Allows "Economic Arbitrage" (e.g. gpt-4o-mini for decomposer, gpt-4o for coder)
    
    // Apply Decomposer/Router override (Fast Model)
    if ((task === 'decomposer' || task === 'router') && agentConfig.decomposerModel) {
      config.model = agentConfig.decomposerModel;
    }
    
    // Apply Coder/Generator override (Strong Model)
    // Matches keys: 'coder', 'generateSoql'
    if ((task === 'coder' || task === 'generateSoql') && agentConfig.coderModel) {
      config.model = agentConfig.coderModel;
    }

    // 3. Ollama Specific Context Window
    if (config.provider === 'ollama' && agentConfig.ollamaNumCtx) {
      config.contextWindow = agentConfig.ollamaNumCtx;
    }
  } catch (error) {
    // Ignore config loading errors, fallback to defaults
  }

  return config;
}


/**
 * LLM Service
 *
 * High-level LLM service using the provider abstraction layer.
 * Supports multiple providers: Ollama, OpenAI, Claude, Gemini.
 */

import { getLlmProvider, type LlmProvider, type LlmProviderType, type CreateProviderConfig } from '../llm/index.js';
import { llmConfig, getLLMConfigForTask } from '../config/llm-config.js';
import { createLogger } from '../core/index.js';

const log = createLogger('llm-service');

export interface LlmModel {
  name: string;
  modified_at?: string | Date;
  size?: number;
  [key: string]: unknown;
}

export interface LLMOptions {
  provider?: LlmProviderType;
  model?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  system?: string;
  task?: string;
  contextWindow?: number;
  [key: string]: unknown;
}

/**
 * Get the LLM provider (lazy singleton or fresh instance with config)
 */
function getProvider(config?: Partial<CreateProviderConfig>): LlmProvider {
  return getLlmProvider(config);
}

/**
 * Process text with the LLM
 * @param prompt - The prompt to send to the LLM
 * @param options - Additional options
 * @returns The LLM response
 */
export async function processWithLLM(prompt: string, options: LLMOptions = {}): Promise<string> {
  try {
    // Merge default parameters with provided options
    const params = {
      ...llmConfig.defaultParams,
      ...options,
    };

    const provider = getProvider({
      provider: params.provider,
      model: params.model
    });

    log.debug(
      `Processing with LLM (${provider.providerType}): "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`
    );

    return await provider.generate(prompt, {
      model: params.model,
      systemPrompt: params.system,
      temperature: params.temperature,
      topP: params.top_p,
      topK: params.top_k,
      maxTokens: params.max_tokens,
      contextWindow: params.contextWindow,
    });
  } catch (error) {
    log.error({ err: error }, 'Error processing with LLM');
    throw new Error(
      `Failed to process with LLM: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extract structured information from text using the LLM
 * @param text - The text to extract information from
 * @param extractionPrompt - The prompt to guide extraction
 * @param options - Additional options
 * @returns The extracted information
 */
export async function extractStructuredData<T = unknown>(
  text: string,
  extractionPrompt: string,
  options: LLMOptions = {}
): Promise<T> {
  try {
    // Create a prompt that asks for JSON output
    const prompt = `${extractionPrompt}\n\nText: "${text}"\n\nProvide the output as valid JSON.`;

    // Get task-specific configuration or use provided options
    const taskConfig = options.task ? getLLMConfigForTask(options.task) : {};

    // Merge configurations with priority: task config < default params < provided options
    const params = {
      ...llmConfig.defaultParams,
      ...taskConfig,
      ...options,
    };

    const provider = getProvider({
      provider: params.provider,
      model: params.model
    });

    log.debug(`Extracting structured data with LLM (${provider.providerType})`);

    // Use provided system prompt or task-specific one or default
    const systemPrompt =
      options.system ||
      (options.task && llmConfig.systemPrompts[options.task]) ||
      'You are a helpful assistant that extracts structured information from text and returns it in valid JSON format.';

    const response = await provider.generate(prompt, {
      model: params.model,
      systemPrompt,
      temperature: params.temperature,
      topP: params.top_p,
      topK: params.top_k,
      maxTokens: params.max_tokens,
      contextWindow: params.contextWindow,
      responseFormat: 'json',
    });

    // Parse the JSON response
    try {
      return JSON.parse(response) as T;
    } catch (jsonError) {
      log.warn({ err: jsonError, response }, 'Error parsing LLM JSON response');

      // Attempt to extract JSON from the response if it's not properly formatted
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as T;
        } catch (_e) {
          throw new Error('Failed to parse JSON from LLM response');
        }
      } else {
        throw new Error('LLM response did not contain valid JSON');
      }
    }
  } catch (error) {
    log.error({ err: error }, 'Error extracting structured data with LLM');
    throw new Error(
      `Failed to extract structured data: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Check if the LLM service is available
 * @returns True if the LLM service is available
 */
export async function isLLMAvailable(): Promise<boolean> {
  try {
    const provider = getProvider();
    return await provider.isAvailable();
  } catch (error) {
    console.warn(
      'LLM service is not available:',
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Generate a SOQL query from natural language using LLM.
 * Returns the raw SOQL string (not yet validated against the graph).
 *
 * @param naturalLanguageQuery - The natural language query
 * @param schemaContext - Optional schema context to inject into prompt
 * @returns The generated SOQL or null if LLM unavailable
 */
export async function generateSoqlWithLLM(
  naturalLanguageQuery: string,
  options: LLMOptions & { schemaContext?: string } = {}
): Promise<string | null> {
  // Check availability
  // Note: This checks the default provider. If a specific provider is requested,
  // we might want to check that instead, but for now this is a reasonable check.
  const available = await isLLMAvailable();
  if (!available) {
    return null;
  }

  try {
    const taskConfig = getLLMConfigForTask('generateSoql');
    
    // Determine provider and model: Options > Task Config > Default
    const providerToUse = options.provider || taskConfig.provider;
    const modelToUse = options.model || taskConfig.model;
    
    const provider = getProvider({
      provider: providerToUse,
      model: modelToUse,
    });
    let systemPrompt = llmConfig.systemPrompts.generateSoql;

    // Inject schema context if provided
    if (options.schemaContext) {
      systemPrompt = `${systemPrompt}\n\n${options.schemaContext}`;
    }

    log.debug(`Generating SOQL with LLM (${provider.providerType}) for: "${naturalLanguageQuery}"`);
    if (options.schemaContext) {
      log.debug('Using injected schema context');
    }

    // Embed instruction in the user prompt for better compliance with local models
    const userPrompt = `Generate a SOQL query for this request. Return ONLY the SOQL query, nothing else.

Request: "${naturalLanguageQuery}"

SOQL:`;

    const response = await provider.generate(userPrompt, {
      systemPrompt,
      model: modelToUse,
      temperature: options.temperature || taskConfig.temperature,
      topP: options.top_p || taskConfig.top_p,
      topK: options.top_k || taskConfig.top_k,
      maxTokens: taskConfig.max_tokens,
      contextWindow: options.contextWindow || taskConfig.contextWindow,
    });

    // Clean up response - remove any markdown formatting LLM might add
    let soql = response.trim();

    // Remove markdown code block if present
    if (soql.startsWith('```')) {
      soql = soql.replace(/^```(?:sql|soql)?\n?/, '').replace(/\n?```$/, '');
    }

    // Remove any leading/trailing whitespace
    soql = soql.trim();

    log.debug({ soql }, 'LLM generated SOQL');
    return soql;
  } catch (error) {
    log.error({ err: error }, 'LLM SOQL generation failed');
    return null;
  }
}

/**
 * Get information about available models
 * @returns List of available models
 */
export async function getAvailableModels(): Promise<LlmModel[]> {
  try {
    const provider = getProvider();
    const models = await provider.listModels();
    return models.map((name) => ({ name }));
  } catch (error) {
    log.error({ err: error }, 'Error getting available models');
    return [];
  }
}

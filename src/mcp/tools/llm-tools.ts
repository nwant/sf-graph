/**
 * LLM Tools
 *
 * MCP tools for interacting with the local LLM (Ollama).
 */
import { z } from 'zod';
import { createLogger } from '../../core/index.js';
import {
  isLLMAvailable,
  getAvailableModels,
  processWithLLM,
  LlmModel,
} from '../../services/llm-service.js';
import { loadConfig } from '../../agent/config.js';
import type { McpTool } from './types.js';
import { toolResponse, errorResponse, validateArgs } from './types.js';

const log = createLogger('mcp:llm');

export const llmTools: McpTool[] = [
  {
    name: 'check-llm-status',
    description: 'Check the status of the LLM service and available models',
    schema: {},
    requirements: {}, // No strict requirements - this checks LLM availability
    handler: async () => {
      // No args to validate for this tool
      try {
        log.debug('Checking LLM status');

        const llmAvailable = await isLLMAvailable();

        let models: LlmModel[] = [];
        if (llmAvailable) {
          models = await getAvailableModels();
        }

        const config = loadConfig();

        return toolResponse({
          llmAvailable,
          defaultModel: config.model,
          availableModels: models.map((model) => ({
            name: model.name,
            modified_at: model.modified_at,
            size: model.size,
          })),
        });
      } catch (error) {
        log.error({ err: error }, 'Error in check-llm-status tool');
        return errorResponse(`Error checking LLM status: ${(error as Error).message}`);
      }
    },
  },

  {
    name: 'process-with-llm',
    description: 'Process text with the local LLM',
    schema: {
      prompt: z.string().describe('Prompt to send to the LLM'),
      system: z.string().optional().describe('System prompt to use'),
      model: z.string().optional().describe('LLM model to use'),
    },
    requirements: { llm: true },
    handler: async (args) => {
      const schema = {
        prompt: z.string(),
        system: z.string().optional(),
        model: z.string().optional(),
      };
      const validated = validateArgs(args, schema);
      if (!validated.success) return validated.error;
      const { prompt, system, model } = validated.data;

      try {
        log.debug({ promptLength: prompt.length, model }, 'Processing text with LLM');

        const llmAvailable = await isLLMAvailable();

        if (!llmAvailable) {
          return errorResponse('LLM service is not available. Please make sure Ollama is running.');
        }

        const response = await processWithLLM(prompt, {
          system,
          model,
        });

        return toolResponse(response);
      } catch (error) {
        log.error({ err: error }, 'Error in process-with-llm tool');
        return errorResponse(`Error processing text with LLM: ${(error as Error).message}`);
      }
    },
  },
];

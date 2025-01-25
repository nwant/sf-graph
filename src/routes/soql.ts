import {
  generateSoqlFromNaturalLanguage,
} from '../services/soql-generator.js';
import { validateAndCorrectSoql } from '../services/soql-validator.js';
import { isLLMAvailable, getAvailableModels, LlmModel } from '../services/llm-service.js';
import { loadConfig } from '../agent/config.js';
import Joi from 'joi';
import { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi';

interface SoqlGenerateRequest {
  query: string;
  options?: {
    includeMetadata?: boolean;
    maxLimit?: number;
    orgId?: string;
  };
}

interface SoqlValidateRequest {
  query: string;
  orgId?: string;
}



export const soqlRoutes: ServerRoute[] = [
  // Get LLM status
  {
    method: 'GET',
    path: '/soql/llm-status',
    options: {
      handler: async (_request: Request, h: ResponseToolkit) => {
        try {
          console.log('LLM status request received');

          // Check if LLM is available
          const llmAvailable = await isLLMAvailable();

          // Get available models if LLM is available
          let models: LlmModel[] = [];
          if (llmAvailable) {
            models = await getAvailableModels();
          }

          const config = loadConfig();

          return {
            success: true,
            llmAvailable,
            defaultModel: config.model,
            availableModels: models.map((model) => ({
              name: model.name,
              modified_at: model.modified_at,
              size: model.size,
            })),
          };
        } catch (error: unknown) {
          const err = error as Error;
          console.error('Error getting LLM status:', err);
          return h
            .response({
              success: false,
              message: `Error getting LLM status: ${err.message}`,
              error: err.message,
            })
            .code(500);
        }
      },
      description: 'Get LLM service status',
      tags: ['api', 'soql', 'llm'],
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                success: Joi.boolean(),
                llmAvailable: Joi.boolean(),
                defaultModel: Joi.string(),
                availableModels: Joi.array().items(
                  Joi.object({
                    name: Joi.string(),
                    modified_at: Joi.string(),
                    size: Joi.number(),
                  })
                ),
              }),
            },
            500: {
              description: 'Internal server error',
              schema: Joi.object({
                success: Joi.boolean(),
                message: Joi.string(),
                error: Joi.string(),
              }),
            },
          },
        },
      },
    },
  },
  // Generate SOQL from natural language
  {
    method: 'POST',
    path: '/soql/generate',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          console.log('SOQL generation request received');
          const payload = request.payload as SoqlGenerateRequest;
          const { query, options } = payload;

          const result = await generateSoqlFromNaturalLanguage(query, {
            orgId: options?.orgId,
          });

          // Prepare the response
          const response: Record<string, unknown> = {
            success: true,
            query: {
              natural: query,
              soql: result.soql,
              draftSoql: result.draftSoql,
            },
            metadata: {
              mainObject: result.mainObject,
              fields: result.validation.parsed?.fields || [],
              subqueries: result.validation.parsed?.subqueries || [],
              whereClause: result.validation.parsed?.whereClause,
              orderBy: result.validation.parsed?.orderBy,
              limit: result.validation.parsed?.limit,
            },
            validation: {
              isValid: result.isValid,
              wasCorrected: result.validation.wasCorrected,
              messages: result.validation.messages,
            },
          };

          return response;
        } catch (error: unknown) {
          const err = error as Error;
          console.error('Error in SOQL generation:', err);
          return h
            .response({
              success: false,
              message: `Error generating SOQL: ${err.message}`,
              error: err.message,
            })
            .code(500);
        }
      },
      description: 'Generate SOQL query from natural language',
      tags: ['api', 'soql'],
      validate: {
        payload: Joi.object({
          query: Joi.string().required().description('Natural language query'),
          options: Joi.object({
            includeMetadata: Joi.boolean()
              .default(true)
              .description('Include metadata in response'),
            maxLimit: Joi.number()
              .integer()
              .min(1)
              .description('Maximum limit for generated queries'),
            orgId: Joi.string().description('Org ID for multi-org support'),
          }).optional(),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                success: Joi.boolean(),
                query: Joi.object({
                  natural: Joi.string(),
                  soql: Joi.string(),
                  draftSoql: Joi.string(),
                }),
                metadata: Joi.object(),
                validation: Joi.object({
                  isValid: Joi.boolean(),
                  wasCorrected: Joi.boolean(),
                  messages: Joi.array().items(Joi.object()),
                }),
              }),
            },
            500: {
              description: 'Internal server error',
              schema: Joi.object({
                success: Joi.boolean(),
                message: Joi.string(),
                error: Joi.string(),
              }),
            },
          },
        },
      },
    },
  },

  // Validate SOQL query
  {
    method: 'POST',
    path: '/soql/validate',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          console.log('SOQL validation request received');
          const payload = request.payload as SoqlValidateRequest;
          const { query, orgId } = payload;

          const result = await validateAndCorrectSoql(query, orgId);

          return {
            success: true,
            query: query,
            correctedQuery: result.wasCorrected ? result.soql : undefined,
            isValid: result.isValid,
            wasCorrected: result.wasCorrected,
            messages: result.messages,
            parsed: result.parsed,
          };
        } catch (error: unknown) {
          const err = error as Error;
          console.error('Error in SOQL validation:', err);
          return h
            .response({
              success: false,
              message: `Error validating SOQL: ${err.message}`,
              error: err.message,
            })
            .code(500);
        }
      },
      description: 'Validate a SOQL query against the metadata graph',
      tags: ['api', 'soql'],
      validate: {
        payload: Joi.object({
          query: Joi.string().required().description('SOQL query to validate'),
          orgId: Joi.string().optional().description('Org ID for multi-org support'),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                success: Joi.boolean(),
                query: Joi.string(),
                correctedQuery: Joi.string().optional(),
                isValid: Joi.boolean(),
                wasCorrected: Joi.boolean(),
                messages: Joi.array().items(Joi.object()),
                parsed: Joi.object().optional(),
              }),
            },
            500: {
              description: 'Internal server error',
              schema: Joi.object({
                success: Joi.boolean(),
                message: Joi.string(),
                error: Joi.string(),
              }),
            },
          },
        },
      },
    },
  },


];

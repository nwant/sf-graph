import {
  getAllObjects,
  getObjectByApiName,
  getObjectFields,
  getObjectRelationships,
} from '../services/neo4j/index.js';
import Joi from 'joi';
import { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi';

interface MCPPayload {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: unknown;
}

interface MCPReadPayload extends MCPPayload {
  params: {
    uri: string;
  };
}

export const mcpRoutes: ServerRoute[] = [
  // MCP Server Capabilities endpoint
  {
    method: 'POST',
    path: '/mcp/initialize',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          console.log('MCP server initialization request received');
          console.log('MCP server initialization request received');
          const payload = request.payload as MCPPayload;
          const { id } = payload;

          // Return server capabilities according to MCP protocol
          return {
            jsonrpc: '2.0',
            id: id,
            result: {
              capabilities: {
                resources: {
                  subscribe: false,
                  listChanged: false,
                },
              },
            },
          };
        } catch (error: any) {
          console.error('Error in MCP server initialization:', error);
          console.error('Error in MCP server initialization:', error);
          const payload = request.payload as MCPPayload | undefined;
          const id = payload?.id;
          return h
            .response({
              jsonrpc: '2.0',
              id: id,
              error: {
                code: -32603,
                message: `Internal error: ${error.message}`,
              },
            })
            .code(500);
        }
      },
      description: 'Initialize MCP server and return capabilities',
      tags: ['api', 'mcp'],
      validate: {
        payload: Joi.object({
          jsonrpc: Joi.string().required(),
          id: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
          method: Joi.string().required(),
          params: Joi.object().optional(),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                jsonrpc: Joi.string(),
                id: Joi.alternatives().try(Joi.number(), Joi.string()),
                result: Joi.object({
                  capabilities: Joi.object({
                    resources: Joi.object({
                      subscribe: Joi.boolean(),
                      listChanged: Joi.boolean(),
                    }),
                  }),
                }),
              }),
            },
          },
        },
      },
    },
  },

  // MCP Resources List endpoint (following MCP protocol)
  {
    method: 'POST',
    path: '/mcp/resources/list',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          console.log('MCP resources/list request received');
          console.log('MCP resources/list request received');
          const payload = request.payload as MCPPayload;
          const { id } = payload;

          // Get all objects to expose as resources
          const objects = await getAllObjects();

          // Transform objects into MCP resources format
          const resources = objects.map((obj) => ({
            uri: `salesforce://object/${obj.apiName}`,
            name: obj.label || obj.apiName,
            description: obj.description || `Salesforce ${obj.apiName} object`,
            mimeType: 'application/json',
          }));

          return {
            jsonrpc: '2.0',
            id: id,
            result: {
              resources: resources,
              nextCursor: null, // No pagination in this implementation
            },
          };
        } catch (error: any) {
          console.error('Error in MCP resources/list:', error);
          console.error('Error in MCP resources/list:', error);
          const payload = request.payload as MCPPayload | undefined;
          const id = payload?.id;
          return h
            .response({
              jsonrpc: '2.0',
              id: id,
              error: {
                code: -32603,
                message: `Internal error: ${error.message}`,
              },
            })
            .code(500);
        }
      },
      description: 'List available Salesforce metadata resources',
      tags: ['api', 'mcp'],
      validate: {
        payload: Joi.object({
          jsonrpc: Joi.string().required(),
          id: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
          method: Joi.string().required(),
          params: Joi.object({
            cursor: Joi.string().optional(),
          }).optional(),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                jsonrpc: Joi.string(),
                id: Joi.alternatives().try(Joi.number(), Joi.string()),
                result: Joi.object({
                  resources: Joi.array().items(
                    Joi.object({
                      uri: Joi.string(),
                      name: Joi.string(),
                      description: Joi.string(),
                      mimeType: Joi.string(),
                    })
                  ),
                  nextCursor: Joi.string().allow(null),
                }),
              }),
            },
          },
        },
      },
    },
  },

  // MCP Resources Read endpoint (following MCP protocol)
  {
    method: 'POST',
    path: '/mcp/resources/read',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          console.log('MCP resources/read request received');
          console.log('MCP resources/read request received');
          const payload = request.payload as MCPReadPayload;
          const { id, params } = payload;
          const { uri } = params;

          console.log(`Reading resource: ${uri}`);

          // Parse the URI to extract object API name
          const uriMatch = uri.match(/^salesforce:\/\/object\/(.+)$/);

          if (!uriMatch) {
            return h
              .response({
                jsonrpc: '2.0',
                id: id,
                error: {
                  code: -32002,
                  message: 'Resource not found',
                  data: { uri },
                },
              })
              .code(404);
          }

          const objectApiName = uriMatch[1];

          // Get object metadata
          const object = await getObjectByApiName(objectApiName);

          if (!object) {
            return h
              .response({
                jsonrpc: '2.0',
                id: id,
                error: {
                  code: -32002,
                  message: 'Resource not found',
                  data: { uri },
                },
              })
              .code(404);
          }

          // Get fields for this object
          const fields = await getObjectFields(objectApiName);

          // Get relationships for this object
          const relationships = await getObjectRelationships(objectApiName);

          // Create the resource content
          const resourceContent = {
            object: {
              apiName: object.apiName,
              label: object.label || object.apiName,
              description: object.description || '',
              // @ts-ignore
              category: object.category || 'standard',
            },
            fields: fields.map((field) => ({
              apiName: field.apiName,
              label: field.label || field.apiName,
              description: field.description || '',
              type: field.type || 'string',
              category: field.category || 'standard',
              nullable: field.nillable || false,
              unique: field.unique || false,
              helpText: field.helpText || '',
            })),
            relationships: relationships.map((rel) => ({
              sourceObject: rel.sourceObject,
              targetObject: rel.targetObject,
              relationshipType: rel.relationshipType || 'LOOKUP',
              fieldCount: rel.fieldCount || 1,
              direction: rel.direction || 'outgoing',
            })),
          };

          return {
            jsonrpc: '2.0',
            id: id,
            result: {
              contents: [
                {
                  uri: uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(resourceContent, null, 2),
                },
              ],
            },
          };
        } catch (error: any) {
          console.error('Error in MCP resources/read:', error);
          console.error('Error in MCP resources/read:', error);
          const payload = request.payload as MCPPayload | undefined;
          const id = payload?.id;
          return h
            .response({
              jsonrpc: '2.0',
              id: id,
              error: {
                code: -32603,
                message: `Internal error: ${error.message}`,
              },
            })
            .code(500);
        }
      },
      description: 'Read Salesforce metadata resource content',
      tags: ['api', 'mcp'],
      validate: {
        payload: Joi.object({
          jsonrpc: Joi.string().required(),
          id: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
          method: Joi.string().required(),
          params: Joi.object({
            uri: Joi.string().required(),
          }).required(),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                jsonrpc: Joi.string(),
                id: Joi.alternatives().try(Joi.number(), Joi.string()),
                result: Joi.object({
                  contents: Joi.array().items(
                    Joi.object({
                      uri: Joi.string(),
                      mimeType: Joi.string(),
                      text: Joi.string(),
                    })
                  ),
                }),
              }),
            },
            404: {
              description: 'Resource not found',
              schema: Joi.object({
                jsonrpc: Joi.string(),
                id: Joi.alternatives().try(Joi.number(), Joi.string()),
                error: Joi.object({
                  code: Joi.number(),
                  message: Joi.string(),
                  data: Joi.object({
                    uri: Joi.string(),
                  }),
                }),
              }),
            },
          },
        },
      },
    },
  },

  // MCP Resource Templates endpoint (following MCP protocol)
  {
    method: 'POST',
    path: '/mcp/resources/templates/list',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          console.log('MCP resources/templates/list request received');
          console.log('MCP resources/templates/list request received');
          const payload = request.payload as MCPPayload;
          const { id } = payload;

          // Define resource templates
          const resourceTemplates = [
            {
              uriTemplate: 'salesforce://object/{objectApiName}',
              name: 'Salesforce Object',
              description: 'Access metadata for a specific Salesforce object',
              mimeType: 'application/json',
            },
          ];

          return {
            jsonrpc: '2.0',
            id: id,
            result: {
              resourceTemplates: resourceTemplates,
            },
          };
        } catch (error: any) {
          console.error('Error in MCP resources/templates/list:', error);
          console.error('Error in MCP resources/templates/list:', error);
          const payload = request.payload as MCPPayload | undefined;
          const id = payload?.id;
          return h
            .response({
              jsonrpc: '2.0',
              id: id,
              error: {
                code: -32603,
                message: `Internal error: ${error.message}`,
              },
            })
            .code(500);
        }
      },
      description: 'List available Salesforce metadata resource templates',
      tags: ['api', 'mcp'],
      validate: {
        payload: Joi.object({
          jsonrpc: Joi.string().required(),
          id: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
          method: Joi.string().required(),
          params: Joi.object().optional(),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                jsonrpc: Joi.string(),
                id: Joi.alternatives().try(Joi.number(), Joi.string()),
                result: Joi.object({
                  resourceTemplates: Joi.array().items(
                    Joi.object({
                      uriTemplate: Joi.string(),
                      name: Joi.string(),
                      description: Joi.string(),
                      mimeType: Joi.string(),
                    })
                  ),
                }),
              }),
            },
          },
        },
      },
    },
  },
];

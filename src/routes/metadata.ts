import {
  fetchMetadata,
  retrieveMetadataDetails,
  fetchObjectMetadata,
  MetadataItem,
} from '../services/salesforce.js';
import { apiService } from '../core/api-service.js';
import {
  refreshObjectNodes,
  refreshSingleObjectNode,
  syncObjectRelationships,
  getAllObjects,
  getObjectByApiName,
  getObjectFields,
  getObjectRelationships,
  findRelatedObjects,
  getNeighborhoodEdges,
} from '../services/neo4j/index.js';
import { transformNeighborhood } from '../services/cytoscape-transformer.js';
import Joi from 'joi';
import { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi';

interface MetadataRequest {
  type: string;
  names?: string[];
  includeFields?: boolean;
  includeRecordTypes?: boolean;
}


export const routes: ServerRoute[] = [
  // GET routes for retrieving Salesforce metadata from the graph
  {
    method: 'GET',
    path: '/objects',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          const { q, limit } = request.query as { q?: string; limit?: number };
          console.log('Fetching all objects from Neo4j...');
          let objects = await getAllObjects();
          
          // If search query provided, filter by apiName or label
          if (q && q.length >= 2) {
            const query = q.toLowerCase();
            objects = objects.filter(
              (obj) =>
                obj.apiName.toLowerCase().includes(query) ||
                obj.label.toLowerCase().includes(query)
            );
          }
          
          // Apply limit if provided
          if (limit && limit > 0) {
            objects = objects.slice(0, limit);
          }
          
          console.log(`Retrieved ${objects.length} objects`);
          return {
            success: true,
            count: objects.length,
            objects,
          };
        } catch (error: any) {
          console.error('Error in GET /objects:', error);
          return h
            .response({
              success: false,
              error: error.message,
              code: 'NEO4J_ERROR',
            })
            .code(500);
        }
      },
      description: 'Get all Salesforce objects from the graph, with optional search',
      tags: ['api'],
      validate: {
        query: Joi.object({
          q: Joi.string().min(2).optional().description('Search query (filters by apiName or label)'),
          limit: Joi.number().integer().min(1).max(100).optional().description('Max results to return'),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                success: Joi.boolean(),
                count: Joi.number(),
                objects: Joi.array().items(
                  Joi.object({
                    apiName: Joi.string(),
                    label: Joi.string(),
                    description: Joi.string(),
                    category: Joi.string(),
                    lastRefreshed: Joi.string().allow(null),
                    name: Joi.string(),
                  })
                ),
              }),
            },
          },
        },
      },
    },
  },
  {
    method: 'GET',
    path: '/objects/{objectApiName}',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          const { objectApiName } = request.params;
          const { include } = request.query as { include?: string };
          console.log(`Retrieving object: ${objectApiName}, include: ${include}`);

          const object = await getObjectByApiName(objectApiName);

          if (!object) {
            return h
              .response({
                success: false,
                message: `Object not found: ${objectApiName}`,
              })
              .code(404);
          }

          // Check if fields are requested via ?include=fields
          const includeFields = include?.split(',').includes('fields');
          const fields = includeFields ? await getObjectFields(objectApiName) : undefined;

          return {
            success: true,
            object,
            ...(fields && { fields }),
          };
        } catch (error: any) {
          console.error(`Error in GET /object/${request.params.objectApiName}:`, error);
          return h
            .response({
              success: false,
              message: `Error retrieving object: ${error.message}`,
              error: error.message,
            })
            .code(500);
        }
      },
      description: 'Get a specific Salesforce object from the graph. Use ?include=fields to include field details.',
      tags: ['api'],
      validate: {
        params: Joi.object({
          objectApiName: Joi.string()
            .required()
            .description('API name of the Salesforce object (case insensitive)'),
        }),
        query: Joi.object({
          include: Joi.string()
            .optional()
            .description('Comma-separated list of related data to include (e.g., "fields")'),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                success: Joi.boolean(),
                object: Joi.object({
                  apiName: Joi.string(),
                  label: Joi.string(),
                  description: Joi.string(),
                  category: Joi.string(),
                  lastRefreshed: Joi.string().allow(null),
                  name: Joi.string(),
                  fieldCount: Joi.number(),
                }),
                fields: Joi.array().items(
                  Joi.object({
                    apiName: Joi.string(),
                    label: Joi.string(),
                    type: Joi.string(),
                    referenceTo: Joi.array().items(Joi.string()).allow(null),
                  })
                ).optional(),
              }),
            },
            404: {
              description: 'Object not found',
              schema: Joi.object({
                success: Joi.boolean(),
                message: Joi.string(),
              }),
            },
          },
        },
      },
    },
  },
  {
    method: 'GET',
    path: '/objects/{objectApiName}/relationships',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          const { objectApiName } = request.params;
          console.log(`Retrieving relationships for object: ${objectApiName}`);

          // First check if the object exists
          const object = await getObjectByApiName(objectApiName);

          if (!object) {
            return h
              .response({
                success: false,
                message: `Object not found: ${objectApiName}`,
              })
              .code(404);
          }

          const relationships = await getObjectRelationships(objectApiName);

          return {
            success: true,
            count: relationships.length,
            relationships,
          };
        } catch (error: any) {
          console.error(
            `Error in GET /object/${request.params.objectApiName}/relationships:`,
            error
          );
          return h
            .response({
              success: false,
              message: `Error retrieving relationships: ${error.message}`,
              error: error.message,
            })
            .code(500);
        }
      },
      description: 'Get all relationships for a specific Salesforce object from the graph',
      tags: ['api'],
      validate: {
        params: Joi.object({
          objectApiName: Joi.string()
            .required()
            .description('API name of the Salesforce object (case insensitive)'),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                success: Joi.boolean(),
                count: Joi.number(),
                relationships: Joi.array().items(
                  Joi.object({
                    sourceObject: Joi.string(),
                    targetObject: Joi.string(),
                    relationshipType: Joi.string(),
                    fieldCount: Joi.number(),
                    fields: Joi.array().items(Joi.string()),
                    direction: Joi.string().valid('incoming', 'outgoing'),
                  })
                ),
              }),
            },
            404: {
              description: 'Object not found',
              schema: Joi.object({
                success: Joi.boolean(),
                message: Joi.string(),
              }),
            },
          },
        },
      },
    },
  },
  // Graph visualization endpoint
  {
    method: 'GET',
    path: '/objects/{objectApiName}/neighborhood',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          const { objectApiName } = request.params;
          const { depth = 2 } = request.query as { depth?: number };
          console.log(`Retrieving neighborhood for object: ${objectApiName}, depth: ${depth}`);

          // Fetch object, neighbors, and ALL edges within the neighborhood in parallel
          const [object, neighbors, relationships] = await Promise.all([
            getObjectByApiName(objectApiName),
            findRelatedObjects(objectApiName, depth),
            getNeighborhoodEdges(objectApiName, depth),
          ]);

          if (!object) {
            return h
              .response({
                success: false,
                error: `Object not found: ${objectApiName}`,
                code: 'NOT_FOUND',
              })
              .code(404);
          }

          // Transform to Cytoscape format
          const elements = transformNeighborhood(object, neighbors, relationships);

          return {
            success: true,
            centerObject: objectApiName,
            depth,
            nodeCount: elements.nodes.length,
            edgeCount: elements.edges.length,
            elements,
          };
        } catch (error: any) {
          console.error(
            `Error in GET /objects/${request.params.objectApiName}/neighborhood:`,
            error
          );
          return h
            .response({
              success: false,
              error: error.message,
              code: 'NEO4J_ERROR',
            })
            .code(500);
        }
      },
      description: 'Get neighborhood graph data for an object in Cytoscape format',
      tags: ['api', 'graph-viz'],
      validate: {
        params: Joi.object({
          objectApiName: Joi.string()
            .required()
            .description('API name of the Salesforce object (case insensitive)'),
        }),
        query: Joi.object({
          depth: Joi.number()
            .integer()
            .min(1)
            .max(3)
            .default(2)
            .description('How many hops to include (1-3)'),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success - returns Cytoscape-compatible elements',
              schema: Joi.object({
                success: Joi.boolean(),
                centerObject: Joi.string(),
                depth: Joi.number(),
                nodeCount: Joi.number(),
                edgeCount: Joi.number(),
                elements: Joi.object({
                  nodes: Joi.array().items(
                    Joi.object({
                      data: Joi.object({
                        id: Joi.string(),
                        label: Joi.string(),
                        category: Joi.string(),
                        fieldCount: Joi.number().optional(),
                        depth: Joi.number().optional(),
                        isCenter: Joi.boolean().optional(),
                      }),
                    })
                  ),
                  edges: Joi.array().items(
                    Joi.object({
                      data: Joi.object({
                        id: Joi.string(),
                        source: Joi.string(),
                        target: Joi.string(),
                        label: Joi.string(),
                        type: Joi.string(),
                      }),
                    })
                  ),
                }),
              }),
            },
            404: {
              description: 'Object not found',
              schema: Joi.object({
                success: Joi.boolean(),
                error: Joi.string(),
                code: Joi.string(),
              }),
            },
          },
        },
      },
    },
  },
  // POST routes for syncing Salesforce metadata to the graph
  {
    method: 'POST',
    path: '/objects',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          const payload = request.payload as MetadataRequest;
          const { includeFields = false, includeRecordTypes = false } = payload || {};
          console.log(
            `Starting Object nodes refresh process... (includeFields: ${includeFields}, includeRecordTypes: ${includeRecordTypes})`
          );

          // Fetch metadata items
          let metadataItems: MetadataItem[] = [];
          try {
            metadataItems = await fetchMetadata();
          } catch (error: any) {
            console.error('Error fetching metadata:', error.message);
            return h
              .response({
                success: false,
                message: `Error fetching metadata: ${error.message}`,
                error: error.message,
              })
              .code(500);
          }

          // Retrieve detailed metadata
          let detailedItems: MetadataItem[] = [];
          try {
            // Filter out items without fullName to satisfy the stricter type requirement
            const itemsWithFullName = metadataItems.filter(
              (item): item is MetadataItem & { fullName: string } => typeof item.fullName === 'string'
            );
            detailedItems = await retrieveMetadataDetails(itemsWithFullName);
          } catch (error: any) {
            console.error('Error retrieving metadata details:', error.message);
            return h
              .response({
                success: false,
                message: `Error retrieving metadata details: ${error.message}`,
                error: error.message,
              })
              .code(500);
          }

          // Refresh object nodes
          let stats;
          try {
            stats = await refreshObjectNodes(detailedItems, includeFields, includeRecordTypes);
            console.log('Object nodes refresh completed successfully');
          } catch (error: any) {
            console.error('Error refreshing object nodes:', error.message);
            // Even if there's an error, we'll return a 200 status with error details
            // since some objects may have been processed successfully
            return h
              .response({
                success: false,
                message: `Object nodes refresh partially completed with errors${includeFields ? ' (with fields)' : ''}${includeRecordTypes ? ' (with record types)' : ''}`,
                error: error.message,
              })
              .code(207); // 207 Multi-Status indicates partial success
          }

          return {
            success: true,
            message: `Object nodes refreshed successfully${includeFields ? ' with fields' : ''}${includeRecordTypes ? ' with record types' : ''}`,
            stats: {
              created: stats.created,
              updated: stats.updated,
              total: stats.total,
              fieldsIncluded: includeFields,
              recordTypesIncluded: includeRecordTypes,
            },
          };
        } catch (error) {
          console.error('Error in /objects:', error);
          throw error;
        }
      },
      description: 'Sync all objects from Salesforce to the graph',
      tags: ['api'],
      validate: {
        payload: Joi.object({
          includeFields: Joi.boolean()
            .default(false)
            .description(
              'When true, also creates Field nodes and their corresponding relationships'
            ),
          includeRecordTypes: Joi.boolean()
            .default(false)
            .description(
              'When true, also creates RecordType nodes and their corresponding relationships'
            ),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                success: Joi.boolean(),
                message: Joi.string(),
                stats: Joi.object({
                  created: Joi.number(),
                  updated: Joi.number(),
                  total: Joi.number(),
                  fieldsIncluded: Joi.boolean(),
                  recordTypesIncluded: Joi.boolean(),
                }),
              }),
            },
          },
        },
      },
    },
  },
  {
    method: 'POST',
    path: '/objects/{objectApiName}',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          const { objectApiName } = request.params;
          const payload = request.payload as MetadataRequest;
          const { includeFields = false, includeRecordTypes = false } = payload || {};
          console.log(
            `Starting Object node refresh for: ${objectApiName} (includeFields: ${includeFields}, includeRecordTypes: ${includeRecordTypes})`
          );

          // Fetch metadata for the specific object
          let objectMetadata: any;
          try {
            objectMetadata = await fetchObjectMetadata(objectApiName);
          } catch (error: any) {
            console.error(`Error fetching metadata for object ${objectApiName}:`, error.message);
            return h
              .response({
                success: false,
                message: `Error fetching metadata for object ${objectApiName}: ${error.message}`,
                error: error.message,
              })
              .code(500);
          }

          // Refresh the Object node in Neo4j
          let result;
          try {
            result = await refreshSingleObjectNode(
              objectApiName,
              objectMetadata,
              includeFields,
              includeRecordTypes
            );
            console.log(`Object node refresh completed for ${objectApiName}`);
          } catch (error: any) {
            console.error(`Error refreshing object node for ${objectApiName}:`, error.message);
            // If the error is related to field processing but the object was created/updated
            if (error.message.includes('field') && objectMetadata) {
              return h
                .response({
                  success: true,
                  message: `Object node for ${objectApiName} refreshed successfully, but there were errors processing fields`,
                  result: {
                    created: false,
                    updated: true,
                    fieldsIncluded: false,
                    fieldsError: error.message,
                  },
                })
                .code(207); // 207 Multi-Status indicates partial success
            }

            return h
              .response({
                success: false,
                message: `Error refreshing object node for ${objectApiName}: ${error.message}`,
                error: error.message,
              })
              .code(500);
          }

          return {
            success: true,
            message: `Object node for ${objectApiName} refreshed successfully${includeFields ? ' with fields' : ''}${includeRecordTypes ? ' with record types' : ''}`,
            result: {
              created: result.created,
              updated: result.updated,
              fieldsIncluded: includeFields,
              recordTypesIncluded: includeRecordTypes,
            },
          };
        } catch (error) {
          console.error(`Error in /object/${request.params.objectApiName}:`, error);
          throw error;
        }
      },
      description: 'Sync a specific object from Salesforce to the graph',
      tags: ['api'],
      validate: {
        params: Joi.object({
          objectApiName: Joi.string()
            .required()
            .description('API name of the Salesforce object (case insensitive)'),
        }),
        payload: Joi.object({
          includeFields: Joi.boolean()
            .default(false)
            .description(
              'When true, also creates Field nodes and their corresponding relationships'
            ),
          includeRecordTypes: Joi.boolean()
            .default(false)
            .description(
              'When true, also creates RecordType nodes and their corresponding relationships'
            ),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                success: Joi.boolean(),
                message: Joi.string(),
                result: Joi.object({
                  created: Joi.boolean(),
                  updated: Joi.boolean(),
                  fieldsIncluded: Joi.boolean(),
                  recordTypesIncluded: Joi.boolean(),
                }),
              }),
            },
            404: {
              description: 'Object not found',
              schema: Joi.object({
                statusCode: Joi.number(),
                error: Joi.string(),
                message: Joi.string(),
              }),
            },
          },
        },
      },
    },
  },
  {
    method: 'POST',
    path: '/objects/{objectApiName}/relationships',
    options: {
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          const { objectApiName } = request.params;
          console.log(`Starting relationship sync for object: ${objectApiName}`);

          // Sync relationships for the object
          let stats;
          try {
            stats = await syncObjectRelationships(objectApiName);
            console.log(`Relationship sync completed for ${objectApiName}`);
          } catch (error: any) {
            console.error(
              `Error syncing relationships for object ${objectApiName}:`,
              error.message
            );
            return h
              .response({
                success: false,
                message: `Error syncing relationships for object ${objectApiName}: ${error.message}`,
                error: error.message,
              })
              .code(500);
          }

          return {
            success: true,
            message: `Relationships for object ${objectApiName} synced successfully`,
            stats: {
              created: stats.created,
              updated: stats.updated,
              total: stats.total,
            },
          };
        } catch (error) {
          console.error(`Error in /object/${request.params.objectApiName}/relationships:`, error);
          throw error;
        }
      },
      description: 'Sync all relationships for a specific object from Salesforce to the graph',
      tags: ['api'],
      validate: {
        params: Joi.object({
          objectApiName: Joi.string()
            .required()
            .description('API name of the Salesforce object (case insensitive)'),
        }),
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                success: Joi.boolean(),
                message: Joi.string(),
                stats: Joi.object({
                  created: Joi.number(),
                  updated: Joi.number(),
                  total: Joi.number(),
                }),
              }),
            },
            404: {
              description: 'Object not found',
              schema: Joi.object({
                statusCode: Joi.number(),
                error: Joi.string(),
                message: Joi.string(),
              }),
            },
          },
        },
      },
    },
  },
  {
    method: 'GET',
    path: '/paths',
    options: {
      description: 'Find paths between two objects',
      tags: ['api'],
      validate: {
        query: Joi.object({
          from: Joi.string().required().description('Source object API name'),
          to: Joi.string().required().description('Target object API name'),
          minHops: Joi.number().integer().min(1).default(1).description('Minimum number of hops'),
          maxHops: Joi.number().integer().min(1).max(20).default(5).description('Maximum number of hops'),
          orgId: Joi.string().optional().description('Org ID filter'),
        }),
      },
      handler: async (request: Request, h: ResponseToolkit) => {
        try {
          const { from, to, minHops, maxHops, orgId } = request.query as any;
          
          const result = await apiService.findDetailedPaths(from, to, {
            minHops,
            maxHops,
            orgId
          });
          
          return result;
        } catch (error: any) {
           console.error(`Error in /paths:`, error);
           const statusCode = error.message.includes('not found') ? 404 : 500;
           return h.response({
             statusCode,
             error: 'Internal Server Error',
             message: error.message
           }).code(statusCode);
        }
      },
      plugins: {
        'hapi-swagger': {
          responses: {
            200: {
              description: 'Success',
              schema: Joi.object({
                 fromObject: Joi.string(),
                 toObject: Joi.string(),
                 pathCount: Joi.number(),
                 minHops: Joi.number(),
                 maxHops: Joi.number(),
                 paths: Joi.array().items(Joi.object())
              })
            }
          }
        }
      }
    }
  }
];

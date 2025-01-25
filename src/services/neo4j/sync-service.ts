/**
 * Neo4j Sync Service - Syncs Salesforce Metadata to Neo4j Graph
 *
 * Handles creating and updating Object, Field, and RecordType nodes in Neo4j
 * based on metadata fetched from Salesforce.
 */

import { getDriver } from './driver.js';
import { handlerRegistry } from '../HandlerRegistry.js';
import { CustomFieldHandler } from '../handlers/CustomFieldHandler.js';
import { CustomObjectHandler } from '../handlers/CustomObjectHandler.js';
import type { MetadataItem, FieldMetadata } from '../salesforce.js';
import { Transaction, ManagedTransaction } from 'neo4j-driver';
import { classifyObject, classifyField, ObjectCategory, ObjectSubtype, FieldCategory } from '../../core/object-classifier.js';
import { DEFAULTS } from '../../config/defaults.js';
import { createLogger } from '../../core/index.js';
import type { PicklistValue } from '../../core/types.js';

const log = createLogger('neo4j:sync');

// === Types ===

export interface SyncStats {
  created: number;
  updated: number;
  total: number;
  fieldsIncluded?: boolean;
  recordTypesIncluded?: boolean;
  picklistValueCount?: number;
  dependencyCount?: number;
}

export interface ObjectRefreshResult {
  objectCount: number;
  fieldCount?: number;
  created?: number;
  updated?: number;
}

interface ObjectDefinition {
  apiName: string;
  label: string;
  description: string;
  category: ObjectCategory;
  subtype: ObjectSubtype;
  namespace?: string;
  parentObjectName?: string;
}

interface RecordTypeDefinition {
  apiName: string;
  sobjectType: string;
  label: string;
  description: string;
  isActive: boolean;
  isDefault: boolean;
}

interface FieldDefinition {
  apiName: string;
  sobjectType: string;
  label: string;
  type: string;
  description: string;
  helpText: string;
  nillable: boolean;
  unique: boolean;
  category: FieldCategory;
  namespace?: string;
  required: boolean;
  referenceTo: string[] | null;
  relationshipName: string | null;
  relationshipType: 'Lookup' | 'MasterDetail' | 'Hierarchical' | null;
  // SOQL-relevant properties
  calculated?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  length?: number | null;
  precision?: number | null;
  scale?: number | null;
  controllerName?: string;
}


// === Graph Creation ===

/**
 * Create full metadata graph from scratch (clears existing data)
 */
export async function createMetadataGraph(
  metadataItems: MetadataItem[]
): Promise<void> {
  const driver = getDriver();
  const session = driver.session();

  try {
    await session.executeWrite(async (tx: ManagedTransaction) => {
      log.debug('Clearing existing graph data...');
      await tx.run('MATCH (n) DETACH DELETE n');

      log.debug('Creating new graph nodes and relationships via Handlers...');

      for (const item of metadataItems) {
        const handler = handlerRegistry.getHandler(item.type);

        if (handler) {
          try {
            log.debug({ type: item.type, name: item.fullName || item.name }, 'Processing item');
            await handler.process(tx, item);
          } catch (handlerError) {
            log.error({ err: handlerError, type: item.type, fullName: item.fullName }, 'Error in handler');
          }
        } else {
          log.warn({ type: item.type }, 'Skipping - No handler registered');
        }
      }

      log.debug('Graph creation completed successfully');
    });
  } catch (error) {
    log.error({ err: error }, 'Error creating metadata graph');
    throw new Error(
      `Failed to create metadata graph: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

// === Object Refresh ===

/**
 * Refresh Object nodes from metadata items
 */
export async function refreshObjectNodes(
  metadataItems: MetadataItem[],
  includeFields = false,
  includeRecordTypes = false,
  orgId?: string
): Promise<SyncStats> {
  const driver = getDriver();
  const session = driver.session();

  try {
    log.debug(
      `Refreshing Object nodes in Neo4j... (includeFields: ${includeFields}, includeRecordTypes: ${includeRecordTypes})`
    );

    // Filter only CustomObject metadata items
    const objectItems = metadataItems.filter(
      (item) => item.type === 'CustomObject'
    );
    log.debug(`Found ${objectItems.length} CustomObject items to refresh`);

    // Get existing Object nodes for this org (outside transaction)
    const existingResult = await session.run(
      `MATCH (o:Object)
       WHERE $orgId IS NULL OR o.orgId = $orgId
       RETURN toLower(o.apiName) as apiName`,
      { orgId: orgId || null }
    );
    const existingObjects = existingResult.records
      .map((record) => {
        const apiName = record.get('apiName');
        return typeof apiName === 'string' ? apiName.toLowerCase() : null;
      })
      .filter((name): name is string => name !== null);
    log.debug(
      `Found ${existingObjects.length} existing Object nodes in the database`
    );

    let created = 0;
    let updated = 0;
    let totalPicklistValues = 0;
    let totalDependencies = 0;

    // Process each object in its own transaction for faster commits
    for (const item of objectItems) {
      const apiName = item.name;
      let label = '';
      let description = '';

      // Classify the object
      const classification = classifyObject(apiName);

      // Extract additional properties if available from metadata
      if (item.content && typeof item.content === 'object') {
        const content = item.content as Record<string, unknown>;
        if (content.CustomObject) {
          const customObj = content.CustomObject as Record<string, string[]>;
          label = customObj.label?.[0] || '';
          description = customObj.description?.[0] || '';
        } else {
          label = (content.label as string) || '';
          description = (content.description as string) || '';
        }
      }

      // If label is still empty, try to get it from describe API
      if (!label) {
        try {
          const { fetchObjectDescribe } = await import('../salesforce.js');
          const describeInfo = await fetchObjectDescribe(apiName);
          if (describeInfo) {
            label = describeInfo.label;
          }
        } catch (err) {
          // Describe failed, continue without label
          log.debug({ err, apiName }, 'Object describe failed, using fallback label');
        }
      }

      const exists =
        apiName && existingObjects.includes(apiName.toLowerCase());

      const objectDefinition: ObjectDefinition = {
        apiName,
        label,
        description,
        category: classification.category,
        subtype: classification.subtype,
        namespace: classification.namespace,
        parentObjectName: classification.parentObjectName,
      };

      const objectHandler = new CustomObjectHandler();

      if (orgId && !item.orgId) {
        item.orgId = orgId;
      }

      // Commit per object for incremental progress and faster commits
      await session.executeWrite(async (tx: ManagedTransaction) => {
        await objectHandler.processObjectDefinition(tx, {
          ...objectDefinition,
          orgId,
        });

        // If includeFields is true, handle field nodes for this object
        if (includeFields) {
          try {
            const result = await processObjectFields(tx, apiName, orgId);
            totalPicklistValues += result.picklistValueCount;
            totalDependencies += result.dependencyCount;
          } catch (error) {
            log.error(
              { err: error },
              `Error processing fields for object ${apiName}, continuing`
            );
          }
        }

        // If includeRecordTypes is true, handle record type nodes
        if (includeRecordTypes) {
          try {
            await processObjectRecordTypes(tx, apiName, orgId);
          } catch (error) {
            log.error(
              { err: error },
              `Error processing record types for object ${apiName}, continuing`
            );
          }
        }
      });

      if (exists) {
        updated++;
      } else {
        created++;
      }
    }

    const stats = {
      created,
      updated,
      total: objectItems.length,
      fieldsIncluded: includeFields,
      recordTypesIncluded: includeRecordTypes,
      picklistValueCount: totalPicklistValues,
      dependencyCount: totalDependencies,
    };

    log.debug(
      `Object refresh completed: ${stats.created} created, ${stats.updated} updated, ${stats.total} total`
    );
    return stats;
  } catch (error) {
    log.error({ err: error }, 'Error refreshing Object nodes');
    throw new Error(
      `Failed to refresh Object nodes: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

/**
 * Refresh a single Object node
 */
export async function refreshSingleObjectNode(
  objectApiName: string,
  metadataItem: MetadataItem,
  includeFields = false,
  includeRecordTypes = false,
  orgId?: string
): Promise<{ updated: boolean; created: boolean; picklistValueCount?: number; dependencyCount?: number }> {
  const driver = getDriver();
  const session = driver.session();

  try {
    log.debug(
      `Refreshing Object node for: ${objectApiName} (includeFields: ${includeFields}, includeRecordTypes: ${includeRecordTypes})`
    );

    const apiName = objectApiName;
    let label = '';
    let description = '';

    // Classify the object
    const classification = classifyObject(apiName);

    // Extract additional properties if available
    if (metadataItem?.content && typeof metadataItem.content === 'object') {
      const content = metadataItem.content as Record<string, unknown>;
      if (content.CustomObject) {
        const customObj = content.CustomObject as Record<string, string[]>;
        label = customObj.label?.[0] || '';
        description = customObj.description?.[0] || '';
      } else {
        label = (content.label as string) || '';
        description = (content.description as string) || '';
      }
    }

    const result = await session.executeWrite(async (tx: ManagedTransaction) => {
      const existingResult = await tx.run(
        `MATCH (o:Object)
         WHERE toLower(o.apiName) = toLower($apiName)
         AND ($orgId IS NULL OR o.orgId = $orgId)
         RETURN o`,
        { apiName, orgId: orgId || null }
      );

      const exists = existingResult.records.length > 0;

      const objectDefinition: ObjectDefinition = {
        apiName,
        label,
        description,
        category: classification.category,
        subtype: classification.subtype,
        namespace: classification.namespace,
        parentObjectName: classification.parentObjectName,
      };

      if (orgId && !metadataItem.orgId) {
        metadataItem.orgId = orgId;
      }

      const objectHandler = new CustomObjectHandler();
      await objectHandler.processObjectDefinition(tx, {
        ...objectDefinition,
        orgId,
      });

      let picklistValueCount = 0;
      let dependencyCount = 0;

      if (includeFields) {
        try {
          const result = await processObjectFields(tx, objectApiName, orgId);
          picklistValueCount = result.picklistValueCount;
          dependencyCount = result.dependencyCount;
        } catch (error) {
          log.error(
            { err: error },
            `Error processing fields for object ${objectApiName}`
          );
        }
      }

      if (includeRecordTypes) {
        try {
          await processObjectRecordTypes(tx, objectApiName, orgId);
        } catch (error) {
          log.error(
            { err: error },
            `Error processing record types for object ${objectApiName}`
          );
        }
      }

      return { updated: exists, created: !exists, picklistValueCount, dependencyCount };
    });

    log.debug(
      `Object node refresh completed for ${objectApiName}: ${result.created ? 'Created' : 'Updated'}`
    );
    return result;
  } catch (error) {
    log.error({ err: error }, `Error refreshing Object node for ${objectApiName}`);
    throw new Error(
      `Failed to refresh Object node for ${objectApiName}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

// === Helper Functions ===

async function processObjectRecordTypes(
  tx: Transaction | ManagedTransaction,
  objectApiName: string,
  orgId?: string
): Promise<void> {
  const { fetchObjectRecordTypes } = await import('../salesforce.js');
  const recordTypes = await fetchObjectRecordTypes(objectApiName);
  log.debug(
    `Processing ${recordTypes.length} record types for object ${objectApiName}`
  );

  const objectHandler = new CustomObjectHandler();

  for (const recordType of recordTypes) {
    const recordTypeDefinition: RecordTypeDefinition = {
      apiName: recordType.apiName,
      sobjectType: recordType.sobjectType,
      label: recordType.label,
      description: recordType.description,
      isActive: recordType.isActive,
      isDefault: recordType.isDefault,
    };

    await objectHandler.processRecordTypeDefinition(
      tx,
      recordTypeDefinition,
      orgId
    );
  }
}

async function processObjectFields(
  tx: Transaction | ManagedTransaction,
  objectApiName: string,
  orgId?: string
): Promise<{ success: boolean; picklistValueCount: number; dependencyCount: number }> {
  try {
    const { fetchObjectFields } = await import('../salesforce.js');
    const fields: FieldMetadata[] = await fetchObjectFields(objectApiName);

    if (!fields || fields.length === 0) {
      log.debug(
        `No fields found for object ${objectApiName}, skipping field processing`
      );
      return { success: true, picklistValueCount: 0, dependencyCount: 0 };
    }

    log.debug(
      `Processing ${fields.length} fields for object ${objectApiName}`
    );

    const fieldHandler = new CustomFieldHandler();
    let totalPicklistValues = 0;
    let dependencyCount = 0;

    for (const field of fields) {
      // Use relationshipType (Lookup/MasterDetail) for relationship fields,
      // otherwise use fieldType for the handler to create REFERENCES edges
      const fieldType = field.relationshipType || field.fieldType;

      // Classify the field
      const fieldClassification = classifyField(field.apiName);

      const fieldDefinition: FieldDefinition = {
        apiName: field.apiName,
        sobjectType: field.sobjectType,
        label: field.label,
        type: fieldType,
        description: field.description,
        helpText: field.helpText,
        nillable: field.nillable,
        unique: field.unique,
        category: fieldClassification.category,
        namespace: fieldClassification.namespace,
        required: !field.nillable,
        referenceTo: field.referenceTo,
        relationshipName: field.relationshipName,
        relationshipType: field.relationshipType,
        // SOQL-relevant properties
        calculated: field.calculated,
        filterable: field.filterable,
        sortable: field.sortable,
        groupable: field.groupable,
        length: field.length,
        precision: field.precision,
        scale: field.scale,
        controllerName: field.controllerName || undefined,
      };

      await fieldHandler.processFieldDefinition(tx, fieldDefinition, orgId);

      // Handle Dependencies (Drift + Create)
      if (fieldDefinition.controllerName) {
        // Clear existing relationship first (Drift handling)
        await tx.run(
          `
          MATCH (f1:Field {apiName: $apiName, sobjectType: $sobjectType})
          WHERE ($orgId IS NULL OR f1.orgId = $orgId)
          MATCH (f1)-[r:CONTROLLED_BY]->()
          DELETE r
          `,
          {
            apiName: fieldDefinition.apiName,
            sobjectType: fieldDefinition.sobjectType,
            orgId: orgId || null,
          }
        );

        // Create new relationship
        await tx.run(
          `
          MATCH (f1:Field {apiName: $apiName, sobjectType: $sobjectType})
          WHERE ($orgId IS NULL OR f1.orgId = $orgId)
          MATCH (f2:Field {apiName: $controllerName, sobjectType: $sobjectType})
          WHERE ($orgId IS NULL OR f2.orgId = $orgId)
          MERGE (f1)-[:CONTROLLED_BY]->(f2)
          `,
          {
            apiName: fieldDefinition.apiName,
            sobjectType: fieldDefinition.sobjectType,
            controllerName: fieldDefinition.controllerName,
            orgId: orgId || null,
          }
        );
        dependencyCount++;
      } else {
        // Ensure no stray relationship if controller was removed
        await tx.run(
          `
          MATCH (f1:Field {apiName: $apiName, sobjectType: $sobjectType})
          WHERE ($orgId IS NULL OR f1.orgId = $orgId)
          MATCH (f1)-[r:CONTROLLED_BY]->()
          DELETE r
          `,
          {
            apiName: fieldDefinition.apiName,
            sobjectType: fieldDefinition.sobjectType,
            orgId: orgId || null,
          }
        );
      }

      // Process picklist values if present
      if (
        (field.fieldType === 'picklist' || field.fieldType === 'multipicklist') &&
        field.picklistValues &&
        field.picklistValues.length > 0
      ) {
        // field.picklistValues is already PicklistValue[] thanks to salesforce.ts update
        const count = await processPicklistValues(
          tx,
          objectApiName,
          field.apiName,
          field.picklistValues,
          orgId
        );
        totalPicklistValues += count;
      }
    }

    return { success: true, picklistValueCount: totalPicklistValues, dependencyCount };
  } catch (error) {
    log.error(
      { err: error },
      `Error processing fields for object ${objectApiName}`
    );
    throw error;
  }
}

// === Relationship Sync ===

/**
 * Sync relationships for a specific object
 */
export async function syncObjectRelationships(
  objectApiName: string,
  orgId?: string
): Promise<SyncStats> {
  const driver = getDriver();
  const session = driver.session();

  try {
    log.debug(`Syncing relationships for object: ${objectApiName}`);

    const { fetchObjectFields } = await import('../salesforce.js');
    const fields: FieldMetadata[] = await fetchObjectFields(objectApiName);

    if (!fields || fields.length === 0) {
      log.debug(
        `No fields found for object ${objectApiName}, skipping relationship processing`
      );
      return { created: 0, updated: 0, total: 0 };
    }

    const referenceFields = fields.filter(
      (field) => field.referenceTo && field.apiName && field.sobjectType
    );
    log.debug(
      `Found ${referenceFields.length} reference fields for object ${objectApiName}`
    );

    if (referenceFields.length === 0) {
      log.debug(
        `No reference fields found for object ${objectApiName}, skipping relationship processing`
      );
      return { created: 0, updated: 0, total: 0 };
    }

    // Collect all unique target objects to fetch their child relationships
    const targetObjects = new Set<string>();
    for (const field of referenceFields) {
      if (field.referenceTo) {
        for (const target of field.referenceTo) {
          targetObjects.add(target);
        }
      }
    }

    // Fetch child relationships for each target object to get childRelationshipName
    // Build lookup: targetObject -> Map<childSObject:fieldName, relationshipName>
    const { fetchChildRelationships } = await import('../salesforce.js');
    const childRelationshipLookup = new Map<string, Map<string, string>>();
    
    for (const targetObject of targetObjects) {
      try {
        const childRels = await fetchChildRelationships(targetObject);
        const lookup = new Map<string, string>();
        for (const rel of childRels) {
          // Key is "childSObject:fieldName" e.g. "Contact:AccountId"
          lookup.set(`${rel.childSObject}:${rel.field}`, rel.relationshipName);
        }
        childRelationshipLookup.set(targetObject, lookup);
      } catch (err) {
        // Log but continue - not all objects may be describable
        log.debug({ err, targetObject }, 'Could not fetch child relationships for target object');
      }
    }

    const stats = await session.executeWrite(async (tx: ManagedTransaction) => {
      let created = 0;
      let updated = 0;

      // Classify the source object
      const sourceClassification = classifyObject(objectApiName);

      // Ensure source object exists
      const objectExists = await tx.run(
        `
          MATCH (o:Object)
          WHERE toLower(o.apiName) = toLower($apiName) AND ($orgId IS NULL OR o.orgId = $orgId)
          RETURN count(o) > 0 as exists
          `,
        { apiName: objectApiName, orgId }
      );

      if (!objectExists.records[0].get('exists')) {
        log.debug(
          `Object ${objectApiName} does not exist in the graph, creating it first`
        );
        await tx.run(
          `
            CREATE (o:Object {
              apiName: $apiName,
              label: $apiName,
              description: '',
              category: $category,
              subtype: $subtype,
              namespace: $namespace,
              parentObjectName: $parentObjectName,
              lastRefreshed: datetime(),
              name: $apiName,
              orgId: $orgId
            })
            `,
          {
            apiName: objectApiName,
            category: sourceClassification.category,
            subtype: sourceClassification.subtype,
            namespace: sourceClassification.namespace || null,
            parentObjectName: sourceClassification.parentObjectName || null,
            orgId: orgId || null,
          }
        );
      }

      for (const field of referenceFields) {
        if (!field.referenceTo) continue;

        const relType =
          field.relationshipType === 'MasterDetail' ? 'MASTER_DETAIL' : 'LOOKS_UP';
        const relationshipType = field.relationshipType || 'Lookup';

        // Classify the field
        const fieldClassification = classifyField(field.apiName);

        try {
          // Check if field exists
          const fieldExists = await tx.run(
            `
              MATCH (f:Field)
              WHERE f.apiName = $fieldApiName AND f.sobjectType = $sobjectType AND ($orgId IS NULL OR f.orgId = $orgId)
              RETURN count(f) > 0 as exists
              `,
            {
              fieldApiName: field.apiName,
              sobjectType: field.sobjectType,
              orgId,
            }
          );

          if (!fieldExists.records[0].get('exists')) {
            log.debug(
              `Field ${field.apiName} does not exist in the graph, creating it first`
            );
            await tx.run(
              `
                CREATE (f:Field {
                  apiName: $apiName,
                  sobjectType: $sobjectType,
                  label: $label,
                  type: $type,
                  description: $description,
                  helpText: $helpText,
                  nillable: $nillable,
                  unique: $unique,
                  category: $category,
                  namespace: $namespace,
                  relationshipName: $relationshipName,
                  lastRefreshed: datetime(),
                  name: $apiName,
                  orgId: $orgId
                })
                `,
              {
                apiName: field.apiName,
                sobjectType: field.sobjectType,
                label: field.label,
                type: field.fieldType,
                description: field.description,
                helpText: field.helpText,
                nillable: field.nillable,
                unique: field.unique,
                category: fieldClassification.category,
                namespace: fieldClassification.namespace || null,
                relationshipName: field.relationshipName || null,
                orgId: orgId || null,
              }
            );

            await tx.run(
              `
                MATCH (o:Object), (f:Field)
                WHERE toLower(o.apiName) = toLower($objectApiName) AND ($orgId IS NULL OR o.orgId = $orgId)
                AND f.apiName = $fieldApiName AND f.sobjectType = $sobjectType AND ($orgId IS NULL OR f.orgId = $orgId)
                MERGE (o)-[:HAS_FIELD]->(f)
                `,
              {
                objectApiName,
                fieldApiName: field.apiName,
                sobjectType: field.sobjectType,
                orgId,
              }
            );
            created++;
          } else {
            updated++;
          }

          // Handle each reference target (support polymorphism)
          for (const targetApiName of field.referenceTo) {
            // Classify the target object
            const targetClassification = classifyObject(targetApiName);
            
            // Look up the child relationship name from the target object's perspective
            // This is used for SOQL subqueries: SELECT Name, (SELECT Name FROM Contacts) FROM Account
            const targetLookup = childRelationshipLookup.get(targetApiName);
            const childRelName = targetLookup?.get(`${objectApiName}:${field.apiName}`) || null;

            // Ensure target object exists
            const targetObjectExists = await tx.run(
              `
                MATCH (o:Object)
                WHERE toLower(o.apiName) = toLower($apiName) AND ($orgId IS NULL OR o.orgId = $orgId)
                RETURN count(o) > 0 as exists
                `,
              { apiName: targetApiName, orgId }
            );

            if (!targetObjectExists.records[0].get('exists')) {
              log.debug(
                `Target object ${targetApiName} does not exist in the graph, creating it first`
              );
              await tx.run(
                `
                  CREATE (o:Object {
                    apiName: $apiName,
                    label: $apiName,
                    description: '',
                    category: $category,
                    subtype: $subtype,
                    namespace: $namespace,
                    parentObjectName: $parentObjectName,
                    lastRefreshed: datetime(),
                    name: $apiName,
                    orgId: $orgId
                  })
                  `,
                {
                  apiName: targetApiName,
                  category: targetClassification.category,
                  subtype: targetClassification.subtype,
                  namespace: targetClassification.namespace || null,
                  parentObjectName: targetClassification.parentObjectName || null,
                  orgId: orgId || null,
                }
              );
            }

            // Create relationship from field to target object
            await tx.run(
              `
                MATCH (f:Field), (o:Object)
                WHERE f.apiName = $fieldApiName AND f.sobjectType = $sobjectType AND ($orgId IS NULL OR f.orgId = $orgId)
                AND toLower(o.apiName) = toLower($targetApiName) AND ($orgId IS NULL OR o.orgId = $orgId)
                MERGE (f)-[:${relType} {relationshipType: $relationshipType}]->(o)
                `,
              {
                fieldApiName: field.apiName,
                sobjectType: field.sobjectType,
                targetApiName: targetApiName,
                relationshipType,
                orgId,
              }
            );

            // Create REFERENCES relationship between objects with childRelationshipName for SOQL
            await tx.run(
              `
              MATCH (source:Object), (target:Object)
              WHERE toLower(source.apiName) = toLower($sourceObject) AND ($orgId IS NULL OR source.orgId = $orgId)
                AND toLower(target.apiName) = toLower($targetObject) AND ($orgId IS NULL OR target.orgId = $orgId)
              MERGE (source)-[r:REFERENCES]->(target)
              ON CREATE SET
                r.fields = [$fieldName],
                r.relationshipType = $relationshipType,
                r.childRelationshipNames = CASE WHEN $childRelName IS NOT NULL THEN [$childRelName] ELSE [] END
              ON MATCH SET
                r.fields = CASE
                  WHEN $fieldName IN coalesce(r.fields, []) THEN r.fields
                  ELSE coalesce(r.fields, []) + $fieldName
                END,
                r.relationshipType = CASE
                  WHEN $relationshipType = 'MASTER_DETAIL' THEN 'MASTER_DETAIL'
                  WHEN r.relationshipType = 'MASTER_DETAIL' THEN 'MASTER_DETAIL'
                  ELSE 'LOOKUP'
                END,
                r.childRelationshipNames = CASE
                  WHEN $childRelName IS NULL THEN coalesce(r.childRelationshipNames, [])
                  WHEN $childRelName IN coalesce(r.childRelationshipNames, []) THEN r.childRelationshipNames
                  ELSE coalesce(r.childRelationshipNames, []) + $childRelName
                END
              WITH r
              SET r.fieldCount = size(r.fields)
              `,
              {
                sourceObject: field.sobjectType,
                targetObject: targetApiName,
                fieldName: field.apiName,
                relationshipType:
                  relationshipType === 'MasterDetail' ? 'MASTER_DETAIL' : 'LOOKUP',
                childRelName,
                orgId,
              }
            );
          }
        } catch (error) {
          log.error(
            { err: error },
            `Error processing relationship for field ${field.apiName} of object ${objectApiName}`
          );
        }
      }

      return { created, updated, total: referenceFields.length };
    });

    log.debug(
      `Relationship sync completed for ${objectApiName}: ${stats.created} created, ${stats.updated} updated, ${stats.total} total`
    );
    return stats;
  } catch (error) {
    log.error(
      { err: error },
      `Error syncing relationships for object ${objectApiName}`
    );
    throw new Error(
      `Failed to sync relationships for object ${objectApiName}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

async function processPicklistValues(
  tx: Transaction | ManagedTransaction,
  objectApiName: string,
  fieldApiName: string,
  values: PicklistValue[],
  orgId?: string
): Promise<number> {
  try {
    // 1. Delete existing values for this field to handle drift (values removed/renamed)
    await tx.run(
      `
      MATCH (f:Field {apiName: $fieldApiName, sobjectType: $objectApiName})
      WHERE ($orgId IS NULL OR f.orgId = $orgId)
      MATCH (f)-[:HAS_VALUE]->(v:PicklistValue)
      DETACH DELETE v
      `,
      {
        fieldApiName,
        objectApiName,
        orgId: orgId || null,
      }
    );

    if (values.length === 0) {
      return 0;
    }

    // 2. Batch create new values using UNWIND
    // NOTE: This is called within a transaction, so we can't start new sessions here.
    // The batching happens at a higher level (in refreshObjectNodes) where we have session control.
    // For now, we'll create all values in this transaction but log progress.
    const batchSize = DEFAULTS.PICKLIST_BATCH_SIZE;
    let created = 0;

    // Split into chunks for better progress tracking
    for (let i = 0; i < values.length; i += batchSize) {
      const batch = values.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(values.length / batchSize);

      await tx.run(
        `
        MATCH (f:Field {apiName: $fieldApiName, sobjectType: $objectApiName})
        WHERE ($orgId IS NULL OR f.orgId = $orgId)
        
        UNWIND $values as val
        
        CREATE (v:PicklistValue {
          value: val.value,
          label: val.label,
          isActive: val.active,
          defaultValue: val.defaultValue,
          apiName: val.value,
          objectApiName: $objectApiName,
          fieldApiName: $fieldApiName,
          orgId: $orgId,
          validFor: val.validFor
        })
        
        CREATE (f)-[:HAS_VALUE]->(v)
        `,
        {
          fieldApiName,
          objectApiName,
          values: batch.map((v) => ({
            ...v,
            orgId: orgId || null,
          })),
          orgId: orgId || null,
        }
      );

      created += batch.length;

      // Log progress for large picklist fields
      if (totalBatches > 1) {
        log.debug(
          `Picklist batch ${batchNum}/${totalBatches} complete for ${objectApiName}.${fieldApiName} (${created}/${values.length} values)`
        );
      }
    }

    return created;
  } catch (error) {
    log.error(
      { err: error },
      `Error processing picklist values for ${objectApiName}.${fieldApiName}`
    );
    // Don't fail the whole sync for picklist errors, just log and return 0
    return 0;
  }
}



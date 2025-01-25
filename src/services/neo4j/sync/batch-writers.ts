/**
 * Batch Writers
 *
 * Neo4j batch write operations using UNWIND for efficient data ingestion.
 */

import type { Driver, ManagedTransaction } from 'neo4j-driver';
import { batchProcess } from '../../../core/concurrency.js';
import type {
  ObjectBatchData,
  FieldBatchData,
  FieldLinkData,
  RelationshipData,
  FieldDependencyData,
} from './types.js';

// === Batch Cypher Queries ===

const BATCH_UPSERT_OBJECTS = `
UNWIND $objects AS obj
MERGE (o:Object {apiName: obj.apiName, orgId: obj.orgId})
ON CREATE SET
  o.label = obj.label,
  o.category = obj.category,
  o.subtype = obj.subtype,
  o.namespace = obj.namespace,
  o.parentObjectName = obj.parentObjectName,
  o.keyPrefix = obj.keyPrefix,
  o.lastRefreshed = datetime(),
  o.name = obj.apiName
ON MATCH SET
  o.label = obj.label,
  o.category = obj.category,
  o.subtype = obj.subtype,
  o.namespace = obj.namespace,
  o.parentObjectName = obj.parentObjectName,
  o.keyPrefix = obj.keyPrefix,
  o.lastRefreshed = datetime()
`;

const BATCH_UPSERT_FIELDS = `
UNWIND $fields AS f
MERGE (field:Field {apiName: f.apiName, sobjectType: f.sobjectType, orgId: f.orgId})
ON CREATE SET
  field.label = f.label,
  field.type = f.type,
  field.nillable = f.nillable,
  field.unique = f.unique,
  field.category = f.category,
  field.namespace = f.namespace,
  field.referenceTo = f.referenceTo,
  field.relationshipName = f.relationshipName,
  field.relationshipType = f.relationshipType,
  field.calculated = f.calculated,
  field.filterable = f.filterable,
  field.sortable = f.sortable,
  field.groupable = f.groupable,
  field.length = f.length,
  field.precision = f.precision,
  field.scale = f.scale,
  field.controllerName = f.controllerName,
  field.isDependentPicklist = f.isDependentPicklist,
  field.lastRefreshed = datetime(),
  field.name = f.apiName
ON MATCH SET
  field.label = f.label,
  field.type = f.type,
  field.nillable = f.nillable,
  field.unique = f.unique,
  field.category = f.category,
  field.namespace = f.namespace,
  field.referenceTo = f.referenceTo,
  field.relationshipName = f.relationshipName,
  field.relationshipType = f.relationshipType,
  field.calculated = f.calculated,
  field.filterable = f.filterable,
  field.sortable = f.sortable,
  field.groupable = f.groupable,
  field.length = f.length,
  field.precision = f.precision,
  field.scale = f.scale,
  field.controllerName = f.controllerName,
  field.isDependentPicklist = f.isDependentPicklist,
  field.lastRefreshed = datetime()
`;

const BATCH_LINK_FIELDS_TO_OBJECTS = `
UNWIND $links AS link
MATCH (o:Object {apiName: link.objectName, orgId: link.orgId})
MATCH (f:Field {apiName: link.fieldName, sobjectType: link.objectName, orgId: link.orgId})
MERGE (o)-[:HAS_FIELD]->(f)
`;

// Create typed Field→Object relationships (LOOKS_UP or MASTER_DETAIL)
const BATCH_CREATE_FIELD_REFERENCES = `
UNWIND $refs AS ref
// Ensure target object exists
MERGE (target:Object {apiName: ref.targetObject, orgId: ref.orgId})
ON CREATE SET
  target.label = ref.targetObject,
  target.category = ref.targetCategory,
  target.subtype = ref.targetSubtype,
  target.namespace = ref.targetNamespace,
  target.parentObjectName = ref.targetParentObjectName,
  target.name = ref.targetObject

// Create typed field-to-object relationship based on relationshipType
WITH ref
MATCH (f:Field {apiName: ref.fieldName, sobjectType: ref.sourceObject, orgId: ref.orgId})
MATCH (t:Object {apiName: ref.targetObject, orgId: ref.orgId})
// Use LOOKS_UP for Lookup and Hierarchical, MASTER_DETAIL for MasterDetail
FOREACH (_ IN CASE WHEN ref.relationshipType IN ['Lookup', 'Hierarchical'] THEN [1] ELSE [] END |
  MERGE (f)-[:LOOKS_UP]->(t)
)
FOREACH (_ IN CASE WHEN ref.relationshipType = 'MasterDetail' THEN [1] ELSE [] END |
  MERGE (f)-[:MASTER_DETAIL]->(t)
)
`;

// Create aggregated Object→Object REFERENCES relationships
const BATCH_UPSERT_OBJECT_REFERENCES = `
UNWIND $refs AS ref
MATCH (source:Object {apiName: ref.sourceObject, orgId: ref.orgId})
MATCH (target:Object {apiName: ref.targetObject, orgId: ref.orgId})
MERGE (source)-[r:REFERENCES]->(target)
ON CREATE SET
  r.fields = [ref.fieldName],
  r.relationshipType = ref.relationshipType
ON MATCH SET
  r.fields = CASE
    WHEN ref.fieldName IN coalesce(r.fields, []) THEN r.fields
    ELSE coalesce(r.fields, []) + ref.fieldName
  END,
  r.relationshipType = CASE
    WHEN ref.relationshipType = 'MasterDetail' THEN 'MasterDetail'
    ELSE r.relationshipType
  END
WITH r
SET r.fieldCount = size(r.fields)
`;

// Create DERIVED_FROM edges for system-derived objects (e.g., AccountShare → Account)
const BATCH_CREATE_DERIVED_FROM = `
MATCH (derived:Object {orgId: $orgId})
WHERE derived.parentObjectName IS NOT NULL
MATCH (parent:Object {apiName: derived.parentObjectName, orgId: $orgId})
MERGE (derived)-[:DERIVED_FROM]->(parent)
`;

// === Batch Write Functions ===

/**
 * Batch write objects to Neo4j using UNWIND
 */
export async function batchWriteObjects(
  driver: Driver,
  objects: ObjectBatchData[],
  batchSize: number,
  onProgress: (current: number) => void
): Promise<void> {
  const session = driver.session();
  try {
    await batchProcess(
      objects,
      batchSize,
      async (batch) => {
        await session.executeWrite(async (tx: ManagedTransaction) => {
          await tx.run(BATCH_UPSERT_OBJECTS, { objects: batch });
        });
        return batch.length;
      },
      onProgress
    );
  } finally {
    await session.close();
  }
}

/**
 * Batch write fields and link to objects
 */
export async function batchWriteFields(
  driver: Driver,
  fields: FieldBatchData[],
  links: FieldLinkData[],
  batchSize: number,
  onProgress: (current: number) => void
): Promise<void> {
  const session = driver.session();
  try {
    await batchProcess(
      fields,
      batchSize,
      async (batch, batchIndex) => {
        const linkBatch = links.slice(
          batchIndex * batchSize,
          (batchIndex + 1) * batchSize
        );

        await session.executeWrite(async (tx: ManagedTransaction) => {
          await tx.run(BATCH_UPSERT_FIELDS, { fields: batch });
          await tx.run(BATCH_LINK_FIELDS_TO_OBJECTS, { links: linkBatch });
        });
        return batch.length;
      },
      onProgress
    );
  } finally {
    await session.close();
  }
}

/**
 * Batch write relationships with typed Field→Object edges
 */
export async function batchWriteRelationships(
  driver: Driver,
  refs: RelationshipData[],
  batchSize: number,
  onProgress: (current: number) => void
): Promise<void> {
  const session = driver.session();
  try {
    await batchProcess(
      refs,
      batchSize,
      async (batch) => {
        await session.executeWrite(async (tx: ManagedTransaction) => {
          // Create typed Field→Object edges (LOOKS_UP or MASTER_DETAIL)
          await tx.run(BATCH_CREATE_FIELD_REFERENCES, { refs: batch });
          // Create aggregated Object→Object REFERENCES edges
          await tx.run(BATCH_UPSERT_OBJECT_REFERENCES, { refs: batch });
        });
        return batch.length;
      },
      onProgress
    );
  } finally {
    await session.close();
  }
}

/**
 * Create DERIVED_FROM edges for system-derived objects (e.g., AccountShare → Account)
 */
export async function createDerivedFromEdges(
  driver: Driver,
  orgId: string
): Promise<void> {
  const session = driver.session();
  try {
    await session.executeWrite(async (tx: ManagedTransaction) => {
      await tx.run(BATCH_CREATE_DERIVED_FROM, { orgId });
    });
  } finally {
    await session.close();
  }
}

/**
 * Batch write picklist values and link to fields
 * 
 * Optimized approach:
 * 1. Bulk delete all old picklist values for the org (one query)
 * 2. Create picklist values AND relationships in one query (fast!)
 * 
 * This avoids expensive MATCH operations on freshly created nodes.
 */
export async function batchWritePicklistValues(
  driver: Driver,
  picklistValues: import('./types.js').PicklistValueBatchData[],
  batchSize: number,
  onProgress: (current: number) => void
): Promise<void> {
  const session = driver.session();
  try {
    // If no values to process, skip
    if (picklistValues.length === 0) {
      return;
    }

    const orgId = picklistValues[0].orgId;

    // Step 1: Bulk delete all existing picklist values for this org
    await session.executeWrite(async (tx: ManagedTransaction) => {
      await tx.run(
        `
        MATCH (v:PicklistValue {orgId: $orgId})
        DETACH DELETE v
        `,
        { orgId }
      );
    });

    // Step 2: Create picklist values AND relationships in one optimized query
    await batchProcess(
      picklistValues,
      batchSize,
      async (batch) => {
        await session.executeWrite(async (tx: ManagedTransaction) => {
          await tx.run(
            `
            UNWIND $values AS val
            // Match the field first
            MATCH (f:Field {apiName: val.fieldApiName, sobjectType: val.objectApiName, orgId: val.orgId})
            
            // Create the picklist value
            CREATE (v:PicklistValue {
              value: val.value,
              label: val.label,
              isActive: val.isActive,
              defaultValue: val.defaultValue,
              apiName: val.value,
              objectApiName: val.objectApiName,
              fieldApiName: val.fieldApiName,
              validFor: val.validFor,
              orgId: val.orgId
            })
            
            // Create the relationship immediately (no re-match needed!)
            CREATE (f)-[:HAS_VALUE]->(v)
            `,
            { values: batch }
          );
        });
        return batch.length;
      },
      onProgress
    );
  } finally {
    await session.close();
  }
}


/**
 * Batch write field dependencies (CONTROLLED_BY)
 * Handles drift by removing existing dependencies for the fields first.
 */
export async function batchWriteFieldDependencies(
  driver: Driver,
  dependencies: FieldDependencyData[],
  batchSize: number,
  onProgress: (current: number) => void
): Promise<void> {
  const session = driver.session();
  try {
    await batchProcess(
      dependencies,
      batchSize,
      async (batch) => {
        await session.executeWrite(async (tx: ManagedTransaction) => {
          await tx.run(
            `
            UNWIND $deps AS dep
            // Match the dependent field
            MATCH (f:Field {apiName: dep.sourceField, sobjectType: dep.objectName, orgId: dep.orgId})
            
            // Delete existing dependency to handle drift
            WITH f, dep
            OPTIONAL MATCH (f)-[r:CONTROLLED_BY]->(:Field)
            DELETE r
            
            // Create new dependency to controller
            WITH f, dep
            MATCH (c:Field {apiName: dep.controllerField, sobjectType: dep.objectName, orgId: dep.orgId})
            MERGE (f)-[:CONTROLLED_BY]->(c)
            `,
            { deps: batch }
          );
        });
        return batch.length;
      },
      onProgress
    );
  } finally {
    await session.close();
  }
}

/**
 * Describe-based Sync Service
 *
 * Syncs Salesforce schema to Neo4j using the Describe API.
 * Supports parallel processing with configurable concurrency and batch writes.
 */

import type { Connection } from 'jsforce';
import type { ManagedTransaction } from 'neo4j-driver';
import { getDriver } from './driver.js';
import {
  classifyObject,
  classifyField,
  isSystemDerivedObject,
  matchesCategory,
  ObjectCategory,
} from '../../core/object-classifier.js';
import {
  pLimit,
  retryWithBackoff,
  isRetryableError,
} from '../../core/concurrency.js';
import type {
  SyncProgressCallback,
  SyncPhaseError,
  SyncPhaseStats,
} from '../../core/types.js';
import { DEFAULTS } from '../../config/defaults.js';
import { createLogger } from '../../core/logger.js';

import {
  type DescribeResult,
  getRelationshipType,
  prepareObjectBatchData,
  prepareFieldBatchData,
  prepareRelationshipBatchData,
  preparePicklistBatchData,
  batchWriteObjects,
  batchWriteFields,
  batchWriteRelationships,
  batchWritePicklistValues,
  enrichPicklistValues,
  prepareFieldDependencyBatchData,
  batchWriteFieldDependencies,
  createDerivedFromEdges,
  handleDeletedObjects,
  clearOrgData as clearOrgDataInternal,
} from './sync/index.js';

import { rebuildSynonymIndex } from '../dynamic-synonym-service.js';
import { applyStandardDescriptions } from './standard-documentation.js';

const log = createLogger('describe-sync');

// === Types ===

export interface DescribeSyncResult {
  success: boolean;
  objectCount: number;
  fieldCount: number;
  relationshipCount: number;
  picklistValueCount?: number;
  dependencyCount?: number;
  deletedCount?: number;
  duration: number;
  error?: string;
  phaseStats?: {
    describing?: SyncPhaseStats;
    objects?: SyncPhaseStats;
    fields?: SyncPhaseStats;
    picklistValues?: SyncPhaseStats;
    picklistEnrichment?: SyncPhaseStats;
    relationships?: SyncPhaseStats;
    dependencies?: SyncPhaseStats;
  };
  errors?: SyncPhaseError[];
}

export interface DescribeSyncOptions {
  objectFilter?: string[];
  incremental?: boolean;
  excludeSystemObjects?: boolean;
  categoryFilter?: ObjectCategory[];
  onProgress?: SyncProgressCallback;
  concurrency?: number;
  batchSize?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

// Re-export for backward compatibility
export type ProgressCallback = SyncProgressCallback;

// === Main Sync Function ===

/**
 * Sync Salesforce schema to Neo4j using the Describe API.
 *
 * Uses phased parallel processing:
 * 1. Parallel SF describe calls (rate-limited)
 * 2. Batch Neo4j object writes
 * 3. Batch Neo4j field writes
 * 4. Batch Neo4j relationship writes
 */
export async function syncFromDescribe(
  connection: Connection,
  orgId: string,
  options: DescribeSyncOptions = {}
): Promise<DescribeSyncResult> {
  // Use sequential mode if concurrency is 1 (for testing/debugging)
  if (options.concurrency === 1) {
    return syncFromDescribeSequential(connection, orgId, options);
  }

  const driver = getDriver();
  const startTime = Date.now();
  const errors: SyncPhaseError[] = [];

  // Configuration with defaults
  const concurrency = options.concurrency ?? DEFAULTS.CONCURRENCY;
  const batchSize = options.batchSize ?? DEFAULTS.BATCH_SIZE;
  const retryAttempts = options.retryAttempts ?? DEFAULTS.RETRY_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULTS.RETRY_DELAY_MS;

  // Stats tracking
  const phaseStats: DescribeSyncResult['phaseStats'] = {
    describing: { duration: 0, count: 0, errors: 0 },
    objects: { duration: 0, count: 0, errors: 0 },
    fields: { duration: 0, count: 0, errors: 0 },
    relationships: { duration: 0, count: 0, errors: 0 },
    picklistValues: { duration: 0, count: 0, errors: 0 },
    picklistEnrichment: { duration: 0, count: 0, errors: 0 },
    dependencies: { duration: 0, count: 0, errors: 0 },
  };

  try {
    // =====================
    // Phase 0: Get object list
    // =====================
    options.onProgress?.({ phase: 'listing', current: 0, total: 0 });

    const objectNames = await getFilteredObjectNames(connection, options);
    const total = objectNames.length;
    log.debug({ total }, 'Found objects to sync');

    if (total === 0) {
      return {
        success: true,
        objectCount: 0,
        fieldCount: 0,
        relationshipCount: 0,
        duration: Date.now() - startTime,
        phaseStats,
      };
    }

    // =====================
    // Phase 1: Parallel SF describe calls
    // =====================
    const describeStart = Date.now();
    options.onProgress?.({ phase: 'describing', current: 0, total });

    const describeResults = await parallelDescribe(connection, objectNames, {
      concurrency,
      retryAttempts,
      retryDelayMs,
      onProgress: (current, objectName) => {
        options.onProgress?.({
          phase: 'describing',
          current,
          total,
          objectName,
        });
      },
      onError: (objectName, error) => {
        errors.push({
          phase: 'describing',
          objectName,
          error: error.message,
          retryable: isRetryableError(error),
        });
        phaseStats.describing!.errors++;
      },
    });

    phaseStats.describing!.duration = Date.now() - describeStart;
    phaseStats.describing!.count = describeResults.length;

    log.debug(
      { count: describeResults.length, total, duration: phaseStats.describing!.duration },
      'Describe phase complete'
    );

    // =====================
    // Phase 2: Batch create Object nodes
    // =====================
    const objectsStart = Date.now();
    const objectData = prepareObjectBatchData(describeResults, orgId);
    options.onProgress?.({
      phase: 'objects',
      current: 0,
      total: objectData.length,
    });

    await batchWriteObjects(driver, objectData, batchSize, (current) => {
      options.onProgress?.({
        phase: 'objects',
        current,
        total: objectData.length,
      });
    });

    phaseStats.objects!.duration = Date.now() - objectsStart;
    phaseStats.objects!.count = objectData.length;

    log.debug(
      { count: objectData.length, duration: phaseStats.objects!.duration },
      'Object nodes created'
    );

    // =====================
    // Phase 3: Batch create Field nodes
    // =====================
    const fieldsStart = Date.now();
    const { fieldData, linkData } = prepareFieldBatchData(
      describeResults,
      orgId
    );
    options.onProgress?.({
      phase: 'fields',
      current: 0,
      total: fieldData.length,
    });

    await batchWriteFields(driver, fieldData, linkData, batchSize, (current) => {
      options.onProgress?.({
        phase: 'fields',
        current,
        total: fieldData.length,
      });
    });

    phaseStats.fields!.duration = Date.now() - fieldsStart;
    phaseStats.fields!.count = fieldData.length;

    log.debug(
      { count: fieldData.length, duration: phaseStats.fields!.duration },
      'Field nodes created'
    );

    // =====================
    // Phase 3b: Batch create Picklist Values
    // =====================
    const picklistStart = Date.now();
    const picklistData = preparePicklistBatchData(describeResults, orgId);
    
    if (picklistData.length > 0) {
      options.onProgress?.({
        phase: 'picklistValues',
        current: 0,
        total: picklistData.length,
      });

      await batchWritePicklistValues(driver, picklistData, options.batchSize ?? DEFAULTS.PICKLIST_BATCH_SIZE, (current) => {
        options.onProgress?.({
          phase: 'picklistValues',
          current,
          total: picklistData.length,
        });
      });

      phaseStats.picklistValues!.duration = Date.now() - picklistStart;
      phaseStats.picklistValues!.count = picklistData.length;

      log.debug(
        { count: picklistData.length, duration: phaseStats.picklistValues!.duration },
        'Picklist values created'
      );
    } else {
      phaseStats.picklistValues!.duration = Date.now() - picklistStart;
    }

    // =====================
    // Phase 3c: Enrich Picklist Values
    // =====================
    const enrichmentStart = Date.now();
    let enrichedCount = 0;
    const enrichmentErrors: SyncPhaseError[] = [];

    options.onProgress?.({ phase: 'picklistEnrichment', current: 0, total: 0 });

    try {
      const result = await enrichPicklistValues(driver, connection, orgId);
      enrichedCount = result.count;
      enrichmentErrors.push(...result.errors);
      
      // Update progress with final count
      options.onProgress?.({ 
        phase: 'picklistEnrichment', 
        current: enrichedCount, 
        total: enrichedCount >= 0 ? enrichedCount : 0
      });

      phaseStats.picklistEnrichment!.duration = Date.now() - enrichmentStart;
      phaseStats.picklistEnrichment!.count = enrichedCount;
      phaseStats.picklistEnrichment!.errors = enrichmentErrors.length;

      if (enrichedCount > 0) {
        log.debug({ count: enrichedCount }, 'Picklist values enriched');
      }
    } catch (error) {
      log.warn({ error }, 'Picklist enrichment failed (non-fatal)');
      phaseStats.picklistEnrichment!.duration = Date.now() - enrichmentStart;
      phaseStats.picklistEnrichment!.count = 0;
      phaseStats.picklistEnrichment!.errors = 1;
      enrichmentErrors.push({
        phase: 'picklistEnrichment',
        error: error instanceof Error ? error.message : String(error),
        retryable: false,
      });
    }

    errors.push(...enrichmentErrors);

    // =====================
    // Phase 4: Batch create Relationships
    // =====================
    const relsStart = Date.now();
    const refData = prepareRelationshipBatchData(describeResults, orgId);
    options.onProgress?.({
      phase: 'relationships',
      current: 0,
      total: refData.length,
    });

    await batchWriteRelationships(driver, refData, batchSize, (current) => {
      options.onProgress?.({
        phase: 'relationships',
        current,
        total: refData.length,
      });
    });

    phaseStats.relationships!.duration = Date.now() - relsStart;
    phaseStats.relationships!.count = refData.length;

    log.debug(
      { count: refData.length, duration: phaseStats.relationships!.duration },
      'Relationships created'
    );

    await createDerivedFromEdges(driver, orgId);

    // =====================
    // Phase 4c: Field Dependencies
    // =====================
    const depsStart = Date.now();
    const depData = prepareFieldDependencyBatchData(describeResults, orgId);
    
    if (depData.length > 0) {
      options.onProgress?.({
        phase: 'dependencies',
        current: 0,
        total: depData.length
      });

      await batchWriteFieldDependencies(driver, depData, batchSize, (current) => {
        options.onProgress?.({
          phase: 'dependencies',
          current,
          total: depData.length
        });
      });

      phaseStats.dependencies!.duration = Date.now() - depsStart;
      phaseStats.dependencies!.count = depData.length;

      log.debug(
        { count: depData.length, duration: phaseStats.dependencies!.duration },
        'Field dependencies created'
      );
    }

    // =====================
    // Phase 5: Handle deleted objects (incremental mode)
    // =====================
    let deletedCount = 0;
    if (options.incremental) {
      options.onProgress?.({ phase: 'cleanup', current: 0, total: 0 });
      deletedCount = await handleDeletedObjects(
        driver,
        orgId,
        objectNames
      );
    }

    // =====================
    // Phase 6: Apply standard documentation
    // =====================
    try {
      // Get API version from connection for version-specific descriptions
      const apiVersion = connection.version || '62.0';
      const descriptionsApplied = await applyStandardDescriptions(driver, orgId, apiVersion);
      if (descriptionsApplied > 0) {
        log.debug({ count: descriptionsApplied, apiVersion }, 'Standard documentation applied');
      }
    } catch (descError) {
      // Non-fatal - log and continue
      log.warn({ error: descError }, 'Could not apply standard documentation');
    }

    // =====================
    // Phase 7: Rebuild synonym index
    // =====================
    try {
      await rebuildSynonymIndex(orgId);
      log.debug({ orgId }, 'Synonym index rebuilt');
    } catch (synonymError) {
      // Non-fatal - log and continue
      log.warn({ error: synonymError }, 'Could not rebuild synonym index');
    }

    const duration = Date.now() - startTime;
    log.debug({ duration }, 'Sync completed');

    return {
      success: errors.length === 0,
      objectCount: phaseStats.objects!.count,
      fieldCount: phaseStats.fields!.count,
      relationshipCount: phaseStats.relationships!.count,
      deletedCount,
      duration,
      phaseStats,
      picklistValueCount: phaseStats.picklistValues!.count,
      dependencyCount: phaseStats.dependencies!.count,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    log.error({ error }, 'Sync failed');
    return {
      success: false,
      objectCount: phaseStats.objects?.count ?? 0,
      fieldCount: phaseStats.fields?.count ?? 0,
      relationshipCount: phaseStats.relationships?.count ?? 0,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
      phaseStats,
      errors,
    };
  }
}

// === Helper Functions ===

/**
 * Get filtered list of object names to sync
 */
async function getFilteredObjectNames(
  connection: Connection,
  options: DescribeSyncOptions
): Promise<string[]> {
  const globalDescribe = await connection.describeGlobal();
  let objectNames = globalDescribe.sobjects
    .filter((obj) => obj.queryable)
    .map((obj) => obj.name);

  // Apply object filter
  if (options.objectFilter && options.objectFilter.length > 0) {
    const filterLower = options.objectFilter.map((f) => f.toLowerCase());
    objectNames = objectNames.filter((name) =>
      filterLower.includes(name.toLowerCase())
    );
  }

  // Filter out system-derived objects
  if (options.excludeSystemObjects) {
    objectNames = objectNames.filter((name) => !isSystemDerivedObject(name));
  }

  // Apply category filter
  if (options.categoryFilter && options.categoryFilter.length > 0) {
    objectNames = objectNames.filter((name) =>
      matchesCategory(name, options.categoryFilter!)
    );
  }

  return objectNames;
}

/**
 * Parallel describe with concurrency control and retry
 */
async function parallelDescribe(
  connection: Connection,
  objectNames: string[],
  options: {
    concurrency: number;
    retryAttempts: number;
    retryDelayMs: number;
    onProgress: (current: number, objectName: string) => void;
    onError: (objectName: string, error: Error) => void;
  }
): Promise<DescribeResult[]> {
  const limit = pLimit(options.concurrency);
  let completed = 0;
  const results: DescribeResult[] = [];

  const promises = objectNames.map((objectName) =>
    limit(async () => {
      try {
        const describe = await retryWithBackoff(
          () => connection.describe(objectName),
          {
            attempts: options.retryAttempts,
            delayMs: options.retryDelayMs,
            shouldRetry: isRetryableError,
            onRetry: (error, attempt, delayMs) => {
              log.warn(
                { objectName, attempt, delayMs, error: error.message },
                'Retrying describe'
              );
            },
          }
        );

        completed++;
        options.onProgress(completed, objectName);
        results.push({ objectName, describe });
      } catch (error) {
        completed++;
        options.onProgress(completed, objectName);
        options.onError(objectName, error as Error);
      }
    })
  );

  await Promise.all(promises);
  return results;
}

// === Sequential Sync (Fallback) ===

/**
 * Sequential sync - original implementation for fallback/testing
 */
async function syncFromDescribeSequential(
  connection: Connection,
  orgId: string,
  options: DescribeSyncOptions = {}
): Promise<DescribeSyncResult> {
  const driver = getDriver();
  const session = driver.session();
  const startTime = Date.now();

  let objectCount = 0;
  let fieldCount = 0;
  let relationshipCount = 0;

  try {
    options.onProgress?.({ phase: 'listing', current: 0, total: 0 });

    const objectNames = await getFilteredObjectNames(connection, options);
    const total = objectNames.length;
    log.debug({ total }, 'Found objects to sync (sequential mode)');

    for (let i = 0; i < objectNames.length; i++) {
      const objectName = objectNames[i];
      options.onProgress?.({
        phase: 'describing',
        current: i + 1,
        total,
        objectName,
      });

      try {
        const describe = await connection.describe(objectName);
        const objectClassification = classifyObject(describe.name);

        // Create/update Object node
        await session.executeWrite(async (tx: ManagedTransaction) => {
          await tx.run(
            `
            MERGE (o:Object {apiName: $apiName, orgId: $orgId})
            ON CREATE SET
              o.label = $label,
              o.category = $category,
              o.subtype = $subtype,
              o.namespace = $namespace,
              o.parentObjectName = $parentObjectName,
              o.keyPrefix = $keyPrefix,
              o.lastRefreshed = datetime(),
              o.name = $apiName
            ON MATCH SET
              o.label = $label,
              o.category = $category,
              o.subtype = $subtype,
              o.namespace = $namespace,
              o.parentObjectName = $parentObjectName,
              o.keyPrefix = $keyPrefix,
              o.lastRefreshed = datetime()
            `,
            {
              apiName: describe.name,
              orgId,
              label: describe.label,
              category: objectClassification.category,
              subtype: objectClassification.subtype,
              namespace: objectClassification.namespace || null,
              parentObjectName: objectClassification.parentObjectName || null,
              keyPrefix: describe.keyPrefix || null,
            }
          );
        });

        objectCount++;

        // Process fields
        for (const field of describe.fields) {
          const fieldClassification = classifyField(field.name);
          const relationshipType = getRelationshipType(field, objectName);

          await session.executeWrite(async (tx: ManagedTransaction) => {
            await tx.run(
              `
              MERGE (f:Field {apiName: $apiName, sobjectType: $sobjectType, orgId: $orgId})
              ON CREATE SET
                f.label = $label,
                f.type = $type,
                f.nillable = $nillable,
                f.unique = $unique,
                f.category = $category,
                f.namespace = $namespace,
                f.referenceTo = $referenceTo,
                f.relationshipName = $relationshipName,
                f.relationshipType = $relationshipType,
                f.calculated = $calculated,
                f.filterable = $filterable,
                f.sortable = $sortable,
                f.groupable = $groupable,
                f.length = $length,
                f.precision = $precision,
                f.scale = $scale,
                f.lastRefreshed = datetime(),
                f.name = $apiName
              ON MATCH SET
                f.label = $label,
                f.type = $type,
                f.nillable = $nillable,
                f.unique = $unique,
                f.category = $category,
                f.namespace = $namespace,
                f.referenceTo = $referenceTo,
                f.relationshipName = $relationshipName,
                f.relationshipType = $relationshipType,
                f.calculated = $calculated,
                f.filterable = $filterable,
                f.sortable = $sortable,
                f.groupable = $groupable,
                f.length = $length,
                f.precision = $precision,
                f.scale = $scale,
                f.lastRefreshed = datetime()
              `,
              {
                apiName: field.name,
                sobjectType: objectName,
                orgId,
                label: field.label,
                type: field.type,
                nillable: field.nillable,
                unique: field.unique,
                category: fieldClassification.category,
                namespace: fieldClassification.namespace || null,
                // Store full array for polymorphic lookups
                referenceTo:
                  field.referenceTo && field.referenceTo.length > 0
                    ? field.referenceTo
                    : null,
                relationshipName: field.relationshipName || null,
                relationshipType,
                // SOQL-relevant properties
                calculated: field.calculated ?? false,
                filterable: field.filterable ?? true,
                sortable: field.sortable ?? true,
                groupable: field.groupable ?? true,
                length: field.length ?? null,
                precision: field.precision ?? null,
                scale: field.scale ?? null,
              }
            );

            await tx.run(
              `
              MATCH (o:Object {apiName: $objectName, orgId: $orgId})
              MATCH (f:Field {apiName: $fieldName, sobjectType: $objectName, orgId: $orgId})
              MERGE (o)-[:HAS_FIELD]->(f)
              `,
              {
                objectName,
                fieldName: field.name,
                orgId,
              }
            );
          });

          fieldCount++;

          // Create relationships for reference fields
          if (
            field.type === 'reference' &&
            field.referenceTo &&
            field.referenceTo.length > 0
          ) {
            for (const targetObject of field.referenceTo) {
              const targetClassification = classifyObject(targetObject);

              await session.executeWrite(async (tx: ManagedTransaction) => {
                await tx.run(
                  `
                  MERGE (o:Object {apiName: $apiName, orgId: $orgId})
                  ON CREATE SET
                    o.label = $apiName,
                    o.category = $category,
                    o.subtype = $subtype,
                    o.namespace = $namespace,
                    o.parentObjectName = $parentObjectName,
                    o.name = $apiName
                  `,
                  {
                    apiName: targetObject,
                    orgId,
                    category: targetClassification.category,
                    subtype: targetClassification.subtype,
                    namespace: targetClassification.namespace || null,
                    parentObjectName:
                      targetClassification.parentObjectName || null,
                  }
                );

                await tx.run(
                  `
                  MATCH (source:Object {apiName: $sourceObject, orgId: $orgId})
                  MATCH (target:Object {apiName: $targetObject, orgId: $orgId})
                  MERGE (source)-[r:REFERENCES]->(target)
                  ON CREATE SET
                    r.fieldCount = 1,
                    r.relationshipType = $relationshipType,
                    r.fields = [$fieldName]
                  ON MATCH SET
                    r.fields = CASE
                      WHEN $fieldName IN coalesce(r.fields, []) THEN r.fields
                      ELSE coalesce(r.fields, []) + $fieldName
                    END,
                    r.fieldCount = size(CASE
                      WHEN $fieldName IN coalesce(r.fields, []) THEN r.fields
                      ELSE coalesce(r.fields, []) + $fieldName
                    END),
                    r.relationshipType = CASE
                      WHEN $relationshipType = 'MasterDetail' THEN 'MasterDetail'
                      ELSE r.relationshipType
                    END
                  `,
                  {
                    sourceObject: objectName,
                    targetObject,
                    fieldName: field.name,
                    relationshipType: relationshipType!,
                    orgId,
                  }
                );

                // Create typed Field→Object edge (LOOKS_UP or MASTER_DETAIL)
                const fieldEdgeType = relationshipType === 'MasterDetail' ? 'MASTER_DETAIL' : 'LOOKS_UP';
                await tx.run(
                  `
                  MATCH (f:Field {apiName: $fieldName, sobjectType: $sourceObject, orgId: $orgId})
                  MATCH (t:Object {apiName: $targetObject, orgId: $orgId})
                  MERGE (f)-[:${fieldEdgeType}]->(t)
                  `,
                  {
                    fieldName: field.name,
                    sourceObject: objectName,
                    targetObject,
                    orgId,
                  }
                );
              });

              relationshipCount++;
            }
          }
        }
      } catch (objectError) {
        log.warn(
          { objectName, error: objectError instanceof Error ? objectError.message : objectError },
          'Could not describe object'
        );
      }
    }

    // Create DERIVED_FROM edges for system objects
    await createDerivedFromEdges(driver, orgId);

    // Handle deleted objects in incremental mode
    let deletedCount = 0;
    if (options.incremental) {
      deletedCount = await handleDeletedObjects(driver, orgId, objectNames);
    }

    return {
      success: true,
      objectCount,
      fieldCount,
      relationshipCount,
      deletedCount,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      objectCount,
      fieldCount,
      relationshipCount,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await session.close();
  }
}

/**
 * Clear all synced data for an org
 */
export async function clearOrgData(orgId: string): Promise<void> {
  const driver = getDriver();
  await clearOrgDataInternal(driver, orgId);
}

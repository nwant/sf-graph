/**
 * API Service - Core Business Logic Layer
 *
 * This is the central API that all interfaces (CLI, MCP, REST) consume.
 * It wraps the underlying services (neo4j, salesforce, llm) and provides
 * a unified interface with proper typing.
 *
 * NOTE: Many of the imported services are still JavaScript without type declarations.
 * We use explicit casts and type assertions to bridge the gap during incremental migration.
 */

import type {
  SalesforceObject,
  RelatedObject,
  SyncOptions,
  SyncResult,
  SoqlOptions,
  SoqlResult,
  QueryResult,
  OrgInfo,
  OrgStatus,
  SchemaComparison,
  ObjectDetails,
  ObjectPath,
  PathFindingResult,
  GraphStatus,
  LlmStatus,
  SampleDataResult,
} from './types.js';

import { classifyObject, classifyField } from './object-classifier.js';
import { DEFAULTS } from '../config/defaults.js';
import { createLogger } from './logger.js';

const log = createLogger('api-service');

// Load environment variables for CLI context


// === Typed Service Imports ===
import {
  initSalesforceConnection,
  fetchObjectMetadata,
  setConnection,
  conn,
} from '../services/salesforce.js';
import {
  refreshSingleObjectNode,
  syncObjectRelationships,
} from '../services/neo4j/sync-service.js';
import { syncFromDescribe, clearOrgData } from '../services/neo4j/describe-sync.js';
import { initNeo4jDriver, closeDriver } from '../services/neo4j/driver.js';
import {
  ObjectNotFoundError,
  ConfigurationError,
  LlmError,
} from './errors.js';
import { loadConfig } from '../agent/config.js';

// === Typed Service Imports ===
import {
  getAllObjects,
  getObjectByApiName,
  getObjectFields,
  getObjectRelationships,
  findRelatedObjects,
  findObjectPaths,
  findDetailedPaths,
  findSoqlPaths,
  executeRead,
  type GraphField,
  type GraphRelationship,
  type RelatedObjectPreview,
  type ObjectPath as GraphObjectPath,
} from '../services/neo4j/index.js';
import {
  listAuthenticatedOrgs,
  getDefaultOrgAlias,
  executeSoqlViaCli,
  isSfCliInstalled,
  type AuthenticatedOrg,
} from '../services/sf-cli.js';
import { generateSoqlFromNaturalLanguage } from '../services/soql-generator.js';
import {
  isLLMAvailable,
  getAvailableModels,
  processWithLLM,
  type LlmModel as ServiceLlmModel,
} from '../services/llm-service.js';

import {
  generateSampleData as generateSampleDataService,
  generateRelatedSampleData as generateRelatedSampleDataService,
} from '../services/sample-data-generator.js';
import {
  compareOrgSchemas,
  compareObjectBetweenOrgs,
  getSyncedOrgs,
  type SchemaComparisonResult,
  type ObjectComparisonResult,
  type OrgSyncSummary,
} from '../services/schema-compare.js';

/**
 * Central API Service class
 *
 * All business logic lives here. CLI commands, MCP tools, and REST routes
 * should all call methods on this class rather than accessing services directly.
 */
export class ApiService {
  private neo4jInitialized = false;

  /**
   * Ensure Neo4j driver is initialized.
   * This is needed for CLI context where the server doesn't initialize it.
   */
  private async ensureNeo4jInitialized(): Promise<void> {
    if (!this.neo4jInitialized) {
      await initNeo4jDriver();
      this.neo4jInitialized = true;
    }
  }

  /**
   * Initialize Salesforce connection for a specific org.
   * Returns true if successfully connected.
   */
  private async initSalesforce(orgId: string): Promise<void> {
    await initSalesforceConnection(orgId);
  }

  /**
   * Cleanup resources. Should be called when CLI commands complete.
   * This closes the Neo4j driver connection to allow process to exit.
   */
  async cleanup(): Promise<void> {
    if (this.neo4jInitialized) {
      await closeDriver();
      this.neo4jInitialized = false;
    }
  }
  // === Graph Status ===

  async getGraphStatus(orgId?: string): Promise<GraphStatus> {
    await this.ensureNeo4jInitialized();
    try {
      const objects = await getAllObjects({ orgId });
      const hasObjects = objects && objects.length > 0;

      return {
        populated: hasObjects,
        objectCount: objects?.length || 0,
        orgId,
      };
    } catch (err) {
      log.debug({ err, orgId }, 'Failed to get graph status, returning empty');
      return {
        populated: false,
        objectCount: 0,
        orgId,
      };
    }
  }

  /**
   * Check if an org has data in the graph.
   * Throws a helpful error if not.
   */
  async checkOrgHasData(orgId?: string): Promise<void> {
    const status = await this.getGraphStatus(orgId);
    if (!status.populated) {
      const orgMsg = orgId ? ` for org '${orgId}'` : '';
      throw new Error(
        `No metadata found in graph${orgMsg}. Please sync first:\n\n` +
        `  sf graph sync${orgId ? ` -o ${orgId}` : ''}\n`
      );
    }
  }

  // === Graph Queries ===

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async executeQuery(query: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
    await this.ensureNeo4jInitialized();
    const records = await executeRead<Record<string, unknown>>(query, params);
    return records.map((record) => record.toObject());
  }

  // === Objects ===

  async listObjects(orgId?: string): Promise<SalesforceObject[]> {
    await this.ensureNeo4jInitialized();
    const objects = await getAllObjects({ orgId });
    return objects.map((obj: Record<string, unknown>) => {
      const apiName = String(obj.apiName);
      const classification = classifyObject(apiName);
      return {
        apiName,
        label: String(obj.label),
        category: classification.category,
        subtype: classification.subtype,
        namespace: classification.namespace,
        parentObjectName: classification.parentObjectName,
        keyPrefix: obj.keyPrefix ? String(obj.keyPrefix) : undefined,
        orgId,
      };
    });
  }

  async getObject(apiName: string, orgId?: string): Promise<ObjectDetails | null> {
    await this.ensureNeo4jInitialized();
    const object = await getObjectByApiName(apiName, { orgId });
    if (!object) return null;

    const fields = await getObjectFields(apiName, { orgId });
    const relationships = await getObjectRelationships(apiName, { orgId });

    const objectClassification = classifyObject(apiName);

    return {
      apiName: String(object.apiName),
      label: String(object.label),
      category: objectClassification.category,
      subtype: objectClassification.subtype,
      namespace: objectClassification.namespace,
      parentObjectName: objectClassification.parentObjectName,
      keyPrefix: object.keyPrefix ? String(object.keyPrefix) : undefined,
      orgId,
      fields: fields.map((f: GraphField) => {
        const fieldClassification = classifyField(f.apiName);
        // Handle referenceTo as array (polymorphic support)
        let referenceTo: string[] | undefined;
        if (f.referenceTo) {
          referenceTo = Array.isArray(f.referenceTo) ? f.referenceTo : [f.referenceTo];
        }
        return {
          apiName: f.apiName,
          label: f.label,
          type: f.type,
          referenceTo,
          category: fieldClassification.category,
          namespace: fieldClassification.namespace,
          required: !f.nillable,
          unique: f.unique,
          externalId: false, // Not in GraphField, default to false
          relationshipName: f.relationshipName ?? undefined,
          relationshipType: f.relationshipType as 'Lookup' | 'MasterDetail' | 'Hierarchical' | undefined,
          // SOQL-relevant properties
          calculated: f.calculated,
          filterable: f.filterable,
          sortable: f.sortable,
          groupable: f.groupable,
          length: f.length ?? undefined,
          precision: f.precision ?? undefined,
          scale: f.scale ?? undefined,
          picklistValues: f.picklistValues,
        };
      }),
      relationships: relationships.map((r: GraphRelationship) => {
        // Handle referenceTo as array (polymorphic support)
        const referenceTo: string[] = r.referenceTo ?? [];
        return {
          fieldApiName: r.fieldApiName ?? '',
          fieldLabel: r.fieldLabel,
          fieldDescription: r.fieldDescription,
          relationshipName: r.relationshipName ?? '',
          referenceTo,
          relationshipType: r.relationshipType as 'Lookup' | 'MasterDetail' | 'Hierarchical',
          direction: r.direction,
          relatedObject: r.direction === 'outgoing' ? r.targetObject : r.sourceObject,
        };
      }),
    };
  }

  async findRelatedObjects(
    objectApiName: string,
    maxDepth = 2,
    orgId?: string
  ): Promise<RelatedObject[]> {
    await this.ensureNeo4jInitialized();
    const relatedByDepth: Record<number, RelatedObjectPreview[]> = await findRelatedObjects(objectApiName, maxDepth, { orgId });

    // Flatten the depth-grouped results into a single array with depth info
    const result: RelatedObject[] = [];
    for (const [depth, objects] of Object.entries(relatedByDepth)) {
      for (const obj of objects) {
        result.push({
          apiName: obj.apiName,
          label: obj.label,
          relationshipType: obj.category, // Use category as relationship type indicator
          depth: Number(depth),
        });
      }
    }
    return result;
  }

  async findPaths(
    sourceObjectApiName: string,
    targetObjectApiName: string,
    maxDepth = 5,
    orgId?: string
  ): Promise<ObjectPath[]> {
    await this.ensureNeo4jInitialized();
    const graphPaths: GraphObjectPath[] = await findObjectPaths(sourceObjectApiName, targetObjectApiName, maxDepth, {
      orgId,
    });

    // Convert GraphObjectPath to ObjectPath format expected by core/types
    return graphPaths.map((gp) => ({
      path: gp.segments.map((s) => s.sourceObject).concat(
        gp.segments.length > 0 ? [gp.segments[gp.segments.length - 1].targetObject] : []
      ),
      relationships: gp.segments.map((s) => s.relationshipType),
    }));
  }

  async findDetailedPaths(
    fromObject: string,
    toObject: string,
    options: { minHops?: number; maxHops?: number; orgId?: string } = {}
  ): Promise<PathFindingResult> {
    await this.ensureNeo4jInitialized();
    return findDetailedPaths(fromObject, toObject, options);
  }

  /**
   * Find paths between two objects with SOQL-ready metadata.
   * Returns paths with relationship names for generating dot notation and subqueries.
   */
  async findSoqlPaths(
    fromObject: string,
    toObject: string,
    options: { maxHops?: number; orgId?: string } = {}
  ): Promise<import('./types.js').SoqlPathResult> {
    await this.ensureNeo4jInitialized();
    return findSoqlPaths(fromObject, toObject, options);
  }

  // === Sync ===

  /**
   * Sync all Salesforce objects to Neo4j using the Describe API.
   * Supports parallel processing with configurable concurrency.
   */
  async syncAll(options: SyncOptions = {}): Promise<SyncResult> {
    await this.ensureNeo4jInitialized();

    try {
      // 1. Initialize Salesforce connection
      if (options.connection) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setConnection(options.connection as any);
      } else {
        if (!options.orgId) {
          throw new ConfigurationError(
            'orgId is required for sync when no connection is provided',
            'orgId'
          );
        }
        await this.initSalesforce(options.orgId);
      }

      // 2. If rebuild flag is set, clear all existing data for this org first
      if (options.rebuild && options.orgId) {
        await clearOrgData(options.orgId);
      }

      // 3. Use describe-based sync with parallelization
      // Get the connection that was set
      if (!conn) {
        throw new ConfigurationError(
          'Salesforce connection not initialized',
          'connection'
        );
      }

      const result = await syncFromDescribe(conn, options.orgId!, {
        objectFilter: options.objectFilter,
        excludeSystemObjects: options.excludeSystemObjects ?? true,
        categoryFilter: options.categoryFilter,
        incremental: options.incremental,
        onProgress: options.onProgress,
        concurrency: options.concurrency ?? DEFAULTS.CONCURRENCY,
        batchSize: options.batchSize ?? DEFAULTS.BATCH_SIZE,
        retryAttempts: options.retryAttempts ?? DEFAULTS.RETRY_ATTEMPTS,
        retryDelayMs: options.retryDelayMs ?? DEFAULTS.RETRY_DELAY_MS,
      });

      return {
        success: result.success,
        objectCount: result.objectCount,
        fieldCount: result.fieldCount,
        relationshipCount: result.relationshipCount,
        picklistValueCount: result.picklistValueCount,
        dependencyCount: result.dependencyCount,
        deletedCount: result.deletedCount,
        syncedAt: new Date().toISOString(),
        duration: result.duration,
        message: `Synced ${result.objectCount} objects, ${result.fieldCount} fields, ${result.relationshipCount} relationships in ${result.duration}ms`,
        phaseStats: result.phaseStats,
        errors: result.errors,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        objectCount: 0,
        syncedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async syncObject(apiName: string, options: SyncOptions = {}): Promise<SyncResult> {
    await this.ensureNeo4jInitialized();
    const startTime = Date.now();

    try {
      // 1. Initialize Salesforce connection
      if (options.connection) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setConnection(options.connection as any);
      } else {
        if (!options.orgId) {
          throw new ConfigurationError(
            'orgId is required for sync when no connection is provided',
            'orgId'
          );
        }
        await this.initSalesforce(options.orgId);
      }

      // 2. Fetch metadata for specific object
      const metadata = await fetchObjectMetadata(apiName);


      // 3. Sync to Neo4j
      if (options.orgId) {
        metadata.orgId = options.orgId;
      }
      
      const includeFields = options.includeFields ?? true;
      const includeRecordTypes = options.includeRecordTypes ?? false;
      
      const stats = await refreshSingleObjectNode(apiName, metadata, includeFields, includeRecordTypes, options.orgId);
      
      // 4. Optionally sync relationships (if fields are included, relationships are created automatically)
      // Note: syncObjectRelationships returns void, so we don't get relationship counts easily here
      // unless we update that method too. For now we focus on object/picklist stats.
      if (includeFields) {
        await syncObjectRelationships(apiName, options.orgId);
      }

      return {
        success: true,
        objectCount: 1,
        picklistValueCount: stats.picklistValueCount,
        dependencyCount: stats.dependencyCount,
        syncedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
        message: `Synced ${apiName} in ${Date.now() - startTime}ms`,
      };
    } catch (error) {
      return {
        success: false,
        objectCount: 0,
        syncedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // === SOQL ===

  async generateSoql(options: SoqlOptions): Promise<string> {
    await this.ensureNeo4jInitialized();
    const object = await getObjectByApiName(options.objectApiName);
    if (!object) {
      throw new ObjectNotFoundError(options.objectApiName);
    }

    let fieldList = options.fields;
    if (!fieldList || fieldList.length === 0) {
      const fields = await getObjectFields(options.objectApiName);
      fieldList = fields.map((f: { apiName: string }) => f.apiName);
    }

    let query = `SELECT ${fieldList!.join(', ')} FROM ${options.objectApiName}`;
    if (options.whereClause) query += ` WHERE ${options.whereClause}`;
    if (options.orderBy) query += ` ORDER BY ${options.orderBy}`;
    if (options.limit) query += ` LIMIT ${options.limit}`;

    return query;
  }

  async executeSoql(query: string, orgAlias?: string): Promise<QueryResult> {
    const targetOrg = orgAlias || (await getDefaultOrgAlias());
    if (!targetOrg) {
      throw new ConfigurationError(
        'No org specified and no default org configured',
        'orgAlias'
      );
    }
    const result = await executeSoqlViaCli(query, targetOrg);
    return result as QueryResult;
  }

  async naturalLanguageToSoql(question: string, _useLLM = true): Promise<SoqlResult> {
    await this.ensureNeo4jInitialized();
    
    // Import type from core types (the new interface)
    const result = await generateSoqlFromNaturalLanguage(question);

    // Convert SoqlGenerationResult to SoqlResult format
    // The new result has validation.parsed which contains parsed components
    const parsed = result.validation.parsed;
    
    return {
      soql: result.soql,
      mainObject: result.mainObject,
      selectedFields: parsed?.fields || [],
      conditions: [], // Conditions are now embedded in the SOQL string
      orderBy: parsed?.orderBy,
      limit: parsed?.limit ?? undefined,
      isValid: result.isValid,
      validationMessages: result.validation.messages.map(m => m.message),
      llmAnalysis: undefined, // LLM analysis is now internal
    };
  }

  // === Orgs ===

  async listOrgs(): Promise<{ authenticated: OrgInfo[]; synced: OrgStatus[] }> {
    await this.ensureNeo4jInitialized();
    const cliOrgs: AuthenticatedOrg[] = await listAuthenticatedOrgs();
    const syncedOrgs = await getSyncedOrgs().catch((err) => {
      log.debug({ err }, 'Failed to get synced orgs');
      return [];
    });

    const syncedOrgIds = new Set(syncedOrgs.map((o) => o.orgId));

    return {
      authenticated: cliOrgs.map((o: AuthenticatedOrg) => ({
        alias: o.alias || '',
        username: o.username || '',
        orgId: o.orgId || '',
        instanceUrl: o.instanceUrl || '',
        isScratch: o.isScratchOrg,
        isDefault: o.isDefault,
        syncedToGraph: syncedOrgIds.has(o.orgId),
      })),
      synced: syncedOrgs.map((o) => ({
        orgId: o.orgId,
        synced: true,
        objectCount: o.objectCount,
        lastSyncedAt: o.lastSyncedAt ?? '',
        message: `${o.objectCount} objects synced`,
      })),
    };
  }

  async getOrgStatus(orgId: string): Promise<OrgStatus> {
    const syncedOrgs: OrgSyncSummary[] = await getSyncedOrgs().catch((err) => {
      log.debug({ err, orgId }, 'Failed to get synced orgs for status check');
      return [];
    });
    const org = syncedOrgs.find((o) => o.orgId === orgId);

    if (!org) {
      return {
        orgId,
        synced: false,
        message: `Org '${orgId}' has not been synced to the graph yet`,
      };
    }

    return {
      orgId,
      synced: true,
      objectCount: org.objectCount,
      lastSyncedAt: org.lastSyncedAt ?? undefined,
      message: `${org.objectCount} objects synced. Last sync: ${org.lastSyncedAt ?? 'unknown'}`,
    };
  }

  async compareSchemas(
    sourceOrg: string,
    targetOrg: string,
    objectFilter?: string
  ): Promise<SchemaComparison> {
    const result: SchemaComparisonResult = await compareOrgSchemas(sourceOrg, targetOrg, objectFilter);

    // Convert SchemaComparisonResult to SchemaComparison
    return {
      sourceOrg: result.sourceOrg,
      targetOrg: result.targetOrg,
      summary: {
        objectsOnlyInSource: result.summary.objectsOnlyInSource,
        objectsOnlyInTarget: result.summary.objectsOnlyInTarget,
        objectsWithDifferences: result.summary.objectsWithDifferences,
        objectsInBoth: result.summary.totalSourceObjects - result.summary.objectsOnlyInSource,
      },
      differences: [
        ...result.objectsOnlyInSource.map((obj) => ({
          objectApiName: obj,
          status: 'only_in_source' as const,
        })),
        ...result.objectsOnlyInTarget.map((obj) => ({
          objectApiName: obj,
          status: 'only_in_target' as const,
        })),
        ...result.objectsWithDifferences.map((obj) => ({
          objectApiName: obj.objectApiName,
          status: 'different' as const,
          fieldDifferences: [
            ...obj.addedFields.map((f) => ({ fieldApiName: f, status: 'only_in_source' as const })),
            ...obj.removedFields.map((f) => ({ fieldApiName: f, status: 'only_in_target' as const })),
            ...obj.typeMismatches.map((f) => ({
              fieldApiName: f.field,
              status: 'type_mismatch' as const,
              sourceType: f.sourceType,
              targetType: f.targetType,
            })),
          ],
        })),
      ],
    };
  }

  async compareObject(
    objectApiName: string,
    sourceOrg: string,
    targetOrg: string
  ): Promise<SchemaComparison> {
    const result: ObjectComparisonResult = await compareObjectBetweenOrgs(
      objectApiName,
      sourceOrg,
      targetOrg
    );

    // Convert ObjectComparisonResult to SchemaComparison
    return {
      sourceOrg: result.sourceOrg,
      targetOrg: result.targetOrg,
      summary: {
        objectsOnlyInSource: 0,
        objectsOnlyInTarget: 0,
        objectsWithDifferences: result.differencesCount > 0 ? 1 : 0,
        objectsInBoth: 1,
      },
      differences: result.differencesCount > 0
        ? [{
            objectApiName: result.objectApiName,
            status: 'different' as const,
            fieldDifferences: result.differences.map((d) => ({
              fieldApiName: d.field,
              status: d.status,
              sourceType: d.sourceType,
              targetType: d.targetType,
            })),
          }]
        : [],
    };
  }

  // === LLM ===

  async getLlmStatus(): Promise<LlmStatus> {
    let available = false;
    try {
      available = await isLLMAvailable();
    } catch (err) {
      log.debug({ err }, 'LLM availability check failed');
      available = false;
    }

    let models: ServiceLlmModel[] = [];
    if (available) {
      try {
        models = await getAvailableModels();
      } catch (err) {
        log.debug({ err }, 'Failed to get available LLM models');
        models = [];
      }
    }

    const config = loadConfig();

    return {
      available,
      defaultModel: config.model,
      availableModels: models.map((m: ServiceLlmModel) => ({
        name: m.name,
        // Convert Date to string if needed
        modified_at: m.modified_at instanceof Date ? m.modified_at.toISOString() : m.modified_at,
        size: m.size,
      })),
    };
  }

  async processWithLlm(
    prompt: string,
    options: { system?: string; model?: string } = {}
  ): Promise<string> {
    const available = await isLLMAvailable();
    if (!available) {
      throw new LlmError('LLM service is not available');
    }
    return await processWithLLM(prompt, options);
  }

  // === Sample Data ===

  async generateSampleData(
    objectApiName: string,
    count = 5,
    includeRelated = false,
    orgId?: string
  ): Promise<SampleDataResult> {
    if (includeRelated) {
      // Returns Record<string, SampleRecord[]> with main object and related objects
      const relatedResult = await generateRelatedSampleDataService(objectApiName, count, { orgId });
      const mainRecords = relatedResult[objectApiName] || [];

      // Separate main object records from related
      const relatedRecords: Record<string, Record<string, unknown>[]> = {};
      for (const [key, records] of Object.entries(relatedResult)) {
        if (key !== objectApiName) {
          relatedRecords[key] = records;
        }
      }

      return {
        objectApiName,
        count: mainRecords.length,
        records: mainRecords,
        relatedRecords: Object.keys(relatedRecords).length > 0 ? relatedRecords : undefined,
      };
    } else {
      // Returns SampleRecord[]
      const records = await generateSampleDataService(objectApiName, count, { orgId });
      return {
        objectApiName,
        count: records.length,
        records,
      };
    }
  }

  // === Capability Checks ===

  async checkSfCli(): Promise<boolean> {
    return await isSfCliInstalled();
  }

  async checkLlm(): Promise<boolean> {
    return await isLLMAvailable();
  }

  /**
   * Get Salesforce object describe metadata including child relationships.
   * Used for JIT validation when graph data is incomplete.
   */
  async describeSObject(objectApiName: string, orgId?: string): Promise<{
    childRelationships?: Array<{
      childSObject: string;
      field: string;
      relationshipName: string | null;
    }>;
  }> {
    if (orgId) {
      await this.initSalesforce(orgId);
    }
    
    const { fetchChildRelationships } = await import('../services/salesforce.js');
    const childRels = await fetchChildRelationships(objectApiName);
    
    return {
      childRelationships: childRels.map(r => ({
        childSObject: r.childSObject,
        field: r.field,
        relationshipName: r.relationshipName,
      })),
    };
  }
}

// Export singleton instance for convenience
export const apiService = new ApiService();

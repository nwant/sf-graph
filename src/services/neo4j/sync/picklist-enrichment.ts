/**
 * Picklist Value Enrichment Service
 *
 * Enriches picklist values with metadata from standard Salesforce objects.
 * 
 * Phase 1: Enrichment + Raw Dependency Metadata
 * - Enrich from OpportunityStage, CaseStatus, TaskStatus (already in graph)
 * - Store raw ValidFor bitmaps from PicklistValueInfo
 * - Zero additional Salesforce API calls for most enrichment
 * 
 * Phase 2 (Future): Dependency Relationship Modeling


 * - Decode ValidFor bitmaps
 * - Create CONTROLS/DEPENDS_ON and ENABLES/VALID_WHEN relationships
 */

import type { Driver } from 'neo4j-driver';
import type { Connection } from 'jsforce';
import type { SyncPhaseError } from '../../../core/types.js';
import { createLogger } from '../../../core/logger.js';

const log = createLogger('picklist-enrichment');

/**
 * Enrich picklist values with metadata from standard Salesforce objects.
 * 
 * Strategy:
 * 1. Query OpportunityStage records from Salesforce (1 SOQL)
 * 2. Query CaseStatus records from Salesforce (1 SOQL)
 * 3. Query TaskStatus records from Salesforce (1 SOQL)
 * 4. Match and update picklist values in Neo4j
 * 
 * All enrichment is non-blocking. Errors are collected and returned.
 */
export async function enrichPicklistValues(
  driver: Driver,
  connection: Connection,
  orgId: string
): Promise<{ count: number; errors: SyncPhaseError[] }> {
  const errors: SyncPhaseError[] = [];
  let totalEnriched = 0;

  // Enrich OpportunityStage values
  try {
    const count = await enrichOpportunityStages(driver, connection, orgId);
    totalEnriched += count;
    if (count > 0) {
      log.debug({ count }, 'Enriched OpportunityStage values');
    }
  } catch (error) {
    log.warn({ error }, 'Failed to enrich OpportunityStage values');
    errors.push({
      phase: 'picklistEnrichment',
      objectName: 'OpportunityStage',
      error: error instanceof Error ? error.message : String(error),
      retryable: false,
    });
  }

  // Enrich CaseStatus values
  try {
    const count = await enrichCaseStatuses(driver, connection, orgId);
    totalEnriched += count;
    if (count > 0) {
      log.debug({ count }, 'Enriched CaseStatus values');
    }
  } catch (error) {
    log.warn({ error }, 'Failed to enrich CaseStatus values');
    errors.push({
      phase: 'picklistEnrichment',
      objectName: 'CaseStatus',
      error: error instanceof Error ? error.message : String(error),
      retryable: false,
    });
  }

  // Enrich TaskStatus values
  try {
    const count = await enrichTaskStatuses(driver, connection, orgId);
    totalEnriched += count;
    if (count > 0) {
      log.debug({ count }, 'Enriched TaskStatus values');
    }
  } catch (error) {
    log.warn({ error }, 'Failed to enrich TaskStatus values');
    errors.push({
      phase: 'picklistEnrichment',
      objectName: 'TaskStatus',
      error: error instanceof Error ? error.message : String(error),
      retryable: false,
    });
  }

  return { count: totalEnriched, errors };
}

/**
 * Enrich Opportunity.StageName picklist values from OpportunityStage records.
 * Queries Salesforce for OpportunityStage metadata and updates picklist values in Neo4j.
 */
async function enrichOpportunityStages(
  driver: Driver,
  connection: Connection,
  orgId: string
): Promise<number> {
  // Query OpportunityStage records from Salesforce
  const result = await connection.query<{
    ApiName: string;
    Description: string | null;
    SortOrder: number | null;
    DefaultProbability: number | null;
    ForecastCategory: string | null;
    IsClosed: boolean;
    IsWon: boolean;
  }>('SELECT ApiName, Description, SortOrder, DefaultProbability, ForecastCategory, IsClosed, IsWon FROM OpportunityStage WHERE IsActive = true');

  if (result.records.length === 0) {
    return 0;
  }

  // Update picklist values in Neo4j
  const session = driver.session();
  try {
    const updateResult = await session.executeWrite((tx) =>
      tx.run(
        `
        UNWIND $stages AS stage
        MATCH (pv:PicklistValue {
          objectApiName: 'Opportunity',
          fieldApiName: 'StageName',
          value: stage.apiName,
          orgId: $orgId
        })
        SET pv.description = stage.description,
            pv.sortOrder = stage.sortOrder,
            pv.defaultProbability = stage.defaultProbability,
            pv.forecastCategory = stage.forecastCategory,
            pv.isClosed = stage.isClosed,
            pv.isWon = stage.isWon
        RETURN count(pv) as enriched
        `,
        {
          stages: result.records.map(r => ({
            apiName: r.ApiName,
            description: r.Description,
            sortOrder: r.SortOrder,
            defaultProbability: r.DefaultProbability,
            forecastCategory: r.ForecastCategory,
            isClosed: r.IsClosed,
            isWon: r.IsWon,
          })),
          orgId,
        }
      )
    );

    return updateResult.records[0]?.get('enriched')?.toNumber() || 0;
  } finally {
    await session.close();
  }
}

/**
 * Enrich Case.Status picklist values from CaseStatus records.
 * Queries Salesforce for CaseStatus metadata and updates picklist values in Neo4j.
 */
async function enrichCaseStatuses(
  driver: Driver,
  connection: Connection,
  orgId: string
): Promise<number> {
  // Query CaseStatus records from Salesforce
  const result = await connection.query<{
    ApiName: string;
    MasterLabel: string;
    SortOrder: number | null;
    IsClosed: boolean;
  }>('SELECT ApiName, MasterLabel, SortOrder, IsClosed FROM CaseStatus');

  if (result.records.length === 0) {
    return 0;
  }

  // Update picklist values in Neo4j
  const session = driver.session();
  try {
    const updateResult = await session.executeWrite((tx) =>
      tx.run(
        `
        UNWIND $statuses AS status
        MATCH (pv:PicklistValue {
          objectApiName: 'Case',
          fieldApiName: 'Status',
          value: status.apiName,
          orgId: $orgId
        })
        SET pv.description = status.masterLabel,
            pv.sortOrder = status.sortOrder,
            pv.isClosed = status.isClosed
        RETURN count(pv) as enriched
        `,
        {
          statuses: result.records.map(r => ({
            apiName: r.ApiName,
            masterLabel: r.MasterLabel,
            sortOrder: r.SortOrder,
            isClosed: r.IsClosed,
          })),
          orgId,
        }
      )
    );

    return updateResult.records[0]?.get('enriched')?.toNumber() || 0;
  } finally {
    await session.close();
  }
}

/**
 * Enrich Task.Status picklist values from TaskStatus records.
 * Queries Salesforce for TaskStatus metadata and updates picklist values in Neo4j.
 */
async function enrichTaskStatuses(
  driver: Driver,
  connection: Connection,
  orgId: string
): Promise<number> {
  // Query TaskStatus records from Salesforce
  const result = await connection.query<{
    ApiName: string;
    MasterLabel: string;
    SortOrder: number | null;
   IsClosed: boolean;
  }>('SELECT ApiName, MasterLabel, SortOrder, IsClosed FROM TaskStatus');

  if (result.records.length === 0) {
    return 0;
  }

  // Update picklist values in Neo4j
  const session = driver.session();
  try {
    const updateResult = await session.executeWrite((tx) =>
      tx.run(
        `
        UNWIND $statuses AS status
        MATCH (pv:PicklistValue {
          objectApiName: 'Task',
          fieldApiName: 'Status',
          value: status.apiName,
          orgId: $orgId
        })
        SET pv.description = status.masterLabel,
            pv.sortOrder = status.sortOrder,
            pv.isClosed = status.isClosed
        RETURN count(pv) as enriched
        `,
        {
          statuses: result.records.map(r => ({
            apiName: r.ApiName,
            masterLabel: r.MasterLabel,
            sortOrder: r.SortOrder,
            isClosed: r.IsClosed,
          })),
          orgId,
        }
      )
    );

    return updateResult.records[0]?.get('enriched')?.toNumber() || 0;
  } finally {
    await session.close();
  }
}

/**
 * Grounding Graph Executor
 *
 * Neo4j implementation of GraphQueryExecutor interface for value grounding.
 * Provides picklist matching and object lookups.
 */

import { getDriver } from '../neo4j/driver.js';
import type { GraphQueryExecutor } from './value-grounding-service.js';
import type { PicklistMatch } from './types.js';

/**
 * Neo4j implementation of GraphQueryExecutor for grounding service.
 */
export class Neo4jGroundingGraphExecutor implements GraphQueryExecutor {
  private orgId?: string;

  constructor(orgId?: string) {
    this.orgId = orgId;
  }

  /**
   * Find picklist values matching a term.
   */
  async findPicklistValues(
    term: string,
    objectApiName?: string
  ): Promise<PicklistMatch[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const normalizedTerm = term.toLowerCase().trim();
      
      // Build query with optional object filter
      let query: string;
      const params: Record<string, unknown> = { term: normalizedTerm, orgId: this.orgId };
      
      if (objectApiName) {
        params.objectApiName = objectApiName;
        query = `
          MATCH (o:Object {apiName: $objectApiName})-[:HAS_FIELD]->(f:Field)-[:HAS_PICKLIST_VALUE]->(pv:PicklistValue)
          ${this.orgId ? 'WHERE o.orgId = $orgId' : ''}
          WITH f, pv, toLower(pv.label) AS lowerLabel, toLower(pv.value) AS lowerValue
          WHERE lowerLabel = $term OR lowerValue = $term
             OR lowerLabel CONTAINS $term OR lowerValue CONTAINS $term
          RETURN f.apiName AS fieldApiName,
                 f.sobjectType AS objectApiName,
                 pv.value AS value,
                 pv.label AS label,
                 CASE WHEN lowerValue = $term OR lowerLabel = $term THEN true ELSE false END AS isExact,
                 CASE 
                   WHEN lowerValue = $term OR lowerLabel = $term THEN 1.0
                   WHEN lowerLabel STARTS WITH $term OR lowerValue STARTS WITH $term THEN 0.9
                   ELSE 0.7
                 END AS similarity
          ORDER BY similarity DESC
          LIMIT 10
        `;
      } else {
        query = `
          MATCH (o:Object)-[:HAS_FIELD]->(f:Field)-[:HAS_PICKLIST_VALUE]->(pv:PicklistValue)
          ${this.orgId ? 'WHERE o.orgId = $orgId' : ''}
          WITH f, o, pv, toLower(pv.label) AS lowerLabel, toLower(pv.value) AS lowerValue
          WHERE lowerLabel = $term OR lowerValue = $term
             OR lowerLabel CONTAINS $term OR lowerValue CONTAINS $term
          RETURN f.apiName AS fieldApiName,
                 o.apiName AS objectApiName,
                 pv.value AS value,
                 pv.label AS label,
                 CASE WHEN lowerValue = $term OR lowerLabel = $term THEN true ELSE false END AS isExact,
                 CASE 
                   WHEN lowerValue = $term OR lowerLabel = $term THEN 1.0
                   WHEN lowerLabel STARTS WITH $term OR lowerValue STARTS WITH $term THEN 0.9
                   ELSE 0.7
                 END AS similarity
          ORDER BY similarity DESC
          LIMIT 10
        `;
      }

      const result = await session.executeRead((tx) => tx.run(query, params));

      return result.records.map((record) => ({
        fieldApiName: record.get('fieldApiName') as string,
        objectApiName: record.get('objectApiName') as string,
        value: record.get('value') as string,
        label: record.get('label') as string,
        isExact: record.get('isExact') as boolean,
        similarity: record.get('similarity') as number,
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Find object by name (exact or fuzzy).
   */
  async findObject(term: string): Promise<{ apiName: string; label: string; confidence: number } | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const normalizedTerm = term.toLowerCase().trim();
      const orgFilter = this.orgId ? 'WHERE o.orgId = $orgId' : '';

      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (o:Object)
          ${orgFilter}
          WITH o, toLower(o.label) AS lowerLabel, toLower(o.apiName) AS lowerApiName
          WHERE lowerLabel = $term 
             OR lowerApiName = $term
             OR replace(lowerApiName, '__c', '') = $term
             OR lowerLabel CONTAINS $term
          RETURN o.apiName AS apiName,
                 o.label AS label,
                 CASE 
                   WHEN lowerLabel = $term OR lowerApiName = $term THEN 0.95
                   WHEN replace(lowerApiName, '__c', '') = $term THEN 0.9
                   WHEN lowerLabel STARTS WITH $term THEN 0.85
                   ELSE 0.7
                 END AS confidence
          ORDER BY confidence DESC
          LIMIT 1
          `,
          { term: normalizedTerm, orgId: this.orgId }
        )
      );

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      return {
        apiName: record.get('apiName') as string,
        label: record.get('label') as string,
        confidence: record.get('confidence') as number,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Semantic search for objects (requires embeddings).
   */
  async semanticSearchObjects(
    _term: string,
    _topK: number
  ): Promise<Array<{ apiName: string; label: string; similarity: number }>> {
    // This would require vector embeddings - return empty for now
    // The search service will fall back to exact/fuzzy matching
    return [];
  }

  /**
   * Semantic search for fields (requires embeddings).
   */
  async semanticSearchFields(
    _term: string,
    _objectApiName: string,
    _topK: number
  ): Promise<Array<{ apiName: string; label: string; similarity: number }>> {
    // This would require vector embeddings - return empty for now
    return [];
  }
}

/**
 * Create a Neo4j grounding graph executor.
 */
export function createGroundingGraphExecutor(orgId?: string): Neo4jGroundingGraphExecutor {
  return new Neo4jGroundingGraphExecutor(orgId);
}

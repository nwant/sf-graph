/**
 * Semantic Graph Executor
 *
 * Neo4j implementation of SemanticGraphQueryExecutor interface.
 * Provides object and field lookups for the semantic search service.
 */

import { getDriver } from '../neo4j/driver.js';
import type { SemanticGraphQueryExecutor } from './semantic-search-service.js';

/**
 * Neo4j implementation of SemanticGraphQueryExecutor.
 */
export class Neo4jSemanticGraphExecutor implements SemanticGraphQueryExecutor {
  private orgId?: string;

  constructor(orgId?: string) {
    this.orgId = orgId;
  }

  /**
   * Get all objects with their labels and descriptions.
   */
  async getAllObjects(): Promise<Array<{
    apiName: string;
    label: string;
    description?: string;
    category?: string;
    keyPrefix?: string;
  }>> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? 'WHERE o.orgId = $orgId' : '';
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (o:Object)
          ${orgFilter}
          RETURN o.apiName AS apiName, 
                 o.label AS label, 
                 o.description AS description,
                 o.category AS category,
                 o.keyPrefix AS keyPrefix
          `,
          { orgId: this.orgId }
        )
      );

      return result.records.map((record) => ({
        apiName: record.get('apiName') as string,
        label: record.get('label') as string,
        description: record.get('description') as string | undefined,
        category: record.get('category') as string | undefined,
        keyPrefix: record.get('keyPrefix') as string | undefined,
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Get all fields for an object with their labels.
   */
  async getFieldsForObject(objectApiName: string): Promise<Array<{
    apiName: string;
    label: string;
    description?: string;
    type?: string;
    filterable?: boolean;
  }>> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? 'AND o.orgId = $orgId' : '';
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (o:Object {apiName: $objectApiName})-[:HAS_FIELD]->(f:Field)
          ${orgFilter}
          RETURN f.apiName AS apiName,
                 f.label AS label,
                 f.description AS description,
                 f.type AS type,
                 f.filterable AS filterable
          `,
          { objectApiName, orgId: this.orgId }
        )
      );

      return result.records.map((record) => ({
        apiName: record.get('apiName') as string,
        label: record.get('label') as string,
        description: record.get('description') as string | undefined,
        type: record.get('type') as string | undefined,
        filterable: record.get('filterable') as boolean | undefined,
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Get all fields across all objects.
   */
  async getAllFields(): Promise<Array<{
    apiName: string;
    sobjectType: string;
    label: string;
    description?: string;
    type?: string;
    filterable?: boolean;
  }>> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? 'WHERE o.orgId = $orgId' : '';
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (o:Object)-[:HAS_FIELD]->(f:Field)
          ${orgFilter}
          RETURN f.apiName AS apiName,
                 f.sobjectType AS sobjectType,
                 f.label AS label,
                 f.description AS description,
                 f.type AS type,
                 f.filterable AS filterable
          `,
          { orgId: this.orgId }
        )
      );

      return result.records.map((record) => ({
        apiName: record.get('apiName') as string,
        sobjectType: record.get('sobjectType') as string,
        label: record.get('label') as string,
        description: record.get('description') as string | undefined,
        type: record.get('type') as string | undefined,
        filterable: record.get('filterable') as boolean | undefined,
      }));
    } finally {
      await session.close();
    }
  }
}

/**
 * Create a Neo4j semantic graph executor.
 */
export function createSemanticGraphExecutor(orgId?: string): Neo4jSemanticGraphExecutor {
  return new Neo4jSemanticGraphExecutor(orgId);
}

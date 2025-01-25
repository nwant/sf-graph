/**
 * Neo4j Graph Executor for Embeddings
 *
 * Implements EmbeddingGraphExecutor interface for Neo4j operations.
 * Handles querying nodes for embedding and batch updating embeddings.
 */

import { getDriver } from '../neo4j/driver.js';
import { createLogger } from '../../core/index.js';
import type {
  EmbeddingGraphExecutor,
  ObjectForEmbedding,
  FieldForEmbedding,
} from './embedding-sync.js';

const log = createLogger('neo4j-graph-executor');

/**
 * Neo4j implementation of EmbeddingGraphExecutor.
 */
export class Neo4jGraphExecutor implements EmbeddingGraphExecutor {
  private orgId?: string;

  constructor(orgId?: string) {
    this.orgId = orgId;
  }

  /**
   * Get objects that need embedding.
   */
  async getObjectsForEmbedding(force: boolean): Promise<ObjectForEmbedding[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Build WHERE clause: org filter first (if set), then embedding check
      // Use parentheses to ensure correct precedence
      const conditions: string[] = [];
      
      if (this.orgId) {
        conditions.push('o.orgId = $orgId');
      }
      
      if (!force) {
        conditions.push('(o.embedding IS NULL OR o.contentHash IS NULL)');
      }
      
      const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}` 
        : '';

      const result = await session.executeRead(async (tx) => {
        return tx.run(
          `
          MATCH (o:Object)
          ${whereClause}
          RETURN o.apiName AS apiName,
                 o.label AS label,
                 o.description AS description,
                 o.contentHash AS contentHash
          ORDER BY o.apiName
          `,
          { orgId: this.orgId }
        );
      });

      return result.records.map((record) => ({
        apiName: record.get('apiName') as string,
        label: record.get('label') as string,
        description: record.get('description') as string | undefined,
        contentHash: record.get('contentHash') as string | undefined,
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Get fields that need embedding.
   */
  async getFieldsForEmbedding(force: boolean): Promise<FieldForEmbedding[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Build WHERE clause: org filter first (via object), then embedding check
      // Use parentheses to ensure correct precedence
      const conditions: string[] = [];
      
      if (this.orgId) {
        conditions.push('o.orgId = $orgId');  // Filter by object's org, not field
      }
      
      if (!force) {
        conditions.push('(f.embedding IS NULL OR f.contentHash IS NULL)');
      }
      
      const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}` 
        : '';

      const result = await session.executeRead(async (tx) => {
        return tx.run(
          `
          MATCH (o:Object)-[:HAS_FIELD]->(f:Field)
          ${whereClause}
          RETURN f.apiName AS apiName,
                 o.apiName AS sobjectType,
                 f.label AS label,
                 f.type AS type,
                 f.description AS description,
                 f.inlineHelpText AS helpText,
                 f.contentHash AS contentHash
          ORDER BY o.apiName, f.apiName
          `,
          { orgId: this.orgId }
        );
      });

      return result.records.map((record) => ({
        apiName: record.get('apiName') as string,
        sobjectType: record.get('sobjectType') as string,
        label: record.get('label') as string,
        type: record.get('type') as string,
        description: record.get('description') as string | undefined,
        helpText: record.get('helpText') as string | undefined,
        contentHash: record.get('contentHash') as string | undefined,
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Update a single object with embedding.
   */
  async updateObjectEmbedding(
    apiName: string,
    embedding: number[],
    contentHash: string
  ): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? ', orgId: $orgId' : '';

      await session.executeWrite(async (tx) => {
        await tx.run(
          `
          MATCH (o:Object {apiName: $apiName ${orgFilter}})
          SET o.embedding = $embedding, o.contentHash = $contentHash
          `,
          { apiName, embedding, contentHash, orgId: this.orgId }
        );
      });

      log.debug({ apiName }, 'Object embedding updated');
    } finally {
      await session.close();
    }
  }

  /**
   * Update a single field with embedding.
   */
  async updateFieldEmbedding(
    apiName: string,
    sobjectType: string,
    embedding: number[],
    contentHash: string
  ): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? ', orgId: $orgId' : '';

      await session.executeWrite(async (tx) => {
        await tx.run(
          `
          MATCH (o:Object {apiName: $sobjectType ${orgFilter}})-[:HAS_FIELD]->(f:Field {apiName: $apiName})
          SET f.embedding = $embedding, f.contentHash = $contentHash
          `,
          { apiName, sobjectType, embedding, contentHash, orgId: this.orgId }
        );
      });

      log.debug({ apiName, sobjectType }, 'Field embedding updated');
    } finally {
      await session.close();
    }
  }

  /**
   * Batch update objects with embeddings using UNWIND.
   */
  async batchUpdateObjectEmbeddings(
    updates: Array<{ apiName: string; embedding: number[]; contentHash: string }>
  ): Promise<void> {
    if (updates.length === 0) return;

    const driver = getDriver();
    const session = driver.session();

    try {
      const batchData = updates.map((u) => ({
        apiName: u.apiName,
        embedding: u.embedding,
        contentHash: u.contentHash,
      }));

      const orgFilter = this.orgId ? 'AND o.orgId = $orgId' : '';

      await session.executeWrite(async (tx) => {
        await tx.run(
          `
          UNWIND $items AS item
          MATCH (o:Object)
          WHERE o.apiName = item.apiName ${orgFilter}
          SET o.embedding = item.embedding, o.contentHash = item.contentHash
          `,
          { items: batchData, orgId: this.orgId }
        );
      });

      log.debug({ count: updates.length }, 'Batch object embeddings updated');
    } finally {
      await session.close();
    }
  }

  /**
   * Batch update fields with embeddings using UNWIND.
   */
  async batchUpdateFieldEmbeddings(
    updates: Array<{
      apiName: string;
      sobjectType: string;
      embedding: number[];
      contentHash: string;
    }>
  ): Promise<void> {
    if (updates.length === 0) return;

    const driver = getDriver();
    const session = driver.session();

    try {
      const batchData = updates.map((u) => ({
        apiName: u.apiName,
        sobjectType: u.sobjectType,
        embedding: u.embedding,
        contentHash: u.contentHash,
      }));

      const orgFilter = this.orgId ? 'AND o.orgId = $orgId' : '';

      await session.executeWrite(async (tx) => {
        await tx.run(
          `
          UNWIND $items AS item
          MATCH (o:Object)-[:HAS_FIELD]->(f:Field)
          WHERE o.apiName = item.sobjectType AND f.apiName = item.apiName ${orgFilter}
          SET f.embedding = item.embedding, f.contentHash = item.contentHash
          `,
          { items: batchData, orgId: this.orgId }
        );
      });

      log.debug({ count: updates.length }, 'Batch field embeddings updated');
    } finally {
      await session.close();
    }
  }
}

/**
 * Create a Neo4j graph executor for embedding operations.
 */
export function createNeo4jGraphExecutor(orgId?: string): Neo4jGraphExecutor {
  return new Neo4jGraphExecutor(orgId);
}

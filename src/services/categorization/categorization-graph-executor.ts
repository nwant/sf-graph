/**
 * Categorization Graph Executor
 *
 * Neo4j implementation of HeuristicGraphQueryExecutor interface.
 * Provides object/field property lookups and category assignment.
 */

import { getDriver } from '../neo4j/driver.js';
import type {
  HeuristicGraphQueryExecutor,
  ObjectProperties,
  FieldProperties,
} from './heuristic-tagger.js';
import type { CategoryAssignment, CategoryName, CategorySource } from './types.js';

/**
 * Neo4j implementation of HeuristicGraphQueryExecutor.
 */
export class Neo4jCategorizationGraphExecutor implements HeuristicGraphQueryExecutor {
  private orgId?: string;

  constructor(orgId?: string) {
    this.orgId = orgId;
  }

  /**
   * Get object properties for categorization.
   */
  async getObjectProperties(apiName: string): Promise<ObjectProperties | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? 'AND o.orgId = $orgId' : '';
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (o:Object {apiName: $apiName})
          ${orgFilter}
          RETURN o.apiName AS apiName,
                 o.label AS label,
                 o.namespace AS namespace,
                 o.category AS category,
                 o.objectSubtype AS subtype
          `,
          { apiName, orgId: this.orgId }
        )
      );

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      return {
        apiName: record.get('apiName') as string,
        label: record.get('label') as string,
        namespace: record.get('namespace') as string | undefined,
        category: record.get('category') as string | undefined,
        subtype: record.get('subtype') as string | undefined,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get field properties for categorization.
   */
  async getFieldProperties(
    apiName: string,
    sobjectType: string
  ): Promise<FieldProperties | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? 'AND o.orgId = $orgId' : '';
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (o:Object {apiName: $sobjectType})-[:HAS_FIELD]->(f:Field {apiName: $apiName})
          ${orgFilter}
          OPTIONAL MATCH (f)-[:REFERENCES]->(ref:Object)
          RETURN f.apiName AS apiName,
                 f.sobjectType AS sobjectType,
                 f.label AS label,
                 f.type AS type,
                 f.namespace AS namespace,
                 f.category AS category,
                 collect(ref.apiName) AS referenceTo
          `,
          { apiName, sobjectType, orgId: this.orgId }
        )
      );

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      const referenceTo = record.get('referenceTo') as string[];
      
      return {
        apiName: record.get('apiName') as string,
        sobjectType: record.get('sobjectType') as string,
        label: record.get('label') as string,
        type: record.get('type') as string,
        namespace: record.get('namespace') as string | undefined,
        category: record.get('category') as string | undefined,
        referenceTo: referenceTo.length > 0 ? referenceTo : undefined,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Check if object has lookup to target.
   */
  async hasLookupTo(objectApiName: string, targetObjectApiName: string): Promise<boolean> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? 'AND o.orgId = $orgId' : '';
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (o:Object {apiName: $objectApiName})-[:HAS_FIELD]->(f:Field)-[:REFERENCES]->(target:Object {apiName: $targetObjectApiName})
          ${orgFilter}
          RETURN count(f) > 0 AS hasLookup
          `,
          { objectApiName, targetObjectApiName, orgId: this.orgId }
        )
      );

      if (result.records.length === 0) {
        return false;
      }

      return result.records[0].get('hasLookup') as boolean;
    } finally {
      await session.close();
    }
  }

  /**
   * Get all categories assigned to an object.
   */
  async getObjectCategories(apiName: string): Promise<CategoryAssignment[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? 'AND o.orgId = $orgId' : '';
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (o:Object {apiName: $apiName})-[r:CATEGORIZED_AS]->(c:Category)
          ${orgFilter}
          RETURN c.name AS category,
                 r.confidence AS confidence,
                 r.source AS source,
                 r.rule AS rule,
                 r.assignedAt AS assignedAt
          `,
          { apiName, orgId: this.orgId }
        )
      );

      return result.records.map((record) => ({
        category: record.get('category') as CategoryName,
        confidence: record.get('confidence') as number,
        source: (record.get('source') as CategorySource) || 'heuristic',
        rule: record.get('rule') as string | undefined,
        assignedAt: record.get('assignedAt') ? new Date(record.get('assignedAt') as string) : new Date(),
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Assign category to object in graph.
   */
  async assignObjectCategory(
    apiName: string,
    assignment: CategoryAssignment,
    rule: string
  ): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? 'AND o.orgId = $orgId' : '';
      await session.executeWrite((tx) =>
        tx.run(
          `
          MATCH (o:Object {apiName: $apiName})
          ${orgFilter}
          MERGE (c:Category {name: $category})
          MERGE (o)-[r:CATEGORIZED_AS]->(c)
          SET r.confidence = $confidence,
              r.source = $source,
              r.rule = $rule,
              r.assignedAt = datetime()
          `,
          {
            apiName,
            category: assignment.category,
            confidence: assignment.confidence,
            source: assignment.source,
            rule,
            orgId: this.orgId,
          }
        )
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Get all objects that match a category.
   */
  async getObjectsByCategory(category: string): Promise<string[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? 'AND o.orgId = $orgId' : '';
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (o:Object)-[:CATEGORIZED_AS]->(c:Category {name: $category})
          ${orgFilter}
          RETURN o.apiName AS apiName
          `,
          { category, orgId: this.orgId }
        )
      );

      return result.records.map((record) => record.get('apiName') as string);
    } finally {
      await session.close();
    }
  }

  /**
   * Get custom objects (those ending in __c).
   */
  async getCustomObjects(): Promise<string[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? 'WHERE o.orgId = $orgId AND' : 'WHERE';
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (o:Object)
          ${orgFilter} o.apiName ENDS WITH '__c'
          RETURN o.apiName AS apiName
          `,
          { orgId: this.orgId }
        )
      );

      return result.records.map((record) => record.get('apiName') as string);
    } finally {
      await session.close();
    }
  }

  /**
   * Get all objects for categorization.
   */
  async getAllObjects(): Promise<string[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const orgFilter = this.orgId ? 'WHERE o.orgId = $orgId' : '';
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (o:Object)
          ${orgFilter}
          RETURN o.apiName AS apiName
          ORDER BY o.apiName
          `,
          { orgId: this.orgId }
        )
      );

      return result.records.map((record) => record.get('apiName') as string);
    } finally {
      await session.close();
    }
  }
}

/**
 * Create a Neo4j categorization graph executor.
 */
export function createCategorizationGraphExecutor(orgId?: string): Neo4jCategorizationGraphExecutor {
  return new Neo4jCategorizationGraphExecutor(orgId);
}

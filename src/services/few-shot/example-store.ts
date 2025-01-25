/**
 * Few-Shot Example Store
 *
 * Neo4j-backed storage for SOQL examples with vector similarity search.
 * Handles embedding generation, storage, and retrieval.
 */

import * as crypto from 'node:crypto';
import { getDriver } from '../neo4j/driver.js';
import { getVectorStore } from '../vector/neo4j-vector-store.js';
import { getEmbeddingProvider } from '../embeddings/embedding-service.js';
import { createLogger } from '../../core/index.js';
import type { SoqlExample, ExampleSearchResult } from './types.js';

const log = createLogger('few-shot-store');

/** Vector index name for few-shot examples */
export const FEW_SHOT_INDEX_NAME = 'few_shot_example_embedding';

/** Node label for few-shot examples */
const NODE_LABEL = 'FewShotExample';

/**
 * Neo4j store for few-shot SOQL examples.
 */
export class FewShotExampleStore {
  /**
   * Clear all existing examples from the store.
   * Called before seeding to prevent ghost examples.
   */
  async clearAll(): Promise<number> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.executeWrite(async (tx) => {
        return tx.run(`
          MATCH (n:${NODE_LABEL})
          WITH n, count(n) as total
          DETACH DELETE n
          RETURN total
        `);
      });

      const count = result.records.length > 0 
        ? result.records[0].get('total')?.toNumber?.() || 0 
        : 0;
      
      log.info({ count }, 'Cleared existing few-shot examples');
      return count;
    } finally {
      await session.close();
    }
  }

  /**
   * Seed examples into the store with embeddings.
   * Clears existing examples first.
   */
  async seedExamples(examples: SoqlExample[]): Promise<void> {
    if (examples.length === 0) {
      log.warn('No examples provided for seeding');
      return;
    }

    const provider = getEmbeddingProvider();
    const modelName = provider.modelName;
    const driver = getDriver();
    const session = driver.session();

    log.info({ count: examples.length, model: modelName }, 'Seeding few-shot examples');

    try {
      // Clear existing examples first
      await this.clearAll();

      // Generate embeddings for all questions
      const questions = examples.map((ex) => ex.question);
      const embeddings = await provider.embedBatch(questions);

      // Prepare nodes with embeddings
      const nodes = examples.map((ex, i) => ({
        id: ex.id,
        question: ex.question,
        soql: ex.soql,
        complexity: ex.complexity,
        patterns: ex.patterns,
        objects: ex.objects,
        explanation: ex.explanation || null,
        embedding: embeddings[i],
        embeddingModel: modelName,
        contentHash: this.computeHash(ex.question),
      }));

      // Batch insert
      await session.executeWrite(async (tx) => {
        await tx.run(
          `
          UNWIND $nodes AS node
          CREATE (n:${NODE_LABEL} {
            id: node.id,
            question: node.question,
            soql: node.soql,
            complexity: node.complexity,
            patterns: node.patterns,
            objects: node.objects,
            explanation: node.explanation,
            embedding: node.embedding,
            embeddingModel: node.embeddingModel,
            contentHash: node.contentHash
          })
          `,
          { nodes }
        );
      });

      // Ensure vector index exists
      await this.ensureIndex(embeddings[0].length);

      log.info({ count: examples.length }, 'Few-shot examples seeded successfully');
    } finally {
      await session.close();
    }
  }

  /**
   * Ensure the vector index exists.
   */
  private async ensureIndex(dimensions: number): Promise<void> {
    const vectorStore = getVectorStore();
    
    const exists = await vectorStore.indexExists(FEW_SHOT_INDEX_NAME);
    if (!exists) {
      await vectorStore.createIndex(
        FEW_SHOT_INDEX_NAME,
        NODE_LABEL,
        'embedding',
        dimensions
      );
      log.info({ indexName: FEW_SHOT_INDEX_NAME }, 'Created vector index for few-shot examples');
    }
  }

  /**
   * Search for similar examples by question embedding.
   * 
   * @param questionEmbedding - Embedding of the user's question
   * @param k - Number of results to return
   * @param currentModel - Current embedding model for compatibility check
   * @returns Similar examples with scores
   */
  async search(
    questionEmbedding: number[],
    k: number,
    currentModel: string
  ): Promise<ExampleSearchResult[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.executeRead(async (tx) => {
        return tx.run(
          `
          CALL db.index.vector.queryNodes($indexName, $k, $embedding)
          YIELD node, score
          WHERE node.embeddingModel = $currentModel
          RETURN node {
            .id, .question, .soql, .complexity, .patterns, .objects, .explanation
          } AS example, score
          ORDER BY score DESC
          `,
          { 
            indexName: FEW_SHOT_INDEX_NAME, 
            k, 
            embedding: questionEmbedding,
            currentModel
          }
        );
      });

      return result.records.map((record) => ({
        example: record.get('example') as SoqlExample,
        score: record.get('score') as number,
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Get the count of stored examples.
   */
  async getExampleCount(): Promise<number> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.executeRead(async (tx) => {
        return tx.run(`MATCH (n:${NODE_LABEL}) RETURN count(n) as count`);
      });

      return result.records[0]?.get('count')?.toNumber?.() || 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Get all examples (for listing).
   */
  async getAllExamples(limit?: number): Promise<SoqlExample[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.executeRead(async (tx) => {
        return tx.run(
          `
          MATCH (n:${NODE_LABEL})
          RETURN n {.id, .question, .soql, .complexity, .patterns, .objects, .explanation} AS example
          ORDER BY n.id
          ${limit ? `LIMIT ${limit}` : ''}
          `
        );
      });

      return result.records.map((record) => record.get('example') as SoqlExample);
    } finally {
      await session.close();
    }
  }

  /**
   * Get examples by pattern tag.
   */
  async getExamplesByPattern(pattern: string, limit?: number): Promise<SoqlExample[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.executeRead(async (tx) => {
        return tx.run(
          `
          MATCH (n:${NODE_LABEL})
          WHERE $pattern IN n.patterns
          RETURN n {.id, .question, .soql, .complexity, .patterns, .objects, .explanation} AS example
          ORDER BY n.id
          ${limit ? `LIMIT ${limit}` : ''}
          `,
          { pattern }
        );
      });

      return result.records.map((record) => record.get('example') as SoqlExample);
    } finally {
      await session.close();
    }
  }

  /**
   * Check if a specific embedding model is used in stored examples.
   */
  async getStoredEmbeddingModel(): Promise<string | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.executeRead(async (tx) => {
        return tx.run(
          `MATCH (n:${NODE_LABEL}) RETURN n.embeddingModel AS model LIMIT 1`
        );
      });

      return result.records[0]?.get('model') || null;
    } finally {
      await session.close();
    }
  }

  /**
   * Compute content hash for change detection.
   */
  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

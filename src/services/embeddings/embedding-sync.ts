/**
 * Embedding Sync Service
 *
 * Generates embeddings for graph nodes during sync operations.
 * Uses content hashing to avoid re-embedding unchanged content.
 */

import { createLogger } from '../../core/index.js';
import type { EmbeddingProvider, BatchOptions } from './types.js';
import {
  prepareObjectMetadata,
  prepareFieldMetadata,
} from './embedding-service.js';

const log = createLogger('embedding-sync');

// === Types ===

/**
 * Options for embedding sync operations.
 */
export interface EmbeddingSyncOptions {
  /** Force re-embedding even if content hasn't changed */
  force?: boolean;
  /** Batch size for embedding operations */
  batchSize?: number;
  /** Progress callback */
  onProgress?: (completed: number, total: number, type: string) => void;
}

/**
 * Result of an embedding sync operation.
 */
export interface EmbeddingSyncResult {
  /** Number of nodes processed */
  processed: number;
  /** Number of nodes embedded */
  embedded: number;
  /** Number of nodes skipped (unchanged) */
  skipped: number;
  /** Number of errors */
  errors: number;
  /** Time taken in milliseconds */
  durationMs: number;
}

// === Graph Interface ===

/**
 * Interface for querying and updating graph nodes for embedding.
 */
export interface EmbeddingGraphExecutor {
  /**
   * Get objects that need embedding.
   * Returns objects with their current contentHash (null if not yet embedded).
   */
  getObjectsForEmbedding(force: boolean): Promise<ObjectForEmbedding[]>;

  /**
   * Get fields that need embedding.
   */
  getFieldsForEmbedding(force: boolean): Promise<FieldForEmbedding[]>;

  /**
   * Update object with embedding and content hash.
   */
  updateObjectEmbedding(
    apiName: string,
    embedding: number[],
    contentHash: string
  ): Promise<void>;

  /**
   * Update field with embedding and content hash.
   */
  updateFieldEmbedding(
    apiName: string,
    sobjectType: string,
    embedding: number[],
    contentHash: string
  ): Promise<void>;

  /**
   * Batch update objects with embeddings.
   */
  batchUpdateObjectEmbeddings(
    updates: Array<{ apiName: string; embedding: number[]; contentHash: string }>
  ): Promise<void>;

  /**
   * Batch update fields with embeddings.
   */
  batchUpdateFieldEmbeddings(
    updates: Array<{ apiName: string; sobjectType: string; embedding: number[]; contentHash: string }>
  ): Promise<void>;
}

/**
 * Object data for embedding.
 */
export interface ObjectForEmbedding {
  apiName: string;
  label: string;
  description?: string;
  contentHash?: string;
}

/**
 * Field data for embedding.
 */
export interface FieldForEmbedding {
  apiName: string;
  sobjectType: string;
  label: string;
  description?: string;
  helpText?: string;
  type: string;
  contentHash?: string;
}

// === Embedding Sync Service ===

/**
 * Embedding sync service for generating embeddings during sync.
 */
export class EmbeddingSyncService {
  private provider: EmbeddingProvider;
  private graphExecutor: EmbeddingGraphExecutor;

  constructor(
    provider: EmbeddingProvider,
    graphExecutor: EmbeddingGraphExecutor
  ) {
    this.provider = provider;
    this.graphExecutor = graphExecutor;
  }

  /**
   * Sync embeddings for all objects.
   */
  async syncObjectEmbeddings(
    options: EmbeddingSyncOptions = {}
  ): Promise<EmbeddingSyncResult> {
    const startTime = Date.now();
    const result: EmbeddingSyncResult = {
      processed: 0,
      embedded: 0,
      skipped: 0,
      errors: 0,
      durationMs: 0,
    };

    log.debug({ force: options.force }, 'Starting object embedding sync');

    try {
      // Get objects that need embedding
      const objects = await this.graphExecutor.getObjectsForEmbedding(
        options.force || false
      );
      log.debug({ count: objects.length }, 'Objects to process');

      // Filter objects that need re-embedding
      const needsEmbedding: Array<{
        obj: ObjectForEmbedding;
        text: string;
        newHash: string;
      }> = [];

      for (const obj of objects) {
        const metadata = prepareObjectMetadata({
          apiName: obj.apiName,
          label: obj.label,
          description: obj.description,
        });

        if (!metadata) {
          result.skipped++;
          continue;
        }

        const text = metadata.text;
        const newHash = metadata.contentHash;

        // Skip if content unchanged (unless forced)
        if (!options.force && obj.contentHash === newHash) {
          result.skipped++;
          continue;
        }

        needsEmbedding.push({ obj, text, newHash });
      }

      log.debug({ needsEmbedding: needsEmbedding.length, skipped: result.skipped }, 'Objects filtered');

      if (needsEmbedding.length === 0) {
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // Batch embed
      const texts = needsEmbedding.map((item) => item.text);
      const batchOptions: BatchOptions = {
        batchSize: options.batchSize || 50,
        onProgress: (completed, total) => {
          options.onProgress?.(completed, total, 'objects');
        },
      };

      const embeddings = await this.provider.embedBatch(texts, batchOptions);

      // Batch update graph
      const updates = needsEmbedding.map((item, i) => ({
        apiName: item.obj.apiName,
        embedding: embeddings[i],
        contentHash: item.newHash,
      }));

      await this.graphExecutor.batchUpdateObjectEmbeddings(updates);

      result.processed = objects.length;
      result.embedded = needsEmbedding.length;
      result.durationMs = Date.now() - startTime;

      log.debug(
        { embedded: result.embedded, skipped: result.skipped, durationMs: result.durationMs },
        'Object embedding sync complete'
      );

      return result;
    } catch (error) {
      log.error({ error }, 'Object embedding sync failed');
      result.errors++;
      result.durationMs = Date.now() - startTime;
      throw error;
    }
  }

  /**
   * Sync embeddings for all fields.
   */
  async syncFieldEmbeddings(
    options: EmbeddingSyncOptions = {}
  ): Promise<EmbeddingSyncResult> {
    const startTime = Date.now();
    const result: EmbeddingSyncResult = {
      processed: 0,
      embedded: 0,
      skipped: 0,
      errors: 0,
      durationMs: 0,
    };

    log.debug({ force: options.force }, 'Starting field embedding sync');

    try {
      // Get fields that need embedding
      const fields = await this.graphExecutor.getFieldsForEmbedding(
        options.force || false
      );
      log.debug({ count: fields.length }, 'Fields to process');

      // Filter fields that need re-embedding
      const needsEmbedding: Array<{
        field: FieldForEmbedding;
        text: string;
        newHash: string;
      }> = [];

      for (const field of fields) {
        const metadata = prepareFieldMetadata({
          apiName: field.apiName,
          sobjectType: field.sobjectType,
          label: field.label,
          type: field.type,
          description: field.description,
          helpText: field.helpText,
        });

        if (!metadata) {
          result.skipped++;
          continue;
        }

        const text = metadata.text;
        const newHash = metadata.contentHash;

        // Skip if content unchanged (unless forced)
        if (!options.force && field.contentHash === newHash) {
          result.skipped++;
          continue;
        }

        needsEmbedding.push({ field, text, newHash });
      }

      log.debug({ needsEmbedding: needsEmbedding.length, skipped: result.skipped }, 'Fields filtered');

      if (needsEmbedding.length === 0) {
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // Batch embed (may be large, use smaller batch size)
      const texts = needsEmbedding.map((item) => item.text);
      const batchOptions: BatchOptions = {
        batchSize: options.batchSize || 50,
        onProgress: (completed, total) => {
          options.onProgress?.(completed, total, 'fields');
        },
      };

      const embeddings = await this.provider.embedBatch(texts, batchOptions);

      // Batch update graph
      const updates = needsEmbedding.map((item, i) => ({
        apiName: item.field.apiName,
        sobjectType: item.field.sobjectType,
        embedding: embeddings[i],
        contentHash: item.newHash,
      }));

      await this.graphExecutor.batchUpdateFieldEmbeddings(updates);

      result.processed = fields.length;
      result.embedded = needsEmbedding.length;
      result.durationMs = Date.now() - startTime;

      log.debug(
        { embedded: result.embedded, skipped: result.skipped, durationMs: result.durationMs },
        'Field embedding sync complete'
      );

      return result;
    } catch (error) {
      log.error({ error }, 'Field embedding sync failed');
      result.errors++;
      result.durationMs = Date.now() - startTime;
      throw error;
    }
  }

  /**
   * Sync all embeddings (objects and fields).
   */
  async syncAll(options: EmbeddingSyncOptions = {}): Promise<{
    objects: EmbeddingSyncResult;
    fields: EmbeddingSyncResult;
    totalDurationMs: number;
  }> {
    const startTime = Date.now();

    log.debug('Starting full embedding sync');

    const objectsResult = await this.syncObjectEmbeddings(options);
    const fieldsResult = await this.syncFieldEmbeddings(options);

    const totalDurationMs = Date.now() - startTime;

    log.debug(
      {
        objectsEmbedded: objectsResult.embedded,
        fieldsEmbedded: fieldsResult.embedded,
        totalDurationMs,
      },
      'Full embedding sync complete'
    );

    return {
      objects: objectsResult,
      fields: fieldsResult,
      totalDurationMs,
    };
  }
}

/**
 * Create an embedding sync service.
 */
export function createEmbeddingSyncService(
  provider: EmbeddingProvider,
  graphExecutor: EmbeddingGraphExecutor
): EmbeddingSyncService {
  return new EmbeddingSyncService(provider, graphExecutor);
}

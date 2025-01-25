/**
 * Ollama Embedding Provider
 *
 * Implements EmbeddingProvider using local Ollama for privacy-first embedding.
 * Supports models like nomic-embed-text, all-minilm, mxbai-embed-large.
 */

import { Ollama } from 'ollama';
import { createLogger } from '../../core/index.js';
import type {
  EmbeddingProvider,
  EmbeddingProviderType,
  BatchOptions,
} from './types.js';
import { EmbeddingError } from './types.js';

const log = createLogger('ollama-embeddings');

// Ollama embedding model configurations
const MODEL_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'all-minilm': 384,
  'mxbai-embed-large': 1024,
  'snowflake-arctic-embed': 1024,
};

const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_BATCH_SIZE = 50; // Ollama is local, so we can be more conservative
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 500;

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ollama embedding provider implementation.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly providerType: EmbeddingProviderType = 'ollama';

  private client: Ollama;
  private model: string;
  private knownDimensions: number | null;
  private detectedDimensions: number | null = null;

  constructor(model: string = DEFAULT_MODEL, baseUrl: string = DEFAULT_BASE_URL) {
    this.client = new Ollama({ host: baseUrl });
    this.model = model;
    // Use known dimensions if available, otherwise we'll detect dynamically
    this.knownDimensions = MODEL_DIMENSIONS[model] ?? null;

    log.debug({ model, knownDimensions: this.knownDimensions, baseUrl }, 'Ollama embedding provider initialized');
  }

  /**
   * Get the model name for embedding versioning.
   */
  get modelName(): string {
    return this.model;
  }

  /**
   * Get the embedding dimensions for this model.
   * Returns known dimensions if available, otherwise uses detected dimensions
   * from a previous embed call. If neither, returns a default of 768.
   */
  getDimensions(): number {
    if (this.knownDimensions !== null) {
      return this.knownDimensions;
    }
    if (this.detectedDimensions !== null) {
      return this.detectedDimensions;
    }
    // Fallback for unknown models before first embed call
    // This will be updated after first successful embedding
    return 768;
  }

  /**
   * Detect dimensions by generating a test embedding.
   * Call this before getDimensions() if you need accurate dimensions for an unknown model.
   */
  async detectDimensions(): Promise<number> {
    if (this.knownDimensions !== null) {
      return this.knownDimensions;
    }
    if (this.detectedDimensions !== null) {
      return this.detectedDimensions;
    }

    try {
      log.debug({ model: this.model }, 'Detecting dimensions for unknown model via test embedding');
      const testEmbedding = await this.embed('test');
      this.detectedDimensions = testEmbedding.length;
      log.info({ model: this.model, dimensions: this.detectedDimensions }, 'Detected embedding dimensions');
      return this.detectedDimensions;
    } catch (error) {
      log.warn({ model: this.model, error }, 'Failed to detect dimensions, using default 768');
      return 768;
    }
  }

  /**
   * Check if Ollama is available and the model is loaded.
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Check if Ollama is running
      const models = await this.client.list();

      // Check if our model is available
      const modelAvailable = models.models.some(
        (m) => m.name === this.model || m.name.startsWith(`${this.model}:`)
      );

      if (!modelAvailable) {
        log.warn({ model: this.model }, 'Ollama model not found, may need to pull');
        // Try to pull the model
        try {
          await this.client.pull({ model: this.model });
          return true;
        } catch {
          return false;
        }
      }

      return true;
    } catch (error) {
      log.warn({ error }, 'Ollama embedding provider not available');
      return false;
    }
  }

  /**
   * Embed a single text string.
   */
  async embed(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new EmbeddingError('Cannot embed empty text', 'ollama');
    }

    try {
      const response = await this.client.embed({
        model: this.model,
        input: text,
      });

      // Ollama returns embeddings array, take the first one for single input
      if (!response.embeddings || response.embeddings.length === 0) {
        throw new EmbeddingError('No embedding returned from Ollama', 'ollama');
      }

      const embedding = response.embeddings[0];
      
      // Update detected dimensions from actual embedding (for unknown models)
      if (this.knownDimensions === null && this.detectedDimensions === null) {
        this.detectedDimensions = embedding.length;
        log.debug({ model: this.model, dimensions: this.detectedDimensions }, 'Detected dimensions from embedding');
      }

      return embedding;
    } catch (error) {
      if (error instanceof EmbeddingError) throw error;

      // Check for connection errors
      if (this.isConnectionError(error)) {
        throw new EmbeddingError(
          'Cannot connect to Ollama. Is it running?',
          'ollama',
          error as Error
        );
      }

      throw new EmbeddingError(
        `Failed to embed text: ${(error as Error).message}`,
        'ollama',
        error as Error
      );
    }
  }

  /**
   * Embed multiple texts with batching.
   * Ollama's embed endpoint supports multiple inputs natively.
   */
  async embedBatch(texts: string[], options: BatchOptions = {}): Promise<number[][]> {
    const {
      batchSize = DEFAULT_BATCH_SIZE,
      maxRetries = DEFAULT_MAX_RETRIES,
      initialBackoffMs = DEFAULT_INITIAL_BACKOFF_MS,
      onProgress,
    } = options;

    if (!texts || texts.length === 0) {
      return [];
    }

    // Filter out empty texts and track their indices
    const validTexts: { text: string; index: number }[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (texts[i] && texts[i].trim().length > 0) {
        validTexts.push({ text: texts[i], index: i });
      }
    }

    if (validTexts.length === 0) {
      return texts.map(() => []);
    }

    const results: number[][] = new Array(texts.length).fill([]);
    let completed = 0;

    // Process in batches
    for (let i = 0; i < validTexts.length; i += batchSize) {
      const batch = validTexts.slice(i, i + batchSize);
      const batchTexts = batch.map((v) => v.text);

      let retries = 0;
      let backoff = initialBackoffMs;

      while (retries <= maxRetries) {
        try {
          const response = await this.client.embed({
            model: this.model,
            input: batchTexts,
          });

          if (!response.embeddings || response.embeddings.length !== batchTexts.length) {
            throw new EmbeddingError(
              `Expected ${batchTexts.length} embeddings, got ${response.embeddings?.length ?? 0}`,
              'ollama'
            );
          }

          // Map results back to original indices
          for (let j = 0; j < response.embeddings.length; j++) {
            const originalIndex = batch[j].index;
            results[originalIndex] = response.embeddings[j];
          }

          completed += batch.length;
          onProgress?.(completed, validTexts.length);

          log.debug(
            { batchStart: i, batchSize: batch.length, completed, total: validTexts.length },
            'Batch embedded successfully'
          );

          break;
        } catch (error) {
          if (error instanceof EmbeddingError) throw error;

          if (retries < maxRetries) {
            log.warn(
              { retries, backoff, batchStart: i, error: (error as Error).message },
              'Embedding failed, retrying'
            );
            await sleep(backoff);
            backoff *= 2;
            retries++;
          } else {
            // Log warning and skip this batch instead of halting entire process
            log.warn(
              { batchStart: i, batchSize: batch.length, error: (error as Error).message },
              'Batch failed after retries, skipping'
            );
            completed += batch.length;
            onProgress?.(completed, validTexts.length);
            break;
          }
        }
      }
    }

    return results;
  }

  /**
   * Check if an error is a connection error.
   */
  private isConnectionError(error: unknown): boolean {
    const message = (error as Error)?.message?.toLowerCase() ?? '';
    return (
      message.includes('econnrefused') ||
      message.includes('fetch failed') ||
      message.includes('network')
    );
  }
}

/**
 * Create an Ollama embedding provider.
 */
export function createOllamaProvider(
  model: string = DEFAULT_MODEL,
  baseUrl: string = DEFAULT_BASE_URL
): OllamaEmbeddingProvider {
  return new OllamaEmbeddingProvider(model, baseUrl);
}

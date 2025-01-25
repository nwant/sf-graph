/**
 * OpenAI Embedding Provider
 *
 * Implements EmbeddingProvider using OpenAI's text-embedding-3-small model.
 * Supports smart batching with exponential backoff for rate limit handling.
 */

import OpenAI from 'openai';
import { createLogger } from '../../core/index.js';
import type {
  EmbeddingProvider,
  EmbeddingProviderType,
  BatchOptions,
} from './types.js';
import { EmbeddingError, RateLimitError } from './types.js';

const log = createLogger('openai-embeddings');

// OpenAI embedding model configurations
const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_BATCH_SIZE = 100; // OpenAI supports up to 2048, but we stay conservative
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;

/**
 * Sleep helper for exponential backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenAI embedding provider implementation.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerType: EmbeddingProviderType = 'openai';

  private client: OpenAI;
  private model: string;
  private dimensions: number;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    if (!apiKey) {
      throw new EmbeddingError('OpenAI API key is required', 'openai');
    }

    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.dimensions = MODEL_DIMENSIONS[model] ?? 1536;

    log.debug({ model, dimensions: this.dimensions }, 'OpenAI embedding provider initialized');
  }

  /**
   * Get the model name for embedding versioning.
   */
  get modelName(): string {
    return this.model;
  }

  /**
   * Get the embedding dimensions for this model.
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Check if OpenAI API is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Simple test embedding
      await this.client.embeddings.create({
        model: this.model,
        input: 'test',
      });
      return true;
    } catch (error) {
      log.warn({ error }, 'OpenAI embedding provider not available');
      return false;
    }
  }

  /**
   * Embed a single text string.
   */
  async embed(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new EmbeddingError('Cannot embed empty text', 'openai');
    }

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
      });

      return response.data[0].embedding;
    } catch (error) {
      if (this.isRateLimitError(error)) {
        throw new RateLimitError('openai', this.getRetryAfter(error));
      }
      throw new EmbeddingError(
        `Failed to embed text: ${(error as Error).message}`,
        'openai',
        error as Error
      );
    }
  }

  /**
   * Embed multiple texts with smart batching and rate limit handling.
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
          const response = await this.client.embeddings.create({
            model: this.model,
            input: batchTexts,
          });

          // Map results back to original indices
          for (let j = 0; j < response.data.length; j++) {
            const originalIndex = batch[j].index;
            results[originalIndex] = response.data[j].embedding;
          }

          completed += batch.length;
          onProgress?.(completed, validTexts.length);

          log.debug(
            { batchStart: i, batchSize: batch.length, completed, total: validTexts.length },
            'Batch embedded successfully'
          );

          break;
        } catch (error) {
          if (this.isRateLimitError(error) && retries < maxRetries) {
            const retryAfter = this.getRetryAfter(error) ?? backoff;
            log.warn(
              { retries, backoff: retryAfter, batchStart: i },
              'Rate limited, retrying with backoff'
            );
            await sleep(retryAfter);
            backoff *= 2; // Exponential backoff
            retries++;
          } else {
            throw new EmbeddingError(
              `Failed to embed batch starting at ${i}: ${(error as Error).message}`,
              'openai',
              error as Error
            );
          }
        }
      }
    }

    return results;
  }

  /**
   * Check if an error is a rate limit error.
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      return error.status === 429;
    }
    return false;
  }

  /**
   * Extract retry-after time from rate limit error.
   */
  private getRetryAfter(error: unknown): number | undefined {
    if (error instanceof OpenAI.APIError && error.headers) {
      const retryAfter = error.headers['retry-after'];
      if (retryAfter) {
        return parseInt(retryAfter, 10) * 1000; // Convert seconds to ms
      }
    }
    return undefined;
  }
}

/**
 * Create an OpenAI embedding provider.
 */
export function createOpenAIProvider(
  apiKey: string,
  model: string = DEFAULT_MODEL
): OpenAIEmbeddingProvider {
  return new OpenAIEmbeddingProvider(apiKey, model);
}

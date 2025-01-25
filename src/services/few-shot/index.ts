/**
 * Few-Shot Example Service
 *
 * Main service for dynamic few-shot selection (DAIL-SQL).
 * Uses singleton pattern to avoid per-request initialization overhead.
 */

import { FewShotExampleStore } from './example-store.js';
import { getEmbeddingProvider } from '../embeddings/embedding-service.js';
import { createLogger } from '../../core/index.js';
import type { SoqlExample } from './types.js';

const log = createLogger('few-shot-service');

/** Default number of examples to retrieve */
const DEFAULT_EXAMPLE_COUNT = 3;

/**
 * Service for retrieving similar few-shot examples for SOQL generation.
 * Uses singleton pattern for efficient reuse.
 */
export class FewShotExampleService {
  private static instance: FewShotExampleService | null = null;
  private store: FewShotExampleStore;

  private constructor() {
    this.store = new FewShotExampleStore();
  }

  /**
   * Get the singleton instance.
   */
  public static getInstance(): FewShotExampleService {
    if (!FewShotExampleService.instance) {
      FewShotExampleService.instance = new FewShotExampleService();
    }
    return FewShotExampleService.instance;
  }

  /**
   * Reset singleton (for testing).
   */
  public static resetInstance(): void {
    FewShotExampleService.instance = null;
  }

  /**
   * Get the underlying store (for CLI commands).
   */
  public getStore(): FewShotExampleStore {
    return this.store;
  }

  /**
   * Check if the example store is ready (has examples seeded).
   */
  async isReady(): Promise<boolean> {
    try {
      const count = await this.store.getExampleCount();
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Auto-initialize the example store on first use.
   * Loads examples from JSON and generates embeddings.
   * 
   * @param onProgress - Optional callback for progress updates
   * @returns true if initialization happened, false if already initialized
   */
  async ensureInitialized(onProgress?: (message: string) => void): Promise<boolean> {
    try {
      const ready = await this.isReady();
      if (ready) {
        return false; // Already initialized
      }

      onProgress?.('ℹ️  Initializing few-shot examples (one-time setup)...');
      log.info('Auto-initializing few-shot example store');

      // Dynamically load examples
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      const examples: SoqlExample[] = require('../../data/few-shot/examples.json');

      await this.store.seedExamples(examples);
      
      onProgress?.(`✅ Loaded ${examples.length} few-shot examples`);
      log.info({ count: examples.length }, 'Few-shot examples auto-initialized');
      
      return true;
    } catch (error) {
      log.warn({ err: error }, 'Failed to auto-initialize few-shot examples');
      return false;
    }
  }

  /**
   * Find the most similar examples for a given question.
   * 
   * Auto-initializes the store on first use if needed.
   * If the index doesn't exist or search fails, returns empty array
   * so the Coder agent can proceed without examples.
   * 
   * @param question - Natural language question
   * @param k - Number of examples to return (default: 3)
   * @param onProgress - Optional callback for progress updates during auto-init
   * @returns Array of similar examples, or empty array on failure
   */
  async findSimilarExamples(
    question: string, 
    k = DEFAULT_EXAMPLE_COUNT,
    onProgress?: (message: string) => void
  ): Promise<SoqlExample[]> {
    try {
      // Auto-initialize on first use
      await this.ensureInitialized(onProgress);

      const provider = getEmbeddingProvider();
      const currentModel = provider.modelName;

      // Check if examples are seeded (might still be empty after failed init)
      const count = await this.store.getExampleCount();
      if (count === 0) {
        log.debug('No few-shot examples available, skipping');
        return [];
      }

      // Check embedding model compatibility
      const storedModel = await this.store.getStoredEmbeddingModel();
      if (storedModel && storedModel !== currentModel) {
        log.warn(
          { storedModel, currentModel },
          'Embedding model mismatch. Run "sf graph ai examples seed --force" to re-embed.'
        );
        // Still attempt search - the search will filter by model
      }

      // Generate embedding for the question
      const [embedding] = await provider.embedBatch([question]);

      // Search for similar examples
      const results = await this.store.search(embedding, k, currentModel);

      log.debug(
        { 
          question: question.substring(0, 50), 
          resultsCount: results.length,
          topScore: results[0]?.score 
        },
        'Found similar few-shot examples'
      );

      return results.map((r) => r.example);
    } catch (error) {
      // Cold start fallback: proceed without examples
      log.warn(
        { err: error },
        'Few-shot search failed, proceeding without examples'
      );
      return [];
    }
  }

  /**
   * Format examples for injection into the CODER_PROMPT.
   * 
   * @param examples - Examples to format
   * @returns Formatted string for prompt injection
   */
  formatExamplesForPrompt(examples: SoqlExample[]): string {
    if (examples.length === 0) {
      return '';
    }

    const formatted = examples.map((ex, i) => {
      let block = `**Example ${i + 1}:**\n`;
      block += `Question: "${ex.question}"\n`;
      block += `\`\`\`soql\n${ex.soql}\n\`\`\``;
      if (ex.explanation) {
        block += `\nNote: ${ex.explanation}`;
      }
      return block;
    });

    return formatted.join('\n\n');
  }
}

// Re-export types
export type { SoqlExample, StoredSoqlExample, ExampleSearchResult } from './types.js';

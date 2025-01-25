/**
 * Embedding Configuration
 *
 * Configuration for embedding providers and models.
 * Follows llm-config.ts pattern for embedding-specific settings.
 */

export type EmbeddingProviderType = 'openai' | 'ollama';

/**
 * Default embedding models per provider.
 */
export const EMBEDDING_MODELS: Record<EmbeddingProviderType, { default: string; options: string[] }> = {
  ollama: {
    default: 'nomic-embed-text',
    options: [
      'nomic-embed-text', // 768 dims, optimized for retrieval
      'mxbai-embed-large', // 1024 dims, high quality
      'all-minilm', // 384 dims, fast and lightweight
      'snowflake-arctic-embed', // 1024 dims, multilingual
      'avr/sfr-embedding-mistral',
    ],
  },
  openai: {
    default: 'text-embedding-3-small',
    options: [
      'text-embedding-3-small', // 1536 dims, cost-effective
      'text-embedding-3-large', // 3072 dims, highest quality
      'text-embedding-ada-002', // 1536 dims, legacy
    ],
  },
};

/**
 * Embedding generation parameters.
 */
export interface EmbeddingParams {
  /** Maximum batch size for embedding requests */
  batchSize: number;
  /** Timeout for embedding API calls in milliseconds */
  timeout: number;
  /** Number of retry attempts for failed requests */
  retryAttempts: number;
}

/**
 * Default embedding parameters.
 */
export const EMBEDDING_DEFAULTS: EmbeddingParams = {
  batchSize: 50,
  timeout: 30000,
  retryAttempts: 3,
};

/**
 * Vector index configuration for Neo4j.
 */
export interface VectorIndexConfig {
  /** Dimension size for the index (must match embedding model) */
  dimensions: number;
  /** Similarity function: 'cosine' | 'euclidean' */
  similarityFunction: 'cosine' | 'euclidean';
}

/**
 * Default vector dimensions per model.
 * Used for Neo4j vector index creation.
 */
export const MODEL_DIMENSIONS: Record<string, number> = {
  // Ollama models
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  'snowflake-arctic-embed': 1024,
  'avr/sfr-embedding-mistral': 4096,
  // OpenAI models
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

/**
 * Get the default model for a provider.
 */
export function getDefaultModel(provider: EmbeddingProviderType): string {
  return EMBEDDING_MODELS[provider].default;
}

/**
 * Get the dimension size for a model.
 */
export function getModelDimensions(model: string): number {
  return MODEL_DIMENSIONS[model] || 768; // Default to 768 if unknown
}

/**
 * Validate that a model is supported for a provider.
 */
export function isValidModel(provider: EmbeddingProviderType, model: string): boolean {
  return EMBEDDING_MODELS[provider].options.includes(model);
}

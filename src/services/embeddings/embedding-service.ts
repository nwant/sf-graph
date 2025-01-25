/**
 * Embedding Service
 *
 * Factory and utility functions for the embedding service.
 * - Creates embedding providers based on configuration
 * - Composes embeddable text from metadata
 * - Computes content hashes for change detection
 */

import * as crypto from 'node:crypto';
import { createLogger } from '../../core/index.js';
import { loadConfig } from '../../agent/config.js';
import type {
  EmbeddingProvider,
  EmbeddingProviderType,
  EmbeddingConfig,
  MetadataInput,
  EmbeddableMetadata,
  EmbeddableNodeType,
} from './types.js';
import { EmbeddingError } from './types.js';
import { createOpenAIProvider } from './openai-embeddings.js';
import { createOllamaProvider } from './ollama-embeddings.js';

const log = createLogger('embedding-service');

// Minimum text length to embed (avoid garbage vectors)
const MIN_EMBEDDABLE_LENGTH = 5;

// Maximum text length for embedding (avoid context overflow)
// nomic-embed-text has 8192 token limit; 6000 chars ~= 1500 tokens, safe margin
const MAX_EMBEDDABLE_LENGTH = 6000;

// Singleton instance
let embeddingProvider: EmbeddingProvider | null = null;

/**
 * Create an embedding provider based on configuration.
 */
export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  log.debug({ provider: config.provider, model: config.model }, 'Creating embedding provider');

  switch (config.provider) {
    case 'openai':
      if (!config.apiKey) {
        throw new EmbeddingError('OpenAI API key is required', 'openai');
      }
      return createOpenAIProvider(config.apiKey, config.model);

    case 'ollama':
      return createOllamaProvider(config.model, config.baseUrl);

    default:
      throw new EmbeddingError(
        `Unknown embedding provider: ${config.provider}`,
        config.provider as EmbeddingProviderType
      );
  }
}

/**
 * Get the default embedding provider based on agent config.
 * Creates a singleton instance.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (embeddingProvider) {
    return embeddingProvider;
  }

  const config = loadConfig();

  // Build embedding config from agent config
  const embeddingConfig: EmbeddingConfig = {
    provider: (config.embeddingProvider as EmbeddingProviderType) ?? 'ollama',
    model: config.embeddingModel ?? 'nomic-embed-text',
    apiKey: config.openaiApiKey,
    baseUrl: config.baseUrl,
  };

  embeddingProvider = createEmbeddingProvider(embeddingConfig);
  return embeddingProvider;
}

/**
 * Clear the singleton provider (for testing or reconfiguration).
 */
export function clearEmbeddingProvider(): void {
  embeddingProvider = null;
}

/**
 * Compose embeddable text from metadata.
 * Returns null if the resulting text is too short to embed meaningfully.
 * Truncates text that exceeds the maximum length for embedding models.
 *
 * Format:
 * - Objects: "{label} ({apiName}). {description}"
 * - Fields: "{label} ({apiName}) on {objectApiName}. Type: {type}. {description} {helpText}"
 * - PicklistValues: "{value} ({label}) for {fieldApiName} on {objectApiName}"
 */
export function composeEmbeddableText(input: MetadataInput): string | null {
  const parts: string[] = [];

  // Primary identifier
  if (input.label) {
    parts.push(input.label);
    if (input.apiName && input.apiName !== input.label) {
      parts.push(`(${input.apiName})`);
    }
  } else if (input.apiName) {
    parts.push(input.apiName);
  }

  // Context: parent object for fields
  if (input.objectApiName) {
    parts.push(`on ${input.objectApiName}`);
  }

  // Type information
  if (input.type) {
    parts.push(`Type: ${input.type}`);
  }

  // Description
  if (input.description) {
    parts.push(input.description);
  }

  // Help text (for fields)
  if (input.helpText) {
    parts.push(input.helpText);
  }

  // Related entities (for context)
  if (input.relatedEntities && input.relatedEntities.length > 0) {
    parts.push(`Related to: ${input.relatedEntities.join(', ')}`);
  }

  let text = parts.join('. ').trim();

  // Validate minimum length
  if (text.length < MIN_EMBEDDABLE_LENGTH) {
    log.debug({ input, textLength: text.length }, 'Text too short to embed');
    return null;
  }

  // Truncate if exceeds maximum length
  if (text.length > MAX_EMBEDDABLE_LENGTH) {
    log.debug(
      {
        field: input.apiName,
        object: input.objectApiName,
        originalLength: text.length,
        truncatedTo: MAX_EMBEDDABLE_LENGTH,
      },
      'Truncated long text for embedding'
    );
    text = text.substring(0, MAX_EMBEDDABLE_LENGTH);
  }

  return text;
}

/**
 * Compute SHA-256 hash of text content for change detection.
 */
export function computeContentHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Create embeddable metadata from input.
 * Composes text and computes hash, but does not generate embedding.
 */
export function createEmbeddableMetadata(
  nodeType: EmbeddableNodeType,
  nodeId: string,
  input: MetadataInput
): EmbeddableMetadata | null {
  const text = composeEmbeddableText(input);

  if (!text) {
    return null;
  }

  return {
    nodeType,
    nodeId,
    text,
    contentHash: computeContentHash(text),
  };
}

/**
 * Check if content has changed by comparing hashes.
 */
export function hasContentChanged(
  newHash: string,
  existingHash: string | null | undefined
): boolean {
  if (!existingHash) {
    return true; // No existing hash, content is "new"
  }
  return newHash !== existingHash;
}

/**
 * Prepare Object metadata for embedding.
 */
export function prepareObjectMetadata(object: {
  apiName: string;
  label?: string;
  description?: string;
}): EmbeddableMetadata | null {
  return createEmbeddableMetadata('Object', object.apiName, {
    apiName: object.apiName,
    label: object.label,
    description: object.description,
  });
}

/**
 * Prepare Field metadata for embedding.
 */
export function prepareFieldMetadata(field: {
  apiName: string;
  sobjectType: string;
  label?: string;
  description?: string;
  helpText?: string;
  type?: string;
}): EmbeddableMetadata | null {
  // Field nodeId is composite: objectApiName.fieldApiName
  const nodeId = `${field.sobjectType}.${field.apiName}`;

  return createEmbeddableMetadata('Field', nodeId, {
    apiName: field.apiName,
    label: field.label,
    description: field.description,
    helpText: field.helpText,
    type: field.type,
    objectApiName: field.sobjectType,
  });
}

/**
 * Prepare PicklistValue metadata for embedding.
 */
export function preparePicklistValueMetadata(value: {
  value: string;
  label?: string;
  fieldApiName: string;
  objectApiName: string;
}): EmbeddableMetadata | null {
  // PicklistValue nodeId is composite: objectApiName.fieldApiName.value
  const nodeId = `${value.objectApiName}.${value.fieldApiName}.${value.value}`;

  return createEmbeddableMetadata('PicklistValue', nodeId, {
    apiName: value.value,
    label: value.label,
    objectApiName: value.objectApiName,
  });
}

/**
 * Batch prepare metadata and filter out items that can't be embedded.
 */
export function batchPrepareMetadata<T>(
  items: T[],
  preparer: (item: T) => EmbeddableMetadata | null
): EmbeddableMetadata[] {
  const prepared: EmbeddableMetadata[] = [];

  for (const item of items) {
    const metadata = preparer(item);
    if (metadata) {
      prepared.push(metadata);
    }
  }

  return prepared;
}

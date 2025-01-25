/**
 * Centralized Default Configuration Values
 *
 * All magic numbers and default values are defined here for consistency
 * and maintainability. Users can override these via CLI flags.
 */

export const DEFAULTS = {
  /**
   * Maximum parallel Salesforce API calls.
   * Higher values speed up sync but risk hitting rate limits.
   * CLI flag: --concurrency
   */
  CONCURRENCY: 10,

  /**
   * Neo4j batch write size.
   * Larger batches are more efficient but use more memory.
   * Optimized for lightweight operations (fields, relationships, picklist values).
   * CLI flag: --batch-size
   */
  BATCH_SIZE: 150,

  /**
   * Maximum number of retry attempts for transient failures.
   */
  RETRY_ATTEMPTS: 3,

  /**
   * Initial delay between retries in milliseconds.
   */
  RETRY_DELAY_MS: 1000,

  /**
   * Multiplier for exponential backoff between retries.
   */
  RETRY_BACKOFF_MULTIPLIER: 2,

  /**
   * Maximum delay between retries in milliseconds.
   */
  RETRY_MAX_DELAY_MS: 30000,

  /**
   * LLM request timeout in milliseconds.
   */
  LLM_TIMEOUT_MS: 10000,

  /**
   * Batch size for picklist value creation.
   * Smaller batches provide more frequent progress updates.
   * Larger batches are more efficient but may appear to hang.
   */
  PICKLIST_BATCH_SIZE: 1000,
} as const;

/**
 * Type for the defaults object
 */
export type Defaults = typeof DEFAULTS;

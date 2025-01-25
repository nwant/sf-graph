/**
 * Concurrency Utilities
 *
 * Zero-dependency concurrency control for parallel operations.
 * Provides rate limiting, retry with backoff, and batch processing.
 */

/**
 * Limit function returned by pLimit
 */
export type LimitFunction = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Creates a concurrency limiter that restricts the number of concurrent promises.
 *
 * @param concurrency - Maximum number of concurrent executions
 * @returns A limit function that wraps async functions
 *
 * @example
 * const limit = pLimit(5);
 * const results = await Promise.all(
 *   urls.map(url => limit(() => fetch(url)))
 * );
 */
export function pLimit(concurrency: number): LimitFunction {
  if (concurrency < 1) {
    throw new Error('Concurrency must be at least 1');
  }

  const queue: Array<{
    fn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];
  let activeCount = 0;

  const next = (): void => {
    if (activeCount >= concurrency || queue.length === 0) {
      return;
    }

    const item = queue.shift()!;
    activeCount++;

    item
      .fn()
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        activeCount--;
        next();
      });
  };

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      next();
    });
  };
}

/**
 * Options for retry with backoff
 */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  attempts?: number;
  /** Initial delay in milliseconds (default: 1000) */
  delayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Function to determine if error is retryable (default: always retry) */
  shouldRetry?: (error: Error) => boolean;
  /** Callback when a retry occurs */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

/**
 * Wraps an async function with exponential backoff retry logic.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration
 * @returns The result of the function, or throws after all retries exhausted
 *
 * @example
 * const result = await retryWithBackoff(
 *   () => connection.describe(objectName),
 *   {
 *     attempts: 3,
 *     shouldRetry: (err) => err.message.includes('REQUEST_LIMIT_EXCEEDED'),
 *   }
 * );
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  // Import defaults inline to avoid circular dependencies
  const { DEFAULTS } = await import('../config/defaults.js');

  const {
    attempts = DEFAULTS.RETRY_ATTEMPTS,
    delayMs = DEFAULTS.RETRY_DELAY_MS,
    backoffMultiplier = DEFAULTS.RETRY_BACKOFF_MULTIPLIER,
    maxDelayMs = DEFAULTS.RETRY_MAX_DELAY_MS,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: Error | undefined;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt === attempts || !shouldRetry(lastError)) {
        throw lastError;
      }

      // Call onRetry callback if provided
      onRetry?.(lastError, attempt, currentDelay);

      // Wait before retrying
      await sleep(currentDelay);

      // Calculate next delay with exponential backoff
      currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is a Salesforce rate limit error
 */
export function isSalesforceRateLimitError(error: Error): boolean {
  const message = error.message || '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errorCode = (error as any)?.errorCode;

  return (
    errorCode === 'REQUEST_LIMIT_EXCEEDED' ||
    message.includes('REQUEST_LIMIT_EXCEEDED') ||
    message.includes('TotalRequests Limit exceeded') ||
    message.includes('ConcurrentPerOrgLongTxn Limit exceeded')
  );
}

/**
 * Check if an error is retryable (network issues, rate limits, etc.)
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message || '';

  // Salesforce rate limit errors
  if (isSalesforceRateLimitError(error)) {
    return true;
  }

  // Network errors
  if (
    message.includes('ETIMEDOUT') ||
    message.includes('ECONNRESET') ||
    message.includes('ECONNREFUSED') ||
    message.includes('socket hang up')
  ) {
    return true;
  }

  // Salesforce temporary errors
  if (
    message.includes('UNABLE_TO_LOCK_ROW') ||
    message.includes('SERVER_UNAVAILABLE')
  ) {
    return true;
  }

  return false;
}

/**
 * Process items in batches with a processor function
 *
 * @param items - Array of items to process
 * @param batchSize - Number of items per batch
 * @param processor - Function to process each batch
 * @param onBatchComplete - Optional callback after each batch
 * @returns Flattened array of all results
 *
 * @example
 * const results = await batchProcess(
 *   objects,
 *   50,
 *   async (batch) => {
 *     await session.executeWrite(tx => tx.run(query, { items: batch }));
 *     return batch.length;
 *   }
 * );
 */
export async function batchProcess<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[], batchIndex: number) => Promise<R>,
  onBatchComplete?: (processed: number, total: number) => void
): Promise<R[]> {
  const results: R[] = [];
  const totalBatches = Math.ceil(items.length / batchSize);

  for (let i = 0; i < totalBatches; i++) {
    const start = i * batchSize;
    const batch = items.slice(start, start + batchSize);

    const result = await processor(batch, i);
    results.push(result);

    onBatchComplete?.(Math.min(start + batchSize, items.length), items.length);
  }

  return results;
}

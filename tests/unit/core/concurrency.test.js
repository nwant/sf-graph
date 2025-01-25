import { describe, expect, test, jest, beforeEach } from '@jest/globals';

const {
  pLimit,
  retryWithBackoff,
  isRetryableError,
  isSalesforceRateLimitError,
  batchProcess,
} = await import('../../../dist/core/concurrency.js');

describe('Concurrency Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // pLimit
  // ============================================================
  describe('pLimit', () => {
    test('limits concurrent executions to specified concurrency', async () => {
      const limit = pLimit(2);
      let concurrent = 0;
      let maxConcurrent = 0;

      const task = async (delay) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, delay));
        concurrent--;
        return delay;
      };

      const promises = [
        limit(() => task(50)),
        limit(() => task(50)),
        limit(() => task(50)),
        limit(() => task(50)),
      ];

      await Promise.all(promises);

      expect(maxConcurrent).toBe(2);
    });

    test('processes all items even with concurrency limit', async () => {
      const limit = pLimit(3);
      const results = [];

      const promises = [1, 2, 3, 4, 5].map((n) =>
        limit(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          results.push(n);
          return n;
        })
      );

      const returnedValues = await Promise.all(promises);

      expect(returnedValues).toEqual([1, 2, 3, 4, 5]);
      expect(results.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    test('throws error for concurrency less than 1', () => {
      expect(() => pLimit(0)).toThrow('Concurrency must be at least 1');
      expect(() => pLimit(-1)).toThrow('Concurrency must be at least 1');
    });

    test('propagates errors from tasks', async () => {
      const limit = pLimit(2);

      const promise = limit(async () => {
        throw new Error('Task failed');
      });

      await expect(promise).rejects.toThrow('Task failed');
    });

    test('continues processing other tasks after one fails', async () => {
      const limit = pLimit(2);
      const results = [];

      const promises = [
        limit(async () => {
          results.push(1);
          return 1;
        }),
        limit(async () => {
          throw new Error('Task 2 failed');
        }),
        limit(async () => {
          results.push(3);
          return 3;
        }),
      ];

      const settled = await Promise.allSettled(promises);

      expect(settled[0].status).toBe('fulfilled');
      expect(settled[1].status).toBe('rejected');
      expect(settled[2].status).toBe('fulfilled');
      expect(results).toContain(1);
      expect(results).toContain(3);
    });
  });

  // ============================================================
  // retryWithBackoff
  // ============================================================
  describe('retryWithBackoff', () => {
    test('returns result on first successful attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const result = await retryWithBackoff(fn, { attempts: 3 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries on failure and succeeds on second attempt', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValueOnce('success');

      const result = await retryWithBackoff(fn, {
        attempts: 3,
        delayMs: 10,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('respects max attempts and throws after exhausting retries', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Always fails'));

      await expect(
        retryWithBackoff(fn, { attempts: 3, delayMs: 10 })
      ).rejects.toThrow('Always fails');

      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('calls onRetry callback on each retry', async () => {
      const onRetry = jest.fn();
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      await retryWithBackoff(fn, {
        attempts: 3,
        delayMs: 10,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 10);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2, 20);
    });

    test('respects shouldRetry predicate - does not retry when false', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('Non-retryable error'))
        .mockResolvedValue('success');

      await expect(
        retryWithBackoff(fn, {
          attempts: 3,
          delayMs: 10,
          shouldRetry: () => false,
        })
      ).rejects.toThrow('Non-retryable error');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('respects shouldRetry predicate - retries when true', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('Retryable error'))
        .mockResolvedValue('success');

      const result = await retryWithBackoff(fn, {
        attempts: 3,
        delayMs: 10,
        shouldRetry: (err) => err.message.includes('Retryable'),
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('applies exponential backoff', async () => {
      const onRetry = jest.fn();
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'))
        .mockResolvedValue('success');

      await retryWithBackoff(fn, {
        attempts: 4,
        delayMs: 100,
        backoffMultiplier: 2,
        onRetry,
      });

      // Delays: 100, 200, 400
      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 100);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 200);
      expect(onRetry).toHaveBeenNthCalledWith(3, expect.any(Error), 3, 400);
    });

    test('respects maxDelayMs cap', async () => {
      const onRetry = jest.fn();
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      await retryWithBackoff(fn, {
        attempts: 3,
        delayMs: 100,
        backoffMultiplier: 10,
        maxDelayMs: 150,
        onRetry,
      });

      // First delay: 100, second delay: min(1000, 150) = 150
      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 100);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 150);
    });
  });

  // ============================================================
  // isRetryableError
  // ============================================================
  describe('isRetryableError', () => {
    test('returns true for Salesforce rate limit errors', () => {
      const error = new Error('REQUEST_LIMIT_EXCEEDED');
      expect(isRetryableError(error)).toBe(true);
    });

    test('returns true for network timeout errors', () => {
      expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
      expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isRetryableError(new Error('socket hang up'))).toBe(true);
    });

    test('returns true for Salesforce temporary errors', () => {
      expect(isRetryableError(new Error('UNABLE_TO_LOCK_ROW'))).toBe(true);
      expect(isRetryableError(new Error('SERVER_UNAVAILABLE'))).toBe(true);
    });

    test('returns false for non-retryable errors', () => {
      expect(isRetryableError(new Error('INVALID_FIELD'))).toBe(false);
      expect(isRetryableError(new Error('Object not found'))).toBe(false);
      expect(isRetryableError(new Error('Permission denied'))).toBe(false);
    });
  });

  // ============================================================
  // isSalesforceRateLimitError
  // ============================================================
  describe('isSalesforceRateLimitError', () => {
    test('returns true for REQUEST_LIMIT_EXCEEDED', () => {
      const error = new Error('REQUEST_LIMIT_EXCEEDED');
      expect(isSalesforceRateLimitError(error)).toBe(true);
    });

    test('returns true for TotalRequests Limit exceeded', () => {
      const error = new Error('TotalRequests Limit exceeded');
      expect(isSalesforceRateLimitError(error)).toBe(true);
    });

    test('returns true for ConcurrentPerOrgLongTxn Limit exceeded', () => {
      const error = new Error('ConcurrentPerOrgLongTxn Limit exceeded');
      expect(isSalesforceRateLimitError(error)).toBe(true);
    });

    test('returns true when errorCode property is REQUEST_LIMIT_EXCEEDED', () => {
      const error = new Error('Some message');
      error.errorCode = 'REQUEST_LIMIT_EXCEEDED';
      expect(isSalesforceRateLimitError(error)).toBe(true);
    });

    test('returns false for other errors', () => {
      expect(isSalesforceRateLimitError(new Error('Some other error'))).toBe(
        false
      );
    });
  });

  // ============================================================
  // batchProcess
  // ============================================================
  describe('batchProcess', () => {
    test('processes items in batches of specified size', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7];
      const batches = [];

      await batchProcess(items, 3, async (batch, index) => {
        batches.push({ batch, index });
        return batch.length;
      });

      expect(batches).toEqual([
        { batch: [1, 2, 3], index: 0 },
        { batch: [4, 5, 6], index: 1 },
        { batch: [7], index: 2 },
      ]);
    });

    test('calls onBatchComplete callback with progress', async () => {
      const items = [1, 2, 3, 4, 5];
      const progress = [];

      await batchProcess(
        items,
        2,
        async (batch) => batch.length,
        (processed, total) => {
          progress.push({ processed, total });
        }
      );

      expect(progress).toEqual([
        { processed: 2, total: 5 },
        { processed: 4, total: 5 },
        { processed: 5, total: 5 },
      ]);
    });

    test('returns array of processor results', async () => {
      const items = ['a', 'b', 'c', 'd', 'e'];

      const results = await batchProcess(items, 2, async (batch) => {
        return batch.join('-');
      });

      expect(results).toEqual(['a-b', 'c-d', 'e']);
    });

    test('handles empty input array', async () => {
      const results = await batchProcess([], 10, async (batch) => batch.length);
      expect(results).toEqual([]);
    });

    test('handles batch size larger than array', async () => {
      const items = [1, 2, 3];
      const batches = [];

      await batchProcess(items, 10, async (batch) => {
        batches.push(batch);
        return batch.length;
      });

      expect(batches).toEqual([[1, 2, 3]]);
    });
  });
});

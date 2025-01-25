/**
 * Custom Error Classes for sf-graph
 *
 * Provides a consistent error handling pattern across the application.
 * All errors extend SfGraphError for unified catching and logging.
 */

/**
 * Base error class for sf-graph application errors.
 * Includes error code and optional cause for error chaining.
 */
export class SfGraphError extends Error {
  readonly code: string;
  readonly cause?: Error;

  constructor(message: string, code = 'SF_GRAPH_ERROR', cause?: Error) {
    super(message);
    this.name = 'SfGraphError';
    this.code = code;
    this.cause = cause;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get the full error chain message including cause
   */
  getFullMessage(): string {
    let msg = `[${this.code}] ${this.message}`;
    if (this.cause) {
      msg += `\n  Caused by: ${this.cause.message}`;
    }
    return msg;
  }
}

/**
 * Error thrown when Neo4j connection fails or is unavailable.
 */
export class Neo4jConnectionError extends SfGraphError {
  constructor(message: string, cause?: Error) {
    super(message, 'NEO4J_CONNECTION_ERROR', cause);
    this.name = 'Neo4jConnectionError';
  }
}

/**
 * Error thrown when Neo4j query execution fails.
 */
export class Neo4jQueryError extends SfGraphError {
  readonly query?: string;

  constructor(message: string, query?: string, cause?: Error) {
    super(message, 'NEO4J_QUERY_ERROR', cause);
    this.name = 'Neo4jQueryError';
    this.query = query;
  }
}

/**
 * Error thrown when Salesforce connection fails.
 */
export class SalesforceConnectionError extends SfGraphError {
  readonly orgAlias?: string;

  constructor(message: string, orgAlias?: string, cause?: Error) {
    super(message, 'SALESFORCE_CONNECTION_ERROR', cause);
    this.name = 'SalesforceConnectionError';
    this.orgAlias = orgAlias;
  }
}

/**
 * Error thrown when Salesforce API call fails.
 */
export class SalesforceApiError extends SfGraphError {
  readonly apiMethod?: string;

  constructor(message: string, apiMethod?: string, cause?: Error) {
    super(message, 'SALESFORCE_API_ERROR', cause);
    this.name = 'SalesforceApiError';
    this.apiMethod = apiMethod;
  }
}

/**
 * Error thrown when requested object is not found in the graph.
 */
export class ObjectNotFoundError extends SfGraphError {
  readonly objectApiName: string;

  constructor(objectApiName: string, orgId?: string) {
    const message = orgId
      ? `Object '${objectApiName}' not found in org '${orgId}'`
      : `Object '${objectApiName}' not found`;
    super(message, 'OBJECT_NOT_FOUND');
    this.name = 'ObjectNotFoundError';
    this.objectApiName = objectApiName;
  }
}

/**
 * Error thrown when sync operation fails.
 */
export class SyncError extends SfGraphError {
  readonly objectApiName?: string;
  readonly phase?: 'objects' | 'fields' | 'relationships';

  constructor(
    message: string,
    objectApiName?: string,
    phase?: 'objects' | 'fields' | 'relationships',
    cause?: Error
  ) {
    super(message, 'SYNC_ERROR', cause);
    this.name = 'SyncError';
    this.objectApiName = objectApiName;
    this.phase = phase;
  }
}

/**
 * Error thrown when configuration is invalid or missing.
 */
export class ConfigurationError extends SfGraphError {
  readonly configKey?: string;

  constructor(message: string, configKey?: string, cause?: Error) {
    super(message, 'CONFIGURATION_ERROR', cause);
    this.name = 'ConfigurationError';
    this.configKey = configKey;
  }
}

/**
 * Error thrown when LLM service is unavailable or fails.
 */
export class LlmError extends SfGraphError {
  readonly model?: string;

  constructor(message: string, model?: string, cause?: Error) {
    super(message, 'LLM_ERROR', cause);
    this.name = 'LlmError';
    this.model = model;
  }
}

/**
 * Error thrown when rate limited by Salesforce API.
 * Includes optional retry-after hint from the API response.
 */
export class SalesforceRateLimitError extends SfGraphError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, cause?: Error) {
    super(message, 'SALESFORCE_RATE_LIMIT', cause);
    this.name = 'SalesforceRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Error thrown when Neo4j transaction conflicts (deadlock or retry needed).
 * These are typically transient and safe to retry.
 */
export class Neo4jTransactionConflictError extends SfGraphError {
  constructor(message: string, cause?: Error) {
    super(message, 'NEO4J_TRANSACTION_CONFLICT', cause);
    this.name = 'Neo4jTransactionConflictError';
  }
}

/**
 * Error representing a partial sync failure where some objects succeeded
 * but others failed. Contains aggregated error information.
 */
export class PartialSyncError extends SfGraphError {
  readonly successCount: number;
  readonly failureCount: number;
  readonly phaseErrors: Array<{
    phase: string;
    objectName?: string;
    error: string;
  }>;

  constructor(
    successCount: number,
    failureCount: number,
    phaseErrors: Array<{ phase: string; objectName?: string; error: string }>
  ) {
    super(
      `Sync partially completed: ${successCount} succeeded, ${failureCount} failed`,
      'PARTIAL_SYNC_ERROR'
    );
    this.name = 'PartialSyncError';
    this.successCount = successCount;
    this.failureCount = failureCount;
    this.phaseErrors = phaseErrors;
  }

  /**
   * Get a summary of errors by phase
   */
  getErrorSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const err of this.phaseErrors) {
      summary[err.phase] = (summary[err.phase] || 0) + 1;
    }
    return summary;
  }
}

/**
 * Type guard to check if an error is an SfGraphError
 */
export function isSfGraphError(error: unknown): error is SfGraphError {
  return error instanceof SfGraphError;
}

/**
 * Wrap an unknown error in an SfGraphError if it isn't one already
 */
export function wrapError(
  error: unknown,
  defaultMessage: string,
  defaultCode = 'SF_GRAPH_ERROR'
): SfGraphError {
  if (error instanceof SfGraphError) {
    return error;
  }

  if (error instanceof Error) {
    return new SfGraphError(
      `${defaultMessage}: ${error.message}`,
      defaultCode,
      error
    );
  }

  return new SfGraphError(`${defaultMessage}: ${String(error)}`, defaultCode);
}

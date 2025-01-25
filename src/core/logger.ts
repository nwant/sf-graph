/**
 * Centralized Logger Service
 *
 * Provides structured logging using pino. Uses pino-pretty for
 * development and JSON output for production.
 *
 * Usage:
 *   import { createLogger } from './logger.js';
 *   const log = createLogger('neo4j');
 *   log.info({ objectCount: 10 }, 'Synced objects');
 *   log.error({ err }, 'Failed to connect');
 */

import pino from 'pino';
import { loadConfig } from '../agent/config.js';

const config = loadConfig();
const level = config.logLevel || 'warn';
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Root logger instance
 */
export const logger = pino({
  name: 'sf-graph',
  level,
  // Pretty print in dev, structured JSON in production
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
});

/**
 * Create a child logger with a namespace
 *
 * @param namespace - The namespace for this logger (e.g., 'neo4j', 'salesforce', 'mcp')
 * @returns A pino child logger
 *
 * @example
 * const log = createLogger('neo4j');
 * log.info('Driver initialized');
 * log.error({ err }, 'Connection failed');
 */
export function createLogger(namespace: string) {
  return logger.child({ namespace });
}

/**
 * Re-export pino types for convenience
 */
export type { Logger } from 'pino';

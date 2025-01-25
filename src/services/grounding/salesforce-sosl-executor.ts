/**
 * Salesforce SOSL Executor
 *
 * Implements SoslExecutor interface using jsforce Connection.
 * Provides Tier 2 instance data grounding via SOSL searches.
 */

import type jsforce from 'jsforce';
import { createLogger } from '../../core/index.js';
import type { SoslSearchResponse, SoslSearchRecord } from './sosl-fallback.js';
import type { SoslExecutor } from './sosl-fallback.js';

// Re-export the interface type for convenience
export type { SoslExecutor } from './sosl-fallback.js';

const log = createLogger('salesforce-sosl');

/**
 * SOSL executor implementation using jsforce Connection.
 */
export class SalesforceSoslExecutor implements SoslExecutor {
  private connection: jsforce.Connection;

  constructor(connection: jsforce.Connection) {
    this.connection = connection;
  }

  /**
   * Execute a SOSL query against Salesforce.
   */
  async searchSosl(query: string): Promise<SoslSearchResponse> {
    log.debug({ query }, 'Executing SOSL query');

    try {
      // jsforce search returns an array of results per object
      const result = await this.connection.search(query);

      // Normalize jsforce response to our interface
      // jsforce returns { searchRecords: [...] } structure
      const searchRecords: SoslSearchRecord[] = (result.searchRecords || []).map((record: any) => ({
        attributes: {
          type: record.attributes?.type || 'Unknown',
          url: record.attributes?.url || '',
        },
        Id: record.Id,
        Name: record.Name,
        ...record,
      }));

      log.debug({ resultCount: searchRecords.length }, 'SOSL query complete');

      return { searchRecords };
    } catch (error) {
      log.error({ error, query }, 'SOSL query failed');
      throw error;
    }
  }
}

/**
 * Create a SOSL executor from a jsforce Connection.
 */
export function createSoslExecutor(connection: jsforce.Connection): SoslExecutor {
  return new SalesforceSoslExecutor(connection);
}

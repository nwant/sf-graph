/**
 * Batch Graph Signals
 *
 * Fetches graph-based signals (relationship counts, junction detection)
 * for multiple objects in a single Cypher query to avoid N+1 problems.
 */

import { getDriver } from '../neo4j/driver.js';
import { createLogger } from '../../core/index.js';

const log = createLogger('batch-graph-signals');

/**
 * Graph signals for a single object.
 */
export interface GraphSignals {
  /** Total number of lookup/master-detail relationships */
  relationshipCount: number;
  /** Whether this object is a junction (links to 2+ primary tables) */
  isJunction: boolean;
  /** Number of primary tables this object links to */
  primaryLinkCount: number;
}

/**
 * Options for batch graph signal fetching.
 */
export interface BatchGraphSignalsOptions {
  /** Object API names to fetch signals for */
  neighborNames: string[];
  /** Primary tables from the Decomposer plan (for junction detection) */
  primaryTables: string[];
  /** Optional org ID for multi-org support */
  orgId?: string;
}

/**
 * Batch fetch graph signals for all neighbors in one Cypher query.
 *
 * This avoids the N+1 query problem by fetching relationship counts
 * and junction status for all candidates in a single database round-trip.
 *
 * @param options - Fetch options
 * @returns Map of objectApiName → GraphSignals
 */
export async function batchGetGraphSignals(
  options: BatchGraphSignalsOptions
): Promise<Map<string, GraphSignals>> {
  const { neighborNames, primaryTables, orgId } = options;

  if (neighborNames.length === 0) {
    return new Map();
  }

  const driver = getDriver();
  const session = driver.session();

  try {
    // Build org filter if needed
    const orgFilter = orgId ? 'AND n.orgId = $orgId' : '';

    // Single query to fetch:
    // 1. Total relationship count (outgoing lookups/master-details)
    // 2. Junction detection (links to 2+ different primary tables)
    const cypher = `
      UNWIND $neighborNames AS name
      MATCH (n:Object)
      WHERE toLower(n.apiName) = toLower(name) ${orgFilter}

      // Count total outgoing relationships (to any object)
      OPTIONAL MATCH (n)-[:HAS_FIELD]->(:Field)-[:LOOKS_UP|MASTER_DETAIL]->(anyTarget:Object)
      WITH n, name, COUNT(DISTINCT anyTarget) AS relationshipCount

      // Count links to primary tables specifically (for junction detection)
      OPTIONAL MATCH (n)-[:HAS_FIELD]->(:Field)-[:LOOKS_UP|MASTER_DETAIL]->(primaryTarget:Object)
      WHERE primaryTarget.apiName IN $primaryTables
      WITH n.apiName AS objName,
           relationshipCount,
           COUNT(DISTINCT primaryTarget.apiName) AS primaryLinkCount

      RETURN objName, relationshipCount, primaryLinkCount, primaryLinkCount >= 2 AS isJunction
    `;

    const result = await session.executeRead(async (tx) => {
      return tx.run(cypher, {
        neighborNames,
        primaryTables,
        orgId,
      });
    });

    const signals = new Map<string, GraphSignals>();

    for (const record of result.records) {
      const objName = record.get('objName') as string;
      const relationshipCount = (record.get('relationshipCount') as { low: number })?.low ?? 0;
      const primaryLinkCount = (record.get('primaryLinkCount') as { low: number })?.low ?? 0;
      const isJunction = record.get('isJunction') as boolean;

      signals.set(objName, {
        relationshipCount,
        isJunction,
        primaryLinkCount,
      });
    }

    // Fill in missing entries with defaults (objects not found in graph)
    for (const name of neighborNames) {
      if (!signals.has(name)) {
        // Try case-insensitive match
        const found = Array.from(signals.keys()).find(
          (k) => k.toLowerCase() === name.toLowerCase()
        );
        if (!found) {
          signals.set(name, {
            relationshipCount: 0,
            isJunction: false,
            primaryLinkCount: 0,
          });
        }
      }
    }

    log.debug(
      {
        inputCount: neighborNames.length,
        outputCount: signals.size,
        junctionCount: Array.from(signals.values()).filter((s) => s.isJunction).length,
      },
      'Batch graph signals fetched'
    );

    return signals;
  } catch (error) {
    log.error({ error, neighborNames }, 'Failed to fetch batch graph signals');
    // Return empty signals on error (graceful degradation)
    const emptySignals = new Map<string, GraphSignals>();
    for (const name of neighborNames) {
      emptySignals.set(name, {
        relationshipCount: 0,
        isJunction: false,
        primaryLinkCount: 0,
      });
    }
    return emptySignals;
  } finally {
    await session.close();
  }
}

/**
 * Normalize relationship count using log scale.
 * Handles hub objects gracefully (Account with 100+ relationships).
 *
 * Edge cases:
 * - relationshipCount = 0: Math.log1p(0) = 0, returns 0 (safe)
 * - relationshipCount = 50+: caps at 1.0
 *
 * @param relationshipCount - Number of relationships
 * @returns Normalized score between 0 and 1
 */
export function computeGraphScore(relationshipCount: number): number {
  // Log scale: log1p(count) / log1p(50)
  // Math.log1p(x) = ln(1+x), so log1p(0) = 0 (handles 0 safely)
  // Objects with 50+ relationships max out at 1.0
  return Math.min(1, Math.log1p(relationshipCount) / Math.log1p(50));
}

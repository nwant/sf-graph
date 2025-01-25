import { Transaction, ManagedTransaction } from 'neo4j-driver';
import { MetadataItem } from '../salesforce.js';

/**
 * Base class for all Metadata Handlers.
 * Enforces the contract for processing Salesforce metadata items into Neo4j nodes.
 */
export abstract class BaseHandler {
  constructor() {}

  /**
   * Process a single metadata item.
   * @param {Object} tx - The Neo4j transaction object.
   * @param {Object} item - The metadata item from Salesforce.
   */
  abstract process(tx: Transaction | ManagedTransaction, item: MetadataItem): Promise<void>;

  /**
   * Helper to clean up strings for Cypher.
   * @param {string} str
   * @returns {string}
   */
  protected sanitize(str?: string): string {
    return str || '';
  }

  /**
   * Normalizes metadata content whether it comes from XML (arrays) or JSON (direct).
   * @param {Object} item - The full metadata item
   * @param {string} typeName - The key to look for (e.g., 'CustomField')
   * @returns {Object} - A flat object with the properties
   */
  protected normalizeContent(item: MetadataItem, typeName: string): Record<string, unknown> {
    if (!item.content) return {};

    // 1. Fully parsed XML structure (e.g., content.CustomField.type[0])
    if (item.content[typeName]) {
      const raw = item.content[typeName] as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(raw)) {
        normalized[key] = Array.isArray(val) ? val[0] : val;
      }
      return normalized;
    }

    // 2. Already flat JSON or direct properties (e.g., content.type)
    return item.content;
  }
}

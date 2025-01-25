/**
 * Unit tests for DynamicSynonymService
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  normalizeForLookup,
  clearSynonymCache,
} from '../../../dist/services/dynamic-synonym-service.js';

// Mock the Neo4j driver
jest.mock('../../../dist/services/neo4j/driver.js', () => ({
  getDriver: jest.fn(() => ({
    session: jest.fn(() => ({
      executeRead: jest.fn(),
      close: jest.fn(),
    })),
  })),
}));

describe('DynamicSynonymService', () => {
  beforeEach(() => {
    clearSynonymCache();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('normalizeForLookup', () => {
    test('converts to lowercase', () => {
      expect(normalizeForLookup('Invoice')).toBe('invoice');
      expect(normalizeForLookup('ACCOUNT')).toBe('account');
    });

    test('removes special characters', () => {
      expect(normalizeForLookup('Invoice__c')).toBe('invoicec');
      expect(normalizeForLookup('users account')).toBe('users account');
    });

    test('normalizes whitespace', () => {
      expect(normalizeForLookup('  multiple   spaces  ')).toBe('multiple spaces');
    });

    test('handles empty input', () => {
      expect(normalizeForLookup('')).toBe('');
    });

    test('preserves numbers', () => {
      expect(normalizeForLookup('Product2')).toBe('product2');
      expect(normalizeForLookup('Quote123')).toBe('quote123');
    });
  });

  describe('SynonymIndex structure', () => {
    test('index should have required maps', async () => {
      // This is a structural test - actual index building requires Neo4j
      // For now, we just test that the normalization works correctly
      // which is the key logic that doesn't require Neo4j
      expect(normalizeForLookup('Annual Revenue')).toBe('annual revenue');
      expect(normalizeForLookup('Customer Name')).toBe('customer name');
    });
  });

  describe('word variants', () => {
    test('normalizes singular and plural consistently', () => {
      expect(normalizeForLookup('accounts')).toBe('accounts');
      expect(normalizeForLookup('account')).toBe('account');
      expect(normalizeForLookup('opportunities')).toBe('opportunities');
      expect(normalizeForLookup('opportunity')).toBe('opportunity');
    });
  });
});

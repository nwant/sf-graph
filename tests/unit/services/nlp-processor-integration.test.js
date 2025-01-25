/**
 * Integration unit tests for NLP Processor's usage of Dynamic Synonyms
 * Uses unstable_mockModule for ESM support
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// --- Mocks ---

await jest.unstable_mockModule('../../../dist/services/dynamic-synonym-service.js', () => ({
  findObject: jest.fn(),
  findField: jest.fn(),
}));

await jest.unstable_mockModule('../../../dist/services/neo4j/graph-service.js', () => ({
  getAllObjects: jest.fn(),
  getObjectFields: jest.fn(),
}));

await jest.unstable_mockModule('../../../dist/services/llm-service.js', () => ({
  processWithLLM: jest.fn(),
  extractStructuredData: jest.fn(),
  isLLMAvailable: jest.fn().mockReturnValue(false),
}));

await jest.unstable_mockModule('../../../dist/config/llm-config.js', () => ({
  llmConfig: {},
}));

await jest.unstable_mockModule('../../../dist/services/condition-patterns.js', () => ({
  extractConditionsFromPatterns: jest.fn().mockReturnValue([]),
  extractImpliedConditions: jest.fn().mockReturnValue([]),
  extractLocationConditions: jest.fn().mockReturnValue([]),
}));

// --- Imports ---

const { identifyEntities } = await import('../../../dist/services/nlp-processor.js');
const dynamicSynonyms = await import('../../../dist/services/dynamic-synonym-service.js');
const graphService = await import('../../../dist/services/neo4j/graph-service.js');

describe('NLP Processor Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock getAllObjects to return some basic objects
    graphService.getAllObjects.mockResolvedValue([
      { apiName: 'Account', label: 'Account' },
      { apiName: 'Contact', label: 'Contact' },
    ]);

    // Mock getObjectFields to return empty by default
    graphService.getObjectFields.mockResolvedValue([]);

    // Mock findField to return null by default
    dynamicSynonyms.findField.mockResolvedValue(null);
  });

  test('identifyEntities should use dynamic synonyms for custom objects', async () => {
    // Mock findObject to return a match for "invoices" -> "Invoice__c"
    dynamicSynonyms.findObject.mockResolvedValue({
      apiName: 'Invoice__c',
      confidence: 0.85,
      source: 'dynamic'
    });

    const processedQuery = {
      original: 'show me all invoices',
      normalized: 'show me all invoices',
      tokens: ['show', 'me', 'all', 'invoices'],
      intent: 'query',
    };

    const options = { useLLM: false };

    const result = await identifyEntities(processedQuery, options);

    // Verify dynamicSynonyms.findObject was called with "invoices"
    expect(dynamicSynonyms.findObject).toHaveBeenCalledWith('invoices');

    // Verify the mainObject was identified as "Invoice__c"
    expect(result.mainObject).toBe('Invoice__c');

    // Verify it's in the allMentionedObjects list
    expect(result.allMentionedObjects).toContain('Invoice__c');
  });

  test('identifyEntities should prioritize hardcoded/standard matches if confidence is higher', async () => {
    // Mock findObject for "accounts"
    dynamicSynonyms.findObject.mockResolvedValue({
      apiName: 'Account',
      confidence: 0.85,
      source: 'dynamic'
    });

    const processedQuery = {
      original: 'show me accounts',
      normalized: 'show me accounts',
      tokens: ['show', 'me', 'accounts'],
      intent: 'query',
    };

    const options = { useLLM: false };

    const result = await identifyEntities(processedQuery, options);

    // It should still identify Account
    expect(result.mainObject).toBe('Account');
  });
});

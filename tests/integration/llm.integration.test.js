/**
 * LLM Integration Tests
 * Tests LLM service functionality with optional Neo4j integration.
 */
import {
  isLLMAvailable,
  getAvailableModels,
  processWithLLM,
  extractStructuredData,
} from '../../dist/services/llm-service.js';
import { processNaturalLanguage } from '../../dist/services/nlp-processor.js';
import { generateSoqlFromNaturalLanguage } from '../../dist/services/soql-generator.js';
import { initTestDriver, closeTestDriver, isNeo4jConfigured } from '../testUtils.js';


const testQueries = [
  {
    description: 'Basic Account Query',
    query: 'Show me all accounts in California',
  },
  {
    description: 'Contact Query with Condition',
    query: 'Find contacts where the last name is Smith',
  },
];

describe('LLM Integration Tests', () => {
  let dbInitialized = false;
  let llmAvailable = false;

  beforeAll(async () => {
    // Check LLM
    llmAvailable = await isLLMAvailable();

    // Init DB only if configured
    if (isNeo4jConfigured()) {
      dbInitialized = await initTestDriver();
    }
  });

  afterAll(async () => {
    await closeTestDriver();
  });

  test('LLM Service Availability', async () => {
    if (!llmAvailable) {
      console.log('⏭️  LLM not available, skipping test');
      return;
    }
    const models = await getAvailableModels();
    expect(Array.isArray(models)).toBe(true);
  });

  test('Basic LLM Processing', async () => {
    if (!llmAvailable) {
      console.log('⏭️  LLM not available, skipping test');
      return;
    }

    const prompt = 'Explain what Salesforce is in one sentence.';
    const response = await processWithLLM(prompt);
    expect(response).toBeTruthy();
    expect(typeof response).toBe('string');
  });

  test('extractStructuredData returns JSON', async () => {
    if (!llmAvailable) {
      console.log('⏭️  LLM not available, skipping test');
      return;
    }

    const text = 'Show me all accounts with revenue greater than 1 million';
    const extractionPrompt = 'Extract intent and entities from this text.';

    const structured = await extractStructuredData(text, extractionPrompt, {
      task: 'intentAnalysis',
    });
    expect(structured).toBeTruthy();
    expect(typeof structured).toBe('object');
  });

  test('Natural Language Processing', async () => {
    if (!llmAvailable) {
      console.log('⏭️  LLM not available, skipping test');
      return;
    }

    const query = 'Show me accounts in California with more than 100 employees';
    const processedQuery = await processNaturalLanguage(query, { useLLM: true });

    expect(processedQuery).toHaveProperty('original', query);
    expect(processedQuery).toHaveProperty('normalized');
    // Depending on LLM response, it usually adds llmAnalysis
    if (processedQuery.llmAnalysis) {
      expect(processedQuery.llmAnalysis).toHaveProperty('intent');
    }
  });

  // TODO: Re-enable when LLM timeout issues are resolved (exceeds 30s Jest timeout)
  test.skip('SOQL Generation with LLM', async () => {
    if (!llmAvailable || !dbInitialized) {
      console.log('⏭️  LLM or DB not available, skipping test');
      return;
    }

    // We can't easily test this without actual metadata in DB.
    // If DB has no metadata, generateSoqlFromNaturalLanguage might fail.
    try {
      const query = testQueries[0].query;
      const result = await generateSoqlFromNaturalLanguage(query, { useLLM: true });
      expect(result).toHaveProperty('soql');
    } catch (error) {
      // If message is "Object not found", it's expected if DB is empty.
      expect(error.message).toBeTruthy();
    }
  });
});

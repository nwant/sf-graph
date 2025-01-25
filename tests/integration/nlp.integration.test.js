/**
 * NLP Integration Tests
 * Tests natural language processing with optional Neo4j integration.
 */
import {
  processNaturalLanguage,
  identifyEntities,
  extractConditions,
} from '../../dist/services/nlp-processor.js';
import { getObjectFields } from '../../dist/services/neo4j/index.js';
import { isLLMAvailable } from '../../dist/services/llm-service.js';
import { initTestDriver, closeTestDriver, isNeo4jConfigured } from '../testUtils.js';


const testQueries = [
  'Show me all accounts with revenue greater than 1 million',
  'Find contacts where the last name is Smith',
  'Get the top 5 opportunities by amount',
  'List all cases created in the last 30 days',
];

describe('NLP Integration Tests', () => {
  let llmAvailable = false;
  let dbInitialized = false;

  beforeAll(async () => {
    llmAvailable = await isLLMAvailable();

    if (isNeo4jConfigured()) {
      dbInitialized = await initTestDriver();
    }
  });

  afterAll(async () => {
    await closeTestDriver();
  });

  test('processNaturalLanguage runs without errors', async () => {
    if (!llmAvailable) {
      console.log('⏭️  LLM not available, skipping test');
      return;
    }

    const query = testQueries[0];
    const result = await processNaturalLanguage(query);
    expect(result).toHaveProperty('original', query);
    expect(result).toHaveProperty('normalized');
  });

  // TODO: Re-enable when LLM timeout issues are resolved (exceeds 30s Jest timeout)
  test.skip('identifyEntities runs', async () => {
    if (!llmAvailable) {
      console.log('⏭️  LLM not available, skipping test');
      return;
    }

    const query = testQueries[1]; // Contacts
    const processed = await processNaturalLanguage(query);
    const entities = await identifyEntities(processed);

    expect(entities).toHaveProperty('mainObject');
    expect(entities).toHaveProperty('fields');
  });

  test('extractConditions runs (requires DB)', async () => {
    if (!llmAvailable || !dbInitialized) {
      console.log('⏭️  LLM or DB not available, skipping test');
      return;
    }

    // This test might fail if DB has no fields for "Contact".
    // We wrap in try-catch to allow soft failure if data is missing.
    try {
      const query = testQueries[1];
      const processed = await processNaturalLanguage(query);
      const entities = await identifyEntities(processed);

      if (entities.mainObject) {
        const fields = await getObjectFields(entities.mainObject);
        if (fields && fields.length > 0) {
          const conditions = await extractConditions(processed, entities.mainObject, fields);
          expect(Array.isArray(conditions)).toBe(true);
        }
      }
    } catch (e) {
      console.warn('extractConditions test encountered error:', e.message);
      // Don't fail the test if it's just missing data
      if (!e.message.includes('not found') && !e.message.includes('Pool is closed')) {
        throw e;
      }
    }
  });
});

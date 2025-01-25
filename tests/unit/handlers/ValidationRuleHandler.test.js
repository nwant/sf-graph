import { handlerRegistry } from '../../../dist/services/HandlerRegistry.js';
import { CustomObjectHandler } from '../../../dist/services/handlers/CustomObjectHandler.js';
import { ValidationRuleHandler } from '../../../dist/services/handlers/ValidationRuleHandler.js';

class MockTransaction {
  constructor() {
    this.queries = [];
  }

  async run(query, params) {
    this.queries.push({ query: query.trim(), params });
    return { records: [] };
  }
}

describe('HandlerRegistry', () => {
  test('should retrieve CustomObjectHandler', () => {
    const handler = handlerRegistry.getHandler('CustomObject');
    expect(handler).toBeInstanceOf(CustomObjectHandler);
  });

  test('should retrieve ValidationRuleHandler', () => {
    const handler = handlerRegistry.getHandler('ValidationRule');
    expect(handler).toBeInstanceOf(ValidationRuleHandler);
  });

  test('should return undefined for unknown types', () => {
    const handler = handlerRegistry.getHandler('NonExistentType');
    expect(handler).toBeUndefined();
  });
});

describe('ValidationRuleHandler', () => {
  let mockTx;
  let handler;

  beforeEach(() => {
    mockTx = new MockTransaction();
    handler = new ValidationRuleHandler();
  });

  test('should process ValidationRule with Parent link correctly', async () => {
    const item = {
      name: 'Account.MyRule',  // Handler uses item.name
      fullName: 'Account.MyRule',
      content: { description: 'Test Rule' },
    };

    await handler.process(mockTx, item);

    expect(mockTx.queries).toHaveLength(2);

    // Check Node Creation
    const createQuery = mockTx.queries[0].query;
    expect(createQuery).toContain('MERGE (vr:ValidationRule {fullName: $fullName');

    // Check Link Creation
    const linkQuery = mockTx.queries[1].query;
    expect(linkQuery).toContain('MERGE (o)-[:HAS_VALIDATION_RULE]->(vr)');
    expect(mockTx.queries[1].params.objectName).toBe('Account');
  });

  test('should process Standalone ValidationRule correctly', async () => {
    const item = {
      name: 'GlobalRule',  // Handler uses item.name
      fullName: 'GlobalRule',
      content: { description: 'Global Rule' },
    };

    await handler.process(mockTx, item);

    expect(mockTx.queries).toHaveLength(1);
    expect(mockTx.queries[0].query).toContain('MERGE (vr:ValidationRule {fullName: $fullName');
  });
});

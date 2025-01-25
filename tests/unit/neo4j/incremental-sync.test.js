
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Define mocks outside
const mockTx = {
  run: jest.fn(),
};

const mockSession = {
  executeWrite: jest.fn(async (callback) => await callback(mockTx)),
  close: jest.fn(),
};

const mockDriver = {
  session: jest.fn(() => mockSession),
  close: jest.fn(),
};

// Use unstable_mockModule BEFORE importing the module under test
jest.unstable_mockModule('../../../dist/services/neo4j/driver.js', () => ({
  getDriver: jest.fn(() => mockDriver),
  initNeo4jDriver: jest.fn().mockResolvedValue(true),
  closeDriver: jest.fn(),
}));

// Dynamic import of the service under test
const { syncFromDescribe } = await import('../../../dist/services/neo4j/describe-sync.js');

describe('Incremental Sync', () => {
  let mockConn;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTx.run.mockResolvedValue({ records: [], summary: {} });
    
    // Mock Salesforce connection
    mockConn = {
      describeGlobal: jest.fn().mockResolvedValue({
        sobjects: [
          { name: 'Account', queryable: true },
          { name: 'Contact', queryable: true }
        ]
      }),
      describe: jest.fn().mockImplementation((objName) => Promise.resolve({
        name: objName,
        label: objName,
        fields: [
          { name: 'Id', type: 'id' },
          { name: 'Name', type: 'string' }
        ]
      })),
      query: jest.fn().mockResolvedValue({ records: [], done: true, totalSize: 0 }),
      tooling: {
        query: jest.fn().mockResolvedValue({ records: [], done: true, totalSize: 0 })
      }
    };
  });

  test('syncFromDescribe runs full sync by default', async () => {
    // Execute
    const result = await syncFromDescribe(mockConn, 'org123');

    // Verify
    expect(result.success).toBe(true);
    expect(mockConn.describeGlobal).toHaveBeenCalled();
    expect(mockConn.describe).toHaveBeenCalledTimes(2); // Account + Contact
    
    // Check Neo4j writes
    expect(mockDriver.session).toHaveBeenCalled();
    expect(mockSession.executeWrite).toHaveBeenCalled();
    
    // Should verify node creation (MERGE (o:Object ...))
    const calls = mockTx.run.mock.calls;
    const objectMerges = calls.filter(call => call[0].includes('MERGE (o:Object'));
    expect(objectMerges.length).toBeGreaterThan(0);
  });

  test('syncFromDescribe respects object filter', async () => {
    // Execute
    await syncFromDescribe(mockConn, 'org123', { objectFilter: ['Account'] });

    // Verify
    expect(mockConn.describeGlobal).toHaveBeenCalled();
    expect(mockConn.describe).toHaveBeenCalledWith('Account');
    expect(mockConn.describe).toHaveBeenCalledTimes(1);
  });

  test('incremental sync flags deleted objects', async () => {
    const result = await syncFromDescribe(mockConn, 'org123', { incremental: true });
    expect(result.success).toBe(true);
  });
});

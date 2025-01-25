 
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockApiService = {
  getGraphStatus: jest.fn(),
  listObjects: jest.fn(),
  getObject: jest.fn(),
  findPaths: jest.fn(),
  findDetailedPaths: jest.fn(),
  findRelatedObjects: jest.fn(),
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

// Use unstable_mockModule for ESM mocking
jest.unstable_mockModule('../../../dist/core/index.js', () => ({
  createLogger: () => mockLogger,
  apiService: mockApiService,
}));

// Import module under test dynamically
const { schemaTools } = await import('../../../dist/mcp/tools/schema-tools.js');

// Helper to get tool handler
const getTool = (name) => schemaTools.find(t => t.name === name);

describe('Schema Tools (Real Implementation)', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('find-object', () => {
    const handler = getTool('find-object').handler;

    test('returns found: true for valid populated object', async () => {
      mockApiService.getObject.mockResolvedValue({
        apiName: 'Account',
        label: 'Account',
        fields: [{ apiName: 'Name', type: 'string' }],
        relationships: []
      });

      const result = await handler({ objectApiName: 'Account' });
      const content = JSON.parse(result.content[0].text);

      expect(content.found).toBe(true);
      expect(content.apiName).toBe('Account');
    });

    test('returns found: false when object not found in Neo4j', async () => {
      mockApiService.getObject.mockResolvedValue(null);

      const result = await handler({ objectApiName: 'Unknown' });
      const content = JSON.parse(result.content[0].text);

      expect(content.found).toBe(false);
      expect(content.message).toContain('not found');
    });

    test('returns found: false for GHOST OBJECT (0 fields)', async () => {
      // Simulate sync failure where object exists but has no fields
      mockApiService.getObject.mockResolvedValue({
        apiName: 'OpportunityTeamMember',
        fields: [] // Empty fields
      });

      const result = await handler({ objectApiName: 'OpportunityTeamMember' });
      const content = JSON.parse(result.content[0].text);

      expect(content.found).toBe(false);
      expect(content.message).toContain('exists but has NO fields');
      expect(content.suggestions[0]).toContain('Team Selling');
    });
  });

  describe('check-graph-status', () => {
    const handler = getTool('check-graph-status').handler;

    test('returns graph status', async () => {
      mockApiService.getGraphStatus.mockResolvedValue({
        populated: true,
        objectCount: 5,
        lastSyncedAt: '2024-01-01'
      });
      mockApiService.listObjects.mockResolvedValue([{ apiName: 'Account' }]);

      const result = await handler({});
      const content = JSON.parse(result.content[0].text);

      expect(content.hasData).toBe(true);
      expect(content.objectCount).toBe(5);
    });
  });
});

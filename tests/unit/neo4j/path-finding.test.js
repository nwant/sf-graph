import { jest } from '@jest/globals';
import { Record } from 'neo4j-driver';

// Mock driver module directly
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockRun = jest.fn();
const mockSession = jest.fn().mockReturnValue({
  executeRead: jest.fn(callback => callback({ run: mockRun })),
  close: mockClose
});
const mockDriver = {
  session: mockSession,
};
const mockGetDriver = jest.fn().mockReturnValue(mockDriver);

// Use unstable_mockModule for ESM mocking
jest.unstable_mockModule('../../../dist/services/neo4j/driver.js', () => ({
  getDriver: mockGetDriver,
  initNeo4jDriver: jest.fn(),
  closeDriver: jest.fn(),
}));

// Import function under test
// Note: We need to import AFTER mocking
const { findDetailedPaths } = await import('../../../dist/services/neo4j/graph-service.js');

describe('Graph Service - Path Finding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findDetailedPaths', () => {
    it('should find paths correctly and map result structure', async () => {
      // Mock data
      const mockResultRecords = [
        new Record(
          ['objectNames', 'rawHops'],
          [
            ['Account', 'Contact'],
            [
              {
                fromObject: 'Account',
                toObject: 'Contact',
                validUpFields: [],
                validDownFields: [
                  {
                    apiName: 'AccountId',
                    label: 'Account ID',
                    toObject: 'Account',
                    relationshipType: 'Lookup',
                    relationshipName: 'Account'
                  }
                ]
              }
            ]
          ]
        )
      ];

      mockRun.mockResolvedValue({ records: mockResultRecords });

      const result = await findDetailedPaths('Account', 'Contact', { maxHops: 3 });

      expect(mockSession).toHaveBeenCalled();
      // allShortestPaths is used for efficient path finding
      expect(mockRun).toHaveBeenCalledWith(expect.stringContaining('allShortestPaths'), expect.objectContaining({
        sourceApiName: 'Account',
        targetApiName: 'Contact'
      }));

      expect(result.pathCount).toBe(1);
      expect(result.paths[0].objects).toEqual(['Account', 'Contact']);
      expect(result.paths[0].hops[0].direction).toBe('down');
      expect(result.paths[0].hops[0].fields[0].apiName).toBe('AccountId');
    });

    it('should respect maxHops parameter', async () => {
      mockRun.mockResolvedValue({ records: [] });

      await findDetailedPaths('A', 'B', { maxHops: 5 });

      // allShortestPaths uses maxHops to limit depth
      expect(mockRun).toHaveBeenCalledWith(expect.stringContaining('[:REFERENCES*..5]'), expect.anything());
    });

    it('should accept orgId', async () => {
        mockRun.mockResolvedValue({ records: [] });
        await findDetailedPaths('A', 'B', { orgId: 'test-org' });
        
        expect(mockRun).toHaveBeenCalledWith(expect.stringContaining('AND source.orgId = $orgId'), expect.objectContaining({ orgId: 'test-org' }));
    });
  });
});


import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock Neo4j driver
const mockSession = {
  run: jest.fn(),
  close: jest.fn(),
};

const mockDriver = {
  session: jest.fn(() => mockSession),
  close: jest.fn(),
};

// Use unstable_mockModule for ESM mocking
jest.unstable_mockModule('../../../dist/services/neo4j/driver.js', () => ({
  getDriver: jest.fn(() => mockDriver),
  initNeo4jDriver: jest.fn().mockResolvedValue(true),
  closeDriver: jest.fn(),
}));

const { checkOrgData, detectDrift } = await import('../../../dist/services/neo4j/drift-service.js');

describe('Drift Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkOrgData', () => {
    test('returns true for both orgs when data exists', async () => {
      mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key) => key === 'hasSource' || key === 'hasTarget'
          }
        ]
      });

      const result = await checkOrgData('org1', 'org2');
      expect(result.source).toBe(true);
      expect(result.target).toBe(true);
      expect(mockSession.run).toHaveBeenCalledWith(expect.stringContaining('RETURN'), expect.anything());
    });
  });

  describe('detectDrift', () => {
    test('identifies objects valid across both orgs', async () => {
      mockSession.run.mockResolvedValue({
        records: [
          {
            get: (key) => {
              const data = {
                apiName: 'Account',
                sourceLabel: 'Account',
                targetLabel: 'Account',
                sourceFieldCount: 10,
                targetFieldCount: 10,
                onlyInSource: false,
                onlyInTarget: false,
              };
              return data[key];
            }
          }
        ]
      });

      const items = await detectDrift('org1', 'org2');
      expect(items.length).toBe(0);
    });

    test('identifies only-in-source', async () => {
      mockSession.run.mockResolvedValue({
        records: [
            {
              get: (key) => {
                const data = {
                  apiName: 'OldObj__c',
                  sourceLabel: 'Old',
                  sourceFieldCount: 5, 
                  onlyInSource: true,
                  onlyInTarget: false,
                };
                return data[key];
              }
            }
          ]
      });

      const items = await detectDrift('org1', 'org2');
      expect(items.length).toBe(1);
      expect(items[0].status).toBe('only-in-source');
    });

    test('identifies structural differences', async () => {
        mockSession.run.mockResolvedValue({
            records: [
                {
                  get: (key) => {
                    const data = {
                      apiName: 'Account',
                      sourceLabel: 'Account',
                      targetLabel: 'Account',
                      sourceFieldCount: 10, 
                      targetFieldCount: 12, 
                      onlyInSource: false,
                      onlyInTarget: false,
                    };
                    return data[key];
                  }
                }
              ]
          });
    
          const items = await detectDrift('org1', 'org2');
          expect(items.length).toBe(1);
          expect(items[0].status).toBe('different');
          expect(items[0].differences).toContain('fields: 10 vs 12');
    });
  });
});

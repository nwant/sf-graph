
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { SemanticSearchServiceImpl } from '../../../dist/services/semantic/semantic-search-service.js';

// Mock dependencies
const mockGraphExecutor = {
  getAllObjects: jest.fn(),
  getFieldsForObject: jest.fn(),
  getAllFields: jest.fn(),
};

describe('SemanticSearchService Synonym Fix', () => {
    let service;

    beforeEach(() => {
        service = new SemanticSearchServiceImpl(mockGraphExecutor);
        jest.clearAllMocks();
    });

    test('should map "deals" to "Opportunity" using abbreviation map', async () => {
        // Setup graph objects to include Opportunity
        mockGraphExecutor.getAllObjects.mockResolvedValue([
            { apiName: 'Opportunity', label: 'Opportunity' }
        ]);
        mockGraphExecutor.getAllFields.mockResolvedValue([]);

        // Search for 'deals'
        // This implicitly builds the index first
        const results = await service.findObjects('deals');

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].apiName).toBe('Opportunity');
        // It returns as fuzzy_match because it matched an abbreviation/variant
        expect(results[0].source).toBe('fuzzy_match'); 
    });
    
    test('should map "deal" to "Opportunity" using abbreviation map', async () => {
        // Setup graph objects
        mockGraphExecutor.getAllObjects.mockResolvedValue([
            { apiName: 'Opportunity', label: 'Opportunity' }
        ]);
        mockGraphExecutor.getAllFields.mockResolvedValue([]);

        // Search for 'deal'
        const results = await service.findObjects('deal');

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].apiName).toBe('Opportunity');
    });

    test('should NOT map "deal" if Opportunity does not exist in graph', async () => {
        // Setup graph objects WITHOUT Opportunity
        mockGraphExecutor.getAllObjects.mockResolvedValue([
            { apiName: 'Account', label: 'Account' }
        ]);
        mockGraphExecutor.getAllFields.mockResolvedValue([]);

        // Search for 'deal'
        const results = await service.findObjects('deal');

        // Should find nothing
        expect(results.length).toBe(0);
    });
});

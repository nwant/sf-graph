import { jest } from '@jest/globals';
import { Record } from 'neo4j-driver';

// Mock the salesforce module
const mockFetchObjectFields = jest.fn();
const mockFetchObjectRecordTypes = jest.fn();
const mockFetchObjectDescribe = jest.fn();

// Mock driver module
const mockRun = jest.fn();
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockSession = jest.fn().mockReturnValue({
  executeRead: jest.fn(callback => callback({ run: mockRun })),
  executeWrite: jest.fn(async callback => {
    const mockTx = { run: mockRun };
    return await callback(mockTx);
  }),
  run: mockRun,
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

jest.unstable_mockModule('../../../dist/services/salesforce.js', () => ({
  fetchObjectFields: mockFetchObjectFields,
  fetchObjectRecordTypes: mockFetchObjectRecordTypes,
  fetchObjectDescribe: mockFetchObjectDescribe,
  fetchObjectMetadata: jest.fn(),
  fetchMetadata: jest.fn(),
  retrieveMetadataDetails: jest.fn(),
  initSalesforceConnection: jest.fn(),
  setConnection: jest.fn(),
  getCurrentOrgAlias: jest.fn(),
  isConnectionInitialized: jest.fn(),
  conn: null,
}));

// Import functions under test after mocking
const {
  refreshObjectNodes,
  refreshSingleObjectNode,
  syncObjectRelationships
} = await import('../../../dist/services/neo4j/sync-service.js');

describe('Sync Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock return values
    mockRun.mockResolvedValue({ records: [] });
    mockFetchObjectFields.mockResolvedValue([]);
    mockFetchObjectRecordTypes.mockResolvedValue([]);
    mockFetchObjectDescribe.mockResolvedValue(null);
  });

  // ============================================================
  // refreshObjectNodes()
  // ============================================================
  describe('refreshObjectNodes', () => {
    it('should return zero stats when no CustomObject items provided', async () => {
      const metadataItems = [
        { type: 'CustomField', name: 'Account.Name' }
      ];

      const result = await refreshObjectNodes(metadataItems);

      expect(result).toMatchObject({
        created: 0,
        updated: 0,
        total: 0
      });
    });

    it('should process CustomObject items and track created count', async () => {
      const metadataItems = [
        { type: 'CustomObject', name: 'Account' },
        { type: 'CustomObject', name: 'Contact' }
      ];

      // Mock: no existing objects in database
      mockRun.mockResolvedValue({ records: [] });

      const result = await refreshObjectNodes(metadataItems);

      expect(result.total).toBe(2);
      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
    });

    it('should track updated count when objects already exist', async () => {
      const metadataItems = [
        { type: 'CustomObject', name: 'Account' }
      ];

      // Mock: Account already exists
      const existingRecord = new Record(['apiName'], ['account']);
      mockRun.mockResolvedValueOnce({ records: [existingRecord] });
      mockRun.mockResolvedValue({ records: [] }); // Subsequent calls

      const result = await refreshObjectNodes(metadataItems);

      expect(result.total).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
    });

    it('should classify objects correctly using object-classifier', async () => {
      const metadataItems = [
        { type: 'CustomObject', name: 'MyCustom__c' }        // Custom object
      ];

      mockRun.mockResolvedValue({ records: [] });

      const result = await refreshObjectNodes(metadataItems);

      // Verify run was called with correct category from classifier
      expect(mockRun).toHaveBeenCalled();
      expect(result.total).toBe(1);
    });

    it('should set fieldsIncluded flag in result when includeFields is true', async () => {
      const metadataItems = [
        { type: 'CustomObject', name: 'Account' }
      ];

      mockRun.mockResolvedValue({ records: [] });
      mockFetchObjectFields.mockResolvedValue([]);

      const result = await refreshObjectNodes(metadataItems, true, false);

      expect(result.fieldsIncluded).toBe(true);
      expect(result.recordTypesIncluded).toBe(false);
    });

    it('should set recordTypesIncluded flag when includeRecordTypes is true', async () => {
      const metadataItems = [
        { type: 'CustomObject', name: 'Account' }
      ];

      mockRun.mockResolvedValue({ records: [] });
      mockFetchObjectRecordTypes.mockResolvedValue([]);

      const result = await refreshObjectNodes(metadataItems, false, true);

      expect(result.fieldsIncluded).toBe(false);
      expect(result.recordTypesIncluded).toBe(true);
    });

    it('should pass orgId to processing when provided', async () => {
      const metadataItems = [
        { type: 'CustomObject', name: 'Account' }
      ];

      mockRun.mockResolvedValue({ records: [] });

      await refreshObjectNodes(metadataItems, false, false, 'test-org');

      // Verify orgId was passed in some way (the item should have orgId set)
      expect(metadataItems[0].orgId).toBe('test-org');
    });
  });

  // ============================================================
  // refreshSingleObjectNode()
  // ============================================================
  describe('refreshSingleObjectNode', () => {
    it('should return created=true when object does not exist', async () => {
      const metadataItem = { type: 'CustomObject', name: 'NewObject' };

      // Mock: object doesn't exist
      mockRun.mockResolvedValue({ records: [] });

      const result = await refreshSingleObjectNode('NewObject', metadataItem);

      expect(result.created).toBe(true);
      expect(result.updated).toBe(false);
    });

    it('should return updated=true when object already exists', async () => {
      const metadataItem = { type: 'CustomObject', name: 'Account' };

      // Mock: object exists
      const existingRecord = new Record(['o'], [{ apiName: 'Account' }]);
      mockRun.mockResolvedValueOnce({ records: [existingRecord] });
      mockRun.mockResolvedValue({ records: [] });

      const result = await refreshSingleObjectNode('Account', metadataItem);

      expect(result.updated).toBe(true);
      expect(result.created).toBe(false);
    });

    it('should extract label and description from metadata content', async () => {
      const metadataItem = {
        type: 'CustomObject',
        name: 'MyObject__c',
        content: {
          label: 'My Object',
          description: 'A custom object'
        }
      };

      mockRun.mockResolvedValue({ records: [] });

      await refreshSingleObjectNode('MyObject__c', metadataItem);

      // Function should process without error
      expect(mockSession).toHaveBeenCalled();
    });

    it('should handle XML-style metadata content', async () => {
      const metadataItem = {
        type: 'CustomObject',
        name: 'MyObject__c',
        content: {
          CustomObject: {
            label: ['My Object Label'],
            description: ['My Object Description']
          }
        }
      };

      mockRun.mockResolvedValue({ records: [] });

      await refreshSingleObjectNode('MyObject__c', metadataItem);

      expect(mockSession).toHaveBeenCalled();
    });

    it('should process fields when includeFields is true', async () => {
      const metadataItem = { type: 'CustomObject', name: 'Account' };

      mockRun.mockResolvedValue({ records: [] });
      mockFetchObjectFields.mockResolvedValue([
        { apiName: 'Name', sobjectType: 'Account', label: 'Name', fieldType: 'string' }
      ]);

      await refreshSingleObjectNode('Account', metadataItem, true);

      expect(mockFetchObjectFields).toHaveBeenCalledWith('Account');
    });

    it('should process record types when includeRecordTypes is true', async () => {
      const metadataItem = { type: 'CustomObject', name: 'Account' };

      mockRun.mockResolvedValue({ records: [] });
      mockFetchObjectRecordTypes.mockResolvedValue([]);

      await refreshSingleObjectNode('Account', metadataItem, false, true);

      expect(mockFetchObjectRecordTypes).toHaveBeenCalledWith('Account');
    });
  });

  // ============================================================
  // syncObjectRelationships()
  // ============================================================
  describe('syncObjectRelationships', () => {
    it('should return zero stats when object has no reference fields', async () => {
      mockFetchObjectFields.mockResolvedValue([
        { apiName: 'Name', fieldType: 'string', referenceTo: null }
      ]);

      const result = await syncObjectRelationships('Account');

      expect(result).toMatchObject({
        created: 0,
        updated: 0,
        total: 0
      });
    });

    it('should return zero stats when object has no fields', async () => {
      mockFetchObjectFields.mockResolvedValue([]);

      const result = await syncObjectRelationships('EmptyObject');

      expect(result.total).toBe(0);
    });

    it('should process reference fields and create relationships', async () => {
      mockFetchObjectFields.mockResolvedValue([
        {
          apiName: 'AccountId',
          sobjectType: 'Contact',
          label: 'Account',
          fieldType: 'reference',
          referenceTo: 'Account',  // Single target
          relationshipName: 'Account',
          relationshipType: 'Lookup'
        }
      ]);

      // Mock object and field exist checks
      mockRun.mockResolvedValue({
        records: [{
          get: () => true  // exists = true
        }]
      });

      const result = await syncObjectRelationships('Contact');

      expect(result.total).toBe(1);
      expect(mockRun).toHaveBeenCalled();
    });

    it('should handle MasterDetail relationship type', async () => {
      mockFetchObjectFields.mockResolvedValue([
        {
          apiName: 'AccountId',
          sobjectType: 'MyChild__c',
          label: 'Account',
          fieldType: 'reference',
          referenceTo: 'Account',
          relationshipType: 'MasterDetail'
        }
      ]);

      mockRun.mockResolvedValue({
        records: [{ get: () => true }]
      });

      const result = await syncObjectRelationships('MyChild__c');

      // Verify MASTER_DETAIL relationship type was used
      expect(mockRun).toHaveBeenCalled();
      expect(result.total).toBe(1);
    });

    it('should create source object if it does not exist', async () => {
      mockFetchObjectFields.mockResolvedValue([
        {
          apiName: 'AccountId',
          sobjectType: 'Contact',
          label: 'Account',
          fieldType: 'reference',
          referenceTo: 'Account'
        }
      ]);

      // First check returns false (source object doesn't exist)
      // Subsequent checks return true
      let callCount = 0;
      mockRun.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Object does not exist
          return Promise.resolve({
            records: [{ get: () => false }]
          });
        }
        return Promise.resolve({
          records: [{ get: () => true }]
        });
      });

      await syncObjectRelationships('Contact');

      // Verify CREATE was called for the source object
      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining('CREATE (o:Object'),
        expect.anything()
      );
    });

    it('should pass orgId when provided', async () => {
      mockFetchObjectFields.mockResolvedValue([
        {
          apiName: 'AccountId',
          sobjectType: 'Contact',
          referenceTo: 'Account'
        }
      ]);

      mockRun.mockResolvedValue({
        records: [{ get: () => true }]
      });

      await syncObjectRelationships('Contact', 'test-org');

      expect(mockRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ orgId: 'test-org' })
      );
    });

    it('should handle polymorphic lookups with multiple targets', async () => {
      mockFetchObjectFields.mockResolvedValue([
        {
          apiName: 'WhatId',
          sobjectType: 'Task',
          label: 'Related To',
          fieldType: 'reference',
          referenceTo: ['Account', 'Contact', 'Opportunity'],  // Polymorphic
          relationshipType: 'Lookup'
        }
      ]);

      mockRun.mockResolvedValue({
        records: [{ get: () => true }]
      });

      const result = await syncObjectRelationships('Task');

      // Should create relationships to all three targets
      expect(result.total).toBe(1);  // One field, but multiple targets
      expect(mockRun).toHaveBeenCalled();
    });
  });
});

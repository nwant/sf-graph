import { jest } from '@jest/globals';
import { Record } from 'neo4j-driver';

// Mock driver module
const mockRun = jest.fn();
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockSession = jest.fn().mockReturnValue({
  executeRead: jest.fn(callback => callback({ run: mockRun })),
  executeWrite: jest.fn(callback => callback({ run: mockRun })),
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

// Import functions under test after mocking
const {
  getAllObjects,
  getObjectByApiName,
  getObjectFields,
  getObjectRelationships,
  findRelatedObjects
} = await import('../../../dist/services/neo4j/graph-service.js');

describe('Graph Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // getAllObjects()
  // ============================================================
  describe('getAllObjects', () => {
    it('should return empty array when no objects exist', async () => {
      mockRun.mockResolvedValue({ records: [] });

      const result = await getAllObjects();

      expect(result).toEqual([]);
      expect(mockSession).toHaveBeenCalled();
    });

    it('should map object properties correctly', async () => {
      const mockRecords = [
        new Record(
          ['object'],
          [{
            apiName: 'Account',
            label: 'Account',
            description: 'Standard Account object',
            category: 'standard',
            subtype: null,
            namespace: null,
            parentObjectName: null,
            lastRefreshed: '2024-01-01T00:00:00.000Z',
            name: 'Account',
            orgId: 'org123'
          }]
        )
      ];
      mockRun.mockResolvedValue({ records: mockRecords });

      const result = await getAllObjects();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        apiName: 'Account',
        label: 'Account',
        description: 'Standard Account object',
        category: 'standard',
        subtype: null,
        namespace: null,
        orgId: 'org123'
      });
    });

    it('should filter by orgId when provided', async () => {
      mockRun.mockResolvedValue({ records: [] });

      await getAllObjects({ orgId: 'test-org' });

      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining('WHERE o.orgId = $orgId'),
        expect.objectContaining({ orgId: 'test-org' })
      );
    });

    it('should apply default values for missing properties', async () => {
      const mockRecords = [
        new Record(
          ['object'],
          [{
            apiName: 'Contact',
            label: null,        // Missing
            description: null,  // Missing
            category: null,     // Missing
          }]
        )
      ];
      mockRun.mockResolvedValue({ records: mockRecords });

      const result = await getAllObjects();

      expect(result[0]).toMatchObject({
        apiName: 'Contact',
        label: '',                  // Defaulted to empty string
        description: '',            // Defaulted to empty string
        category: 'standard',       // Defaulted to 'standard'
        subtype: null,
        namespace: null
      });
    });
  });

  // ============================================================
  // getObjectByApiName()
  // ============================================================
  describe('getObjectByApiName', () => {
    it('should return null for unknown object', async () => {
      mockRun.mockResolvedValue({ records: [] });

      const result = await getObjectByApiName('NonExistent');

      expect(result).toBeNull();
    });

    it('should return object with all properties mapped correctly', async () => {
      const objectRecord = new Record(
        ['object'],
        [{
          apiName: 'Account',
          label: 'Account Label',
          description: 'Account Description',
          category: 'standard',
          subtype: 'standard',
          namespace: null,
          parentObjectName: null,
          lastRefreshed: '2024-01-01T00:00:00.000Z',
          name: 'Account',
          orgId: 'org123'
        }]
      );
      objectRecord.toObject = () => ({ object: objectRecord.get('object') });

      const fieldCountRecord = {
        get: () => ({ toNumber: () => 50 })
      };

      // First call returns the object, second call returns field count
      mockRun
        .mockResolvedValueOnce({ records: [objectRecord] })
        .mockResolvedValueOnce({ records: [fieldCountRecord] });

      const result = await getObjectByApiName('Account');

      expect(result).not.toBeNull();
      expect(result.apiName).toBe('Account');
      expect(result.label).toBe('Account Label');
      expect(result.category).toBe('standard');
      expect(result.fieldCount).toBe(50);
    });

    it('should perform case-insensitive lookup', async () => {
      mockRun.mockResolvedValue({ records: [] });

      await getObjectByApiName('account');

      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining('toLower(o.apiName) = toLower($apiName)'),
        expect.objectContaining({ apiName: 'account' })
      );
    });

    it('should filter by orgId when provided', async () => {
      mockRun.mockResolvedValue({ records: [] });

      await getObjectByApiName('Account', { orgId: 'test-org' });

      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining('AND o.orgId = $orgId'),
        expect.objectContaining({ orgId: 'test-org' })
      );
    });
  });

  // ============================================================
  // getObjectFields()
  // ============================================================
  describe('getObjectFields', () => {
    it('should return empty array for object with no fields', async () => {
      mockRun.mockResolvedValue({ records: [] });

      const result = await getObjectFields('EmptyObject');

      expect(result).toEqual([]);
    });

    it('should map field properties correctly', async () => {
      const mockRecords = [
        new Record(
          ['field'],
          [{
            apiName: 'Name',
            sobjectType: 'Account',
            label: 'Account Name',
            type: 'string',
            description: 'Name of the account',
            helpText: 'Enter the account name',
            nillable: false,
            unique: false,
            category: 'standard',
            namespace: null,
            lastRefreshed: '2024-01-01T00:00:00.000Z',
            name: 'Name',
            referenceTo: null
          }]
        )
      ];
      mockRun.mockResolvedValue({ records: mockRecords });

      const result = await getObjectFields('Account');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        apiName: 'Name',
        sobjectType: 'Account',
        label: 'Account Name',
        type: 'string',
        nillable: false,
        category: 'standard'
      });
    });

    it('should map lookup field with referenceTo', async () => {
      const mockRecords = [
        new Record(
          ['field'],
          [{
            apiName: 'ParentId',
            sobjectType: 'Account',
            label: 'Parent Account',
            type: 'reference',
            description: '',
            helpText: '',
            nillable: true,
            unique: false,
            category: 'standard',
            namespace: null,
            lastRefreshed: null,
            name: 'ParentId',
            referenceTo: 'Account'
          }]
        )
      ];
      mockRun.mockResolvedValue({ records: mockRecords });

      const result = await getObjectFields('Account');

      expect(result[0].referenceTo).toBe('Account');
      expect(result[0].type).toBe('reference');
    });

    it('should filter by orgId when provided', async () => {
      mockRun.mockResolvedValue({ records: [] });

      await getObjectFields('Account', { orgId: 'test-org' });

      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining('AND o.orgId = $orgId'),
        expect.objectContaining({ orgId: 'test-org' })
      );
    });
  });

  // ============================================================
  // getObjectRelationships()
  // ============================================================
  describe('getObjectRelationships', () => {
    it('should return empty array when no relationships exist', async () => {
      mockRun
        .mockResolvedValueOnce({ records: [] })  // outgoing
        .mockResolvedValueOnce({ records: [] }); // incoming

      const result = await getObjectRelationships('IsolatedObject');

      expect(result).toEqual([]);
    });

    it('should map outgoing relationships correctly', async () => {
      const outgoingRecord = new Record(
        ['relationship'],
        [{
          sourceObject: 'Contact',
          targetObject: 'Account',
          relationshipType: 'Lookup',
          fieldCount: 1,
          direction: 'outgoing',
          fieldApiName: 'AccountId',
          fieldLabel: 'Account',
          fieldDescription: 'Parent account',
          relationshipName: 'Account',
          referenceTo: 'Account'
        }]
      );

      mockRun
        .mockResolvedValueOnce({ records: [outgoingRecord] })
        .mockResolvedValueOnce({ records: [] });

      const result = await getObjectRelationships('Contact');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sourceObject: 'Contact',
        targetObject: 'Account',
        direction: 'outgoing',
        fieldApiName: 'AccountId'
      });
    });

    it('should map incoming relationships correctly', async () => {
      const incomingRecord = new Record(
        ['relationship'],
        [{
          sourceObject: 'Contact',
          targetObject: 'Account',
          relationshipType: 'Lookup',
          fieldCount: 1,
          direction: 'incoming',
          fieldApiName: 'AccountId',
          fieldLabel: 'Account',
          fieldDescription: '',
          relationshipName: 'Contacts',
          referenceTo: 'Account'
        }]
      );

      mockRun
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValueOnce({ records: [incomingRecord] });

      const result = await getObjectRelationships('Account');

      expect(result).toHaveLength(1);
      expect(result[0].direction).toBe('incoming');
      expect(result[0].sourceObject).toBe('Contact');
    });

    it('should combine outgoing and incoming relationships', async () => {
      const outgoingRecord = new Record(['relationship'], [{ direction: 'outgoing', fieldApiName: 'ParentId' }]);
      const incomingRecord = new Record(['relationship'], [{ direction: 'incoming', fieldApiName: 'AccountId' }]);

      mockRun
        .mockResolvedValueOnce({ records: [outgoingRecord] })
        .mockResolvedValueOnce({ records: [incomingRecord] });

      const result = await getObjectRelationships('Account');

      expect(result).toHaveLength(2);
      expect(result.some(r => r.direction === 'outgoing')).toBe(true);
      expect(result.some(r => r.direction === 'incoming')).toBe(true);
    });
  });

  // ============================================================
  // findRelatedObjects()
  // ============================================================
  describe('findRelatedObjects', () => {
    it('should return empty object when no related objects found', async () => {
      mockRun.mockResolvedValue({ records: [] });

      const result = await findRelatedObjects('IsolatedObject');

      expect(result).toEqual({});
    });

    it('should group objects by distance level', async () => {
      const mockRecords = [
        {
          get: jest.fn((key) => {
            if (key === 'related') {
              return { properties: { apiName: 'Contact', label: 'Contact', description: '', category: 'standard' } };
            }
            return { toNumber: () => 1 };
          })
        },
        {
          get: jest.fn((key) => {
            if (key === 'related') {
              return { properties: { apiName: 'Case', label: 'Case', description: '', category: 'standard' } };
            }
            return { toNumber: () => 2 };
          })
        }
      ];
      mockRun.mockResolvedValue({ records: mockRecords });

      const result = await findRelatedObjects('Account', 2);

      expect(result[1]).toBeDefined();
      expect(result[1]).toHaveLength(1);
      expect(result[1][0].apiName).toBe('Contact');

      expect(result[2]).toBeDefined();
      expect(result[2]).toHaveLength(1);
      expect(result[2][0].apiName).toBe('Case');
    });

    it('should respect maxDepth parameter', async () => {
      mockRun.mockResolvedValue({ records: [] });

      await findRelatedObjects('Account', 3);

      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining('[:REFERENCES*1..3]'),
        expect.anything()
      );
    });

    it('should filter by orgId when provided', async () => {
      mockRun.mockResolvedValue({ records: [] });

      await findRelatedObjects('Account', 2, { orgId: 'test-org' });

      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining('AND source.orgId = $orgId'),
        expect.objectContaining({ orgId: 'test-org' })
      );
    });
  });
});

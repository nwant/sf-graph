
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

// Mock the dependencies using unstable_mockModule for ESM support
const mockCloseDriver = jest.fn();
const mockInitNeo4jDriver = jest.fn();

jest.unstable_mockModule('../../../dist/services/neo4j/driver.js', () => ({
  initNeo4jDriver: mockInitNeo4jDriver,
  closeDriver: mockCloseDriver,
  getDriver: jest.fn(),
}));

jest.unstable_mockModule('../../../dist/services/neo4j/index.js', () => ({
  getObjectByApiName: jest.fn(),
  getObjectFields: jest.fn(),
  getObjectRelationships: jest.fn(),
  getAllObjects: jest.fn(),
  getGraphStatus: jest.fn(),
  findDetailedPaths: jest.fn(),
  findObjectPaths: jest.fn(),
  findRelatedObjects: jest.fn(),
  findSoqlPaths: jest.fn(),
  executeRead: jest.fn(),
  executeWrite: jest.fn(),
}));

// Import the module under test and the mocked module
// dynamic imports are needed after mockModule calls
const { apiService } = await import('../../../dist/core/api-service.js');
const neo4jModule = await import('../../../dist/services/neo4j/index.js');

describe('ApiService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ============================================================
    // listObjects()
    // ============================================================
    describe('listObjects', () => {
        test('returns empty array when no objects exist', async () => {
            neo4jModule.getAllObjects.mockResolvedValue([]);

            const result = await apiService.listObjects();

            expect(result).toEqual([]);
        });

        test('returns mapped SalesforceObject array', async () => {
            neo4jModule.getAllObjects.mockResolvedValue([
                {
                    apiName: 'Account',
                    label: 'Account',
                    category: 'standard',
                    subtype: 'standard',
                    namespace: null,
                    orgId: 'org123'
                },
                {
                    apiName: 'MyCustom__c',
                    label: 'My Custom',
                    category: 'custom',
                    subtype: 'custom',
                    namespace: null,
                    orgId: 'org123'
                }
            ]);

            const result = await apiService.listObjects();

            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({
                apiName: 'Account',
                label: 'Account',
                category: 'standard'
            });
        });

        test('passes orgId to graph service', async () => {
            neo4jModule.getAllObjects.mockResolvedValue([]);

            await apiService.listObjects('specific-org');

            expect(neo4jModule.getAllObjects).toHaveBeenCalledWith({ orgId: 'specific-org' });
        });
    });

    // ============================================================
    // getObject()
    // ============================================================
    describe('getObject', () => {
        test('returns null when object not found', async () => {
            neo4jModule.getObjectByApiName.mockResolvedValue(null);

            const result = await apiService.getObject('NonExistent');

            expect(result).toBeNull();
        });

        test('maps relationship direction and relatedObject correctly', async () => {
            neo4jModule.getObjectByApiName.mockResolvedValue({
                apiName: 'TestObject',
                label: 'Test Object',
                category: 'standard'
            });
            
            neo4jModule.getObjectFields.mockResolvedValue([]);
            
            neo4jModule.getObjectRelationships.mockResolvedValue([
                {
                    relationshipName: 'Account',
                    fieldApiName: 'AccountId',
                    referenceTo: ['Account'],  // Now an array for polymorphic support
                    relationshipType: 'Lookup',
                    direction: 'outgoing',
                    sourceObject: 'TestObject',
                    targetObject: 'Account'
                },
                {
                    relationshipName: 'Contacts',
                    fieldApiName: 'AccountId',
                    referenceTo: ['TestObject'],  // Now an array for polymorphic support
                    relationshipType: 'Lookup',
                    direction: 'incoming',
                    sourceObject: 'Contact',
                    targetObject: 'TestObject'
                }
            ]);

            const result = await apiService.getObject('TestObject');

            expect(result).toBeDefined();
            if (!result) return;

            expect(result.relationships).toHaveLength(2);

            // Check Outgoing
            const outgoing = result.relationships.find(r => r.direction === 'outgoing');
            expect(outgoing).toBeDefined();
            expect(outgoing.relatedObject).toBe('Account');
            expect(outgoing.referenceTo).toEqual(['Account']);  // Now an array

            // Check Incoming
            const incoming = result.relationships.find(r => r.direction === 'incoming');
            expect(incoming).toBeDefined();
            expect(incoming.relatedObject).toBe('Contact');
            expect(incoming.referenceTo).toEqual(['TestObject']);  // Now an array
        });

        test('combines object with fields and relationships', async () => {
            neo4jModule.getObjectByApiName.mockResolvedValue({
                apiName: 'Account',
                label: 'Account',
                category: 'standard'
            });

            neo4jModule.getObjectFields.mockResolvedValue([
                { apiName: 'Name', label: 'Account Name', type: 'string', nillable: false }
            ]);

            neo4jModule.getObjectRelationships.mockResolvedValue([
                {
                    fieldApiName: 'OwnerId',
                    direction: 'outgoing',
                    sourceObject: 'Account',
                    targetObject: 'User',
                    referenceTo: ['User']  // Now an array for polymorphic support
                }
            ]);

            const result = await apiService.getObject('Account');

            expect(result).not.toBeNull();
            expect(result.fields).toHaveLength(1);
            expect(result.relationships).toHaveLength(1);
        });

        test('passes orgId to all underlying service calls', async () => {
            neo4jModule.getObjectByApiName.mockResolvedValue({
                apiName: 'Account',
                label: 'Account'
            });
            neo4jModule.getObjectFields.mockResolvedValue([]);
            neo4jModule.getObjectRelationships.mockResolvedValue([]);

            await apiService.getObject('Account', 'specific-org');

            expect(neo4jModule.getObjectByApiName).toHaveBeenCalledWith('Account', { orgId: 'specific-org' });
            expect(neo4jModule.getObjectFields).toHaveBeenCalledWith('Account', { orgId: 'specific-org' });
            expect(neo4jModule.getObjectRelationships).toHaveBeenCalledWith('Account', { orgId: 'specific-org' });
        });
    });

    // ============================================================
    // cleanup()
    // ============================================================
    describe('cleanup', () => {
        test('calls closeDriver', async () => {
            await apiService.cleanup();

            expect(mockCloseDriver).toHaveBeenCalled();
        });
    });
});

import { jest } from '@jest/globals';

// Mock graph-service
const mockGetAllObjects = jest.fn();
const mockGetObjectFields = jest.fn();
const mockGetObjectRelationships = jest.fn();
const mockGetChildRelationships = jest.fn();
const mockGetPicklistValues = jest.fn();

jest.unstable_mockModule('../../../dist/services/neo4j/graph-service.js', () => ({
  getAllObjects: mockGetAllObjects,
  getObjectFields: mockGetObjectFields,
  getObjectRelationships: mockGetObjectRelationships,
  getChildRelationships: mockGetChildRelationships,
  getPicklistValues: mockGetPicklistValues,
  findObjectsByPicklistValue: jest.fn().mockResolvedValue([]),
  getObjectByApiName: jest.fn().mockResolvedValue(null),
  get1HopNeighborSummaries: jest.fn().mockResolvedValue([]),
  executeRead: jest.fn().mockResolvedValue([]),
  executeWrite: jest.fn().mockResolvedValue([]),
  getMetadataRelationships: jest.fn().mockResolvedValue([]),
  findObjectPaths: jest.fn().mockResolvedValue([]),
  findDetailedPaths: jest.fn().mockResolvedValue([]),
  findRelatedObjects: jest.fn().mockResolvedValue([]),
  findSoqlPaths: jest.fn().mockResolvedValue({}),
}));


// Mock schema-categorization-service
const mockGetObjectCategory = jest.fn();
jest.unstable_mockModule('../../../dist/services/categorization/schema-categorization-service.js', () => ({
  createSchemaCategorizationService: () => ({
    getObjectCategory: mockGetObjectCategory
  })
}));

// Mock categorization-graph-executor
jest.unstable_mockModule('../../../dist/services/categorization/categorization-graph-executor.js', () => ({
  createCategorizationGraphExecutor: jest.fn()
}));

// Mock dynamic-synonym-service
jest.unstable_mockModule('../../../dist/services/dynamic-synonym-service.js', () => ({
  findObject: jest.fn().mockResolvedValue(null),
  rebuildSynonymIndex: jest.fn().mockResolvedValue(undefined)
}));

// Import implementations under test
const { 
  extractPotentialEntities,
  findMatchingObjects,
  formatSchemaForPrompt 
} = await import('../../../dist/services/schema-context/index.js');

// Access the buildObjectSchema function via a trick or test it indirectly via FuzzySchemaContextProvider
// Since buildObjectSchema is not exported, we'll test it via FuzzySchemaContextProvider (default export logic)
// But wait, the FuzzySchemaContextProvider is exported, let's use that.
const { FuzzySchemaContextProvider } = await import('../../../dist/services/schema-context/index.js');


describe('Polymorphic Intelligence', () => {
    let provider;
    
    beforeEach(() => {
        jest.clearAllMocks();
        provider = new FuzzySchemaContextProvider();
        
        // Default mocks
        mockGetAllObjects.mockResolvedValue([]);
        mockGetObjectFields.mockResolvedValue([]);
        mockGetObjectRelationships.mockResolvedValue([]);
        mockGetChildRelationships.mockResolvedValue([]);
        mockGetObjectCategory.mockResolvedValue('business_core');
    });

    describe('Polymorphic Field Detection', () => {
        it('should flag fields with multiple referenceTo targets as polymorphic', async () => {
            const taskObject = { apiName: 'Task', label: 'Task' };
            const taskFields = [
                { apiName: 'Id', label: 'Id', type: 'id' },
                { 
                    apiName: 'WhoId',
                    label: 'WhoId',
                    type: 'reference', 
                    referenceTo: ['Contact', 'Lead'],
                    relationshipName: 'Who' // As it would come from graph
                },
                {
                    apiName: 'OwnerId',
                    label: 'OwnerId',
                    type: 'reference',
                    referenceTo: ['User'], // Single target -> Not polymorphic
                    relationshipName: 'Owner'
                }
            ];

            mockGetAllObjects.mockResolvedValue([taskObject]);
            mockGetObjectFields.mockResolvedValue(taskFields);
            mockGetObjectRelationships.mockResolvedValue([]);
            
            // Build context for "Task"
            const context = await provider.getContext('Task');
            
            const taskSchema = context.objects.find(o => o.apiName === 'Task');
            
            const whoField = taskSchema.fields.find(f => f.apiName === 'WhoId');
            const ownerField = taskSchema.fields.find(f => f.apiName === 'OwnerId');
            
            expect(whoField.isPolymorphic).toBe(true);
            expect(whoField.polymorphicTargets).toEqual(['Contact', 'Lead']);
            expect(whoField.relationshipName).toBe('Who');
            
            expect(ownerField.isPolymorphic).toBe(false);
            expect(ownerField.relationshipName).toBeUndefined(); // Should be cleaned up if not polymorphic? Logic sets undefined for both
            // Wait, logic sets relationshipName for polymorphic fields specifically? 
            // "relationshipName" property in enrichedFields loop is scoped inside `if (isPolymorphic)` block?
            // Actually, let's check the implementation.
            // Ah, line 474: relationshipName variable is initialized to undefined.
            // It is ONLY populated inside `if (isPolymorphic)`. 
            // So non-polymorphic fields will have relationshipName: undefined. Correct.
        });

        it('should use fallback heuristic for relationshipName if missing in graph', async () => {
             const eventObject = { apiName: 'Event', label: 'Event' };
             const eventFields = [
                 { 
                     apiName: 'WhatId',
                     label: 'WhatId',
                     type: 'reference', 
                     referenceTo: ['Account', 'Opportunity'],
                     relationshipName: null // Simulating missing metadata
                 }
             ];
             
             mockGetAllObjects.mockResolvedValue([eventObject]);
             mockGetObjectFields.mockResolvedValue(eventFields);
             mockGetObjectRelationships.mockResolvedValue([]);

             const context = await provider.getContext('Event');
             const eventSchema = context.objects.find(o => o.apiName === 'Event');
             const whatField = eventSchema.fields.find(f => f.apiName === 'WhatId');
             
             expect(whatField.isPolymorphic).toBe(true);
             // Should fallback to KNOWN_POLYMORPHIC_FIELDS or 'Id' stripping
             // 'WhatId' is in KNOWN_POLYMORPHIC_FIELDS, so it should be 'What'
             expect(whatField.relationshipName).toBe('What');
        });
    });

    describe('Prompt Injection', () => {
        it('should inject POLYMORPHIC_RULES when polymorphic fields are present', async () => {
             const taskObject = { apiName: 'Task', label: 'Task' };
             const taskFields = [
                 { 
                     apiName: 'WhoId', 
                     type: 'reference', 
                     referenceTo: ['Contact', 'Lead'],
                     relationshipName: 'Who',
                     isPolymorphic: true
                 }
             ];
             
             // Create a fake SchemaContext directly to test formatSchemaForPrompt
             const context = {
                 objects: [{
                     apiName: 'Task',
                     label: 'Task',
                     fields: [{
                         apiName: 'WhoId',
                         type: 'reference',
                         isPolymorphic: true,
                         relationshipName: 'Who',
                         polymorphicTargets: ['Contact', 'Lead']
                     }],
                     parentRelationships: [],
                     childRelationships: []
                 }],
                 stats: { objectCount: 1, totalFields: 1, totalRelationships: 0 }
             };
             
             const prompt = formatSchemaForPrompt(context, { skeletonMode: false });
             
             expect(prompt).toContain('POLYMORPHIC FIELD RULES:');
             expect(prompt).toContain('WhoId/WhatId are Foreign Key fields');
             expect(prompt).toContain('TYPEOF Who WHEN Contact');
        });

        it('should NOT inject POLYMORPHIC_RULES when NO polymorphic fields are present', async () => {
             const accountObject = {
                 apiName: 'Account',
                 label: 'Account',
                 fields: [{ apiName: 'Name', type: 'string' }],
                 parentRelationships: [],
                 childRelationships: []
             };
             
             const context = {
                 objects: [accountObject],
                 stats: { objectCount: 1, totalFields: 1, totalRelationships: 0 }
             };
             
             const prompt = formatSchemaForPrompt(context, { skeletonMode: false });
             
             expect(prompt).not.toContain('POLYMORPHIC FIELD RULES');
        });
    });

    describe('Schema Formatting Details', () => {
        it('should include target types and relationship name in Full Schema', () => {
            const context = {
                 objects: [{
                     apiName: 'Task',
                     label: 'Task',
                     fields: [{
                         apiName: 'WhoId',
                         type: 'reference',
                         isPolymorphic: true,
                         relationshipName: 'Who',
                         polymorphicTargets: ['Contact', 'Lead']
                     }],
                     parentRelationships: [],
                     childRelationships: []
                 }],
                 stats: { objectCount: 1, totalFields: 1, totalRelationships: 0 }
             };
             
             const output = formatSchemaForPrompt(context, { skeletonMode: false });
             
             expect(output).toContain('POLYMORPHIC: Use TYPEOF Who WHEN... (Targets: Contact|Lead)');
        });

        it('should include brief indicator in Skeleton Schema', () => {
            const context = {
                 objects: [{
                     apiName: 'Task',
                     label: 'Task',
                     fields: [{
                         apiName: 'WhoId',
                         label: 'WhoId',
                         type: 'reference',
                         isPolymorphic: true,
                         relationshipName: 'Who',
                         polymorphicTargets: ['Contact', 'Lead']
                     }],
                     parentRelationships: [],
                     childRelationships: []
                 }],
                 stats: { objectCount: 1, totalFields: 1, totalRelationships: 0 }
             };
             
             const output = formatSchemaForPrompt(context, { 
                 skeletonMode: true, 
                 query: 'show tasks' 
             });
             
             // Check for compact representation
             expect(output).toContain('WhoId(POLYMORPHIC:Who->Contact/Lead)');
        });
    });
});

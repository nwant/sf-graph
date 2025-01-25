import { jest } from '@jest/globals';

// Mock the graph-service module with all required exports
const mockGetAllObjects = jest.fn();
const mockGetObjectFields = jest.fn();
const mockGetObjectRelationships = jest.fn();
const mockGetChildRelationships = jest.fn();
const mockFindSoqlPaths = jest.fn();
const mockGetObjectByApiName = jest.fn();
const mockFindRelatedObjects = jest.fn();

jest.unstable_mockModule('../../../dist/services/neo4j/graph-service.js', () => ({
  getAllObjects: mockGetAllObjects,
  getObjectFields: mockGetObjectFields,
  getObjectRelationships: mockGetObjectRelationships,
  getChildRelationships: mockGetChildRelationships,
  findSoqlPaths: mockFindSoqlPaths,
  getObjectByApiName: mockGetObjectByApiName,
  findRelatedObjects: mockFindRelatedObjects,
  getPicklistValues: jest.fn(),
  findObjectsByPicklistValue: jest.fn(),
  executeRead: jest.fn(),
  executeWrite: jest.fn(),
  getMetadataRelationships: jest.fn(),
  findObjectPaths: jest.fn(),
  findDetailedPaths: jest.fn(),
  get1HopNeighborSummaries: jest.fn(),
  // Types are not needed at runtime for mocks
  // Types are not needed at runtime for mocks
}));

const mockFindObject = jest.fn().mockResolvedValue(null);
const mockFindField = jest.fn().mockResolvedValue(null);

jest.unstable_mockModule('../../../dist/services/dynamic-synonym-service.js', () => ({
  findObject: mockFindObject,
  findField: mockFindField,
  getSynonymIndex: jest.fn(),
  buildSynonymIndex: jest.fn(),
  rebuildSynonymIndex: jest.fn(),
  clearSynonymCache: jest.fn(),
  findFieldsGlobal: jest.fn(),
  normalizeForLookup: jest.fn(),
}));

// Import functions under test after mocking
const {
  extractPotentialEntities,
  detectRelationshipIntent,
  findMatchingObjects,
  formatSchemaForPrompt,
  FuzzySchemaContextProvider,
} = await import('../../../dist/services/schema-context/index.js');

describe('Schema Context Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // extractPotentialEntities()
  // Note: Object resolution (e.g., "accounts" → "Account") is now handled
  // by the dynamic synonym service in findMatchingObjects(), not here.
  // extractPotentialEntities only extracts syntactic patterns.
  // ============================================================
  describe('extractPotentialEntities', () => {
    it('should extract custom object names with __c suffix', () => {
      const query = 'show Invoice__c records with customer';
      const result = extractPotentialEntities(query);

      expect(result.entities).toContain('Invoice__c');
    });

    it('should extract capitalized words that might be objects', () => {
      const query = 'get CustomProject details';
      const result = extractPotentialEntities(query);

      expect(result.entities).toContain('CustomProject');
    });

    it('should not include common words like Show, Get, From', () => {
      const query = 'Show me all the data From Account';
      const result = extractPotentialEntities(query);

      expect(result.entities).not.toContain('Show');
      expect(result.entities).not.toContain('From');
      // Account is capitalized so it should be extracted
      expect(result.entities).toContain('Account');
    });

    it('should handle empty query', () => {
      const result = extractPotentialEntities('');
      expect(result.entities).toEqual([]);
    });

    it('should extract status keywords as potential values', () => {
      const result = extractPotentialEntities('show high priority cases');
      expect(result.potentialValues).toContain('High');
    });

    it('should extract company names from patterns', () => {
      const result = extractPotentialEntities('get deals for Microsoft');
      expect(result.potentialValues).toContain('Microsoft');
    });
  });

  // ============================================================
  // detectRelationshipIntent()
  // ============================================================
  describe('detectRelationshipIntent', () => {
    it('should detect parent lookup pattern with "with their account name"', () => {
      const intents = detectRelationshipIntent('get contacts with their account name');
      
      expect(intents.length).toBeGreaterThanOrEqual(1);
      const parentIntent = intents.find(i => i.type === 'parent_lookup');
      expect(parentIntent).toBeDefined();
      expect(parentIntent.sourceEntity).toBe('Contacts');
      expect(parentIntent.targetEntity).toBe('Account');
    });

    it('should detect parent lookup pattern with "including account id"', () => {
      const intents = detectRelationshipIntent('contacts including account id');
      
      const parentIntent = intents.find(i => i.type === 'parent_lookup');
      expect(parentIntent).toBeDefined();
      expect(parentIntent.targetEntity).toBe('Account');
    });

    it('should detect child subquery pattern with "accounts with their opportunities"', () => {
      const intents = detectRelationshipIntent('show accounts with their opportunities');
      
      expect(intents.length).toBeGreaterThanOrEqual(1);
      const childIntent = intents.find(i => i.type === 'child_subquery');
      expect(childIntent).toBeDefined();
      expect(childIntent.sourceEntity).toBe('Accounts');
      expect(childIntent.targetEntity).toBe('Opportunities');
    });

    it('should detect child subquery pattern with "that have contacts"', () => {
      const intents = detectRelationshipIntent('accounts that have contacts');
      
      const childIntent = intents.find(i => i.type === 'child_subquery');
      expect(childIntent).toBeDefined();
      expect(childIntent.sourceEntity).toBe('Accounts');
      expect(childIntent.targetEntity).toBe('Contacts');
    });

    it('should return empty array for queries without relationship patterns', () => {
      const intents = detectRelationshipIntent('show me all accounts');
      expect(intents).toEqual([]);
    });

    it('should not duplicate intents', () => {
      const intents = detectRelationshipIntent('contacts with account name and account details');
      
      const parentIntents = intents.filter(i => 
        i.type === 'parent_lookup' && 
        i.sourceEntity === 'Contact' && 
        i.targetEntity === 'Account'
      );
      expect(parentIntents.length).toBeLessThanOrEqual(2);
    });
  });

  // ============================================================
  // findMatchingObjects()
  // ============================================================
  describe('findMatchingObjects', () => {
    const mockObjects = [
      { apiName: 'Account', label: 'Account' },
      { apiName: 'Contact', label: 'Contact' },
      { apiName: 'Invoice__c', label: 'Invoice' },
      { apiName: 'CustomProject__c', label: 'Custom Project' },
    ];

    beforeEach(() => {
      mockGetAllObjects.mockResolvedValue(mockObjects);
    });

    it('should find exact matches by API name', async () => {
      const terms = { entities: ['Account'], potentialValues: [] };
      const { objects: result } = await findMatchingObjects(terms);
      
      expect(result).toHaveLength(1);
      expect(result[0].object.apiName).toBe('Account');
    });

    it('should find matches by label', async () => {
      const terms = { entities: ['Invoice'], potentialValues: [] };
      const { objects: result } = await findMatchingObjects(terms);
      
      expect(result).toHaveLength(1);
      expect(result[0].object.apiName).toBe('Invoice__c');
    });

    it('should find partial matches', async () => {
      const terms = { entities: ['Custom'], potentialValues: [] };
      const { objects: result } = await findMatchingObjects(terms);
      
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some(r => r.object.apiName.includes('Custom'))).toBe(true);
    });

    it('should return empty array for no entities', async () => {
      const terms = { entities: [], potentialValues: [] };
      const { objects: result } = await findMatchingObjects(terms);
      expect(result).toEqual([]);
      expect(result).toEqual([]);
    });

    it('should not duplicate matches', async () => {
      const terms = { entities: ['Account', 'account', 'ACCOUNT'], potentialValues: [] };
      const { objects: result } = await findMatchingObjects(terms);
      
      const accountMatches = result.filter(r => r.object.apiName === 'Account');
      expect(accountMatches.length).toBe(1);
    });

    it('should pass orgId to getAllObjects', async () => {
      const terms = { entities: ['Account'], potentialValues: [] };
      await findMatchingObjects(terms, 'test-org-id');
      
      expect(mockGetAllObjects).toHaveBeenCalledWith({ orgId: 'test-org-id' });
    });
  });

  // ============================================================
  // formatSchemaForPrompt()
  // ============================================================
  describe('formatSchemaForPrompt', () => {
    it('should return default message for empty context', () => {
      const result = formatSchemaForPrompt({ objects: [], stats: { objectCount: 0, totalFields: 0, totalRelationships: 0 } });
      
      expect(result).toContain('No specific schema context');
    });

    it('should format single object with fields', () => {
      const context = {
        objects: [{
          apiName: 'Account',
          label: 'Account',
          fields: [
            { apiName: 'Id', label: 'Id', type: 'id' },
            { apiName: 'Name', label: 'Name', type: 'string' },
          ],
          parentRelationships: [],
          childRelationships: [],
        }],
        stats: { objectCount: 1, totalFields: 2, totalRelationships: 0 },
      };

      const result = formatSchemaForPrompt(context);

      expect(result).toContain('AVAILABLE SCHEMA');
      expect(result).toContain('Object: Account');
      expect(result).toContain('Id (id)');
      expect(result).toContain('Name (string)');
    });

    it('should format parent relationships', () => {
      const context = {
        objects: [{
          apiName: 'Contact',
          label: 'Contact',
          fields: [],
          parentRelationships: [
            { fieldApiName: 'AccountId', relationshipName: 'Account', targetObject: 'Account' },
          ],
          childRelationships: [],
        }],
        stats: { objectCount: 1, totalFields: 0, totalRelationships: 1 },
      };

      const result = formatSchemaForPrompt(context);

      expect(result).toContain('Parent lookups');
      expect(result).toContain('Account.FieldName');
      expect(result).toContain('access Account fields');
    });

    it('should format child relationships', () => {
      const context = {
        objects: [{
          apiName: 'Account',
          label: 'Account',
          fields: [],
          parentRelationships: [],
          childRelationships: [
            { relationshipName: 'Contacts', childObject: 'Contact' },
          ],
        }],
        stats: { objectCount: 1, totalFields: 0, totalRelationships: 1 },
      };

      const result = formatSchemaForPrompt(context);

      expect(result).toContain('Child relationships');
      expect(result).toContain('SELECT fields FROM Contacts');
      expect(result).toContain('get related Contact records');
    });

    it('should include usage instruction', () => {
      const context = {
        objects: [{ apiName: 'Account', label: 'Account', fields: [], parentRelationships: [], childRelationships: [] }],
        stats: { objectCount: 1, totalFields: 0, totalRelationships: 0 },
      };

      const result = formatSchemaForPrompt(context);

      expect(result).toContain('Use ONLY the objects');
    });
  });

  // ============================================================
  // FuzzySchemaContextProvider
  // ============================================================
  describe('FuzzySchemaContextProvider', () => {
    const provider = new FuzzySchemaContextProvider();

    beforeEach(() => {
      mockGetAllObjects.mockResolvedValue([
        { apiName: 'Account', label: 'Account' },
        { apiName: 'Contact', label: 'Contact' },
      ]);
      mockGetObjectFields.mockResolvedValue([
        { apiName: 'Id', label: 'Id', type: 'id' },
        { apiName: 'Name', label: 'Name', type: 'string' },
      ]);
      mockGetObjectRelationships.mockResolvedValue([]);
      mockGetChildRelationships.mockResolvedValue([]);
      
      // Mock findObject for 'accounts' to simulate successful lookup
      mockFindObject.mockImplementation(async (term) => {
         if (term === 'accounts' || term === 'account') return { apiName: 'Account', confidence: 0.9 };
         return null;
      });
    });

    it('should return context with matched objects', async () => {
      const context = await provider.getContext('show me all accounts');
      
      expect(context.objects).toHaveLength(1);
      expect(context.objects[0].apiName).toBe('Account');
      expect(context.stats.objectCount).toBe(1);
    });

    it('should return empty context when no objects match', async () => {
      const context = await provider.getContext('show me something random');
      
      expect(context.objects).toHaveLength(0);
      expect(context.stats.objectCount).toBe(0);
    });

    it('should include fields in context', async () => {
      const context = await provider.getContext('get account names');
      
      expect(context.objects[0].fields).toBeDefined();
      expect(context.objects[0].fields.length).toBeGreaterThan(0);
    });

    it('should pass orgId through to graph service', async () => {
      await provider.getContext('get accounts', 'test-org');
      
      expect(mockGetAllObjects).toHaveBeenCalledWith({ orgId: 'test-org' });
    });
  });

  // ============================================================
  // Semantic Field Selection
  // ============================================================
  describe('Semantic Field Selection', () => {
    let provider;
    
    // Helper to generate many fields
    const generateFields = (count, prefix = 'Field') => {
      return Array.from({ length: count }, (_, i) => ({
        apiName: `${prefix}_${i}__c`,
        label: `${prefix} ${i}`,
        type: 'string'
      }));
    };

    beforeEach(() => {
      provider = new FuzzySchemaContextProvider();
      
      // Mock objects always return Account
      mockGetAllObjects.mockResolvedValue([
        { apiName: 'Account', label: 'Account' }
      ]);
    });

    it('should prioritize fields matching the query', async () => {
      // Setup: Create 30 dummy fields + 1 important "Revenue_Schedule__c" field
      const dummyFields = generateFields(30, 'Dummy');
      const targetField = { 
        apiName: 'Revenue_Schedule__c', 
        label: 'Revenue Schedule', 
        type: 'string',
        description: 'Schedule of revenue' 
      };
      
      mockGetObjectFields.mockResolvedValue([...dummyFields, targetField]);
      mockGetObjectRelationships.mockResolvedValue([]);
      mockGetChildRelationships.mockResolvedValue([]);

      // Act: Query specifically for "revenue schedule" on Account
      const context = await provider.getContext('show me revenue schedule for accounts');

      // Assert:
      const account = context.objects[0];
      const fieldNames = account.fields.map(f => f.apiName);
      
      // The target field should be present despite being "at the end" of the list originally
      // because it matches the query terms
      expect(fieldNames).toContain('Revenue_Schedule__c');
    });

    it('should exclude irrelevant fields when limit is reached', async () => {
      const dummyFields = generateFields(50, 'Irrelevant');
      mockGetObjectFields.mockResolvedValue(dummyFields);
      mockGetObjectRelationships.mockResolvedValue([]);
      
      const context = await provider.getContext('get accounts');
      
      const account = context.objects[0];
      // Should result in ~25 fields (5 default + 20 others)
      expect(account.fields.length).toBeLessThanOrEqual(30);
    });

    it('should always include default important fields (Id, Name)', async () => {
      const dummyFields = generateFields(10, 'Other');
      const defaults = [
        { apiName: 'Id', label: 'Id', type: 'id' },
        { apiName: 'Name', label: 'Name', type: 'string' }
      ];
      
      mockGetObjectFields.mockResolvedValue([...defaults, ...dummyFields]);
      mockGetObjectRelationships.mockResolvedValue([]);
      
      const context = await provider.getContext('get accounts');
      const fieldNames = context.objects[0].fields.map(f => f.apiName);
      
      expect(fieldNames).toContain('Id');
      expect(fieldNames).toContain('Name');
    });
    
    it('should fallback to default behavior with empty query', async () => {
      const dummyFields = generateFields(30, 'Field');
      mockGetObjectFields.mockResolvedValue(dummyFields);
      mockGetObjectRelationships.mockResolvedValue([]);
      
      // Empty query shouldn't crash
      const context = await provider.getContext('');
      // In our mock setup for this suite, we expect at least the account to be returned if unmatched?
      // Actually fuzzy selection logic returns empty if NO objects match.
      // So empty query -> empty extraction -> empty match.
      expect(context.objects).toEqual([]);
    });

    it('should prioritize partial matches', async () => {
       const fields = [
         { apiName: 'Alpha_Beta__c', label: 'Alpha Beta', type: 'string' },
         { apiName: 'Gamma_Delta__c', label: 'Gamma Delta', type: 'string' },
       ];
       // Add filler fields to force truncation
       const fillers = generateFields(30, 'Filler');
       
       mockGetObjectFields.mockResolvedValue([...fields, ...fillers]);
       mockGetObjectRelationships.mockResolvedValue([]);

       // Query matches 'alpha'
       const context = await provider.getContext('show accounts alpha');
       const fieldNames = context.objects[0].fields.map(f => f.apiName);
       
       expect(fieldNames).toContain('Alpha_Beta__c');
    });
  });

  // ============================================================
  // Dynamic Synonyms (Integration with DynamicSynonymService)
  // ============================================================
  describe('Dynamic Synonyms', () => {
    it('should use dynamic synonym service to find objects from query tokens', async () => {
      // Setup
      mockGetAllObjects.mockResolvedValue([
        { apiName: 'Account', label: 'Account' },
        { apiName: 'Contact', label: 'Contact' }
      ]);
      
      // Mock synonym service response
      mockFindObject.mockImplementation(async (term) => {
        if (term === 'clients') {
          return { apiName: 'Account', confidence: 0.85, source: 'dynamic' };
        }
        return null;
      });

      const terms = { entities: [], potentialValues: [] };
      const query = 'show me all clients';
      
      // Act
      const { objects } = await findMatchingObjects(terms, undefined, query);

      // Assert
      expect(mockFindObject).toHaveBeenCalledWith('clients', undefined);
      expect(objects).toHaveLength(1);
      expect(objects[0].object.apiName).toBe('Account');
    });

    it('should ignore stopwords', async () => {
        const terms = { entities: [], potentialValues: [] };
        const query = 'show me the clients from nyc';
        
        mockFindObject.mockResolvedValue(null);

        await findMatchingObjects(terms, undefined, query);

        // Expect 'show', 'clients', 'nyc' tested, but 'me', 'the', 'from' likely skipped if they are stopwords
        expect(mockFindObject).not.toHaveBeenCalledWith('the', expect.anything());
        expect(mockFindObject).not.toHaveBeenCalledWith('from', expect.anything());
    });
    
    it('should pass query to findMatchingObjects from Provider', async () => {
      const provider = new FuzzySchemaContextProvider();
      
      mockGetAllObjects.mockResolvedValue([{ apiName: 'TestObj', label: 'Test Label' }]);
      mockFindObject.mockImplementation(async (term) => {
        if (term === 'magicword') return { apiName: 'TestObj', confidence: 0.9 };
        return null;
      });
      mockGetObjectFields.mockResolvedValue([]);
      mockGetObjectRelationships.mockResolvedValue([]);
      mockGetChildRelationships.mockResolvedValue([]);

      const context = await provider.getContext('find magicword');
      
      expect(context.objects[0].apiName).toBe('TestObj');
    });
  });
});

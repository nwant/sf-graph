import { jest } from '@jest/globals';

// Mock the graph-service module with all required exports
const mockGetAllObjects = jest.fn();
const mockGetObjectFields = jest.fn();
const mockFindSoqlPaths = jest.fn();
const mockGetChildRelationships = jest.fn();
const mockGetObjectRelationships = jest.fn();
const mockGetObjectByApiName = jest.fn();

jest.unstable_mockModule('../../../dist/services/neo4j/graph-service.js', () => ({
  getAllObjects: mockGetAllObjects,
  getObjectFields: mockGetObjectFields,
  findSoqlPaths: mockFindSoqlPaths,
  getChildRelationships: mockGetChildRelationships,
  getObjectRelationships: mockGetObjectRelationships,
  getObjectByApiName: mockGetObjectByApiName,
  executeRead: jest.fn(),
  executeWrite: jest.fn(),
  getMetadataRelationships: jest.fn(),
  findObjectPaths: jest.fn(),
  findDetailedPaths: jest.fn(),
  findRelatedObjects: jest.fn(),
  getPicklistValues: jest.fn(),
  findObjectsByPicklistValue: jest.fn(),
  get1HopNeighborSummaries: jest.fn().mockResolvedValue([]),
}));

// Import functions under test after mocking
const { validateAndCorrectSoql } = await import('../../../dist/services/soql-validator.js');

describe('SOQL Validator Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mocks
    mockGetAllObjects.mockResolvedValue([
      { apiName: 'Account', label: 'Account' },
      { apiName: 'Contact', label: 'Contact' },
      { apiName: 'Opportunity', label: 'Opportunity' },
      { apiName: 'User', label: 'User' },
    ]);
    
    mockGetObjectFields.mockResolvedValue([
      { apiName: 'Id', label: 'Id', type: 'id' },
      { apiName: 'Name', label: 'Name', type: 'string' },
      { apiName: 'Email', label: 'Email', type: 'email' },
      { apiName: 'Phone', label: 'Phone', type: 'phone' },
      { apiName: 'CreatedDate', label: 'Created Date', type: 'datetime' },
    ]);
    
    mockFindSoqlPaths.mockResolvedValue({ recommendedPath: {} });
    mockFindSoqlPaths.mockResolvedValue({ recommendedPath: {} });
    mockGetChildRelationships.mockResolvedValue([]);
    mockGetObjectRelationships.mockResolvedValue([
      { relationshipName: 'Account', targetObject: 'Account', direction: 'outgoing' },
      { relationshipName: 'Owner', targetObject: 'User', direction: 'outgoing' }
    ]);
  });

  // ============================================================
  // Basic Parsing
  // ============================================================
  describe('Basic SOQL Parsing', () => {
    it('should validate a simple SELECT query', async () => {
      const result = await validateAndCorrectSoql('SELECT Id, Name FROM Account');
      
      expect(result.isValid).toBe(true);
      expect(result.parsed).toBeDefined();
      expect(result.parsed.mainObject).toBe('Account');
      expect(result.parsed.fields).toContain('Id');
      expect(result.parsed.fields).toContain('Name');
    });

    it('should parse WHERE clause', async () => {
      const result = await validateAndCorrectSoql("SELECT Id FROM Account WHERE Name = 'Test'");
      
      expect(result.isValid).toBe(true);
      expect(result.parsed.whereClause).toBe("Name = 'Test'");
    });

    it('should parse ORDER BY clause', async () => {
      const result = await validateAndCorrectSoql('SELECT Id FROM Account ORDER BY Name ASC');
      
      expect(result.isValid).toBe(true);
      expect(result.parsed.orderBy).toBe('Name ASC');
    });

    it('should parse LIMIT clause', async () => {
      const result = await validateAndCorrectSoql('SELECT Id FROM Account LIMIT 10');
      
      expect(result.isValid).toBe(true);
      expect(result.parsed.limit).toBe(10);
    });

    it('should return error for unparseable SOQL', async () => {
      const result = await validateAndCorrectSoql('this is not soql');
      
      expect(result.isValid).toBe(false);
      expect(result.messages.some(m => m.type === 'error')).toBe(true);
    });
  });

  // ============================================================
  // Object Validation
  // ============================================================
  describe('Object Validation', () => {
    it('should validate existing object', async () => {
      const result = await validateAndCorrectSoql('SELECT Id FROM Account');
      
      expect(result.isValid).toBe(true);
      expect(result.parsed.mainObject).toBe('Account');
    });

    it('should correct object case', async () => {
      const result = await validateAndCorrectSoql('SELECT Id FROM account');
      
      expect(result.wasCorrected).toBe(true);
      expect(result.soql).toContain('FROM Account');
    });

    it('should return error for unknown object with no match', async () => {
      mockGetAllObjects.mockResolvedValue([
        { apiName: 'Account', label: 'Account' },
      ]);
      
      const result = await validateAndCorrectSoql('SELECT Id FROM XyzUnknown');
      
      expect(result.isValid).toBe(false);
      expect(result.messages.some(m => m.type === 'error')).toBe(true);
    });

    it('should suggest correction for typo in object name', async () => {
      const result = await validateAndCorrectSoql('SELECT Id FROM Accont');
      
      // Should find 'Account' as a suggestion (Levenshtein distance <= 3)
      expect(result.wasCorrected).toBe(true);
      expect(result.messages.some(m => 
        m.type === 'correction' && m.corrected === 'Account'
      )).toBe(true);
    });
  });

  // ============================================================
  // Field Validation
  // ============================================================
  describe('Field Validation', () => {
    it('should validate existing fields', async () => {
      const result = await validateAndCorrectSoql('SELECT Id, Name, Email FROM Account');
      
      expect(result.isValid).toBe(true);
      expect(result.parsed.fields).toContain('Id');
      expect(result.parsed.fields).toContain('Name');
      expect(result.parsed.fields).toContain('Email');
    });

    it('should warn about unknown field', async () => {
      const result = await validateAndCorrectSoql('SELECT Id, UnknownField FROM Account');
      
      expect(result.messages.some(m => 
        m.type === 'error' && m.message.includes('UnknownField')
      )).toBe(true);
    });

    it('should correct field case', async () => {
      const result = await validateAndCorrectSoql('SELECT id, name FROM Account');
      
      expect(result.wasCorrected).toBe(true);
      expect(result.soql).toContain('Id');
      expect(result.soql).toContain('Name');
    });

    it('should suggest correction for typo in field name', async () => {
      const result = await validateAndCorrectSoql('SELECT Id, Nme FROM Account');
      
      // Should find 'Name' as a suggestion
      expect(result.wasCorrected).toBe(true);
      expect(result.messages.some(m => 
        m.type === 'correction' && m.corrected === 'Name'
      )).toBe(true);
    });
  });



  // ============================================================
  // Parent Lookup Parsing
  // ============================================================
  describe('Parent Lookup Parsing', () => {
    beforeEach(() => {
      // Add lookup field to mock
      mockGetObjectFields.mockImplementation((objectName) => {
        if (objectName === 'Account') {
          return Promise.resolve([
            { apiName: 'Id', label: 'Id', type: 'id' },
            { apiName: 'Name', label: 'Name', type: 'string' },
          ]);
        }
        if (objectName === 'Contact') {
          return Promise.resolve([
            { apiName: 'Id', label: 'Id', type: 'id' },
            { apiName: 'Name', label: 'Name', type: 'string' },
            { apiName: 'FirstName', label: 'First Name', type: 'string' },
            { apiName: 'AccountId', label: 'Account', type: 'reference' },
          ]);
        }
        return Promise.resolve([]);
      });
    });

    it('should parse parent lookup with dot notation', async () => {
      const soql = 'SELECT Id, Account.Name FROM Contact';
      const result = await validateAndCorrectSoql(soql);
      
      expect(result.isValid).toBe(true);
      expect(result.parsed.fields).toContain('Id');
      expect(result.parsed.fields).toContain('Account.Name');
    });

    it('should validate parent relationships using getObjectRelationships (e.g. Owner.Email)', async () => {
      // Mock relationships specifically for this test
      mockGetObjectRelationships.mockResolvedValue([
        { relationshipName: 'Owner', targetObject: 'User', direction: 'outgoing' }
      ]);
      mockGetObjectFields.mockResolvedValue([
         // User fields
         { apiName: 'Email', label: 'Email', type: 'email' }
      ]);
      
      const result = await validateAndCorrectSoql('SELECT Owner.Email FROM Opportunity');
      
      expect(result.isValid).toBe(true);
      expect(result.messages.some(m => m.type === 'error')).toBe(false);
    });
  });

  // ============================================================
  // Multi-org Support
  // ============================================================
  describe('Multi-org Support', () => {
    it('should pass orgId to graph service calls', async () => {
      await validateAndCorrectSoql('SELECT Id FROM Account', 'test-org-id');
      
      expect(mockGetAllObjects).toHaveBeenCalledWith({ orgId: 'test-org-id' });
      expect(mockGetObjectFields).toHaveBeenCalledWith('Account', { orgId: 'test-org-id' });
    });
  });

  // ============================================================
  // ID Literal Validation (Hallucination Prevention)
  // ============================================================
  describe('ID Literal Validation', () => {
    it('should fail when using 15-char ID literal for OwnerId', async () => {
      const soql = "SELECT Id FROM Opportunity WHERE OwnerId = '005abcde1234567'";
      const result = await validateAndCorrectSoql(soql);
      
      expect(result.isValid).toBe(false);
      expect(result.messages.some(m => m.type === 'error' && m.message.includes('Found ID literal'))).toBe(true);
    });

    it('should fail when using messy placeholder IDs', async () => {
      const soql = "SELECT Id FROM Case WHERE OwnerId = '005... John Doe ID (15-char ID)'";
      const result = await validateAndCorrectSoql(soql);
      
      expect(result.isValid).toBe(false);
      expect(result.messages.some(m => m.type === 'error' && m.message.includes('Found ID literal'))).toBe(true);
    });

    it('should fail on multiline IS NOT EMPTY', async () => {
      const soql = `SELECT Id FROM Case WHERE (SELECT Id 
        FROM CaseTeamMember 
        WHERE UserId = '005abc...') is not empty`;
      
      const result = await validateAndCorrectSoql(soql);
      // We explicitly want this to FAIL validation now, rather than try to auto-correct and fail silently
      expect(result.isValid).toBe(false); 
      expect(result.messages.some(m => m.type === 'error' && m.message.includes('IS NOT EMPTY'))).toBe(true);
    });

    it('should fail when using 18-char ID literal for AccountId', async () => {
      const soql = "SELECT Id FROM Contact WHERE AccountId = '001abcde1234567AAA'";
      const result = await validateAndCorrectSoql(soql);
      
      expect(result.isValid).toBe(false);
      expect(result.messages.some(m => m.type === 'error' && m.message.includes('Found ID literal'))).toBe(true);
    });

    it('should allow Name filters', async () => {
      const soql = "SELECT Id FROM Opportunity WHERE Owner.Name LIKE 'Nathan%'";
      const result = await validateAndCorrectSoql(soql);
      
      expect(result.isValid).toBe(true);
    });

    it('should allow semi-joins', async () => {
      const soql = "SELECT Id FROM Opportunity WHERE OwnerId IN (SELECT Id FROM User WHERE Name = 'Nathan')";
      const result = await validateAndCorrectSoql(soql);
      
      expect(result.isValid).toBe(true);
    });
  });

  // ============================================================
  // Error Handling
  // ============================================================
  describe('Error Handling', () => {
    it('should handle graph service errors gracefully', async () => {
      mockGetAllObjects.mockRejectedValue(new Error('DB connection failed'));
      
      const result = await validateAndCorrectSoql('SELECT Id FROM Account');
      
      expect(result.isValid).toBe(false);
      expect(result.messages.some(m => m.type === 'error')).toBe(true);
    });
  });
});

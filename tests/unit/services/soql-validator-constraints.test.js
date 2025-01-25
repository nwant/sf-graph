import { jest } from '@jest/globals';

// Mock the graph-service module
const mockGetAllObjects = jest.fn();
const mockGetObjectFields = jest.fn();
const mockGetObjectRelationships = jest.fn();

jest.unstable_mockModule('../../../dist/services/neo4j/graph-service.js', () => ({
  getAllObjects: mockGetAllObjects,
  getObjectFields: mockGetObjectFields,
  getObjectRelationships: mockGetObjectRelationships,
  getChildRelationships: jest.fn(),
  getObjectByApiName: jest.fn(),
  findSoqlPaths: jest.fn().mockResolvedValue({ recommendedPath: {} }),
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
const { checkToolingApiConstraints, TOOLING_API_OBJECTS } = await import('../../../dist/services/soql/tooling-constraints.js');
const { checkGovernorLimits, DEFAULT_LIMIT, applySuggestedLimit } = await import('../../../dist/services/soql/governor-limits.js');
const { parseSoqlToAst } = await import('../../../dist/services/soql-ast-parser.js');

describe('SOQL Validator Constraints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mocks for standard objects
    mockGetAllObjects.mockResolvedValue([
      { apiName: 'Account', label: 'Account' },
      { apiName: 'Contact', label: 'Contact' },
      { apiName: 'Opportunity', label: 'Opportunity' },
      { apiName: 'EntityDefinition', label: 'Entity Definition' },
      { apiName: 'FieldDefinition', label: 'Field Definition' },
    ]);
    
    mockGetObjectFields.mockResolvedValue([
      { apiName: 'Id', label: 'Id', type: 'id' },
      { apiName: 'Name', label: 'Name', type: 'string' },
      { apiName: 'QualifiedApiName', label: 'Qualified API Name', type: 'string' },
      { apiName: 'KeyPrefix', label: 'Key Prefix', type: 'string' },
    ]);

    mockGetObjectRelationships.mockResolvedValue([]);
  });

  // ============================================================
  // Tooling API Constraints
  // ============================================================
  describe('Tooling API Constraints', () => {
    describe('TOOLING_API_OBJECTS constant', () => {
      it('should include EntityDefinition', () => {
        expect(TOOLING_API_OBJECTS.has('EntityDefinition')).toBe(true);
      });

      it('should include FieldDefinition', () => {
        expect(TOOLING_API_OBJECTS.has('FieldDefinition')).toBe(true);
      });

      it('should not include standard objects', () => {
        expect(TOOLING_API_OBJECTS.has('Account')).toBe(false);
        expect(TOOLING_API_OBJECTS.has('Contact')).toBe(false);
      });
    });

    describe('checkToolingApiConstraints()', () => {
      it('should skip constraints for standard objects', () => {
        const ast = parseSoqlToAst('SELECT COUNT() FROM Account');
        const messages = checkToolingApiConstraints(ast, 'Account');
        expect(messages).toEqual([]);
      });

      it('should reject COUNT() on EntityDefinition', () => {
        const ast = parseSoqlToAst('SELECT COUNT() FROM EntityDefinition');
        const messages = checkToolingApiConstraints(ast, 'EntityDefinition');
        
        expect(messages.length).toBe(1);
        expect(messages[0].type).toBe('error');
        expect(messages[0].message).toContain('COUNT()');
      });

      it('should reject GROUP BY on EntityDefinition', () => {
        const ast = parseSoqlToAst('SELECT QualifiedApiName FROM EntityDefinition GROUP BY QualifiedApiName');
        const messages = checkToolingApiConstraints(ast, 'EntityDefinition');
        
        expect(messages.some(m => m.message.includes('GROUP BY'))).toBe(true);
      });

      it('should reject LIMIT on FieldDefinition', () => {
        const ast = parseSoqlToAst('SELECT QualifiedApiName FROM FieldDefinition LIMIT 100');
        const messages = checkToolingApiConstraints(ast, 'FieldDefinition');
        
        expect(messages.some(m => m.message.includes('LIMIT'))).toBe(true);
      });

      it('should reject OFFSET on EntityDefinition', () => {
        const ast = parseSoqlToAst('SELECT QualifiedApiName FROM EntityDefinition OFFSET 10');
        const messages = checkToolingApiConstraints(ast, 'EntityDefinition');
        
        expect(messages.some(m => m.message.includes('OFFSET'))).toBe(true);
      });

      it('should reject OR in WHERE on EntityDefinition', () => {
        const ast = parseSoqlToAst("SELECT QualifiedApiName FROM EntityDefinition WHERE KeyPrefix = '001' OR KeyPrefix = '003'");
        const messages = checkToolingApiConstraints(ast, 'EntityDefinition');
        
        expect(messages.some(m => m.message.includes('OR'))).toBe(true);
      });

      it('should reject != operator on EntityDefinition', () => {
        const ast = parseSoqlToAst("SELECT QualifiedApiName FROM EntityDefinition WHERE KeyPrefix != 'ABC'");
        const messages = checkToolingApiConstraints(ast, 'EntityDefinition');
        
        expect(messages.some(m => m.message.includes('Not-equals'))).toBe(true);
      });

      it('should allow valid EntityDefinition query', () => {
        const ast = parseSoqlToAst("SELECT QualifiedApiName FROM EntityDefinition WHERE KeyPrefix = '001'");
        const messages = checkToolingApiConstraints(ast, 'EntityDefinition');
        
        expect(messages).toEqual([]);
      });
    });

    describe('Integration with validateAndCorrectSoql()', () => {
      it('should reject COUNT() on EntityDefinition via main validator', async () => {
        const result = await validateAndCorrectSoql('SELECT COUNT() FROM EntityDefinition');
        
        expect(result.isValid).toBe(false);
        expect(result.messages.some(m => m.message.includes('COUNT()'))).toBe(true);
      });

      it('should reject LIMIT on EntityDefinition via main validator', async () => {
        const result = await validateAndCorrectSoql('SELECT QualifiedApiName FROM EntityDefinition LIMIT 100');
        
        expect(result.isValid).toBe(false);
        expect(result.messages.some(m => m.message.includes('LIMIT'))).toBe(true);
      });
    });
  });

  // ============================================================
  // Governor Limit Protections
  // ============================================================
  describe('Governor Limit Protections', () => {
    describe('checkGovernorLimits()', () => {
      it('should warn about leading wildcards', () => {
        const ast = parseSoqlToAst("SELECT Id FROM Account WHERE Name LIKE '%test%'");
        const result = checkGovernorLimits(ast, 'Account');
        
        expect(result.messages.some(m => 
          m.type === 'warning' && m.message.includes('Leading wildcard')
        )).toBe(true);
      });

      it('should NOT warn about trailing wildcards', () => {
        const ast = parseSoqlToAst("SELECT Id FROM Account WHERE Name LIKE 'test%'");
        const result = checkGovernorLimits(ast, 'Account');
        
        expect(result.messages.filter(m => m.message.includes('wildcard'))).toEqual([]);
      });

      it('should suggest LIMIT when missing for standard objects', () => {
        const ast = parseSoqlToAst('SELECT Id FROM Account');
        const result = checkGovernorLimits(ast, 'Account');
        
        expect(result.suggestedLimit).toBe(DEFAULT_LIMIT);
        expect(result.messages.some(m => 
          m.type === 'correction' && m.message.includes('LIMIT')
        )).toBe(true);
      });

      it('should NOT suggest LIMIT for queries that already have one', () => {
        const ast = parseSoqlToAst('SELECT Id FROM Account LIMIT 50');
        const result = checkGovernorLimits(ast, 'Account');
        
        expect(result.suggestedLimit).toBeUndefined();
      });

      it('should skip auto-LIMIT for EntityDefinition (Tooling API)', () => {
        const ast = parseSoqlToAst('SELECT QualifiedApiName FROM EntityDefinition');
        const result = checkGovernorLimits(ast, 'EntityDefinition');
        
        // Should NOT suggest adding LIMIT (since LIMIT is forbidden for Tooling API)
        expect(result.suggestedLimit).toBeUndefined();
      });

      it('should still warn about wildcards on EntityDefinition', () => {
        const ast = parseSoqlToAst("SELECT QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName LIKE '%Account%'");
        const result = checkGovernorLimits(ast, 'EntityDefinition');
        
        expect(result.messages.some(m => m.message.includes('wildcard'))).toBe(true);
        expect(result.suggestedLimit).toBeUndefined();
      });
    });

    describe('applySuggestedLimit()', () => {
      it('should append LIMIT to query', () => {
        const result = applySuggestedLimit('SELECT Id FROM Account', 1000);
        expect(result).toBe('SELECT Id FROM Account LIMIT 1000');
      });

      it('should not double-add LIMIT', () => {
        const result = applySuggestedLimit('SELECT Id FROM Account LIMIT 100', 1000);
        expect(result).toBe('SELECT Id FROM Account LIMIT 100');
      });
    });

    describe('Integration with validateAndCorrectSoql()', () => {
      it('should auto-add LIMIT for standard objects', async () => {
        const result = await validateAndCorrectSoql('SELECT Id FROM Account');
        
        expect(result.isValid).toBe(true);
        expect(result.wasCorrected).toBe(true);
        expect(result.soql).toContain('LIMIT 1000');
        expect(result.parsed.limit).toBe(1000);
      });

      it('should NOT auto-add LIMIT for EntityDefinition', async () => {
        const result = await validateAndCorrectSoql("SELECT QualifiedApiName FROM EntityDefinition WHERE KeyPrefix = '001'");
        
        // Should fail because EntityDefinition is not in the mocked allObjects or pass without LIMIT
        // Since we mock EntityDefinition, it should pass validation but NOT add LIMIT
        expect(result.soql).not.toContain('LIMIT');
      });

      it('should warn about leading wildcard but still be valid', async () => {
        const result = await validateAndCorrectSoql("SELECT Id FROM Account WHERE Name LIKE '%test%'");
        
        expect(result.isValid).toBe(true);
        expect(result.messages.some(m => 
          m.type === 'warning' && m.message.includes('wildcard')
        )).toBe(true);
      });
    });
  });

  // ============================================================
  // DEFAULT_LIMIT constant
  // ============================================================
  describe('DEFAULT_LIMIT constant', () => {
    it('should be 1000', () => {
      expect(DEFAULT_LIMIT).toBe(1000);
    });
  });
});

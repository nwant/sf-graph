
import { describe, test, expect, jest, beforeAll } from '@jest/globals';

// Define mock factory
const mockGraphService = {
  getAllObjects: jest.fn().mockResolvedValue([
    { apiName: 'Account' },
    { apiName: 'Contact' },
    { apiName: 'Opportunity' },
    { apiName: 'Case' }
  ]),
  getObjectFields: jest.fn().mockResolvedValue([
    { apiName: 'Name', type: 'string' },
    { apiName: 'Id', type: 'id' },
    { apiName: 'AccountId', type: 'reference' },
    { apiName: 'StageName', type: 'picklist' },
    { apiName: 'Amount', type: 'currency' },
    { apiName: 'CreatedDate', type: 'datetime' },
    { apiName: 'Quantity', type: 'double' }
  ]),
  getObjectRelationships: jest.fn().mockResolvedValue([
    { relationshipName: 'Account', fieldApiName: 'AccountId', referenceTo: ['Account'], direction: 'outgoing' }
  ]),
  getChildRelationships: jest.fn().mockResolvedValue([]),
  getPicklistValues: jest.fn().mockResolvedValue([]),
  getObjectByApiName: jest.fn().mockResolvedValue({ apiName: 'Account' }),
  findObjectsByPicklistValue: jest.fn().mockResolvedValue([]),
  // Add other missing exports to satisfy ESM import requirements
  executeRead: jest.fn(),
  executeWrite: jest.fn(),
  getMetadataRelationships: jest.fn().mockResolvedValue([]),
  findObjectPaths: jest.fn().mockResolvedValue([]),
  findRelatedObjects: jest.fn().mockResolvedValue({}),
  findDetailedPaths: jest.fn().mockResolvedValue({}),
  findSoqlPaths: jest.fn().mockResolvedValue({}),
  get1HopNeighborSummaries: jest.fn().mockResolvedValue([])
};

// Mock the dependency using unstable_mockModule BEFORE importing the module under test
await jest.unstable_mockModule('../../../dist/services/neo4j/graph-service.js', () => mockGraphService);

// Dynamically import the module under test
const { validateAndCorrectSoqlEnhanced } = await import('../../../dist/services/soql-validator.js');

describe('SOQL Aggregate Validation', () => {
  
  test('should pass for valid GROUP BY query', async () => {
    const query = "SELECT Name, COUNT(Id) FROM Account GROUP BY Name";
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.isValid).toBe(true);
    expect(result.messages.filter(m => m.type === 'error')).toHaveLength(0);
  });

  test('should pass for aggregate-only query (implicit group by)', async () => {
    const query = "SELECT COUNT(Id) FROM Account";
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.isValid).toBe(true);
    expect(result.messages.filter(m => m.type === 'error')).toHaveLength(0);
  });

  test('should fail when non-aggregated field is missing from GROUP BY', async () => {
    const query = "SELECT Name, COUNT(Id) FROM Account";
    const result = await validateAndCorrectSoqlEnhanced(query);
    
    // We expect error messages about grouping
    const errors = result.messages.filter(m => m.type === 'error' && m.message.toLowerCase().includes('not present in the group by'));
    expect(errors.length).toBeGreaterThan(0);
    // Normalized signature is lowercase
    expect(errors[0].message.toLowerCase()).toContain('field \'name\' is selected but not present');
    
    // Also verify isValid is false if any errors are present
    expect(result.isValid).toBe(false);
  });

  test('should handle parent lookups in GROUP BY', async () => {
    const query = "SELECT Account.Name, COUNT(Id) FROM Contact GROUP BY Account.Name";
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.isValid).toBe(true);
    expect(result.messages.filter(m => m.type === 'error')).toHaveLength(0);
  });

  test('should fail when parent lookup is missing from GROUP BY', async () => {
    const query = "SELECT Account.Name, COUNT(Id) FROM Contact";
    const result = await validateAndCorrectSoqlEnhanced(query);
    const errors = result.messages.filter(m => m.type === 'error' && m.message.toLowerCase().includes('not present in the group by'));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message.toLowerCase()).toContain('field \'account.name\' is selected but not present');
  });

  test('should pass for COUNT(DISTINCT)', async () => {
    const query = "SELECT Name, COUNT_DISTINCT(Id) FROM Account GROUP BY Name";
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.messages.filter(m => m.type === 'error')).toHaveLength(0);
  });
  
  test('should pass for simple valid query without aggregates', async () => {
    const query = "SELECT Name FROM Account";
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.isValid).toBe(true);
    expect(result.messages.filter(m => m.type === 'error')).toHaveLength(0);
  });
  test('Valid query with alias and aggregates', async () => {
    const query = 'SELECT Name n, COUNT(Id) FROM Account GROUP BY Name';
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.isValid).toBe(true);
    const aggErrors = result.messages.filter(m => m.message.includes('not present in the GROUP BY'));
    expect(aggErrors).toHaveLength(0);
  });

  test('Valid query with alias in GROUP BY', async () => {
    const query = 'SELECT Name n, COUNT(Id) FROM Account GROUP BY Name';
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.isValid).toBe(true);
  });

  test('Valid query with transparent wrapper in SELECT', async () => {
    const query = 'SELECT toLabel(StageName), COUNT(Id) FROM Opportunity GROUP BY StageName';
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.isValid).toBe(true);
    const aggErrors = result.messages.filter(m => m.message.includes('not present in the GROUP BY'));
    expect(aggErrors).toHaveLength(0);
  });

  test('Valid query with transparent wrapper convertCurrency', async () => {
    const query = 'SELECT convertCurrency(Amount), SUM(Quantity) FROM Opportunity GROUP BY Amount';
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.isValid).toBe(true);
  });

  test('Valid query with Date Function in both SELECT and GROUP BY', async () => {
    const query = 'SELECT CALENDAR_YEAR(CreatedDate), COUNT(Id) FROM Account GROUP BY CALENDAR_YEAR(CreatedDate)';
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.isValid).toBe(true);
  });

  test('Invalid query: Date Function in SELECT but missing in GROUP BY', async () => {
    const query = 'SELECT CALENDAR_YEAR(CreatedDate), COUNT(Id) FROM Account GROUP BY CreatedDate';
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.isValid).toBe(false);
    // Loose check to ensure we catch "not present in the GROUP BY"
    expect(result.messages.some(m => m.message.toLowerCase().includes('not present in the group by'))).toBe(true);
  });

  test('Invalid query: TYPEOF used with aggregates', async () => {
    const query = 'SELECT TYPEOF Owner WHEN User THEN Username END, COUNT(Id) FROM Case';
    const result = await validateAndCorrectSoqlEnhanced(query);
    expect(result.isValid).toBe(false);
    expect(result.messages.some(m => m.message.includes('TYPEOF clauses cannot be used with aggregate functions'))).toBe(true);
  });
});

import { describe, it, expect } from '@jest/globals';

// Import the AST parser
import { 
  parseSoqlToAst, 
  isValidSoqlSyntax,
  extractWhereComparisons,
  extractSemiJoins,
  formatSoqlQuery 
} from '../../../dist/services/soql-ast-parser.js';

describe('SOQL AST Parser', () => {
  
  describe('parseSoqlToAst', () => {
    it('should parse a simple SELECT query', () => {
      const ast = parseSoqlToAst('SELECT Id, Name FROM Account');
      
      expect(ast).not.toBeNull();
      expect(ast.mainObject).toBe('Account');
      expect(ast.fields.length).toBe(2);
      expect(ast.fields.map(f => f.name)).toContain('Id');
      expect(ast.fields.map(f => f.name)).toContain('Name');
    });

    it('should parse COUNT(*) aggregate', () => {
      const ast = parseSoqlToAst('SELECT COUNT() FROM Account');
      
      expect(ast).not.toBeNull();
      expect(ast.aggregates.length).toBeGreaterThan(0);
      expect(ast.aggregates[0].fn).toBe('COUNT');
    });

    it('should parse COUNT(Id) aggregate', () => {
      const ast = parseSoqlToAst('SELECT COUNT(Id) FROM Account');
      
      expect(ast).not.toBeNull();
      expect(ast.aggregates.length).toBeGreaterThan(0);
      expect(ast.aggregates[0].fn).toBe('COUNT');
    });

    it('should parse SUM aggregate', () => {
      const ast = parseSoqlToAst('SELECT SUM(Amount) FROM Opportunity');
      
      expect(ast).not.toBeNull();
      expect(ast.aggregates.length).toBeGreaterThan(0);
      expect(ast.aggregates[0].fn).toBe('SUM');
    });

    it('should parse GROUP BY clause', () => {
      const ast = parseSoqlToAst('SELECT StageName, COUNT(Id) FROM Opportunity GROUP BY StageName');
      
      expect(ast).not.toBeNull();
      expect(ast.groupBy).toBeDefined();
      expect(ast.groupBy).toContain('StageName');
    });

    it('should parse parent lookups (dot notation)', () => {
      const ast = parseSoqlToAst('SELECT Id, Account.Name FROM Contact');
      
      expect(ast).not.toBeNull();
      expect(ast.parentLookups.length).toBe(1);
      expect(ast.parentLookups[0].path).toBe('Account');
      expect(ast.parentLookups[0].field).toBe('Name');
    });

    it('should parse child subqueries', () => {
      const ast = parseSoqlToAst('SELECT Id, (SELECT Id FROM Contacts) FROM Account');
      
      expect(ast).not.toBeNull();
      expect(ast.subqueries.length).toBe(1);
      expect(ast.subqueries[0].relationshipName).toBe('Contacts');
    });

    it('should parse LIMIT and OFFSET', () => {
      const ast = parseSoqlToAst('SELECT Id FROM Account LIMIT 10 OFFSET 5');
      
      expect(ast).not.toBeNull();
      expect(ast.limit).toBe(10);
      expect(ast.offset).toBe(5);
    });

    it('should return null for invalid SOQL', () => {
      const ast = parseSoqlToAst('INVALID QUERY');
      expect(ast).toBeNull();
    });
  });

  describe('isValidSoqlSyntax', () => {
    it('should return true for valid SOQL', () => {
      expect(isValidSoqlSyntax('SELECT Id FROM Account')).toBe(true);
    });

    it('should return false for invalid SOQL', () => {
      expect(isValidSoqlSyntax('INVALID')).toBe(false);
    });
  });

  describe('extractWhereComparisons', () => {
    it('should extract simple equality', () => {
      const ast = parseSoqlToAst("SELECT Id FROM Account WHERE Status = 'Active'");
      const comparisons = extractWhereComparisons(ast?.whereClause);
      
      expect(comparisons.length).toBe(1);
      expect(comparisons[0].field).toBe('Status');
      expect(comparisons[0].operator).toBe('=');
      expect(comparisons[0].value).toBe('Active');
    });

    it('should extract IN list values individually', () => {
      const ast = parseSoqlToAst("SELECT Id FROM Case WHERE Status IN ('New', 'Open', 'Closed')");
      const comparisons = extractWhereComparisons(ast?.whereClause);
      
      expect(comparisons.length).toBe(3);
      expect(comparisons.map(c => c.value)).toContain('New');
      expect(comparisons.map(c => c.value)).toContain('Open');
      expect(comparisons.map(c => c.value)).toContain('Closed');
    });

    it('should handle AND conditions', () => {
      const ast = parseSoqlToAst("SELECT Id FROM Case WHERE Status = 'Open' AND Priority = 'High'");
      const comparisons = extractWhereComparisons(ast?.whereClause);
      
      expect(comparisons.length).toBe(2);
      expect(comparisons.find(c => c.field === 'Status')).toBeDefined();
      expect(comparisons.find(c => c.field === 'Priority')).toBeDefined();
    });

    it('should handle nested AND/OR conditions', () => {
      const ast = parseSoqlToAst("SELECT Id FROM Case WHERE (Status = 'Open' OR Status = 'New') AND Priority = 'High'");
      const comparisons = extractWhereComparisons(ast?.whereClause);
      
      expect(comparisons.length).toBe(3);
    });

    it('should handle parent field lookups in WHERE', () => {
      const ast = parseSoqlToAst("SELECT Id FROM Contact WHERE Account.Name = 'Acme'");
      const comparisons = extractWhereComparisons(ast?.whereClause);
      
      expect(comparisons.length).toBe(1);
      expect(comparisons[0].field).toContain('Account');
    });
  });

  describe('extractSemiJoins', () => {
    it('should extract semi-join with IN subquery', () => {
      const ast = parseSoqlToAst('SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact)');
      const semiJoins = extractSemiJoins(ast?.whereClause);
      
      expect(semiJoins.length).toBe(1);
      expect(semiJoins[0].operator).toBe('IN');
      expect(semiJoins[0].subquery.sObject).toBe('Contact');
      expect(semiJoins[0].subquery.field).toBe('AccountId');
    });

    it('should extract semi-join with NOT IN subquery', () => {
      const ast = parseSoqlToAst('SELECT Id FROM Account WHERE Id NOT IN (SELECT AccountId FROM Contact)');
      const semiJoins = extractSemiJoins(ast?.whereClause);
      
      expect(semiJoins.length).toBe(1);
      expect(semiJoins[0].operator).toBe('NOT IN');
    });

    it('should return empty array when no semi-joins exist', () => {
      const ast = parseSoqlToAst("SELECT Id FROM Account WHERE Name = 'Test'");
      const semiJoins = extractSemiJoins(ast?.whereClause);
      
      expect(semiJoins).toEqual([]);
    });
  });

  describe('formatSoqlQuery', () => {
    it('should format a SOQL query', () => {
      const formatted = formatSoqlQuery('SELECT Id,Name FROM Account WHERE Id=\'123\'');
      
      expect(formatted).toContain('SELECT');
      expect(formatted).toContain('FROM');
    });

    it('should return original on invalid SOQL', () => {
      const invalid = 'INVALID';
      expect(formatSoqlQuery(invalid)).toBe(invalid);
    });
  });
});

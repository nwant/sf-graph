import { expect } from 'expect';
import { parseQuery } from '@jetstreamapp/soql-parser-js';

// Import the AST mutation functions
const {
  mutateMainObject,
  mutateFieldInSelect,
  mutateParentLookupPath,
  mutateWhereClauseField,
  mutateSubqueryField,
  recomposeQuery,
} = await import('../../../dist/services/soql/ast-mutations.js');

describe('AST Mutations', () => {
  describe('mutateMainObject', () => {
    it('should mutate sObject name', () => {
      const query = parseQuery('SELECT Id FROM Account');
      const result = mutateMainObject(query, 'Contact');
      expect(result).toBe(true);
      expect(query.sObject).toBe('Contact');
    });

    it('should return false if no change needed', () => {
      const query = parseQuery('SELECT Id FROM Account');
      const result = mutateMainObject(query, 'Account');
      expect(result).toBe(false);
    });

    it('should work with complex queries', () => {
      const query = parseQuery(
        "SELECT Id, Name FROM Account WHERE Type = 'Customer' ORDER BY Name LIMIT 10"
      );
      mutateMainObject(query, 'Contact');
      const result = recomposeQuery(query);
      expect(result).toContain('FROM Contact');
      expect(result).toContain('ORDER BY');
      expect(result).toContain('LIMIT 10');
    });
  });

  describe('mutateFieldInSelect', () => {
    it('should mutate simple field', () => {
      const query = parseQuery('SELECT Namee FROM Account');
      const result = mutateFieldInSelect(query, 'Namee', 'Name');
      expect(result).toBe(true);
      expect(recomposeQuery(query)).toMatch(/SELECT\s+Name\s+FROM/i);
    });

    it('should return false if field not found', () => {
      const query = parseQuery('SELECT Id FROM Account');
      const result = mutateFieldInSelect(query, 'NonExistent', 'Name');
      expect(result).toBe(false);
    });

    it('should handle type metamorphosis: Field -> FieldRelationship', () => {
      const query = parseQuery('SELECT AccountId FROM Contact');
      mutateFieldInSelect(query, 'AccountId', 'Account.Name');
      const result = recomposeQuery(query);
      expect(result).toContain('Account.Name');
    });

    it('should handle type metamorphosis: FieldRelationship -> Field', () => {
      const query = parseQuery('SELECT Account.Name FROM Contact');
      mutateFieldInSelect(query, 'Account.Name', 'FirstName');
      const result = recomposeQuery(query);
      expect(result).toContain('FirstName');
      expect(result).not.toContain('Account.Name');
    });

    it('should preserve alias when mutating', () => {
      const query = parseQuery('SELECT Name n FROM Account');
      mutateFieldInSelect(query, 'Name', 'FirstName');
      const result = recomposeQuery(query);
      // Check the field was renamed and alias preserved
      expect(result).toMatch(/FirstName\s+n/i);
    });

    it('should be case-insensitive', () => {
      const query = parseQuery('SELECT name FROM Account');
      const result = mutateFieldInSelect(query, 'NAME', 'Id');
      expect(result).toBe(true);
      expect(recomposeQuery(query)).toMatch(/SELECT\s+Id\s+FROM/i);
    });
  });

  describe('mutateParentLookupPath', () => {
    it('should correct terminal field in relationship path', () => {
      const query = parseQuery('SELECT Account.Namee FROM Contact');
      mutateParentLookupPath(query, 'Account.Namee', 'Account.Name');
      const result = recomposeQuery(query);
      expect(result).toContain('Account.Name');
    });

    it('should correct relationship name in path', () => {
      const query = parseQuery('SELECT Accountt.Name FROM Contact');
      mutateParentLookupPath(query, 'Accountt.Name', 'Account.Name');
      const result = recomposeQuery(query);
      expect(result).toContain('Account.Name');
    });

    it('should handle multi-level lookups', () => {
      const query = parseQuery('SELECT Owner.Manager.Namee FROM Account');
      mutateParentLookupPath(query, 'Owner.Manager.Namee', 'Owner.Manager.Name');
      const result = recomposeQuery(query);
      expect(result).toContain('Owner.Manager.Name');
    });

    it('should handle correction of middle relationship', () => {
      const query = parseQuery('SELECT Owner.Managerr.Name FROM Account');
      mutateParentLookupPath(query, 'Owner.Managerr.Name', 'Owner.Manager.Name');
      const result = recomposeQuery(query);
      expect(result).toContain('Owner.Manager.Name');
    });
  });

  describe('mutateWhereClauseField', () => {
    it('should mutate field in simple WHERE', () => {
      const query = parseQuery("SELECT Id FROM Account WHERE Namee = 'Test'");
      const result = mutateWhereClauseField(query.where, 'Namee', 'Name');
      expect(result).toBe(true);
      const soql = recomposeQuery(query);
      expect(soql).toContain("Name = 'Test'");
    });

    it('should return false when no match found', () => {
      const query = parseQuery("SELECT Id FROM Account WHERE Name = 'Test'");
      const result = mutateWhereClauseField(query.where, 'NonExistent', 'Name');
      expect(result).toBe(false);
    });

    it('should return false for undefined WHERE', () => {
      const result = mutateWhereClauseField(undefined, 'Name', 'Id');
      expect(result).toBe(false);
    });

    it('should mutate field in AND condition', () => {
      const query = parseQuery(
        "SELECT Id FROM Account WHERE Namee = 'X' AND Type = 'Y'"
      );
      mutateWhereClauseField(query.where, 'Namee', 'Name');
      const result = recomposeQuery(query);
      expect(result).toContain("Name = 'X'");
      expect(result).toContain("Type = 'Y'");
    });

    it('should mutate field in OR condition', () => {
      const query = parseQuery(
        "SELECT Id FROM Account WHERE Namee = 'X' OR Namee = 'Y'"
      );
      mutateWhereClauseField(query.where, 'Namee', 'Name');
      const result = recomposeQuery(query);
      expect(result).toMatch(/Name = 'X'/);
      expect(result).toMatch(/Name = 'Y'/);
    });

    it('should mutate dot-notation paths in WHERE', () => {
      const query = parseQuery(
        "SELECT Id FROM Contact WHERE Account.Namee = 'Test'"
      );
      mutateWhereClauseField(query.where, 'Account.Namee', 'Account.Name');
      const result = recomposeQuery(query);
      expect(result).toContain("Account.Name = 'Test'");
    });

    it('should handle NOT operator', () => {
      const query = parseQuery(
        "SELECT Id FROM Account WHERE NOT Namee = 'Test'"
      );
      mutateWhereClauseField(query.where, 'Namee', 'Name');
      const result = recomposeQuery(query);
      expect(result).toContain('NOT');
      expect(result).toContain("Name = 'Test'");
    });

    it('should NOT modify string literals containing field names', () => {
      // This is the KEY REGRESSION TEST - the main reason we moved to AST
      const query = parseQuery(
        "SELECT Id FROM Account WHERE Name = 'Account.Name value'"
      );
      // Try to mutate "Account.Name" - should not affect the string literal
      mutateWhereClauseField(query.where, 'Account.Name', 'Account.Id');
      const result = recomposeQuery(query);
      // String literal should be unchanged
      expect(result).toContain("'Account.Name value'");
      // The actual field is "Name", not "Account.Name", so it shouldn't change
      expect(result).toMatch(/WHERE\s+Name\s*=/i);
    });

    it('should handle complex nested conditions', () => {
      const query = parseQuery(
        "SELECT Id FROM Account WHERE (Namee = 'A' AND Type = 'B') OR Namee = 'C'"
      );
      mutateWhereClauseField(query.where, 'Namee', 'Name');
      const result = recomposeQuery(query);
      // Both occurrences of Namee should be replaced
      expect(result).not.toContain('Namee');
      expect(result).toContain("Name = 'A'");
      expect(result).toContain("Name = 'C'");
    });
  });

  describe('mutateSubqueryField', () => {
    it('should mutate field in child subquery', () => {
      const query = parseQuery(
        'SELECT Id, (SELECT Namee FROM Contacts) FROM Account'
      );
      const result = mutateSubqueryField(query, 'Contacts', 'Namee', 'Name');
      expect(result).toBe(true);
      const soql = recomposeQuery(query);
      expect(soql).toContain('SELECT Name FROM Contacts');
    });

    it('should return false for non-existent subquery', () => {
      const query = parseQuery(
        'SELECT Id, (SELECT Name FROM Contacts) FROM Account'
      );
      const result = mutateSubqueryField(query, 'NonExistent', 'Name', 'Id');
      expect(result).toBe(false);
    });

    it('should be case-insensitive for relationship name', () => {
      const query = parseQuery(
        'SELECT Id, (SELECT Namee FROM Contacts) FROM Account'
      );
      const result = mutateSubqueryField(query, 'CONTACTS', 'Namee', 'Name');
      expect(result).toBe(true);
    });
  });

  describe('recomposeQuery', () => {
    it('should regenerate valid SOQL from mutated AST', () => {
      const query = parseQuery(
        "SELECT Id, Name FROM Account WHERE Type = 'Customer'"
      );
      mutateMainObject(query, 'Contact');
      mutateFieldInSelect(query, 'Name', 'FirstName');
      const result = recomposeQuery(query);
      expect(result).toContain('SELECT');
      expect(result).toContain('FROM Contact');
      expect(result).toContain('FirstName');
    });

    it('should handle complex queries with multiple clauses', () => {
      const query = parseQuery(
        'SELECT Id, Name, Amount FROM Opportunity WHERE Amount > 1000 ORDER BY Amount DESC LIMIT 10'
      );
      const result = recomposeQuery(query);
      expect(result).toContain('SELECT');
      expect(result).toContain('FROM Opportunity');
      expect(result).toContain('WHERE');
      expect(result).toContain('ORDER BY');
      expect(result).toContain('LIMIT');
    });
  });

  describe('Integration: Multiple Mutations', () => {
    it('should apply multiple mutations correctly', () => {
      const query = parseQuery(
        "SELECT Id, Accountt.Namee FROM Contact WHERE Accountt.Typee = 'Customer'"
      );

      // Apply multiple corrections
      mutateParentLookupPath(query, 'Accountt.Namee', 'Account.Name');
      mutateWhereClauseField(query.where, 'Accountt.Typee', 'Account.Type');

      const result = recomposeQuery(query);
      expect(result).toContain('Account.Name');
      expect(result).toContain("Account.Type = 'Customer'");
      expect(result).not.toContain('Accountt');
      expect(result).not.toContain('Namee');
      expect(result).not.toContain('Typee');
    });
  });
});

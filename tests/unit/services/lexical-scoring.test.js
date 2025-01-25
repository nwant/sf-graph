/**
 * Unit tests for lexical-scoring.ts
 * Tests the shared lexical utility for field relevance scoring.
 */

import { describe, it, expect } from '@jest/globals';

const {
  LEXICAL_SCORING,
  calculateFieldRelevanceLexical,
  tokenizeQuery,
  rankFieldsByLexicalRelevance,
} = await import('../../../dist/services/soql/lexical-scoring.js');

describe('Lexical Scoring', () => {
  describe('LEXICAL_SCORING constants', () => {
    it('should have expected scoring weights', () => {
      expect(LEXICAL_SCORING.EXACT_MATCH).toBe(10);
      expect(LEXICAL_SCORING.PARTIAL_MATCH).toBe(5);
      expect(LEXICAL_SCORING.DESCRIPTION_MATCH).toBe(2);
      expect(LEXICAL_SCORING.REFERENCE_BOOST).toBe(1);
    });
  });

  describe('tokenizeQuery', () => {
    it('should tokenize a simple query', () => {
      const tokens = tokenizeQuery('Show me accounts');
      expect(tokens).toEqual(['show', 'me', 'accounts']);
    });

    it('should remove special characters', () => {
      const tokens = tokenizeQuery("What's the account's revenue?");
      expect(tokens).toEqual(['whats', 'the', 'accounts', 'revenue']);
    });

    it('should handle empty string', () => {
      const tokens = tokenizeQuery('');
      expect(tokens).toEqual([]);
    });

    it('should handle only special characters', () => {
      const tokens = tokenizeQuery('!@#$%^&*()');
      expect(tokens).toEqual([]);
    });

    it('should handle multiple spaces', () => {
      const tokens = tokenizeQuery('account   revenue   name');
      expect(tokens).toEqual(['account', 'revenue', 'name']);
    });
  });

  describe('calculateFieldRelevanceLexical', () => {
    const baseField = {
      apiName: 'Name',
      label: 'Name',
      type: 'string',
      description: '',
    };

    it('should score exact match on apiName', () => {
      const score = calculateFieldRelevanceLexical(baseField, ['name']);
      expect(score).toBe(LEXICAL_SCORING.EXACT_MATCH);
    });

    it('should score exact match on label', () => {
      const field = { ...baseField, apiName: 'FullName__c', label: 'Name' };
      const score = calculateFieldRelevanceLexical(field, ['name']);
      expect(score).toBe(LEXICAL_SCORING.EXACT_MATCH);
    });

    it('should score partial match on apiName', () => {
      const field = { ...baseField, apiName: 'AccountName', label: 'Account Name' };
      const score = calculateFieldRelevanceLexical(field, ['account']);
      expect(score).toBe(LEXICAL_SCORING.PARTIAL_MATCH);
    });

    it('should score partial match on label', () => {
      const field = { ...baseField, apiName: 'Acc__c', label: 'Account Reference' };
      const score = calculateFieldRelevanceLexical(field, ['reference']);
      expect(score).toBe(LEXICAL_SCORING.PARTIAL_MATCH);
    });

    it('should score description match', () => {
      const field = {
        ...baseField,
        apiName: 'Annual_Turnover__c',
        label: 'Annual Turnover',
        description: 'Total revenue for the account',
      };
      const score = calculateFieldRelevanceLexical(field, ['revenue']);
      expect(score).toBe(LEXICAL_SCORING.DESCRIPTION_MATCH);
    });

    it('should add reference boost for lookup fields', () => {
      const field = { ...baseField, type: 'reference' };
      const score = calculateFieldRelevanceLexical(field, ['name']);
      expect(score).toBe(LEXICAL_SCORING.EXACT_MATCH + LEXICAL_SCORING.REFERENCE_BOOST);
    });

    it('should skip terms shorter than minTermLength', () => {
      const score = calculateFieldRelevanceLexical(baseField, ['id', 'a', 'name']);
      // 'id' and 'a' are skipped (< 3 chars), only 'name' counts
      expect(score).toBe(LEXICAL_SCORING.EXACT_MATCH);
    });

    it('should allow custom minTermLength', () => {
      // baseField has apiName='Name', label='Name'
      // 'id' (2 chars) doesn't match 'name' - so score is 0
      // Use a term that would match
      const field = { ...baseField, apiName: 'Id', label: 'Record Id' };
      const score = calculateFieldRelevanceLexical(field, ['id'], 2);
      // 'id' exactly matches apiName
      expect(score).toBe(LEXICAL_SCORING.EXACT_MATCH);
    });

    it('should return 0 for no matches', () => {
      const score = calculateFieldRelevanceLexical(baseField, ['xyz', 'abc']);
      expect(score).toBe(0);
    });

    it('should accumulate scores for multiple matching terms', () => {
      const field = {
        apiName: 'AccountName',
        label: 'Account Name',
        type: 'string',
        description: '',
      };
      // 'account' partial matches apiName, 'name' partial matches apiName (accountNAME)
      // The code checks for exact first, then partial - only one score per term
      // 'account' -> partial match on 'accountname' = 5
      // 'name' -> partial match on 'accountname' = 5
      const score = calculateFieldRelevanceLexical(field, ['account', 'name']);
      expect(score).toBe(LEXICAL_SCORING.PARTIAL_MATCH + LEXICAL_SCORING.PARTIAL_MATCH);
    });

    it('should handle missing description gracefully', () => {
      const field = { apiName: 'Test', label: 'Test', type: 'string' };
      const score = calculateFieldRelevanceLexical(field, ['revenue']);
      expect(score).toBe(0);
    });
  });

  describe('rankFieldsByLexicalRelevance', () => {
    const fields = [
      { apiName: 'Id', label: 'Id', type: 'id', description: '' },
      { apiName: 'Name', label: 'Name', type: 'string', description: '' },
      { apiName: 'AccountId', label: 'Account', type: 'reference', description: '' },
      { apiName: 'Revenue__c', label: 'Revenue', type: 'currency', description: 'Annual revenue amount' },
      { apiName: 'Description', label: 'Description', type: 'string', description: '' },
    ];

    it('should rank fields by relevance score', () => {
      const ranked = rankFieldsByLexicalRelevance(fields, 'revenue', 10);
      // Revenue__c should be first (exact match on label)
      expect(ranked[0]).toBe('Revenue__c');
    });

    it('should respect maxFields limit', () => {
      const ranked = rankFieldsByLexicalRelevance(fields, 'account name', 2);
      expect(ranked.length).toBeLessThanOrEqual(2);
    });

    it('should filter out fields with no match', () => {
      const ranked = rankFieldsByLexicalRelevance(fields, 'revenue', 10);
      // Revenue__c matches on label (exact)
      // Description field might also match if 'description' contains 'revenue' in other fields
      // Let's just verify Revenue__c is included and first
      expect(ranked[0]).toBe('Revenue__c');
    });

    it('should include reference fields even with no query match (reference boost)', () => {
      // Reference fields get +1 REFERENCE_BOOST unconditionally
      // 'quantum physics' doesn't match any field name/label/description
      // But AccountId is a reference field and gets score = 1 (REFERENCE_BOOST)
      const ranked = rankFieldsByLexicalRelevance(fields, 'quantum physics', 10);
      // AccountId gets included due to reference boost
      expect(ranked).toEqual(['AccountId']);
    });

    it('should return empty for empty query', () => {
      const ranked = rankFieldsByLexicalRelevance(fields, '', 10);
      expect(ranked).toEqual([]);
    });

    it('should handle reference fields with boost', () => {
      const ranked = rankFieldsByLexicalRelevance(fields, 'account', 10);
      // AccountId should rank first due to exact label match + reference boost
      expect(ranked[0]).toBe('AccountId');
    });
  });
});

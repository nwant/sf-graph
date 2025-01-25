/**
 * Tests for relationship-inference.ts
 *
 * Tests the getRelationshipType function that determines relationship types for fields.
 */

import { getRelationshipType } from '../../../../dist/services/neo4j/sync/relationship-inference.js';

describe('Relationship Inference', () => {
  describe('getRelationshipType', () => {
    it('should return null for non-reference fields', () => {
      const field = { type: 'string', referenceTo: null };
      expect(getRelationshipType(field)).toBeNull();
    });

    it('should return null for text fields', () => {
      const field = { type: 'textarea', referenceTo: null };
      expect(getRelationshipType(field)).toBeNull();
    });

    it('should return null for number fields', () => {
      const field = { type: 'double', referenceTo: null };
      expect(getRelationshipType(field)).toBeNull();
    });

    it('should return Lookup for reference field without relationshipOrder', () => {
      const field = {
        type: 'reference',
        referenceTo: ['Account'],
        relationshipOrder: undefined,
      };
      expect(getRelationshipType(field)).toBe('Lookup');
    });

    it('should return Lookup for reference field with null relationshipOrder', () => {
      const field = {
        type: 'reference',
        referenceTo: ['Contact'],
        relationshipOrder: null,
      };
      expect(getRelationshipType(field)).toBe('Lookup');
    });

    it('should return MasterDetail for reference field with relationshipOrder 0', () => {
      const field = {
        type: 'reference',
        referenceTo: ['Account'],
        relationshipOrder: 0,
      };
      expect(getRelationshipType(field)).toBe('MasterDetail');
    });

    it('should return MasterDetail for reference field with relationshipOrder 1', () => {
      const field = {
        type: 'reference',
        referenceTo: ['Account'],
        relationshipOrder: 1,
      };
      expect(getRelationshipType(field)).toBe('MasterDetail');
    });

    it('should return Hierarchical for self-referential lookup', () => {
      const field = {
        type: 'reference',
        referenceTo: ['Account'],
        relationshipOrder: undefined,
      };
      expect(getRelationshipType(field, 'Account')).toBe('Hierarchical');
    });

    it('should return Hierarchical when object is in polymorphic referenceTo array', () => {
      const field = {
        type: 'reference',
        referenceTo: ['Contact', 'Account', 'Lead'],
        relationshipOrder: undefined,
      };
      expect(getRelationshipType(field, 'Account')).toBe('Hierarchical');
    });

    it('should return Lookup for polymorphic field without self-reference', () => {
      const field = {
        type: 'reference',
        referenceTo: ['Contact', 'Account', 'Lead'],
        relationshipOrder: undefined,
      };
      expect(getRelationshipType(field, 'Opportunity')).toBe('Lookup');
    });

    it('should prioritize Hierarchical over MasterDetail for self-referential field', () => {
      // This is an edge case - self-referential master-detail doesn't exist in practice
      // but we should handle it gracefully
      const field = {
        type: 'reference',
        referenceTo: ['User'],
        relationshipOrder: 0,
      };
      // Even with relationshipOrder set, self-reference should return Hierarchical
      expect(getRelationshipType(field, 'User')).toBe('Hierarchical');
    });

    it('should handle empty referenceTo array', () => {
      const field = {
        type: 'reference',
        referenceTo: [],
        relationshipOrder: undefined,
      };
      expect(getRelationshipType(field)).toBe('Lookup');
    });

    it('should handle undefined objectName parameter', () => {
      const field = {
        type: 'reference',
        referenceTo: ['Account'],
        relationshipOrder: undefined,
      };
      expect(getRelationshipType(field, undefined)).toBe('Lookup');
    });
  });
});

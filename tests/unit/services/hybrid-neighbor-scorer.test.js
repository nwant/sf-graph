/**
 * Unit tests for hybrid-neighbor-scorer.ts
 * Tests Jaccard similarity and hybrid scoring defaults.
 */

import { describe, it, expect } from '@jest/globals';

const {
  HYBRID_SCORING_DEFAULTS,
  calculateJaccardSimilarity,
} = await import('../../../dist/services/peripheral-vision/hybrid-neighbor-scorer.js');

describe('Hybrid Neighbor Scorer', () => {
  describe('HYBRID_SCORING_DEFAULTS', () => {
    it('should have expected default weights', () => {
      expect(HYBRID_SCORING_DEFAULTS.semanticWeight).toBe(0.6);
      expect(HYBRID_SCORING_DEFAULTS.graphWeight).toBe(0.4);
      expect(HYBRID_SCORING_DEFAULTS.junctionBonus).toBe(0.15);
    });

    it('should have weights that sum to 1', () => {
      const sum = HYBRID_SCORING_DEFAULTS.semanticWeight + HYBRID_SCORING_DEFAULTS.graphWeight;
      expect(sum).toBe(1.0);
    });
  });

  describe('calculateJaccardSimilarity', () => {
    it('should return 1 for identical strings', () => {
      const similarity = calculateJaccardSimilarity('Account', 'Account');
      expect(similarity).toBe(1);
    });

    it('should return 0 for completely different strings', () => {
      const similarity = calculateJaccardSimilarity('Account', 'XYZ123');
      expect(similarity).toBe(0);
    });

    it('should be case insensitive', () => {
      const similarity = calculateJaccardSimilarity('ACCOUNT', 'account');
      expect(similarity).toBe(1);
    });

    it('should handle partial overlap', () => {
      // Query: "account name" -> tokens: {account, name}
      // Candidate: "account contact" -> tokens: {account, contact}
      // Intersection: {account} = 1
      // Union: {account, name, contact} = 3
      // Jaccard = 1/3 ≈ 0.333
      const similarity = calculateJaccardSimilarity('account name', 'account contact');
      expect(similarity).toBeCloseTo(1 / 3, 5);
    });

    it('should handle empty query', () => {
      const similarity = calculateJaccardSimilarity('', 'Account');
      expect(similarity).toBe(0);
    });

    it('should handle empty candidate', () => {
      const similarity = calculateJaccardSimilarity('Account', '');
      expect(similarity).toBe(0);
    });

    it('should handle special characters', () => {
      // \W+ splits on non-word chars. Underscore is a word char in regex, so:
      // "Account__c" stays as one token: {account__c}
      // "Account Related" splits into {account, related}
      // No intersection (account__c != account)
      // Use a case where special chars do split
      const similarity = calculateJaccardSimilarity('Account-Related', 'Account Related');
      // "Account-Related" splits on hyphen: {account, related}
      // "Account Related" splits: {account, related}
      // Intersection: 2, Union: 2, Jaccard = 1
      expect(similarity).toBe(1);
    });

    it('should compute correct Jaccard for known sets', () => {
      // Query: "show accounts with revenue" -> tokens: {show, accounts, with, revenue}
      // Candidate: "account revenue report" -> tokens: {account, revenue, report}
      // Note: "accounts" != "account" (different tokens)
      // Intersection: {revenue} = 1
      // Union: {show, accounts, with, revenue, account, report} = 6
      // Jaccard = 1/6 ≈ 0.167
      const similarity = calculateJaccardSimilarity(
        'show accounts with revenue',
        'account revenue report'
      );
      expect(similarity).toBeCloseTo(1 / 6, 5);
    });

    it('should handle multiple word overlap', () => {
      // Query: "annual revenue" -> {annual, revenue}
      // Candidate: "annual revenue amount" -> {annual, revenue, amount}
      // Intersection: {annual, revenue} = 2
      // Union: {annual, revenue, amount} = 3
      // Jaccard = 2/3 ≈ 0.667
      const similarity = calculateJaccardSimilarity('annual revenue', 'annual revenue amount');
      expect(similarity).toBeCloseTo(2 / 3, 5);
    });

    it('should be symmetric', () => {
      const sim1 = calculateJaccardSimilarity('Account Contact', 'Contact Opportunity');
      const sim2 = calculateJaccardSimilarity('Contact Opportunity', 'Account Contact');
      expect(sim1).toBeCloseTo(sim2, 10);
    });

    it('should split on non-word characters', () => {
      // \W+ regex: underscores ARE word characters, so they don't split
      // But hyphens, spaces, etc. DO split

      // Camelcase stays as one token
      const sim1 = calculateJaccardSimilarity('OpportunityLineItem', 'opportunity line item');
      // "OpportunityLineItem" -> {opportunitylineitem} (one token)
      // "opportunity line item" -> {opportunity, line, item}
      // No intersection
      expect(sim1).toBe(0);

      // Hyphens split properly
      const sim2 = calculateJaccardSimilarity('opportunity-line-item', 'opportunity line item');
      // Both split to {opportunity, line, item}
      expect(sim2).toBe(1);

      // Underscores are word characters in \W+, so they DON'T split
      const sim3 = calculateJaccardSimilarity('opportunity_line_item', 'opportunity line item');
      // "opportunity_line_item" -> {opportunity_line_item} (one token)
      // "opportunity line item" -> {opportunity, line, item}
      // No intersection
      expect(sim3).toBe(0);
    });
  });
});

/**
 * Unit tests for batch-graph-signals.ts
 * Tests graph signal computation and normalization.
 */

import { describe, it, expect } from '@jest/globals';

const { computeGraphScore } = await import(
  '../../../dist/services/peripheral-vision/batch-graph-signals.js'
);

describe('Batch Graph Signals', () => {
  describe('computeGraphScore', () => {
    it('should return 0 for 0 relationships', () => {
      const score = computeGraphScore(0);
      expect(score).toBe(0);
    });

    it('should return positive score for positive relationships', () => {
      const score = computeGraphScore(5);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it('should cap at 1.0 for 50+ relationships', () => {
      const score50 = computeGraphScore(50);
      const score100 = computeGraphScore(100);
      const score1000 = computeGraphScore(1000);

      // Should all be capped at 1.0
      expect(score50).toBeCloseTo(1.0, 2);
      expect(score100).toBe(1);
      expect(score1000).toBe(1);
    });

    it('should use log scale (diminishing returns)', () => {
      const score5 = computeGraphScore(5);
      const score10 = computeGraphScore(10);
      const score20 = computeGraphScore(20);

      // Log scale: 10 is not double 5's score
      const increase5to10 = score10 - score5;
      const increase10to20 = score20 - score10;

      // Diminishing returns: doubling relationships doesn't double score
      expect(increase10to20).toBeLessThan(increase5to10 * 1.5);
    });

    it('should handle edge case: 1 relationship', () => {
      const score = computeGraphScore(1);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.5); // log1p(1)/log1p(50) ≈ 0.18
    });

    it('should produce reasonable intermediate values', () => {
      const score10 = computeGraphScore(10);
      const score25 = computeGraphScore(25);

      // 10 relationships should give ~0.6
      expect(score10).toBeGreaterThan(0.4);
      expect(score10).toBeLessThan(0.8);

      // 25 relationships should give ~0.85
      expect(score25).toBeGreaterThan(0.7);
      expect(score25).toBeLessThan(1);
    });
  });
});

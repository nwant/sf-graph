/**
 * Unit tests for batch-object-similarity.ts
 * Tests cosine similarity computation.
 */

import { describe, it, expect } from '@jest/globals';

const { cosineSimilarity } = await import(
  '../../../dist/services/vector/batch-object-similarity.js'
);

describe('Batch Object Similarity', () => {
  describe('cosineSimilarity', () => {
    it('should return 1 for identical normalized vectors', () => {
      const vec = [0.5, 0.5, 0.5, 0.5]; // normalized
      const similarity = cosineSimilarity(vec, vec);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(-1.0, 5);
    });

    it('should handle zero vectors', () => {
      const zero = [0, 0, 0];
      const vec = [1, 2, 3];
      expect(cosineSimilarity(zero, vec)).toBe(0);
      expect(cosineSimilarity(vec, zero)).toBe(0);
      expect(cosineSimilarity(zero, zero)).toBe(0);
    });

    it('should handle empty vectors', () => {
      const empty = [];
      const vec = [1, 2, 3];
      expect(cosineSimilarity(empty, vec)).toBe(0);
      expect(cosineSimilarity(vec, empty)).toBe(0);
      expect(cosineSimilarity(empty, empty)).toBe(0);
    });

    it('should handle vectors of different lengths', () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('should compute correct similarity for known vectors', () => {
      // Vectors at 60 degree angle: cos(60°) = 0.5
      const a = [1, 0];
      const b = [0.5, Math.sqrt(3) / 2];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(0.5, 5);
    });

    it('should work with high-dimensional vectors', () => {
      // Simulate embedding vectors (e.g., 1536 dimensions for text-embedding-3-small)
      const dim = 100;
      const a = Array(dim).fill(0).map(() => Math.random());
      const b = Array(dim).fill(0).map(() => Math.random());

      const similarity = cosineSimilarity(a, b);

      // Random vectors should have some similarity (not exactly 0 or 1)
      expect(similarity).toBeGreaterThan(-1);
      expect(similarity).toBeLessThan(1);
    });

    it('should be symmetric', () => {
      const a = [1, 2, 3, 4, 5];
      const b = [5, 4, 3, 2, 1];

      expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
    });

    it('should handle very small numbers', () => {
      const a = [1e-10, 1e-10, 1e-10];
      const b = [1e-10, 1e-10, 1e-10];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it('should handle mixed positive and negative values', () => {
      const a = [1, -1, 1, -1];
      const b = [1, 1, 1, 1];

      // Dot product: 1*1 + (-1)*1 + 1*1 + (-1)*1 = 0
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(0, 5);
    });
  });
});

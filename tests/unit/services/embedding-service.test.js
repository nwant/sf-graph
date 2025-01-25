/**
 * Unit tests for embedding-service.ts
 */

import { describe, it, expect } from '@jest/globals';

// Import from dist directory
const { computeContentHash } = 
  await import('../../../dist/services/embeddings/embedding-service.js');

describe('Embedding Service', () => {
  describe('computeContentHash', () => {
    it('should return a consistent hash for the same content', () => {
      const content = 'This is test content';
      
      const hash1 = computeContentHash(content);
      const hash2 = computeContentHash(content);
      
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different content', () => {
      const hash1 = computeContentHash('Content A');
      const hash2 = computeContentHash('Content B');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should return a valid hex string', () => {
      const hash = computeContentHash('Test content');
      
      // SHA-256 produces 64 hex characters
      expect(hash).toMatch(/^[a-f0-9]+$/);
      expect(hash.length).toBe(64);
    });

    it('should handle empty strings', () => {
      const hash = computeContentHash('');
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });
  });
});

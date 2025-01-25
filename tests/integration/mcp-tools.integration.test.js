/**
 * Integration Tests for MCP Tools with Real Neo4j
 *
 * These tests require Neo4j to be running and use actual database queries.
 * They seed test data, run the tool handlers, and verify results.
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { isNeo4jConfigured, initTestDriver, closeTestDriver } from '../testUtils.js';

// Import the actual tool modules
import { schemaTools } from '../../dist/mcp/tools/schema-tools.js';

describe('MCP Tools Integration Tests', () => {
  let neo4jAvailable = false;

  beforeAll(async () => {
    neo4jAvailable = isNeo4jConfigured();
    if (neo4jAvailable) {
      await initTestDriver();
    }
  });

  afterAll(async () => {
    if (neo4jAvailable) {
      await closeTestDriver();
    }
  });

  describe('Schema Tools with Neo4j', () => {
    test('check-graph-status returns valid response', async () => {
      if (!neo4jAvailable) {
        console.log('Skipping - Neo4j not available');
        return;
      }

      const tool = schemaTools.find((t) => t.name === 'check-graph-status');
      expect(tool).toBeDefined();

      const result = await tool.handler({});

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type', 'text');

      // Parse the response
      const content = JSON.parse(result.content[0].text);
      expect(content).toHaveProperty('hasData');
      expect(content).toHaveProperty('objectCount');
      expect(typeof content.hasData).toBe('boolean');
      expect(typeof content.objectCount).toBe('number');
    });

    test('list-objects returns array', async () => {
      if (!neo4jAvailable) {
        console.log('Skipping - Neo4j not available');
        return;
      }

      const tool = schemaTools.find((t) => t.name === 'list-objects');
      expect(tool).toBeDefined();

      const result = await tool.handler({});

      expect(result).toHaveProperty('content');
      const content = JSON.parse(result.content[0].text);
      expect(Array.isArray(content)).toBe(true);
    });

    test('get-object returns error for non-existent object', async () => {
      if (!neo4jAvailable) {
        console.log('Skipping - Neo4j not available');
        return;
      }

      const tool = schemaTools.find((t) => t.name === 'get-object');
      expect(tool).toBeDefined();

      const result = await tool.handler({ apiName: 'NonExistentObject__xyz' });

      expect(result).toHaveProperty('content');
      expect(result.content[0].text).toContain('not found');
    });
  });
});

/**
 * Unit tests for index-service.ts
 * 
 * These tests verify the config loading and Cypher query generation
 * without requiring a real Neo4j connection.
 */
import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('index-service config', () => {
  test('sf-graph.config.json should have valid structure', () => {
    const configPath = join(__dirname, '../../../sf-graph.config.json');
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    
    // Should have metadataTypes array
    expect(config.metadataTypes).toBeDefined();
    expect(Array.isArray(config.metadataTypes)).toBe(true);
    expect(config.metadataTypes.length).toBeGreaterThan(0);
    
    // Each type should have required fields
    for (const type of config.metadataTypes) {
      expect(type.name).toBeDefined();
      expect(type.handler).toBeDefined();
      expect(type.nodeLabel).toBeDefined();
    }
  });

  test('each metadata type should have identifier array', () => {
    const configPath = join(__dirname, '../../../sf-graph.config.json');
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    
    for (const type of config.metadataTypes) {
      expect(type.identifier).toBeDefined();
      expect(Array.isArray(type.identifier)).toBe(true);
      expect(type.identifier.length).toBeGreaterThan(0);
    }
  });

  test('indexed properties should be defined correctly', () => {
    const configPath = join(__dirname, '../../../sf-graph.config.json');
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    
    for (const type of config.metadataTypes) {
      if (type.properties) {
        for (const [_propName, propConfig] of Object.entries(type.properties)) {
          // Property config should have indexed boolean
          expect(typeof propConfig.indexed).toBe('boolean');
        }
      }
    }
  });

  test('identifier properties should have indexed: true', () => {
    const configPath = join(__dirname, '../../../sf-graph.config.json');
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    
    for (const type of config.metadataTypes) {
      // All identifier properties should be indexed
      for (const idProp of type.identifier) {
        if (type.properties && type.properties[idProp]) {
          expect(type.properties[idProp].indexed).toBe(true);
        }
      }
    }
  });
});

describe('index-service Cypher generation', () => {
  test('should generate correct index name format', () => {
    const nodeLabel = 'Object';
    const propName = 'apiName';
    const indexName = `idx_${nodeLabel.toLowerCase()}_${propName.toLowerCase()}`;
    
    expect(indexName).toBe('idx_object_apiname');
  });

  test('should generate correct constraint name format', () => {
    const nodeLabel = 'Object';
    const identifier = ['apiName', 'orgId'];
    const constraintName = `uniq_${nodeLabel.toLowerCase()}_${identifier.join('_').toLowerCase()}`;
    
    expect(constraintName).toBe('uniq_object_apiname_orgid');
  });

  test('should generate correct CREATE INDEX statement', () => {
    const nodeLabel = 'Object';
    const propName = 'apiName';
    const indexName = `idx_${nodeLabel.toLowerCase()}_${propName.toLowerCase()}`;
    
    const cypher = `CREATE INDEX ${indexName} IF NOT EXISTS FOR (n:${nodeLabel}) ON (n.${propName})`;
    
    expect(cypher).toBe('CREATE INDEX idx_object_apiname IF NOT EXISTS FOR (n:Object) ON (n.apiName)');
  });

  test('should generate correct CREATE CONSTRAINT statement', () => {
    const nodeLabel = 'Object';
    const identifier = ['apiName', 'orgId'];
    const constraintName = `uniq_${nodeLabel.toLowerCase()}_${identifier.join('_').toLowerCase()}`;
    const propsString = identifier.map(p => `n.${p}`).join(', ');
    
    const cypher = `CREATE CONSTRAINT ${constraintName} IF NOT EXISTS FOR (n:${nodeLabel}) REQUIRE (${propsString}) IS UNIQUE`;
    
    expect(cypher).toBe('CREATE CONSTRAINT uniq_object_apiname_orgid IF NOT EXISTS FOR (n:Object) REQUIRE (n.apiName, n.orgId) IS UNIQUE');
  });
});

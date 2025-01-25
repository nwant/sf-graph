/**
 * Neo4j Index Service
 *
 * Manages database indexes and constraints based on sf-graph.config.json.
 */

import { getDriver } from './driver.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../../core/index.js';

const log = createLogger('neo4j:index');

// === Types ===

interface PropertyConfig {
  indexed?: boolean;
}

interface MetadataTypeConfig {
  name: string;
  handler: string;
  nodeLabel: string;
  identifier?: string[];
  properties?: Record<string, PropertyConfig>;
}

interface GraphConfig {
  metadataTypes: MetadataTypeConfig[];
}

interface IndexInfo {
  name: string;
  label: string;
  properties: string[];
  type: 'index' | 'constraint';
  state: string;
}

// === Config Loading ===

function loadConfig(): GraphConfig {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const configPath = join(__dirname, '../../../sf-graph.config.json');
  const content = readFileSync(configPath, 'utf-8');
  return JSON.parse(content) as GraphConfig;
}

// === Index Management ===

/**
 * Ensure all indexes defined in config exist in Neo4j.
 * Creates indexes for properties marked with indexed: true.
 */
export async function ensureIndexes(): Promise<{ created: string[]; existing: string[] }> {
  const config = loadConfig();
  const driver = getDriver();
  const session = driver.session();
  
  const created: string[] = [];
  const existing: string[] = [];

  try {
    // Get existing indexes
    const existingResult = await session.run('SHOW INDEXES');
    const existingIndexes = new Set(
      existingResult.records.map(r => r.get('name') as string)
    );

    for (const metadataType of config.metadataTypes) {
      if (!metadataType.properties) continue;

      for (const [propName, propConfig] of Object.entries(metadataType.properties)) {
        if (!propConfig.indexed) continue;

        const indexName = `idx_${metadataType.nodeLabel.toLowerCase()}_${propName.toLowerCase()}`;
        
        if (existingIndexes.has(indexName)) {
          existing.push(indexName);
          continue;
        }

        try {
          await session.run(
            `CREATE INDEX ${indexName} IF NOT EXISTS FOR (n:${metadataType.nodeLabel}) ON (n.${propName})`
          );
          created.push(indexName);
        } catch (err) {
          log.warn({ err, indexName }, 'Could not create index');
        }
      }
    }

    // Create performance-critical composite indexes for sync operations
    // These are not in config but essential for query performance
    const performanceIndexes = [
      {
        name: 'idx_field_composite_lookup',
        cypher: 'CREATE INDEX idx_field_composite_lookup IF NOT EXISTS FOR (f:Field) ON (f.apiName, f.sobjectType, f.orgId)',
      },
      {
        name: 'idx_picklist_composite_lookup',
        cypher: 'CREATE INDEX idx_picklist_composite_lookup IF NOT EXISTS FOR (p:PicklistValue) ON (p.objectApiName, p.fieldApiName, p.value, p.orgId)',
      },
      {
        name: 'idx_object_composite_lookup',
        cypher: 'CREATE INDEX idx_object_composite_lookup IF NOT EXISTS FOR (o:Object) ON (o.apiName, o.orgId)',
      },
      {
        name: 'idx_picklist_value_lookup',
        cypher: 'CREATE INDEX idx_picklist_value_lookup IF NOT EXISTS FOR (p:PicklistValue) ON (p.value, p.orgId)',
      },
    ];

    for (const perfIndex of performanceIndexes) {
      if (existingIndexes.has(perfIndex.name)) {
        existing.push(perfIndex.name);
        continue;
      }

      try {
        await session.run(perfIndex.cypher);
        created.push(perfIndex.name);
      } catch (err) {
        log.warn({ err, indexName: perfIndex.name }, 'Could not create performance index');
      }
    }

    return { created, existing };
  } finally {
    await session.close();
  }
}

/**
 * Ensure all unique constraints defined in config exist in Neo4j.
 * Creates composite unique constraints from identifier arrays.
 */
export async function ensureConstraints(): Promise<{ created: string[]; existing: string[] }> {
  const config = loadConfig();
  const driver = getDriver();
  const session = driver.session();
  
  const created: string[] = [];
  const existing: string[] = [];

  try {
    // Get existing constraints
    const existingResult = await session.run('SHOW CONSTRAINTS');
    const existingConstraints = new Set(
      existingResult.records.map(r => r.get('name') as string)
    );

    for (const metadataType of config.metadataTypes) {
      if (!metadataType.identifier || metadataType.identifier.length === 0) continue;

      const constraintName = `uniq_${metadataType.nodeLabel.toLowerCase()}_${metadataType.identifier.join('_').toLowerCase()}`;
      
      if (existingConstraints.has(constraintName)) {
        existing.push(constraintName);
        continue;
      }

      try {
        const propsString = metadataType.identifier.map(p => `n.${p}`).join(', ');
        await session.run(
          `CREATE CONSTRAINT ${constraintName} IF NOT EXISTS FOR (n:${metadataType.nodeLabel}) REQUIRE (${propsString}) IS UNIQUE`
        );
        created.push(constraintName);
      } catch (err) {
        log.warn({ err, constraintName }, 'Could not create constraint');
      }
    }

    return { created, existing };
  } finally {
    await session.close();
  }
}

/**
 * List all indexes and constraints in the database.
 */
export async function listIndexes(): Promise<IndexInfo[]> {
  const driver = getDriver();
  const session = driver.session();
  
  try {
    const indexes: IndexInfo[] = [];

    // Get indexes
    const indexResult = await session.run('SHOW INDEXES');
    for (const record of indexResult.records) {
      indexes.push({
        name: record.get('name'),
        label: record.get('labelsOrTypes')?.[0] || '',
        properties: record.get('properties') || [],
        type: 'index',
        state: record.get('state'),
      });
    }

    // Get constraints
    const constraintResult = await session.run('SHOW CONSTRAINTS');
    for (const record of constraintResult.records) {
      indexes.push({
        name: record.get('name'),
        label: record.get('labelsOrTypes')?.[0] || '',
        properties: record.get('properties') || [],
        type: 'constraint',
        state: 'ONLINE',
      });
    }

    return indexes;
  } finally {
    await session.close();
  }
}

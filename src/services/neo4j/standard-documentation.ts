/**
 * Standard Documentation Service
 *
 * Applies curated documentation from versioned JSON files to objects
 * and fields in the Neo4j graph that lack descriptions.
 * 
 * Checks user directory first (SF CLI data dir), then
 * falls back to bundled data (src/data/documentation/).
 */

import type { Driver } from 'neo4j-driver';

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Global } from '@salesforce/core';
import { createLogger } from '../../core/logger.js';
const log = createLogger('standard-documentation');

// Get the path to the bundled descriptions directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File prefix constant
export const DOCUMENTATION_FILE_PREFIX = 'standard-documentation-v';

// Bundled data (shipped with package)
export const BUNDLED_DOCUMENTATION_DIR = path.resolve(__dirname, '../../data/documentation');
// User-extracted data (uses SF CLI's standard data directory)
export const USER_DOCUMENTATION_DIR = path.join(Global.SF_DIR, 'sf-graph', 'documentation');

// Version constraints
export const MIN_API_VERSION = '50.0';
export const DEFAULT_API_VERSION = '62.0';

// === Types ===

interface StandardDescriptions {
  apiVersion: string;
  lastUpdated: string;
  source: string;
  objects: Record<string, {
    description: string;
    usage?: string;
    accessRules?: string;
    supportedCalls?: string;
    fields: Record<string, {
      description: string;
      properties: string[];
    } | string>; // Support both old string and new object format for backward compat
  }>;
}

// === Cache ===

const descriptionsCache = new Map<string, StandardDescriptions>();

/**
 * Get the file path for a specific API version.
 * Checks user directory first, then bundled directory.
 */
function getDescriptionsPath(apiVersion: string): string | null {
  const filename = `${DOCUMENTATION_FILE_PREFIX}${apiVersion}.json`;
  
  // Check user directory first (takes precedence)
  const userPath = path.join(USER_DOCUMENTATION_DIR, filename);
  if (fs.existsSync(userPath)) {
    return userPath;
  }
  
  // Fall back to bundled directory
  const bundledPath = path.join(BUNDLED_DOCUMENTATION_DIR, filename);
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }
  
  return null;
}

/**
 * Normalize API version string (e.g., "62" -> "62.0")
 */
function normalizeVersion(version: string): string {
  const num = parseFloat(version);
  if (isNaN(num)) return DEFAULT_API_VERSION;
  return num.toFixed(1);
}



/**
 * Load descriptions for a specific API version (cached)
 */
export function loadDescriptions(apiVersion: string = DEFAULT_API_VERSION): StandardDescriptions | null {
  const version = normalizeVersion(apiVersion);
  
  if (descriptionsCache.has(version)) {
    return descriptionsCache.get(version)!;
  }

  const filePath = getDescriptionsPath(version);
  
  if (!filePath) {
    log.debug({ version }, 'Descriptions file not found in user or bundled directories');
    return null;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const descriptions = JSON.parse(content) as StandardDescriptions;
    descriptionsCache.set(version, descriptions);
    log.debug(
      { version, objectCount: Object.keys(descriptions.objects).length, path: filePath },
      'Loaded descriptions'
    );
    return descriptions;
  } catch (error) {
    log.warn({ error, version, path: filePath }, 'Failed to load descriptions');
    return null;
  }
}

/**
 * Clear the cached descriptions (for testing)
 */
export function clearDescriptionsCache(): void {
  descriptionsCache.clear();
}

/**
 * Check if documentation exists for a specific API version
 */
export function hasDocumentation(apiVersion: string): boolean {
  const version = normalizeVersion(apiVersion);
  return getDescriptionsPath(version) !== null;
}

/**
 * Apply standard documentation to objects and fields in the graph.
 * Only updates nodes that have empty descriptions.
 * 
 * NOTE: Does NOT fall back to a default version - caller should check
 * hasDocumentation() first and handle missing documentation appropriately.
 *
 * @returns Number of nodes updated
 */
export async function applyStandardDescriptions(
  driver: Driver,
  orgId: string,
  apiVersion: string = DEFAULT_API_VERSION
): Promise<number> {
  const descriptions = loadDescriptions(apiVersion);
  if (!descriptions) {
    log.debug({ apiVersion }, 'No descriptions available for this version');
    return 0;
  }

  return applyDescriptionsToGraph(driver, orgId, descriptions);
}

/**
 * Internal function to apply descriptions to the graph
 */
async function applyDescriptionsToGraph(
  driver: Driver,
  orgId: string,
  descriptions: StandardDescriptions
): Promise<number> {
  const session = driver.session();
  let updatedCount = 0;

  try {
    for (const [objectApiName, objectData] of Object.entries(descriptions.objects)) {
      if (!objectData.description) continue;

      const objectResult = await session.executeWrite((tx) =>
        tx.run(
          `
          MATCH (o:Object {apiName: $apiName, orgId: $orgId})
          WHERE o.description IS NULL OR o.description = ''
          SET o.description = $description,
              o.usage = $usage,
              o.accessRules = $accessRules,
              o.supportedCalls = $supportedCalls
          RETURN count(o) as updated
          `,
          {
            apiName: objectApiName,
            orgId,
            description: objectData.description,
            usage: objectData.usage || null,
            accessRules: objectData.accessRules || null,
            supportedCalls: objectData.supportedCalls || null,
          }
        )
      );

      updatedCount += objectResult.records[0]?.get('updated')?.toNumber() || 0;

      if (objectData.fields) {
        for (const [fieldApiName, fieldData] of Object.entries(objectData.fields)) {
          // fieldData is now { description: string, properties: string[] }
          // Handle old string format if mixed (though scraper forces upgrade)
          const fieldDesc = typeof fieldData === 'string' ? fieldData : fieldData.description;
          const fieldProps = typeof fieldData === 'object' ? fieldData.properties : [];
          
          if (!fieldDesc && fieldProps.length === 0) continue;

          // Map properties to booleans
          const isFilterable = fieldProps.includes('Filter');
          const isGroupable = fieldProps.includes('Group');
          const isSortable = fieldProps.includes('Sort');
          const isCreateable = fieldProps.includes('Create');
          const isUpdateable = fieldProps.includes('Update');

          const fieldResult = await session.executeWrite((tx) =>
            tx.run(
              `
              MATCH (f:Field {apiName: $fieldApiName, sobjectType: $sobjectType, orgId: $orgId})
              WHERE (f.description IS NULL OR f.description = '') 
                 OR (f.isFilterable IS NULL)
              SET f.description = $description,
                  f.isFilterable = $isFilterable,
                  f.isGroupable = $isGroupable,
                  f.isSortable = $isSortable,
                  f.isCreateable = $isCreateable,
                  f.isUpdateable = $isUpdateable
              RETURN count(f) as updated
              `,
              {
                fieldApiName,
                sobjectType: objectApiName,
                orgId,
                description: fieldDesc,
                isFilterable,
                isGroupable,
                isSortable,
                isCreateable,
                isUpdateable
              }
            )
          );

          updatedCount += fieldResult.records[0]?.get('updated')?.toNumber() || 0;
        }
      }
    }

    return updatedCount;
  } finally {
    await session.close();
  }
}

/**
 * Get available description versions from both user and bundled directories
 */
export function getAvailableVersions(): string[] {
  const versions = new Set<string>();
  
  const extractVersions = (dir: string) => {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir)
        .filter(f => f.startsWith(DOCUMENTATION_FILE_PREFIX) && f.endsWith('.json'))
        .map(f => f.replace(DOCUMENTATION_FILE_PREFIX, '').replace(/\.json$/, ''))
        .forEach(v => versions.add(v));
    }
  };
  
  extractVersions(USER_DOCUMENTATION_DIR);
  extractVersions(BUNDLED_DOCUMENTATION_DIR);
  
  return Array.from(versions).sort((a, b) => parseFloat(b) - parseFloat(a));
}

/**
 * Version detail info
 */
export interface VersionInfo {
  version: string;
  source: 'user' | 'bundled';
  path: string;
  objectCount: number;
  lastUpdated: string;
  fileSize: number;
  overridesBundled: boolean;
}

/**
 * Get detailed info about all available versions
 */
export function getVersionDetails(): VersionInfo[] {
  const results: VersionInfo[] = [];
  const userVersions = new Set<string>();
  const bundledVersions = new Set<string>();
  
  // First pass: collect all versions from each source
  const collectVersions = (dir: string, target: Set<string>) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir)
      .filter(f => f.startsWith(DOCUMENTATION_FILE_PREFIX) && f.endsWith('.json'))
      .forEach(f => {
        const version = f.replace(DOCUMENTATION_FILE_PREFIX, '').replace(/\.json$/, '');
        target.add(version);
      });
  };
  
  collectVersions(USER_DOCUMENTATION_DIR, userVersions);
  collectVersions(BUNDLED_DOCUMENTATION_DIR, bundledVersions);
  
  const processDir = (dir: string, source: 'user' | 'bundled') => {
    if (!fs.existsSync(dir)) return;
    
    fs.readdirSync(dir)
      .filter(f => f.startsWith(DOCUMENTATION_FILE_PREFIX) && f.endsWith('.json'))
      .forEach(filename => {
        const filePath = path.join(dir, filename);
        const version = filename.replace(DOCUMENTATION_FILE_PREFIX, '').replace(/\.json$/, '');
        
        // Skip if we already have this version (user takes precedence)
        if (results.some(r => r.version === version)) return;
        
        try {
          const stat = fs.statSync(filePath);
          const content = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(content) as StandardDescriptions;
          
          results.push({
            version,
            source,
            path: filePath,
            objectCount: Object.keys(data.objects).length,
            lastUpdated: data.lastUpdated,
            fileSize: stat.size,
            overridesBundled: source === 'user' && bundledVersions.has(version),
          });
        } catch {
          // Skip files that can't be read
        }
      });
  };
  
  processDir(USER_DOCUMENTATION_DIR, 'user');
  processDir(BUNDLED_DOCUMENTATION_DIR, 'bundled');
  
  return results.sort((a, b) => parseFloat(b.version) - parseFloat(a.version));
}

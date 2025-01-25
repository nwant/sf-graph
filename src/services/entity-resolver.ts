/**
 * Entity Resolver Service
 *
 * Graph-based resolution of missing entities from validation errors.
 * Uses Neo4j to resolve object names and relationship names.
 */

import { getObjectByApiName } from './neo4j/graph-service.js';
import { getDriver } from './neo4j/driver.js';
import { createLogger } from '../core/index.js';
import {
  extractMissingEntityFromMessage,
  type MissingEntity,
  type MissingEntityType,
} from '../core/validation-errors.js';

const log = createLogger('entity-resolver');

// Re-export for convenience
export type { MissingEntity, MissingEntityType };

/**
 * Result of relationship target resolution.
 */
export interface RelationshipTarget {
  targetObject: string;
  sourceObject: string;
  relationshipName: string;
  fieldApiName: string;
}

/**
 * Find the target object for a relationship name.
 * Checks both outgoing (LOOKS_UP, MASTER_DETAIL) edges.
 * 
 * @param relationshipName - The relationship name (e.g., 'Invoices__r', 'Account')
 * @param orgId - Optional org ID filter
 */
export async function findRelationshipTarget(
  relationshipName: string,
  { orgId }: { orgId?: string } = {}
): Promise<RelationshipTarget | null> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const orgFilter = orgId ? 'AND f.orgId = $orgId' : '';
    
    // Check both sides: relationship could be named on the field or as child relationship name
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (source:Object)-[:HAS_FIELD]->(f:Field)-[:LOOKS_UP|MASTER_DETAIL]->(target:Object)
        WHERE (toLower(f.relationshipName) = toLower($relName)
           OR toLower(f.apiName) = toLower($relName))
        ${orgFilter}
        RETURN source.apiName AS sourceObject, 
               target.apiName AS targetObject,
               f.relationshipName AS relationshipName,
               f.apiName AS fieldApiName
        LIMIT 1
        `,
        { relName: relationshipName, orgId }
      )
    );

    if (result.records.length === 0) {
      // Try child relationship name pattern (e.g., 'Invoices__r' -> 'Invoice__c')
      // This queries for child relationship names stored on the parent
      const childResult = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (parent:Object)-[:HAS_FIELD]->(f:Field)-[:LOOKS_UP|MASTER_DETAIL]->(child:Object)
          WHERE toLower(child.apiName + 's') = toLower(REPLACE($relName, '__r', ''))
             OR toLower(child.apiName) = toLower(REPLACE(REPLACE($relName, '__r', '__c'), 's__c', '__c'))
          ${orgFilter}
          RETURN parent.apiName AS sourceObject,
                 child.apiName AS targetObject,
                 f.relationshipName AS relationshipName,
                 f.apiName AS fieldApiName
          LIMIT 1
          `,
          { relName: relationshipName, orgId }
        )
      );

      if (childResult.records.length === 0) {
        return null;
      }

      const record = childResult.records[0];
      return {
        sourceObject: record.get('sourceObject'),
        targetObject: record.get('targetObject'),
        relationshipName: record.get('relationshipName') || relationshipName,
        fieldApiName: record.get('fieldApiName'),
      };
    }

    const record = result.records[0];
    return {
      sourceObject: record.get('sourceObject'),
      targetObject: record.get('targetObject'),
      relationshipName: record.get('relationshipName') || relationshipName,
      fieldApiName: record.get('fieldApiName'),
    };
  } catch (error) {
    log.error({ err: error, relationshipName }, 'Error finding relationship target');
    return null;
  } finally {
    await session.close();
  }
}

/**
 * Extended result from entity resolution.
 */
export interface EntityResolutionResult {
  /** The resolved object API name */
  resolvedApiName: string;
  /** How the entity was resolved */
  resolutionType: 'direct_object' | 'relationship_target' | 'child_relationship';
  /** Additional relationship context (for relationships) */
  relationshipInfo?: {
    sourceObject: string;
    relationshipName: string;
    fieldApiName: string;
  };
}

/**
 * Resolve a missing entity name to an Object API name.
 * Uses the graph to check:
 * 1. Direct object API name match
 * 2. Relationship name -> target object
 *
 * @param name - The entity name to resolve (object or relationship name)
 * @param orgId - Optional org ID filter
 */
export async function resolveMissingEntity(
  name: string,
  orgId?: string
): Promise<string | null> {
  const result = await resolveMissingEntityExtended(name, orgId);
  return result?.resolvedApiName ?? null;
}

/**
 * Resolve a missing entity with extended information.
 * Returns detailed resolution info including relationship context.
 *
 * @param name - The entity name to resolve (object or relationship name)
 * @param orgId - Optional org ID filter
 * @param context - Optional context object (e.g., parent object for relationships)
 */
export async function resolveMissingEntityExtended(
  name: string,
  orgId?: string,
  context?: string
): Promise<EntityResolutionResult | null> {
  log.debug({ name, context }, 'Resolving missing entity (extended)');

  // 1. Check if it's an Object API Name directly
  const obj = await getObjectByApiName(name, { orgId });
  if (obj) {
    log.debug({ name, resolved: obj.apiName }, 'Resolved as direct object match');
    return {
      resolvedApiName: obj.apiName,
      resolutionType: 'direct_object',
    };
  }

  // 2. Check if it's a Relationship Name -> return the target object
  const relMatch = await findRelationshipTarget(name, { orgId });
  if (relMatch) {
    log.debug({ name, resolved: relMatch.targetObject }, 'Resolved as relationship target');
    return {
      resolvedApiName: relMatch.targetObject,
      resolutionType: 'relationship_target',
      relationshipInfo: {
        sourceObject: relMatch.sourceObject,
        relationshipName: relMatch.relationshipName,
        fieldApiName: relMatch.fieldApiName,
      },
    };
  }

  // 3. Special handling for child relationship names (e.g., "OpportunityLineItems")
  // Try to infer the child object from the relationship name
  if (name.endsWith('s') || name.endsWith('__r')) {
    // Remove plural 's' or '__r' suffix and try to match
    const baseName = name.endsWith('__r')
      ? name.slice(0, -3) + '__c'
      : name.slice(0, -1);

    const childObj = await getObjectByApiName(baseName, { orgId });
    if (childObj) {
      log.debug(
        { name, inferred: baseName, resolved: childObj.apiName },
        'Resolved as inferred child object'
      );
      return {
        resolvedApiName: childObj.apiName,
        resolutionType: 'child_relationship',
        relationshipInfo: context
          ? {
              sourceObject: context,
              relationshipName: name,
              fieldApiName: '',
            }
          : undefined,
      };
    }
  }

  log.debug({ name }, 'Could not resolve entity');
  return null;
}

/**
 * Parse validation error messages to extract missing object/relationship names.
 * Uses centralized patterns from validation-errors.ts for consistency.
 *
 * @param errors - Array of validation error messages
 * @returns The extracted missing entity with type and context, or null if no match
 */
export function extractMissingEntityFromErrors(
  errors: Array<{ message: string }>
): MissingEntity | null {
  // Extract message strings and delegate to centralized function
  const messages = errors.map((e) => e.message);
  const result = extractMissingEntityFromMessage(messages);
  
  if (result) {
    log.debug({ result }, 'Extracted missing entity from error');
  }
  
  return result;
}

/**
 * Legacy function for backward compatibility.
 * Returns just the entity name, not the full MissingEntity.
 *
 * @deprecated Use extractMissingEntityFromErrors instead
 */
export function extractMissingEntityName(errors: Array<{ message: string }>): string | null {
  const entity = extractMissingEntityFromErrors(errors);
  return entity?.name ?? null;
}

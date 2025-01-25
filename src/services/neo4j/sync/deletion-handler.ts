/**
 * Deletion Handler
 *
 * Handles soft deletion of objects and fields during incremental sync.
 */

import type { Driver, ManagedTransaction } from 'neo4j-driver';

/**
 * Handle deleted objects in incremental mode
 */
export async function handleDeletedObjects(
  driver: Driver,
  orgId: string,
  currentObjectNames: string[]
): Promise<number> {
  const session = driver.session();
  try {
    // Flag deleted objects
    const deleteResult = await session.executeWrite(
      async (tx: ManagedTransaction) => {
        const result = await tx.run(
          `
        MATCH (o:Object {orgId: $orgId})
        WHERE NOT o.apiName IN $currentNames AND o.deleted IS NULL
        SET o.deleted = true, o.deletedAt = datetime()
        RETURN count(o) as deletedCount
        `,
          { orgId, currentNames: currentObjectNames }
        );
        return result.records[0]?.get('deletedCount')?.toNumber() || 0;
      }
    );

    // Flag deleted fields
    await session.executeWrite(async (tx: ManagedTransaction) => {
      await tx.run(
        `
        MATCH (f:Field {orgId: $orgId})
        WHERE f.deleted IS NULL
        AND NOT EXISTS {
          MATCH (o:Object {orgId: $orgId})-[:HAS_FIELD]->(f)
          WHERE o.deleted IS NULL
        }
        SET f.deleted = true, f.deletedAt = datetime()
        `,
        { orgId }
      );
    });

    // Recalculate REFERENCES edges from active fields
    await session.executeWrite(async (tx: ManagedTransaction) => {
      // Rebuild REFERENCES edges from source of truth (active fields only)
      await tx.run(
        `
        MATCH (source:Object {orgId: $orgId})-[:HAS_FIELD]->(f:Field)-[:LOOKS_UP|MASTER_DETAIL]->(target:Object {orgId: $orgId})
        WHERE f.deleted IS NULL AND source.deleted IS NULL AND target.deleted IS NULL
        WITH source, target, collect(f) as fields
        WITH source, target,
             [field IN fields | field.apiName] as activeFields,
             CASE WHEN any(field IN fields WHERE field.relationshipType = 'MasterDetail')
                  THEN 'MasterDetail' ELSE 'Lookup' END as relType
        MATCH (source)-[r:REFERENCES]->(target)
        SET r.fields = activeFields,
            r.fieldCount = size(activeFields),
            r.relationshipType = relType
        `,
        { orgId }
      );

      // Remove REFERENCES edges with no active fields
      await tx.run(
        `
        MATCH (source:Object {orgId: $orgId})-[r:REFERENCES]->(target:Object {orgId: $orgId})
        WHERE NOT EXISTS {
          MATCH (source)-[:HAS_FIELD]->(f:Field)-[:LOOKS_UP|MASTER_DETAIL]->(target)
          WHERE f.deleted IS NULL
        }
        DELETE r
        `,
        { orgId }
      );
    });

    return deleteResult;
  } finally {
    await session.close();
  }
}

/**
 * Clear all synced data for an org
 */
export async function clearOrgData(
  driver: Driver,
  orgId: string
): Promise<void> {
  const session = driver.session();

  try {
    await session.executeWrite(async (tx: ManagedTransaction) => {
      await tx.run(
        `
        MATCH (n {orgId: $orgId})
        DETACH DELETE n
        `,
        { orgId }
      );
    });
  } finally {
    await session.close();
  }
}

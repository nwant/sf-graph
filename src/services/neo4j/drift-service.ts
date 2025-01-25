
import { getDriver } from './driver.js';

export interface DriftItem {
  apiName: string;
  sourceLabel?: string;
  targetLabel?: string;
  sourceFieldCount?: number;
  targetFieldCount?: number;
  status: 'only-in-source' | 'only-in-target' | 'different';
  differences: string[];
}

/**
 * Check if both orgs have data in the graph
 */
export async function checkOrgData(sourceOrg: string, targetOrg: string): Promise<{ source: boolean; target: boolean }> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const result = await session.run(
      `
      OPTIONAL MATCH (s:Object {orgId: $sourceOrg})
      WITH s LIMIT 1
      OPTIONAL MATCH (t:Object {orgId: $targetOrg})
      WITH s, t LIMIT 1
      RETURN s IS NOT NULL as hasSource, t IS NOT NULL as hasTarget
      `,
      { sourceOrg, targetOrg }
    );

    const record = result.records[0];
    return {
      source: record?.get('hasSource') || false,
      target: record?.get('hasTarget') || false,
    };
  } finally {
    await session.close();
  }
}

/**
 * Detect drift between two orgs
 */
export async function detectDrift(sourceOrg: string, targetOrg: string, objectFilter?: string[]): Promise<DriftItem[]> {
  const driver = getDriver();
  const session = driver.session();
  const items: DriftItem[] = [];

  try {
    // Build filter condition
    const filterClause = objectFilter && objectFilter.length > 0
      ? 'AND (s.apiName IN $objectFilter OR t.apiName IN $objectFilter)'
      : '';

    // Find all objects with same apiName across orgs
    const result = await session.run(
      `
      OPTIONAL MATCH (s:Object {orgId: $sourceOrg})
      WHERE s.deleted IS NULL
      OPTIONAL MATCH (t:Object {orgId: $targetOrg})
      WHERE t.deleted IS NULL AND t.apiName = s.apiName
      WITH s, t
      WHERE s IS NOT NULL OR t IS NOT NULL
      ${filterClause}
      OPTIONAL MATCH (s)-[:HAS_FIELD]->(sf:Field) WHERE sf.deleted IS NULL
      OPTIONAL MATCH (t)-[:HAS_FIELD]->(tf:Field) WHERE tf.deleted IS NULL
      WITH 
        coalesce(s.apiName, t.apiName) as apiName,
        s.label as sourceLabel,
        t.label as targetLabel,
        count(DISTINCT sf) as sourceFieldCount,
        count(DISTINCT tf) as targetFieldCount,
        s IS NULL as onlyInTarget,
        t IS NULL as onlyInSource
      RETURN apiName, sourceLabel, targetLabel, sourceFieldCount, targetFieldCount, onlyInSource, onlyInTarget
      ORDER BY apiName
      `,
      { sourceOrg, targetOrg, objectFilter: objectFilter || [] }
    );

    for (const record of result.records) {
      const apiName = record.get('apiName');
      const onlyInSource = record.get('onlyInSource');
      const onlyInTarget = record.get('onlyInTarget');
      const sourceLabel = record.get('sourceLabel');
      const targetLabel = record.get('targetLabel');
      const sourceFieldCount = record.get('sourceFieldCount')?.toNumber?.() ?? record.get('sourceFieldCount');
      const targetFieldCount = record.get('targetFieldCount')?.toNumber?.() ?? record.get('targetFieldCount');

      if (onlyInSource) {
        items.push({
          apiName,
          sourceLabel,
          sourceFieldCount,
          status: 'only-in-source',
          differences: [],
        });
      } else if (onlyInTarget) {
        items.push({
          apiName,
          targetLabel,
          targetFieldCount,
          status: 'only-in-target',
          differences: [],
        });
      } else {
        // Both exist - check for differences
        const differences: string[] = [];

        if (sourceLabel !== targetLabel) {
          differences.push(`label: "${sourceLabel}" vs "${targetLabel}"`);
        }
        if (sourceFieldCount !== targetFieldCount) {
          differences.push(`fields: ${sourceFieldCount} vs ${targetFieldCount}`);
        }

        if (differences.length > 0) {
          items.push({
            apiName,
            sourceLabel,
            targetLabel,
            sourceFieldCount,
            targetFieldCount,
            status: 'different',
            differences,
          });
        }
      }
    }

    // If drift detected, invalidate schema context cache for affected orgs
    if (items.length > 0) {
      const { defaultSchemaContextProvider } = await import('../schema-context/index.js');
      defaultSchemaContextProvider.invalidateCache(sourceOrg);
      defaultSchemaContextProvider.invalidateCache(targetOrg);
    }

    return items;
  } finally {
    await session.close();
  }
}

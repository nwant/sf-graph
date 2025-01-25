/**
 * Schema Comparison Service
 *
 * Compares Salesforce schemas between different orgs to identify differences.
 * Used for detecting schema drift, validating deployments, and comparing
 * sandbox vs production environments.
 */
import { getAllObjects, getObjectFields, GraphField } from './neo4j/graph-service.js';

interface FieldDifference {
  field: string;
  status: 'only_in_source' | 'only_in_target' | 'type_mismatch';
  details?: GraphField;
  sourceType?: string;
  targetType?: string;
}

interface ObjectSchemaDifference {
  objectApiName: string;
  addedFields: string[];
  removedFields: string[];
  typeMismatches: {
    field: string;
    sourceType: string;
    targetType: string;
  }[];
}

export interface SchemaComparisonResult {
  sourceOrg: string;
  targetOrg: string;
  comparedAt: string;
  summary: {
    objectsOnlyInSource: number;
    objectsOnlyInTarget: number;
    objectsWithDifferences: number;
    totalSourceObjects: number;
    totalTargetObjects: number;
  };
  objectsOnlyInSource: string[];
  objectsOnlyInTarget: string[];
  objectsWithDifferences: ObjectSchemaDifference[];
}

export interface ObjectComparisonResult {
  objectApiName: string;
  sourceOrg: string;
  targetOrg: string;
  comparedAt: string;
  totalFieldsInSource: number;
  totalFieldsInTarget: number;
  differencesCount: number;
  differences: FieldDifference[];
}

export interface OrgSyncSummary {
  orgId: string;
  objectCount: number;
  lastSyncedAt: string | null;
}

/**
 * Compare schemas between two orgs
 * @param {string} sourceOrg - Source org ID
 * @param {string} targetOrg - Target org ID
 * @param {string} objectFilter - Optional filter to specific object
 * @returns {Promise<SchemaComparisonResult>} Schema comparison results
 */
export async function compareOrgSchemas(
  sourceOrg: string,
  targetOrg: string,
  objectFilter: string | null = null
): Promise<SchemaComparisonResult> {
  console.log(`Comparing schemas: ${sourceOrg} vs ${targetOrg}`);

  // Get all objects from both orgs
  const sourceObjects = await getAllObjects({ orgId: sourceOrg });
  const targetObjects = await getAllObjects({ orgId: targetOrg });

  // Create sets for comparison
  const sourceSet = new Set(sourceObjects.map((o) => o.apiName));
  const targetSet = new Set(targetObjects.map((o) => o.apiName));

  // Find objects only in source, only in target, and common
  const onlyInSource = [...sourceSet].filter((x) => !targetSet.has(x));
  const onlyInTarget = [...targetSet].filter((x) => !sourceSet.has(x));
  const common = [...sourceSet].filter((x) => targetSet.has(x));

  // Check for field-level differences in common objects
  const objectsWithDifferences: ObjectSchemaDifference[] = [];

  for (const apiName of common) {
    // Skip if filtering to specific object and this isn't it
    if (objectFilter && apiName.toLowerCase() !== objectFilter.toLowerCase()) {
      continue;
    }

    const diff = await compareObjectBetweenOrgs(apiName, sourceOrg, targetOrg);

    // Only include if there are differences
    if (diff.differences.length > 0) {
      objectsWithDifferences.push({
        objectApiName: apiName,
        addedFields: diff.differences
          .filter((d) => d.status === 'only_in_source')
          .map((d) => d.field),
        removedFields: diff.differences
          .filter((d) => d.status === 'only_in_target')
          .map((d) => d.field),
        typeMismatches: diff.differences
          .filter((d): d is FieldDifference & { sourceType: string; targetType: string } => d.status === 'type_mismatch' && !!d.sourceType && !!d.targetType)
          .map((d) => ({
            field: d.field,
            sourceType: d.sourceType,
            targetType: d.targetType,
          })),
      });
    }
  }

  return {
    sourceOrg,
    targetOrg,
    comparedAt: new Date().toISOString(),
    summary: {
      objectsOnlyInSource: onlyInSource.length,
      objectsOnlyInTarget: onlyInTarget.length,
      objectsWithDifferences: objectsWithDifferences.length,
      totalSourceObjects: sourceObjects.length,
      totalTargetObjects: targetObjects.length,
    },
    objectsOnlyInSource: onlyInSource,
    objectsOnlyInTarget: onlyInTarget,
    objectsWithDifferences: objectsWithDifferences,
  };
}

/**
 * Deep compare a specific object between two orgs
 * @param {string} objectApiName - Object API name to compare
 * @param {string} sourceOrg - Source org ID
 * @param {string} targetOrg - Target org ID
 * @returns {Promise<ObjectComparisonResult>} Detailed comparison of the object
 */
export async function compareObjectBetweenOrgs(
  objectApiName: string,
  sourceOrg: string,
  targetOrg: string
): Promise<ObjectComparisonResult> {
  console.log(`Comparing object ${objectApiName}: ${sourceOrg} vs ${targetOrg}`);

  // Get fields from both orgs
  const sourceFields = await getObjectFields(objectApiName, { orgId: sourceOrg });
  const targetFields = await getObjectFields(objectApiName, { orgId: targetOrg });

  // Create maps for comparison
  const sourceFieldMap = new Map(sourceFields.map((f) => [f.apiName, f]));
  const targetFieldMap = new Map(targetFields.map((f) => [f.apiName, f]));

  // Get all unique field names
  const allFieldNames = new Set([...sourceFieldMap.keys(), ...targetFieldMap.keys()]);

  // Compare fields
  const differences: FieldDifference[] = [];

  for (const fieldName of allFieldNames) {
    const inSource = sourceFieldMap.has(fieldName);
    const inTarget = targetFieldMap.has(fieldName);

    if (inSource && !inTarget) {
      differences.push({
        field: fieldName,
        status: 'only_in_source',
        details: sourceFieldMap.get(fieldName),
      });
    } else if (!inSource && inTarget) {
      differences.push({
        field: fieldName,
        status: 'only_in_target',
        details: targetFieldMap.get(fieldName),
      });
    } else {
      // Both have the field - check for type differences
      const sourceField = sourceFieldMap.get(fieldName)!;
      const targetField = targetFieldMap.get(fieldName)!;

      if (sourceField.type !== targetField.type) {
        differences.push({
          field: fieldName,
          status: 'type_mismatch',
          sourceType: sourceField.type,
          targetType: targetField.type,
        });
      }
    }
  }

  return {
    objectApiName,
    sourceOrg,
    targetOrg,
    comparedAt: new Date().toISOString(),
    totalFieldsInSource: sourceFields.length,
    totalFieldsInTarget: targetFields.length,
    differencesCount: differences.length,
    differences,
  };
}

/**
 * Get list of orgs that have been synced to the graph
 * @returns {Promise<OrgSyncSummary[]>} List of unique org IDs in the graph
 */
export async function getSyncedOrgs(): Promise<OrgSyncSummary[]> {
  const allObjects = await getAllObjects();

  // Get unique org IDs
  const orgIds = new Set<string>();
  for (const obj of allObjects) {
    if (obj.orgId) {
      orgIds.add(obj.orgId);
    }
  }

  // Build org summaries
  const orgs: OrgSyncSummary[] = [];
  for (const orgId of orgIds) {
    const orgObjects = await getAllObjects({ orgId });

    // Get most recent sync time
    let lastSyncedAt: Date | null = null;
    for (const obj of orgObjects) {
      if (obj.lastRefreshed) {
        const objDate = new Date(obj.lastRefreshed);
        if (!lastSyncedAt || objDate > lastSyncedAt) {
          lastSyncedAt = objDate;
        }
      }
    }

    orgs.push({
      orgId,
      objectCount: orgObjects.length,
      lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
    });
  }

  return orgs;
}

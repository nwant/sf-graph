/**
 * Data Preparation
 *
 * Functions to transform SF describe results into batch data for Neo4j.
 */

import { classifyObject, classifyField } from '../../../core/object-classifier.js';
import { getRelationshipType } from './relationship-inference.js';
import type {
  DescribeResult,
  ObjectBatchData,
  FieldBatchData,
  FieldLinkData,
  RelationshipData,
  PicklistValueBatchData,
} from './types.js';

/**
 * Prepare object data for batch Neo4j write
 */
export function prepareObjectBatchData(
  describeResults: DescribeResult[],
  orgId: string
): ObjectBatchData[] {
  return describeResults.map(({ describe }) => {
    const classification = classifyObject(describe.name);
    return {
      apiName: describe.name,
      orgId,
      label: describe.label,
      category: classification.category,
      subtype: classification.subtype,
      namespace: classification.namespace || null,
      parentObjectName: classification.parentObjectName || null,
      keyPrefix: describe.keyPrefix || null,
    };
  });
}

/**
 * Prepare field data for batch Neo4j write
 */
export function prepareFieldBatchData(
  describeResults: DescribeResult[],
  orgId: string
): { fieldData: FieldBatchData[]; linkData: FieldLinkData[] } {
  const fieldData: FieldBatchData[] = [];
  const linkData: FieldLinkData[] = [];

  for (const { objectName, describe } of describeResults) {
    for (const field of describe.fields) {
      const classification = classifyField(field.name);
      const relationshipType = getRelationshipType(field, objectName);

      fieldData.push({
        apiName: field.name,
        sobjectType: objectName,
        orgId,
        label: field.label,
        type: field.type,
        nillable: field.nillable,
        unique: field.unique,
        category: classification.category,
        namespace: classification.namespace || null,
        // Store full array for polymorphic lookups
        referenceTo:
          field.referenceTo && field.referenceTo.length > 0
            ? field.referenceTo
            : null,
        relationshipName: field.relationshipName || null,
        relationshipType,
        // SOQL-relevant properties from jsforce Field
        calculated: field.calculated ?? false,
        filterable: field.filterable ?? true,
        sortable: field.sortable ?? true,
        groupable: field.groupable ?? true,
        length: field.length ?? null,
        precision: field.precision ?? null,
        scale: field.scale ?? null,
        // Dependency metadata (Phase 1)
        controllerName: field.controllerName || null,
        isDependentPicklist: field.dependentPicklist ?? false,
      });

      linkData.push({
        objectName,
        fieldName: field.name,
        orgId,
      });
    }
  }

  return { fieldData, linkData };
}

/**
 * Prepare relationship data for batch Neo4j write
 */
export function prepareRelationshipBatchData(
  describeResults: DescribeResult[],
  orgId: string
): RelationshipData[] {
  const refData: RelationshipData[] = [];

  for (const { objectName, describe } of describeResults) {
    for (const field of describe.fields) {
      if (
        field.type === 'reference' &&
        field.referenceTo &&
        field.referenceTo.length > 0
      ) {
        const relationshipType = getRelationshipType(field, objectName)!;

        for (const targetObject of field.referenceTo) {
          const targetClassification = classifyObject(targetObject);

          refData.push({
            sourceObject: objectName,
            targetObject,
            fieldName: field.name,
            relationshipType,
            orgId,
            targetCategory: targetClassification.category,
            targetSubtype: targetClassification.subtype,
            targetNamespace: targetClassification.namespace || null,
            targetParentObjectName:
              targetClassification.parentObjectName || null,
          });
        }
      }
    }
  }

  return refData;
}

/**
 * Prepare picklist value data for batch Neo4j write
 * 
 * Deduplicates values early to avoid processing the same value multiple times.
 * Salesforce describe can return the same picklist value many times across
 * different fields, but we only need to store each unique combination once.
 */
export function preparePicklistBatchData(
  describeResults: DescribeResult[],
  orgId: string
): PicklistValueBatchData[] {
  // Use Map for deduplication - key is objectApiName:fieldApiName:value
  const uniqueValues = new Map<string, PicklistValueBatchData>();

  for (const { objectName, describe } of describeResults) {
    for (const field of describe.fields) {
      // Check if field has picklist values
      if (
        (field.type === 'picklist' || field.type === 'multipicklist') &&
        field.picklistValues &&
        field.picklistValues.length > 0
      ) {
        // Add each picklist value (deduplicated)
        for (const picklistValue of field.picklistValues) {
          const key = `${objectName}:${field.name}:${picklistValue.value}`;
          
          // Only add if not already seen
          if (!uniqueValues.has(key)) {
            uniqueValues.set(key, {
              objectApiName: objectName,
              fieldApiName: field.name,
              value: picklistValue.value,
              label: picklistValue.label,
              isActive: picklistValue.active,
              defaultValue: picklistValue.defaultValue,
              validFor: picklistValue.validFor ?? null,
              orgId,
            });
          }
        }
      }
    }
  }

  return Array.from(uniqueValues.values());
}

/**
 * Prepare field dependency data for batch Neo4j write
 */
export function prepareFieldDependencyBatchData(
  describeResults: DescribeResult[],
  orgId: string
): import('./types.js').FieldDependencyData[] {
  const dependencyData: import('./types.js').FieldDependencyData[] = [];

  for (const { objectName, describe } of describeResults) {
    for (const field of describe.fields) {
      if (field.controllerName) {
        dependencyData.push({
          sourceField: field.name,
          controllerField: field.controllerName,
          objectName,
          orgId,
        });
      }
    }
  }

  return dependencyData;
}


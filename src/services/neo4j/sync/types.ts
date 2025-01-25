/**
 * Sync Module Types
 *
 * Internal types for batch data preparation and processing.
 */

import type { DescribeSObjectResult } from 'jsforce';

export interface DescribeResult {
  objectName: string;
  describe: DescribeSObjectResult;
}

export interface ObjectBatchData {
  apiName: string;
  orgId: string;
  label: string;
  category: string;
  subtype: string | null;
  namespace: string | null;
  parentObjectName: string | null;
  keyPrefix: string | null;
}

export interface FieldBatchData {
  apiName: string;
  sobjectType: string;
  orgId: string;
  label: string;
  type: string;
  nillable: boolean;
  unique: boolean;
  category: string;
  namespace: string | null;
  referenceTo: string[] | null;
  relationshipName: string | null;
  relationshipType: string | null;
  // SOQL-relevant properties
  calculated: boolean;
  filterable: boolean;
  sortable: boolean;
  groupable: boolean;
  length: number | null;
  precision: number | null;
  scale: number | null;
  // Dependency metadata (Phase 1)
  controllerName: string | null;
  isDependentPicklist: boolean;
}

export interface FieldLinkData {
  objectName: string;
  fieldName: string;
  orgId: string;
}

export interface RelationshipData {
  sourceObject: string;
  targetObject: string;
  fieldName: string;
  relationshipType: string;
  orgId: string;
  targetCategory: string;
  targetSubtype: string | null;
  targetNamespace: string | null;
  targetParentObjectName: string | null;
}

export interface PicklistValueBatchData {
  objectApiName: string;
  fieldApiName: string;
  value: string;
  label: string;
  isActive: boolean;
  defaultValue: boolean;
  validFor: string | null;
  orgId: string;
}

export interface FieldDependencyData {
  sourceField: string;
  controllerField: string;
  objectName: string;
  orgId: string;
}


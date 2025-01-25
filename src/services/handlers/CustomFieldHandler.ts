import { Transaction, ManagedTransaction } from 'neo4j-driver';
import { MetadataItem } from '../salesforce.js';
import { BaseHandler } from './BaseHandler.js';
import { classifyField, FieldCategory } from '../../core/object-classifier.js';

interface FieldDefinition {
  apiName: string;
  sobjectType: string;
  label: string;
  type: string;
  description: string;
  required: boolean;
  category: FieldCategory;
  namespace?: string;
  referenceTo: string[] | null;
  relationshipName: string | null;
  relationshipType: 'Lookup' | 'MasterDetail' | 'Hierarchical' | null;
  helpText?: string;
  nillable?: boolean;
  unique?: boolean;
  controllerName?: string | null;
  // SOQL-relevant properties
  calculated?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  length?: number | null;
  precision?: number | null;
  scale?: number | null;
}

export class CustomFieldHandler extends BaseHandler {
  async process(tx: Transaction | ManagedTransaction, item: MetadataItem): Promise<void> {
    // Extract object name and field type from the content
    // item.name is typically 'Object.Field'
    const parts = item.name.split('.');
    const objectName = parts[0];

    // Normalize content
    const content = this.normalizeContent(item, 'CustomField');
    const fieldType = (content.type as string) || 'Unknown';

    // Extract additional field properties
    const additionalProps = item.additionalProps || {};

    // Get API name and classify the field
    const fieldApiName = (additionalProps.apiName as string) || item.name;
    const fieldClassification = classifyField(fieldApiName);

    // Extract referenceTo as array (handle both string and array formats)
    let referenceTo: string[] | null = null;
    if (content.referenceTo) {
      if (Array.isArray(content.referenceTo)) {
        referenceTo = content.referenceTo as string[];
      } else {
        referenceTo = [content.referenceTo as string];
      }
    }

    // Detect relationship type including hierarchical (self-referential)
    let relationshipType: 'Lookup' | 'MasterDetail' | 'Hierarchical' | null = null;
    if (['Lookup', 'MasterDetail'].includes(fieldType) && referenceTo) {
      if (referenceTo.includes(objectName)) {
        relationshipType = 'Hierarchical';
      } else if (fieldType === 'MasterDetail') {
        relationshipType = 'MasterDetail';
      } else {
        relationshipType = 'Lookup';
      }
    }

    // Prepare field definition object
    const fieldDefinition: FieldDefinition = {
      apiName: fieldApiName,
      sobjectType: objectName,
      label: (additionalProps.label as string) || '',
      type: fieldType,
      description: (additionalProps.description as string) || '',
      required: additionalProps.required === true,
      category: fieldClassification.category,
      namespace: fieldClassification.namespace,
      referenceTo,
      relationshipName: (content.relationshipName as string) || null,
      relationshipType,
      // SOQL-relevant properties (may come from content or additionalProps)
      calculated: (content.calculated as boolean) ?? false,
      filterable: (content.filterable as boolean) ?? true,
      sortable: (content.sortable as boolean) ?? true,
      groupable: (content.groupable as boolean) ?? true,
      length: (content.length as number) ?? null,
      precision: (content.precision as number) ?? null,
      scale: (content.scale as number) ?? null,
      controllerName: (content.controllerName as string) || null,
    };

    await this.processFieldDefinition(tx, fieldDefinition, item.orgId);
  }

  async processFieldDefinition(
    tx: Transaction | ManagedTransaction,
    field: FieldDefinition,
    orgId?: string
  ): Promise<void> {
    // Determine fieldApiName for linking
    const fieldApiName = field.apiName.includes('.')
      ? field.apiName.split('.')[1]
      : field.apiName;

    await tx.run(
      `
            MERGE (f:Field {apiName: $apiName, sobjectType: $sobjectType, orgId: $orgId})
            ON CREATE SET
                f.label = $label,
                f.type = $type,
                f.description = $description,
                f.required = $required,
                f.category = $category,
                f.namespace = $namespace,
                f.helpText = $helpText,
                f.nillable = $nillable,
                f.unique = $unique,
                f.relationshipName = $relationshipName,
                f.relationshipType = $relationshipType,
                f.referenceTo = $referenceTo,
                f.calculated = $calculated,
                f.filterable = $filterable,
                f.sortable = $sortable,
                f.groupable = $groupable,
                f.length = $length,
                f.precision = $precision,
                f.scale = $scale,
                f.lastRefreshed = datetime(),
                f.name = $apiName,
                f.controllerName = $controllerName
            ON MATCH SET
                f.label = $label,
                f.type = $type,
                f.description = $description,
                f.required = $required,
                f.category = $category,
                f.namespace = $namespace,
                f.helpText = $helpText,
                f.nillable = $nillable,
                f.unique = $unique,
                f.relationshipName = $relationshipName,
                f.relationshipType = $relationshipType,
                f.referenceTo = $referenceTo,
                f.calculated = $calculated,
                f.filterable = $filterable,
                f.sortable = $sortable,
                f.groupable = $groupable,
                f.length = $length,
                f.precision = $precision,
                f.scale = $scale,
                f.lastRefreshed = datetime(),
                f.name = $apiName,
                f.controllerName = $controllerName
            `,
      {
        apiName: fieldApiName,
        sobjectType: field.sobjectType,
        label: field.label,
        type: field.type,
        description: field.description,
        required: field.required,
        category: field.category,
        namespace: field.namespace || null,
        helpText: field.helpText || '',
        nillable: field.nillable !== undefined ? field.nillable : true,
        unique: field.unique || false,
        relationshipName: field.relationshipName || null,
        relationshipType: field.relationshipType || null,
        referenceTo: field.referenceTo || null,
        calculated: field.calculated ?? false,
        filterable: field.filterable ?? true,
        sortable: field.sortable ?? true,
        groupable: field.groupable ?? true,
        length: field.length ?? null,
        precision: field.precision ?? null,
        scale: field.scale ?? null,
        controllerName: field.controllerName || null,
        orgId: orgId || null,
      }
    );

    // Link to Parent Object
    await tx.run(
      `
            MATCH (o:Object), (f:Field)
            WHERE toLower(o.apiName) = toLower($objectName) AND ($orgId IS NULL OR o.orgId = $orgId)
            AND f.apiName = $fieldApiName AND f.sobjectType = $sobjectType AND ($orgId IS NULL OR f.orgId = $orgId)
            MERGE (o)-[:HAS_FIELD]->(f)
            MERGE (f)-[:BELONGS_TO]->(o)
            `,
      {
        objectName: field.sobjectType,
        fieldApiName: fieldApiName,
        sobjectType: field.sobjectType,
        orgId,
      }
    );

    // Create Reference Relationships (Lookup/MasterDetail) for all target objects (polymorphic support)
    if (['Lookup', 'MasterDetail'].includes(field.type) && field.referenceTo && field.referenceTo.length > 0) {
      // Use LOOKS_UP for Lookup and Hierarchical, MASTER_DETAIL for MasterDetail
      const relType = field.relationshipType === 'MasterDetail' ? 'MASTER_DETAIL' : 'LOOKS_UP';

      // Create typed Field→Object edges for each target
      for (const targetObject of field.referenceTo) {
        await tx.run(
          `
                MATCH (f:Field), (targetObj:Object)
                WHERE f.apiName = $fieldApiName AND f.sobjectType = $sobjectType AND ($orgId IS NULL OR f.orgId = $orgId)
                AND toLower(targetObj.apiName) = toLower($referenceTo) AND ($orgId IS NULL OR targetObj.orgId = $orgId)
                MERGE (f)-[:${relType}]->(targetObj)
                `,
          {
            fieldApiName: fieldApiName,
            sobjectType: field.sobjectType,
            referenceTo: targetObject,
            orgId,
          }
        );

        // Create high-level Object-to-Object REFERENCES relationship
        await tx.run(
          `
          MATCH (source:Object), (target:Object)
          WHERE toLower(source.apiName) = toLower($sourceObject) AND ($orgId IS NULL OR source.orgId = $orgId)
            AND toLower(target.apiName) = toLower($targetObject) AND ($orgId IS NULL OR target.orgId = $orgId)
          MERGE (source)-[r:REFERENCES]->(target)
          ON CREATE SET
            r.fields = [$fieldName],
            r.relationshipType = $relationshipType
          ON MATCH SET
            r.fields = CASE
              WHEN $fieldName IN coalesce(r.fields, []) THEN r.fields
              ELSE coalesce(r.fields, []) + $fieldName
            END,
            r.relationshipType = CASE
              WHEN $relationshipType = 'MASTER_DETAIL' THEN 'MASTER_DETAIL'
              WHEN r.relationshipType = 'MASTER_DETAIL' THEN 'MASTER_DETAIL'
              ELSE 'LOOKUP'
            END
          WITH r
          SET r.fieldCount = size(r.fields)
          `,
          {
            sourceObject: field.sobjectType,
            targetObject: targetObject,
            fieldName: fieldApiName,
            relationshipType: field.relationshipType === 'MasterDetail' ? 'MASTER_DETAIL' : 'LOOKUP',
            orgId,
          }
        );
      }
    }
  }
}

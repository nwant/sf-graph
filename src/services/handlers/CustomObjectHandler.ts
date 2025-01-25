import { Transaction, ManagedTransaction } from 'neo4j-driver';
import { MetadataItem } from '../salesforce.js';
import { BaseHandler } from './BaseHandler.js';
import { classifyObject, ObjectCategory, ObjectSubtype } from '../../core/object-classifier.js';

interface ObjectDefinition {
  apiName: string;
  label: string;
  description: string;
  category: ObjectCategory;
  subtype: ObjectSubtype;
  namespace?: string;
  parentObjectName?: string;
}

interface RecordTypeDefinition {
  apiName: string;
  sobjectType: string;
  label: string;
  description: string;
  isActive: boolean;
  isDefault: boolean;
}

export class CustomObjectHandler extends BaseHandler {
  async process(tx: Transaction | ManagedTransaction, item: MetadataItem): Promise<void> {
    const apiName = item.name;
    let label = '';
    let description = '';

    // Classify the object using the new classification system
    const classification = classifyObject(apiName);

    // Extract properties carefully as they might be arrays from XML parsing
    if (item.content && typeof item.content === 'object') {
      const content = item.content as Record<string, any>;
      if (content.CustomObject) {
        label = content.CustomObject.label?.[0] || '';
        description = content.CustomObject.description?.[0] || '';
      } else {
        label = (content.label as string) || '';
        description = (content.description as string) || '';
      }
    }

    const objectDefinition: ObjectDefinition = {
      apiName,
      label,
      description,
      category: classification.category,
      subtype: classification.subtype,
      namespace: classification.namespace,
      parentObjectName: classification.parentObjectName,
    };

    await this.processObjectDefinition(tx, objectDefinition);
  }

  async processObjectDefinition(
    tx: Transaction | ManagedTransaction,
    objectDef: ObjectDefinition & { orgId?: string }
  ): Promise<void> {
    await tx.run(
      `
            MERGE (o:Object {apiName: $apiName, orgId: $orgId})
            ON CREATE SET
                o.label = $label,
                o.description = $description,
                o.category = $category,
                o.subtype = $subtype,
                o.namespace = $namespace,
                o.parentObjectName = $parentObjectName,
                o.lastRefreshed = datetime(),
                o.name = $apiName
            ON MATCH SET
                o.label = $label,
                o.description = $description,
                o.category = $category,
                o.subtype = $subtype,
                o.namespace = $namespace,
                o.parentObjectName = $parentObjectName,
                o.lastRefreshed = datetime(),
                o.name = $apiName
            `,
      {
        apiName: objectDef.apiName,
        label: objectDef.label,
        description: objectDef.description,
        category: objectDef.category,
        subtype: objectDef.subtype,
        namespace: objectDef.namespace || null,
        parentObjectName: objectDef.parentObjectName || null,
        orgId: objectDef.orgId || null,
      }
    );

    // If this is a derived object, create DERIVED_FROM relationship to parent
    if (objectDef.parentObjectName) {
      await tx.run(
        `
              MATCH (derived:Object {apiName: $apiName, orgId: $orgId})
              MATCH (parent:Object)
              WHERE toLower(parent.apiName) = toLower($parentObjectName)
                AND ($orgId IS NULL OR parent.orgId = $orgId)
              MERGE (derived)-[:DERIVED_FROM]->(parent)
              `,
        {
          apiName: objectDef.apiName,
          parentObjectName: objectDef.parentObjectName,
          orgId: objectDef.orgId || null,
        }
      );
    }
  }

  async processRecordTypeDefinition(
    tx: Transaction | ManagedTransaction,
    recordType: RecordTypeDefinition,
    orgId?: string
  ): Promise<void> {
    await tx.run(
      `
             MERGE (rt:RecordType {apiName: $apiName, sobjectType: $sobjectType, orgId: $orgId})
             ON CREATE SET
                 rt.label = $label,
                 rt.description = $description,
                 rt.isActive = $isActive,
                 rt.isDefault = $isDefault,
                 rt.lastRefreshed = datetime(),
                 rt.name = $apiName
             ON MATCH SET
                 rt.label = $label,
                 rt.description = $description,
                 rt.isActive = $isActive,
                 rt.isDefault = $isDefault,
                 rt.lastRefreshed = datetime(),
                 rt.name = $apiName
             `,
      {
        apiName: recordType.apiName,
        sobjectType: recordType.sobjectType,
        label: recordType.label,
        description: recordType.description,
        isActive: recordType.isActive,
        isDefault: recordType.isDefault,
        name: recordType.apiName,
        orgId: orgId || null,
      }
    );

    await tx.run(
      `
             MATCH (o:Object), (rt:RecordType)
             WHERE toLower(o.apiName) = toLower($objectApiName) AND ($orgId IS NULL OR o.orgId = $orgId)
             AND rt.apiName = $recordTypeApiName AND rt.sobjectType = $sobjectType AND ($orgId IS NULL OR rt.orgId = $orgId)
             MERGE (o)-[:HAS_RECORD_TYPE]->(rt)
             `,
      {
        objectApiName: recordType.sobjectType,
        recordTypeApiName: recordType.apiName,
        sobjectType: recordType.sobjectType,
        orgId,
      }
    );
  }
}

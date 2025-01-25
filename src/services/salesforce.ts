/**
 * Salesforce Service - Metadata Fetching and Connection Management
 *
 * Handles all Salesforce API interactions via jsforce, authenticated through SF CLI.
 */

import jsforce from 'jsforce';
import xml2js from 'xml2js';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { getOrgConnection, getDefaultOrgAlias, isSfCliInstalled } from './sf-cli.js';
import {
  SalesforceConnectionError,
  SalesforceApiError,
  ConfigurationError,
} from '../core/errors.js';
import type { PicklistValue } from '../core/types.js';
import { createLogger } from '../core/index.js';

const log = createLogger('salesforce');

// === Types ===

export interface SalesforceConnection {
  accessToken: string;
  instanceUrl: string;
  username: string;
}

export interface MetadataItem {
  type: string;
  name: string;
  fullName?: string;
  content?: Record<string, unknown>;
  additionalProps?: Record<string, unknown>;
  orgId?: string;
}

export interface FieldMetadata {
  type: 'Field';
  apiName: string;
  sobjectType: string;
  label: string;
  fieldType: string;
  description: string;
  helpText: string;
  referenceTo: string[] | null;
  relationshipName: string | null;
  nillable: boolean;
  unique: boolean;
  isCustom: boolean;
  relationshipType: 'MasterDetail' | 'Lookup' | 'Hierarchical' | null;
  // SOQL-relevant properties
  calculated?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  length?: number | null;
  precision?: number | null;
  scale?: number | null;
  picklistValues?: PicklistValue[];
  controllerName?: string | null;
}

/**
 * Child relationship metadata from Salesforce describe.
 * Used to generate SOQL subqueries (e.g., SELECT ... FROM Contacts).
 */
export interface ChildRelationship {
  /** The child object that references this object */
  childSObject: string;
  /** The field on the child object that creates the relationship */
  field: string;
  /** The relationship name used in SOQL subqueries (e.g., 'Contacts') */
  relationshipName: string;
  /** Whether cascade delete is enabled (indicates Master-Detail) */
  cascadeDelete: boolean;
}

export interface ToolingRecordType {
  Id: string;
  DeveloperName: string;
  Name: string;
  Description?: string;
  IsActive: boolean;
  SobjectType: string;
  BusinessProcessId?: string;
  NamespacePrefix?: string;
}

// Extend jsforce Field definition to include missing properties
interface ExtendedField extends jsforce.Field {
  description?: string;
}

export interface RecordTypeMetadata {
  apiName: string;
  sobjectType: string;
  label: string;
  description: string;
  isActive: boolean;
  isDefault: boolean;
}

interface SalesforceConfig {
  types: string[];
}

// === Module State ===

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let conn: jsforce.Connection | null = null;
let currentOrgAlias: string | null = null;

// Development configuration
const DEV_MODE = process.env.NODE_ENV !== 'production';
const DEV_CONFIG: SalesforceConfig = {
  types: ['CustomObject', 'CustomField'], // Reduced set for faster development
};

// Load production configuration from file
function loadConfig(): SalesforceConfig {
  try {
    const configPath = path.resolve(process.cwd(), 'sf-graph.config.json');
    if (fs.existsSync(configPath)) {
      const configFile = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return {
        types: configFile.metadataTypes.map((t: { name: string }) => t.name),
      };
    }
    log.warn('Config file not found, defaulting to basic types');
    return { types: ['CustomObject', 'CustomField'] };
  } catch (e) {
    log.error({ err: e }, 'Error loading config');
    return { types: ['CustomObject', 'CustomField'] };
  }
}

const PROD_CONFIG = loadConfig();

// === Connection Management ===

/**
 * Initialize Salesforce connection using SF CLI authentication
 */
export async function initSalesforceConnection(orgAlias?: string): Promise<void> {
  try {

    // Check if SF CLI is installed
    const sfCliAvailable = await isSfCliInstalled();
    if (!sfCliAvailable) {
      throw new SalesforceConnectionError(
        'Salesforce CLI not found. Install with: npm install -g @salesforce/cli\n' +
          'Then authenticate: sf org login web --alias my-org'
      );
    }

    // Get org alias from parameter or environment
    const targetOrg = orgAlias || (await getDefaultOrgAlias());
    if (!targetOrg) {
      throw new ConfigurationError(
        'No Salesforce org specified. Either:\n' +
          '1. Pass orgAlias parameter, or\n' +
          '2. Set a default org via wizard: sf graph org config, or\n' +
          '3. Set a default org: sf config set target-org my-org',
        'SF_DEFAULT_ORG'
      );
    }



    // Get access token from SF CLI
    const { accessToken, instanceUrl } = await getOrgConnection(targetOrg);

    // Create jsforce connection with access token (no password needed!)
    conn = new jsforce.Connection({
      accessToken,
      instanceUrl,
      version: '60.0',
    });

    currentOrgAlias = targetOrg;

  } catch (error) {
    // Re-throw if already a custom error
    if (error instanceof SalesforceConnectionError || error instanceof ConfigurationError) {
      throw error;
    }
    log.error({ err: error }, 'Error connecting to Salesforce');
    throw new SalesforceConnectionError(
      `Failed to connect to Salesforce: ${error instanceof Error ? error.message : String(error)}`,
      orgAlias,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Set an existing connection object (e.g. from @salesforce/core)
 * @param connection The initialized connection object
 */
export function setConnection(connection: jsforce.Connection): void {
  conn = connection;
  
  // Try to determine username/alias for logging
  try {
    // @ts-expect-error: accessing internal or dynamic properties from @salesforce/core connection
    const authInfo = connection.getAuthInfo && connection.getAuthInfo();
    if (authInfo) {
       currentOrgAlias = (authInfo as any).getUsername();
    } else {
       // @ts-expect-error: accessing internal properties
       currentOrgAlias = connection.getUsername ? connection.getUsername() : 'injected-connection';
    }

  } catch (e) {
    currentOrgAlias = 'injected-connection';

  }
}

/**
 * Get the current org alias
 */
export function getCurrentOrgAlias(): string | null {
  return currentOrgAlias;
}

/**
 * Check if connection is initialized
 */
export function isConnectionInitialized(): boolean {
  return conn !== null;
}

// === Metadata Fetching ===

/**
 * Fetch all metadata items of configured types
 */
export async function fetchMetadata(): Promise<MetadataItem[]> {
  if (!conn) {
    throw new SalesforceConnectionError('Salesforce connection not initialized');
  }

  try {
    const config = DEV_MODE ? DEV_CONFIG : PROD_CONFIG;

    await conn.metadata.describe();


    const metadataItems: MetadataItem[] = [];
    for (const type of config.types) {

      const items = await conn.metadata.list([{ type }]);
      if (items) {
           const itemsArray = Array.isArray(items) ? items : [items];
           if (itemsArray.length > 0) {

             metadataItems.push(
               ...itemsArray.map((item) => ({
                 type,
                 name: item.fullName,
                 fullName: item.fullName,
               }))
             );
           } else {
             // No items found for this type
           }
      } else {
         // No items found for this type

      }
    }
    return metadataItems;
  } catch (error) {
    log.error({ err: error }, 'Error fetching metadata');
    throw new SalesforceApiError(
      `Failed to fetch metadata: ${error instanceof Error ? error.message : String(error)}`,
      'metadata.list',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Fetch object-level describe info (label, keyPrefix, etc.)
 */
export async function fetchObjectDescribe(objectApiName: string): Promise<{
  label: string;
  keyPrefix: string | null;
  isCustom: boolean;
} | null> {
  if (!conn) {
    throw new SalesforceConnectionError('Salesforce connection not initialized');
  }

  try {
    const objectDescribe = await conn.describe(objectApiName);
    if (!objectDescribe) {
      return null;
    }

    return {
      label: objectDescribe.label,
      keyPrefix: objectDescribe.keyPrefix || null,
      isCustom: objectDescribe.custom,
    };
  } catch (err) {
    // Object might not exist or not be describable - this is normal for some internal objects
    log.debug({ err, objectApiName }, 'Object describe failed (may be internal/system object)');
    return null;
  }
}

/**
 * Fetch metadata for a specific object
 */
export async function fetchObjectMetadata(objectApiName: string): Promise<MetadataItem> {
  if (!conn) {
    throw new SalesforceConnectionError('Salesforce connection not initialized');
  }

  try {

    // Create a metadata item for the specific object
    const item = {
      type: 'CustomObject',
      fullName: objectApiName,
    };

    // Retrieve the metadata details for this object
    const detailedItem = await retrieveMetadataDetails([item]);

    if (detailedItem.length === 0) {
      throw new SalesforceApiError(
        `Object ${objectApiName} not found or could not be retrieved`,
        'metadata.retrieve'
      );
    }

    return detailedItem[0];
  } catch (error) {
    if (error instanceof SalesforceApiError || error instanceof SalesforceConnectionError) {
      throw error;
    }
    log.error({ err: error, objectApiName }, 'Error fetching metadata for object');
    throw new SalesforceApiError(
      `Failed to fetch metadata for object ${objectApiName}: ${error instanceof Error ? error.message : String(error)}`,
      'metadata.retrieve',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Fetch fields for a specific object
 */
export async function fetchObjectFields(objectApiName: string): Promise<FieldMetadata[]> {
  if (!conn) {
    throw new SalesforceConnectionError('Salesforce connection not initialized');
  }

  try {

    try {
      const objectDescribe = await conn.describe(objectApiName);
      if (!objectDescribe) {
        log.warn({ objectApiName }, 'Object not found or could not be described');
        return [];
      }

      const fields = (objectDescribe.fields || []) as ExtendedField[];


      // Transform fields to match the expected format
      return fields.map((field) => {
        // Detect relationship type including hierarchical (self-referential)
        let relationshipType: 'MasterDetail' | 'Lookup' | 'Hierarchical' | null = null;
        if (field.type === 'reference' && field.relationshipName) {
          if (field.referenceTo?.includes(objectApiName)) {
            relationshipType = 'Hierarchical';
          } else if (field.cascadeDelete) {
            relationshipType = 'MasterDetail';
          } else {
            relationshipType = 'Lookup';
          }
        }

        return {
          type: 'Field' as const,
          apiName: field.name,
          sobjectType: objectApiName,
          label: field.label,
          fieldType: field.type,
          description: field.description || '',
          helpText: field.inlineHelpText || '',
          // Store full array for polymorphic lookups
          referenceTo:
            field.referenceTo && field.referenceTo.length > 0 ? field.referenceTo : null,
          relationshipName: field.relationshipName || null,
          nillable: field.nillable,
          unique: field.unique,
          isCustom: field.custom,
          relationshipType,
          // SOQL-relevant properties
          calculated: field.calculated ?? false,
          filterable: field.filterable ?? true,
          sortable: field.sortable ?? true,
          groupable: field.groupable ?? true,
          length: field.length ?? null,
          precision: field.precision ?? null,
          scale: field.scale ?? null,
          picklistValues: field.picklistValues?.map((pv) => ({
            active: pv.active,
            defaultValue: pv.defaultValue,
            label: pv.label || pv.value,
            value: pv.value,
            validFor: pv.validFor,
          })),
          controllerName: field.controllerName || null,
        };
      });
    } catch (apiError) {
      // Handle specific Salesforce API errors
      if ((apiError as { errorCode?: string }).errorCode === 'NOT_FOUND') {
        log.warn({ objectApiName }, 'Object not found in Salesforce. Skipping field processing.');
        return [];
      }
      throw apiError;
    }
  } catch (error) {
    log.error({ err: error, objectApiName }, 'Error fetching fields for object');
    throw new Error(
      `Failed to fetch fields for object ${objectApiName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Fetch child relationships for a specific object.
 * Child relationships define how other objects reference this object,
 * and provide the relationship names used in SOQL subqueries.
 * 
 * Example: For Account, this returns relationships like:
 * - { childSObject: 'Contact', field: 'AccountId', relationshipName: 'Contacts' }
 * 
 * This allows SOQL like: SELECT Name, (SELECT FirstName FROM Contacts) FROM Account
 */
export async function fetchChildRelationships(objectApiName: string): Promise<ChildRelationship[]> {
  if (!conn) {
    throw new SalesforceConnectionError('Salesforce connection not initialized');
  }

  try {
    const objectDescribe = await conn.describe(objectApiName);
    if (!objectDescribe) {
      log.warn({ objectApiName }, 'Object not found or could not be described');
      return [];
    }

    const childRelationships = objectDescribe.childRelationships || [];
    
    // Filter out relationships without a name (can't be used in SOQL)
    return childRelationships
      .filter((rel) => rel.relationshipName)
      .map((rel) => ({
        childSObject: rel.childSObject as string,
        field: rel.field as string,
        relationshipName: rel.relationshipName as string,
        cascadeDelete: (rel.cascadeDelete as boolean) ?? false,
      }));
  } catch (error) {
    if ((error as { errorCode?: string }).errorCode === 'NOT_FOUND') {
      log.warn({ objectApiName }, 'Object not found in Salesforce. Skipping child relationships.');
      return [];
    }
    log.error({ err: error, objectApiName }, 'Error fetching child relationships for object');
    throw new SalesforceApiError(
      `Failed to fetch child relationships for ${objectApiName}: ${error instanceof Error ? error.message : String(error)}`,
      'describe',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Fetch record types for a specific object
 */
export async function fetchObjectRecordTypes(objectApiName: string): Promise<RecordTypeMetadata[]> {
  if (!conn) {
    throw new Error('Salesforce connection not initialized');
  }

  try {

    const result = await conn.query(`
      SELECT 
        Id, 
        DeveloperName,
        Name,
        Description,
        IsActive,
        SobjectType,
        BusinessProcessId
      FROM RecordType 
      WHERE SobjectType = '${objectApiName}'
      ORDER BY DeveloperName
    `);

    if (!result || !result.records || result.records.length === 0) {

      return [];
    }



    // Cast the records to our explicit interface since we requested these fields in the query
    return (result.records as unknown as ToolingRecordType[]).map(
      (record: ToolingRecordType) => ({
        apiName: record.DeveloperName,
        sobjectType: objectApiName,
        label: record.Name,
        description: record.Description || '',
        isActive: record.IsActive,
        isDefault: !record.BusinessProcessId,
      })
    );
  } catch (error) {
    log.error({ err: error, objectApiName }, 'Error fetching record types for object');
    throw new Error(
      `Failed to fetch record types for object ${objectApiName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Retrieve detailed metadata for multiple items in batches
 */
export async function retrieveMetadataDetails(
  items: { type: string; fullName: string }[]
): Promise<MetadataItem[]> {
  if (!conn) {
    throw new Error('Salesforce connection not initialized');
  }

  try {
    const parseXml = promisify(xml2js.parseString);
    const batchSize = 5;
    const details: MetadataItem[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchPromises = batch.map(async (item) => {
        try {

          // jsforce metadata.read expects a specific string union but accepts string at runtime
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const metadata = await conn!.metadata.read(item.type as any, [item.fullName]);

          if (metadata) {
            // Check for XML string (older API/mock?) or object
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (typeof (metadata as any) === 'string' && (metadata as any as string).startsWith('<?xml')) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const parsed = await parseXml(metadata as any as string);

              // Extract additional field properties for CustomField type
              let additionalProps: Record<string, unknown> = {};
              if (
                item.type === 'CustomField' &&
                (parsed as { CustomField?: unknown }).CustomField
              ) {
                const fieldData = (parsed as { CustomField: Record<string, string[]> }).CustomField;
                additionalProps = {
                  description: fieldData.description?.[0] || '',
                  apiName: item.fullName,
                  label: fieldData.label?.[0] || '',
                  required: fieldData.required?.[0] === 'true',
                  isCustom: item.fullName.endsWith('__c'),
                };
              }

              return {
                type: item.type,
                name: item.fullName,
                content: parsed as Record<string, unknown>,
                additionalProps,
              };
            }

            // Handle non-XML metadata response (object/JSON)
            let additionalProps: Record<string, unknown> = {};
            if (item.type === 'CustomField') {
               // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const md = metadata as any;
              additionalProps = {
                description: md.description || '',
                apiName: item.fullName,
                label: md.label || '',
                required: md.required === true || md.required === 'true',
                isCustom: item.fullName.endsWith('__c'),
              };
            }
            return {
              type: item.type,
              name: item.fullName,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              content: metadata as any,
              additionalProps,
            };
          }

          return null;
        } catch (error) {
          log.error({ err: error, fullName: item.fullName }, 'Error retrieving metadata');
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      const validResults = batchResults.filter((result) => result !== null) as MetadataItem[];
      details.push(...validResults);

      if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
        // Progress logged via caller's spinner

      }
    }

    return details;
  } catch (error) {
    log.error({ err: error }, 'Error retrieving metadata details');
    throw error;
  }
}

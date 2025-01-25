/**
 * Tests for data-preparation.ts
 *
 * Tests the data transformation functions for batch Neo4j writes.
 */

import {
  prepareObjectBatchData,
  prepareFieldBatchData,
  prepareRelationshipBatchData,
} from '../../../../dist/services/neo4j/sync/data-preparation.js';

describe('Data Preparation', () => {
  describe('prepareObjectBatchData', () => {
    it('should return empty array for empty input', () => {
      const result = prepareObjectBatchData([], 'test-org');
      expect(result).toEqual([]);
    });

    it('should map standard object correctly', () => {
      const describeResults = [
        {
          objectName: 'Account',
          describe: {
            name: 'Account',
            label: 'Account',
            keyPrefix: '001',
            fields: [],
          },
        },
      ];

      const result = prepareObjectBatchData(describeResults, 'org-123');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        apiName: 'Account',
        orgId: 'org-123',
        label: 'Account',
        category: 'standard',
        subtype: null,
        namespace: null,
        parentObjectName: null,
        keyPrefix: '001',
      });
    });

    it('should map custom object correctly', () => {
      const describeResults = [
        {
          objectName: 'MyObject__c',
          describe: {
            name: 'MyObject__c',
            label: 'My Object',
            keyPrefix: 'a00',
            fields: [],
          },
        },
      ];

      const result = prepareObjectBatchData(describeResults, 'org-456');

      expect(result).toHaveLength(1);
      expect(result[0].apiName).toBe('MyObject__c');
      expect(result[0].category).toBe('custom');
      expect(result[0].orgId).toBe('org-456');
    });

    it('should map namespaced object correctly', () => {
      const describeResults = [
        {
          objectName: 'ns__CustomObj__c',
          describe: {
            name: 'ns__CustomObj__c',
            label: 'Namespaced Object',
            keyPrefix: 'a01',
            fields: [],
          },
        },
      ];

      const result = prepareObjectBatchData(describeResults, 'org-789');

      expect(result[0].namespace).toBe('ns');
      // Category is still 'custom' (suffix-based), namespace is a separate property
      expect(result[0].category).toBe('custom');
    });

    it('should handle null keyPrefix', () => {
      const describeResults = [
        {
          objectName: 'Contact',
          describe: {
            name: 'Contact',
            label: 'Contact',
            keyPrefix: null,
            fields: [],
          },
        },
      ];

      const result = prepareObjectBatchData(describeResults, 'test-org');

      expect(result[0].keyPrefix).toBeNull();
    });

    it('should handle multiple objects', () => {
      const describeResults = [
        {
          objectName: 'Account',
          describe: { name: 'Account', label: 'Account', keyPrefix: '001', fields: [] },
        },
        {
          objectName: 'Contact',
          describe: { name: 'Contact', label: 'Contact', keyPrefix: '003', fields: [] },
        },
        {
          objectName: 'Lead',
          describe: { name: 'Lead', label: 'Lead', keyPrefix: '00Q', fields: [] },
        },
      ];

      const result = prepareObjectBatchData(describeResults, 'test-org');

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.apiName)).toEqual(['Account', 'Contact', 'Lead']);
    });

    it('should detect system-derived objects with parent', () => {
      const describeResults = [
        {
          objectName: 'AccountShare',
          describe: {
            name: 'AccountShare',
            label: 'Account Share',
            keyPrefix: null,
            fields: [],
          },
        },
      ];

      const result = prepareObjectBatchData(describeResults, 'test-org');

      expect(result[0].parentObjectName).toBe('Account');
      expect(result[0].subtype).toBe('share');
    });
  });

  describe('prepareFieldBatchData', () => {
    it('should return empty arrays for empty input', () => {
      const { fieldData, linkData } = prepareFieldBatchData([], 'test-org');
      expect(fieldData).toEqual([]);
      expect(linkData).toEqual([]);
    });

    it('should map text field correctly', () => {
      const describeResults = [
        {
          objectName: 'Account',
          describe: {
            name: 'Account',
            fields: [
              {
                name: 'Name',
                label: 'Account Name',
                type: 'string',
                nillable: false,
                unique: false,
                referenceTo: null,
                relationshipName: null,
                calculated: false,
                filterable: true,
                sortable: true,
                groupable: true,
                length: 255,
                precision: null,
                scale: null,
              },
            ],
          },
        },
      ];

      const { fieldData, linkData } = prepareFieldBatchData(describeResults, 'org-123');

      expect(fieldData).toHaveLength(1);
      expect(fieldData[0]).toMatchObject({
        apiName: 'Name',
        sobjectType: 'Account',
        orgId: 'org-123',
        label: 'Account Name',
        type: 'string',
        nillable: false,
        unique: false,
        category: 'standard',
        referenceTo: null,
        relationshipName: null,
        relationshipType: null,
        calculated: false,
        filterable: true,
        sortable: true,
        groupable: true,
        length: 255,
      });

      expect(linkData).toHaveLength(1);
      expect(linkData[0]).toEqual({
        objectName: 'Account',
        fieldName: 'Name',
        orgId: 'org-123',
      });
    });

    it('should map lookup field with referenceTo', () => {
      const describeResults = [
        {
          objectName: 'Contact',
          describe: {
            name: 'Contact',
            fields: [
              {
                name: 'AccountId',
                label: 'Account',
                type: 'reference',
                nillable: true,
                unique: false,
                referenceTo: ['Account'],
                relationshipName: 'Account',
                calculated: false,
                filterable: true,
                sortable: true,
                groupable: true,
                length: null,
                precision: null,
                scale: null,
              },
            ],
          },
        },
      ];

      const { fieldData } = prepareFieldBatchData(describeResults, 'test-org');

      expect(fieldData[0].type).toBe('reference');
      expect(fieldData[0].referenceTo).toEqual(['Account']);
      expect(fieldData[0].relationshipName).toBe('Account');
      expect(fieldData[0].relationshipType).toBe('Lookup');
    });

    it('should detect master-detail relationship', () => {
      const describeResults = [
        {
          objectName: 'OpportunityLineItem',
          describe: {
            name: 'OpportunityLineItem',
            fields: [
              {
                name: 'OpportunityId',
                label: 'Opportunity',
                type: 'reference',
                nillable: false,
                unique: false,
                referenceTo: ['Opportunity'],
                relationshipName: 'Opportunity',
                relationshipOrder: 0, // Indicates master-detail
                calculated: false,
                filterable: true,
                sortable: true,
                groupable: true,
              },
            ],
          },
        },
      ];

      const { fieldData } = prepareFieldBatchData(describeResults, 'test-org');

      expect(fieldData[0].relationshipType).toBe('MasterDetail');
    });

    it('should detect hierarchical relationship', () => {
      const describeResults = [
        {
          objectName: 'Account',
          describe: {
            name: 'Account',
            fields: [
              {
                name: 'ParentId',
                label: 'Parent Account',
                type: 'reference',
                nillable: true,
                unique: false,
                referenceTo: ['Account'], // Self-reference
                relationshipName: 'Parent',
                calculated: false,
                filterable: true,
                sortable: true,
                groupable: true,
              },
            ],
          },
        },
      ];

      const { fieldData } = prepareFieldBatchData(describeResults, 'test-org');

      expect(fieldData[0].relationshipType).toBe('Hierarchical');
    });

    it('should handle polymorphic lookup fields', () => {
      const describeResults = [
        {
          objectName: 'Task',
          describe: {
            name: 'Task',
            fields: [
              {
                name: 'WhatId',
                label: 'Related To',
                type: 'reference',
                nillable: true,
                unique: false,
                referenceTo: ['Account', 'Contact', 'Opportunity'],
                relationshipName: 'What',
                calculated: false,
                filterable: true,
                sortable: true,
                groupable: true,
              },
            ],
          },
        },
      ];

      const { fieldData } = prepareFieldBatchData(describeResults, 'test-org');

      expect(fieldData[0].referenceTo).toEqual(['Account', 'Contact', 'Opportunity']);
    });

    it('should handle calculated fields', () => {
      const describeResults = [
        {
          objectName: 'Account',
          describe: {
            name: 'Account',
            fields: [
              {
                name: 'FullAddress__c',
                label: 'Full Address',
                type: 'string',
                nillable: true,
                unique: false,
                referenceTo: null,
                calculated: true, // Formula field
                filterable: false,
                sortable: false,
                groupable: false,
              },
            ],
          },
        },
      ];

      const { fieldData } = prepareFieldBatchData(describeResults, 'test-org');

      expect(fieldData[0].calculated).toBe(true);
      expect(fieldData[0].filterable).toBe(false);
      expect(fieldData[0].sortable).toBe(false);
    });

    it('should handle empty referenceTo array', () => {
      const describeResults = [
        {
          objectName: 'Account',
          describe: {
            name: 'Account',
            fields: [
              {
                name: 'Type',
                label: 'Type',
                type: 'picklist',
                nillable: true,
                unique: false,
                referenceTo: [], // Empty array
                calculated: false,
              },
            ],
          },
        },
      ];

      const { fieldData } = prepareFieldBatchData(describeResults, 'test-org');

      expect(fieldData[0].referenceTo).toBeNull();
    });

    it('should map custom field namespace', () => {
      const describeResults = [
        {
          objectName: 'Account',
          describe: {
            name: 'Account',
            fields: [
              {
                name: 'ns__CustomField__c',
                label: 'Custom Field',
                type: 'string',
                nillable: true,
                unique: false,
              },
            ],
          },
        },
      ];

      const { fieldData } = prepareFieldBatchData(describeResults, 'test-org');

      expect(fieldData[0].namespace).toBe('ns');
      // Category is still 'custom' (suffix-based), namespace is a separate property
      expect(fieldData[0].category).toBe('custom');
    });
  });

  describe('prepareRelationshipBatchData', () => {
    it('should return empty array for empty input', () => {
      const result = prepareRelationshipBatchData([], 'test-org');
      expect(result).toEqual([]);
    });

    it('should return empty array when no reference fields exist', () => {
      const describeResults = [
        {
          objectName: 'Account',
          describe: {
            name: 'Account',
            fields: [
              { name: 'Name', type: 'string', referenceTo: null },
              { name: 'Industry', type: 'picklist', referenceTo: null },
            ],
          },
        },
      ];

      const result = prepareRelationshipBatchData(describeResults, 'test-org');
      expect(result).toEqual([]);
    });

    it('should create relationship data for lookup fields', () => {
      const describeResults = [
        {
          objectName: 'Contact',
          describe: {
            name: 'Contact',
            fields: [
              {
                name: 'AccountId',
                type: 'reference',
                referenceTo: ['Account'],
              },
            ],
          },
        },
      ];

      const result = prepareRelationshipBatchData(describeResults, 'org-123');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sourceObject: 'Contact',
        targetObject: 'Account',
        fieldName: 'AccountId',
        relationshipType: 'Lookup',
        orgId: 'org-123',
        targetCategory: 'standard',
      });
    });

    it('should create multiple entries for polymorphic lookups', () => {
      const describeResults = [
        {
          objectName: 'Task',
          describe: {
            name: 'Task',
            fields: [
              {
                name: 'WhatId',
                type: 'reference',
                referenceTo: ['Account', 'Contact', 'Opportunity'],
              },
            ],
          },
        },
      ];

      const result = prepareRelationshipBatchData(describeResults, 'test-org');

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.targetObject)).toEqual(['Account', 'Contact', 'Opportunity']);
      expect(result.every((r) => r.sourceObject === 'Task')).toBe(true);
      expect(result.every((r) => r.fieldName === 'WhatId')).toBe(true);
    });

    it('should classify target objects correctly', () => {
      const describeResults = [
        {
          objectName: 'Custom__c',
          describe: {
            name: 'Custom__c',
            fields: [
              {
                name: 'AccountId',
                type: 'reference',
                referenceTo: ['Account'],
              },
              {
                name: 'RelatedCustom__c',
                type: 'reference',
                referenceTo: ['AnotherCustom__c'],
              },
            ],
          },
        },
      ];

      const result = prepareRelationshipBatchData(describeResults, 'test-org');

      expect(result).toHaveLength(2);
      expect(result[0].targetCategory).toBe('standard'); // Account
      expect(result[1].targetCategory).toBe('custom'); // AnotherCustom__c
    });

    it('should include target namespace for managed objects', () => {
      const describeResults = [
        {
          objectName: 'MyObject__c',
          describe: {
            name: 'MyObject__c',
            fields: [
              {
                name: 'LookupId__c',
                type: 'reference',
                referenceTo: ['ns__ManagedObj__c'],
              },
            ],
          },
        },
      ];

      const result = prepareRelationshipBatchData(describeResults, 'test-org');

      expect(result[0].targetNamespace).toBe('ns');
      // Category is still 'custom' (suffix-based), namespace is a separate property
      expect(result[0].targetCategory).toBe('custom');
    });

    it('should detect master-detail relationships', () => {
      const describeResults = [
        {
          objectName: 'OrderItem',
          describe: {
            name: 'OrderItem',
            fields: [
              {
                name: 'OrderId',
                type: 'reference',
                referenceTo: ['Order'],
                relationshipOrder: 0,
              },
            ],
          },
        },
      ];

      const result = prepareRelationshipBatchData(describeResults, 'test-org');

      expect(result[0].relationshipType).toBe('MasterDetail');
    });

    it('should skip fields with empty referenceTo array', () => {
      const describeResults = [
        {
          objectName: 'Account',
          describe: {
            name: 'Account',
            fields: [
              {
                name: 'SomeField',
                type: 'reference',
                referenceTo: [],
              },
            ],
          },
        },
      ];

      const result = prepareRelationshipBatchData(describeResults, 'test-org');
      expect(result).toEqual([]);
    });

    it('should skip fields with null referenceTo', () => {
      const describeResults = [
        {
          objectName: 'Account',
          describe: {
            name: 'Account',
            fields: [
              {
                name: 'SomeField',
                type: 'reference',
                referenceTo: null,
              },
            ],
          },
        },
      ];

      const result = prepareRelationshipBatchData(describeResults, 'test-org');
      expect(result).toEqual([]);
    });

    it('should handle multiple objects with multiple relationships', () => {
      const describeResults = [
        {
          objectName: 'Contact',
          describe: {
            name: 'Contact',
            fields: [
              { name: 'AccountId', type: 'reference', referenceTo: ['Account'] },
              { name: 'ReportsToId', type: 'reference', referenceTo: ['Contact'] },
            ],
          },
        },
        {
          objectName: 'Opportunity',
          describe: {
            name: 'Opportunity',
            fields: [
              { name: 'AccountId', type: 'reference', referenceTo: ['Account'] },
            ],
          },
        },
      ];

      const result = prepareRelationshipBatchData(describeResults, 'test-org');

      expect(result).toHaveLength(3);
      expect(result.filter((r) => r.sourceObject === 'Contact')).toHaveLength(2);
      expect(result.filter((r) => r.sourceObject === 'Opportunity')).toHaveLength(1);
    });
  });
});

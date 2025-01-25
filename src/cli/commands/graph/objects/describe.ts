/**
 * sf graph objects describe
 *
 * Describe a specific Salesforce object showing fields and relationships.
 */

import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages } from '@salesforce/core';
import { apiService } from '../../../../core/index.js';
import type { SalesforceField, ObjectRelationship } from '../../../../core/types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.objects.describe');

export type ObjectDescribeResult = {
  apiName: string;
  label: string;
  category: string;
  keyPrefix?: string;
  fieldCount: number;
  relationshipCount: number;
  fields?: Array<{
    apiName: string;
    label: string;
    type: string;
    required: boolean;
    // SOQL-relevant properties
    calculated?: boolean;
    filterable?: boolean;
    sortable?: boolean;
    groupable?: boolean;
  }>;
  relationships?: Array<{
    fieldApiName: string;
    relationshipName: string;
    referenceTo: string[];
    relationshipType: string;
  }>;
};

export default class Describe extends SfCommand<ObjectDescribeResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    objectApiName: Args.string({
      description: 'API name of the object to describe (e.g., Account, Contact, My_Object__c)',
      required: true,
    }),
  };

  public static readonly flags = {
    'show-fields': Flags.boolean({
      char: 'f',
      summary: messages.getMessage('flags.show-fields.summary'),
      default: false,
    }),
    'show-relationships': Flags.boolean({
      char: 'r',
      summary: messages.getMessage('flags.show-relationships.summary'),
      default: false,
    }),
    json: Flags.boolean({
      summary: 'Format output as json.',
      default: false,
    }),
    'target-org': Flags.optionalOrg({
      char: 'o',
      summary: 'The org to retrieve the object description from.',
    }),
  };

  public async run(): Promise<ObjectDescribeResult> {
    try {
      const { args, flags } = await this.parse(Describe);
      const objectApiName = args.objectApiName;
      const orgId = flags['target-org']?.getOrgId();

      this.spinner.start(`Loading ${objectApiName}${orgId ? ` from ${flags['target-org']?.getUsername()}` : ''}...`);
      const object = await apiService.getObject(objectApiName, orgId);
      this.spinner.stop();

      if (!object) {
        this.error(`Object '${objectApiName}' not found in the graph. Run 'sf graph sync' first.`);
      }

      const result: ObjectDescribeResult = {
        apiName: object.apiName,
        label: object.label,
        category: object.category,
        keyPrefix: object.keyPrefix,
        fieldCount: object.fields?.length || 0,
        relationshipCount: object.relationships?.length || 0,
      };

      if (!flags.json) {
        this.log(`\n📋 ${object.label} (${object.apiName})`);
        this.log(`   Type: ${object.category}`);
        if (object.keyPrefix) {
          this.log(`   Key Prefix: ${object.keyPrefix}`);
        }
        this.log(`   Fields: ${object.fields?.length || 0}`);
        this.log(`   Relationships: ${object.relationships?.length || 0}`);
      }

      // Show fields if requested
      if (flags['show-fields'] && object.fields && object.fields.length > 0) {
        result.fields = object.fields.map((f: SalesforceField) => ({
          apiName: f.apiName,
          label: f.label,
          type: f.type,
          required: f.required,
          calculated: f.calculated,
          filterable: f.filterable,
          sortable: f.sortable,
          groupable: f.groupable,
        }));

        if (!flags.json) {
          this.log('\n   Fields:');
          for (const field of object.fields) {
            const reqMarker = field.required ? ' *' : '';
            const calcMarker = field.calculated ? ' [formula]' : '';
            this.log(`     • ${field.apiName} (${field.type})${reqMarker}${calcMarker}`);
          }
        }
      }

      // Show relationships if requested
      if (flags['show-relationships'] && object.relationships && object.relationships.length > 0) {
        result.relationships = object.relationships.map((r: ObjectRelationship) => ({
          fieldApiName: r.fieldApiName,
          relationshipName: r.relationshipName,
          referenceTo: r.referenceTo,
          relationshipType: r.relationshipType,
        }));

        if (!flags.json) {
          this.log('\n   Relationships:');
          for (const rel of object.relationships) {
            const relType = rel.relationshipType === 'MasterDetail' ? '◆' :
                           rel.relationshipType === 'Hierarchical' ? '⟳' : '◇';
            // Display polymorphic targets
            const targets = rel.referenceTo.length > 1
              ? `[${rel.referenceTo.join(', ')}]`
              : rel.referenceTo[0] || 'Unknown';
            this.log(
              `     ${relType} ${rel.fieldApiName} → ${targets} (${rel.relationshipType})`
            );
          }
        }
      }

      if (!flags.json) {
        this.log('');
      }

      return result;
    } finally {
      await apiService.cleanup();
    }
  }
}

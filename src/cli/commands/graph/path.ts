/**
 * sf graph path
 *
 * Find paths between two Salesforce objects.
 */

import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages } from '@salesforce/core';
import { apiService } from '../../../core/index.js';
import type { PathFindingResult, DetailedPath } from '../../../core/types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.path');
import { generatePathTree } from '../../../core/utils/path-tree.js';
import type { NavigationNode } from '../../../core/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import chalk from 'chalk';

export default class Path extends SfCommand<PathFindingResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    fromObject: Args.string({
      description: 'API name of the start object',
      required: true,
    }),
    toObject: Args.string({
      description: 'API name of the end object',
      required: true,
    }),
  };

  public static readonly flags = {
    'min-hops': Flags.integer({
      char: 'i',
      summary: messages.getMessage('flags.min-hops.summary'),
      default: 1,
      min: 1,
    }),
    'max-hops': Flags.integer({
      char: 'n',
      summary: messages.getMessage('flags.max-hops.summary'),
      default: 5,
      min: 1,
      max: 10, 
    }),
    json: Flags.boolean({
      summary: 'Format output as json.',
      default: false,
    }),
    'target-org': Flags.optionalOrg({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
    }),
  };

  public async run(): Promise<PathFindingResult> {
    try {
      const { args, flags } = await this.parse(Path);
      const fromObject = args.fromObject;
      const toObject = args.toObject;
      const orgId = flags['target-org']?.getOrgId();

      this.spinner.start(`Finding paths from ${fromObject} to ${toObject}...`);
      
      const result = await apiService.findDetailedPaths(fromObject, toObject, {
        minHops: flags['min-hops'],
        maxHops: flags['max-hops'],
        orgId
      });
      
      this.spinner.stop();

      if (result.pathCount === 0) {
        this.log(`No paths found between ${fromObject} and ${toObject} within ${flags['max-hops']} hops.`);
        return result;
      }

      if (!flags.json) {
        this.log(`\nFound ${result.pathCount} paths (hops: ${result.minHops}-${result.maxHops})\n`);

        result.paths.forEach((path: DetailedPath, index: number) => {
          this.log(`Path #${index + 1} (${path.hopCount} hops):`);
          this.printPath(path);
          this.log('');
        });
      }

      return result;
    } finally {
      await apiService.cleanup();
    }
  }

  private printPath(path: DetailedPath): void {


    // Convert DetailedPath to NavigationNodes
    // Root node
    const nodes: NavigationNode[] = [{
      objectName: path.objects[0],
      isCycle: false
    }];

    // Add hops
    let currentCycleCheck = [path.objects[0]];
    path.hops.forEach((hop) => {
       const field = hop.fields[0]; // Primary field used
       const isCycle = currentCycleCheck.includes(hop.toObject);
       currentCycleCheck.push(hop.toObject);
       
       nodes.push({
         objectName: hop.toObject,
         fieldName: field.apiName,
         direction: field.direction === 'up' ? 'parent' : 'child',
         isCycle,
         relationshipType: field.relationshipType,
         relationshipName: field.relationshipName
       });
    });

    const tree = generatePathTree(nodes, {
        label: (node, isCurrent) => {
            let label = node.objectName;
            if (node.fieldName) {
                // Format: └── Contact (via AccountId [Lookup])
                const directionArrow = node.direction === 'parent' ? '⬆️' : '⬇️';
                const relInfo = node.relationshipName ? `.${node.relationshipName}` : '';
                const typeInfo = node.relationshipType ? ` [${node.relationshipType}]` : '';
                
                label += ` ${chalk.dim(`(via ${node.fieldName}${relInfo}${typeInfo} ${directionArrow})`)}`;
            }
            if (node.isCycle) {
                label += ` ${chalk.red('(Cycle)')}`;
            }
            if (isCurrent) {
                label = chalk.bold(label);
            }
            return label;
        }
    });

    this.log(tree);
  }
}

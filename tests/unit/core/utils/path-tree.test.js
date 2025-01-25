import { expect, describe, it } from '@jest/globals';
import { generatePathTree } from '../../../../dist/core/utils/path-tree.js';

describe('path-tree utility', () => {
    it('should generate a simple linear tree', () => {
        const nodes = [
            { objectName: 'Account', isCycle: false },
            { objectName: 'Contact', fieldName: 'AccountId', direction: 'child', isCycle: false }
        ];

        const output = generatePathTree(nodes, {
            label: (node, isCurrent) => {
                let label = node.objectName;
                if (node.fieldName) label += ` (via ${node.fieldName})`;
                if (isCurrent) label += '*';
                return label;
            }
        });

        // Expected archy output:
        // Account
        // └── Contact (via AccountId)*
        //
        // Note: archy uses unicode characters.
        expect(output).toContain('Account');
        expect(output).toContain('Contact (via AccountId)*');
        expect(output).toContain('└'); 
    });

    it('should handle cycles', () => {
        const nodes = [
           { objectName: 'A', isCycle: false },
           { objectName: 'B', fieldName: 'ref', direction: 'child', isCycle: false },
           { objectName: 'A', fieldName: 'parent', direction: 'parent', isCycle: true }
        ];

        const output = generatePathTree(nodes, {
            label: (node) => node.objectName + (node.isCycle ? ' (Cycle)' : '')
        });

        expect(output).toContain('A (Cycle)');
    });
});

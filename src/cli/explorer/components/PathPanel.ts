/**
 * Path Panel Component
 *
 * Right pane showing navigation path as a vertical tree.
 */

import { styles, layout, symbols, colors } from '../theme.js';
import type { PathNode } from '../types.js';
import { generatePathTree } from '../../../core/utils/path-tree.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoxElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Screen = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Blessed = any;

export class PathPanel {
  public element: BoxElement;
  private pathNodes: PathNode[] = [];

  constructor(blessed: Blessed, parent: Screen) {
    this.element = blessed.box({
      parent,
      top: 3,
      right: 0,
      width: layout.rightPaneWidth,
      height: '100%-4', // Leave room for header and status bar
      label: ' Path ',
      border: layout.border,
      style: styles.box.default,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        track: { bg: colors.bg.secondary },
        style: { inverse: true },
      },
    });
  }

  /**
   * Update the path display based on history.
   * @param nodes - Array of PathNode objects with object names and field names
   * @param currentIndex - Index of currently selected object (for highlighting)
   */
  updatePath(nodes: PathNode[], currentIndex?: number): void {
    this.pathNodes = nodes;
    this.render(currentIndex);
  }

  private render(highlightIndex?: number): void {


    const tree = generatePathTree(this.pathNodes, {
      label: (node, isCurrent) => {
        let label = node.objectName;
        // Fields/Meta
        if (node.fieldName) {
            // Format: └── object (via field [Type])
            // Just like CLI but with blessed tags
            const arrow = node.direction === 'parent' ? '⬆️' : '⬇️';
            // Use subtle color for details
            label += ` {${colors.fg.secondary}-fg}(via ${node.fieldName}`;
            if (node.relationshipName) label += `.${node.relationshipName}`;
            if (node.relationshipType) label += ` [${node.relationshipType}]`;
            label += ` ${arrow}){/}`;
        }

        if (node.isCycle) {
          label += ` {${colors.fg.warning}-fg}${symbols.cycle}{/}`;
        }
        
        if (isCurrent) {
           // Highlight current node
           label += ` {${colors.fg.accent}-fg}←{/}`;
           if (highlightIndex !== undefined) {
               return `{bold}${label}{/bold}`;
           }
        }
        return label;
      }
    });

    // Add hop count at bottom
    let content = tree;
    if (this.pathNodes.length > 1) {
      content += `\n[${this.pathNodes.length - 1} hops from start]`;
    }

    this.element.setContent(content);
  }

  /**
   * Get the number of path nodes (for 1-9 jump navigation)
   */
  getNodeCount(): number {
    return this.pathNodes.length;
  }

  /**
   * Get object name at a specific index
   */
  getObjectAtIndex(index: number): string | undefined {
    return this.pathNodes[index]?.objectName;
  }
}

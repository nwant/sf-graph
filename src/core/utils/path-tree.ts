import archy from 'archy';
import type { NavigationNode } from '../types.js';

export interface PathTreeRenderer {
  /**
   * Render the label for a node
   * @param node The navigation node to render
   * @param isCurrent Whether this is the currently active (last) node
   */
  label: (node: NavigationNode, isCurrent: boolean) => string;
}

/**
 * Generate an ASCII tree representation of a navigation path
 * 
 * @param nodes List of navigation nodes representing the linear history
 * @param renderer Custom renderer for node labels
 */
export function generatePathTree(nodes: NavigationNode[], renderer: PathTreeRenderer): string {
  if (nodes.length === 0) return '';

  // Archy expects a tree structure where each node has 'label' and 'nodes' array
  // Since our history is linear (A -> B -> C), we build a nested structure
  // A -> { nodes: [ B -> { nodes: [ C ] } ] }

  const buildNode = (index: number): archy.Data | string => {
    const node = nodes[index];
    const isCurrent = index === nodes.length - 1;
    const label = renderer.label(node, isCurrent);

    if (isCurrent) {
      return label; // Leaf node can be just a string
    }

    // Recursive step
    return {
      label,
      nodes: [buildNode(index + 1)]
    };
  };

  return archy(buildNode(0) as archy.Data);
}

/**
 * GraphViewer Component
 * Main Cytoscape.js visualization canvas
 */

import { useMemo, useRef, useCallback } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import type { Core, EventObject } from 'cytoscape';
import { makeStyles, tokens, Spinner } from '@fluentui/react-components';
import type { CytoscapeElements } from '../types/graph';

const useStyles = makeStyles({
  container: {
    flex: 1,
    position: 'relative',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  graph: {
    width: '100%',
    height: '100%',
  },
  loading: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  },
});

interface GraphViewerProps {
  elements: CytoscapeElements | null;
  loading: boolean;
  onNodeClick: (nodeId: string) => void;
  selectedNode: string | null;
}

const cytoscapeStylesheet = [
  {
    selector: 'node',
    style: {
      'background-color': '#0078d4',
      label: 'data(label)',
      color: '#242424',
      'text-valign': 'bottom',
      'text-margin-y': 5,
      'font-size': 10,
      width: 30,
      height: 30,
    },
  },
  {
    selector: 'node[isCenter]',
    style: {
      'background-color': '#107c10',
      width: 40,
      height: 40,
      'border-width': 3,
      'border-color': '#0b5a08',
    },
  },
  {
    selector: 'node[category = "custom"]',
    style: {
      'background-color': '#8764b8',
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-width': 3,
      'border-color': '#ffb900',
    },
  },
  {
    selector: 'edge',
    style: {
      width: 2,
      'line-color': '#a19f9d',
      'target-arrow-color': '#a19f9d',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      label: 'data(label)',
      'font-size': 8,
      'text-rotation': 'autorotate',
      color: '#605e5c',
    },
  },
  {
    selector: 'edge[type = "MasterDetail"]',
    style: {
      'line-color': '#d13438',
      'target-arrow-color': '#d13438',
      width: 3,
    },
  },
];

const layoutOptions = {
  name: 'concentric',
  concentric: (node: { data: (arg0: string) => string | boolean | number }) => {
    const isCenter = node.data('isCenter');
    const depth = parseInt(String(node.data('depth') || '0'), 10);
    return isCenter ? 10 : 5 - depth;
  },
  levelWidth: () => 2,
  animate: true,
  animationDuration: 500,
};

export function GraphViewer({
  elements,
  loading,
  onNodeClick,
  selectedNode,
}: GraphViewerProps) {
  const styles = useStyles();
  const cyRef = useRef<Core | null>(null);

  const cytoscapeElements = useMemo(() => {
    if (!elements) return [];
    return [
      ...elements.nodes.map((n) => ({ data: n.data, group: 'nodes' as const })),
      ...elements.edges.map((e) => ({ data: e.data, group: 'edges' as const })),
    ];
  }, [elements]);

  const handleCyInit = useCallback(
    (cy: Core) => {
      cyRef.current = cy;

      cy.on('tap', 'node', (evt: EventObject) => {
        const nodeId = evt.target.id();
        onNodeClick(nodeId);
      });

      // Center on selected node if exists
      if (selectedNode) {
        const node = cy.getElementById(selectedNode);
        if (node.length) {
          cy.center(node);
        }
      }
    },
    [onNodeClick, selectedNode]
  );

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <Spinner label="Loading graph..." />
        </div>
      </div>
    );
  }

  if (!elements || elements.nodes.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>No graph data available</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <CytoscapeComponent
        elements={cytoscapeElements}
        stylesheet={cytoscapeStylesheet}
        layout={layoutOptions}
        className={styles.graph}
        cy={handleCyInit}
      />
    </div>
  );
}

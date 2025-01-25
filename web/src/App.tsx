/**
 * Graph Visualization App
 * Main application component
 */

import { useState, useCallback, useMemo } from 'react';
import { makeStyles, tokens, MessageBar, Button } from '@fluentui/react-components';
import { GraphViewer } from './components/GraphViewer';
import { SearchBar } from './components/SearchBar';
import { ObjectPanel } from './components/ObjectPanel';
import { Toolbar } from './components/Toolbar';
import { useGraphData } from './hooks/useGraphData';
import { useGraphNavigation } from './hooks/useGraphNavigation';
import type { CytoscapeNode, CytoscapeEdge } from './types/graph';

const useStyles = makeStyles({
  app: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  error: {
    margin: tokens.spacingHorizontalM,
  },
});

function App() {
  const styles = useStyles();
  const { focusedObject, navigate, depth, setDepth } = useGraphNavigation();
  const { data, loading, error, retry } = useGraphData(focusedObject, depth);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleNavigate = useCallback(
    (nodeId: string) => {
      navigate(nodeId);
      setSelectedNodeId(null);
    },
    [navigate]
  );

  const handleSearch = useCallback(
    (objectName: string) => {
      navigate(objectName);
      setSelectedNodeId(null);
    },
    [navigate]
  );

  const selectedNode: CytoscapeNode | null = useMemo(() => {
    if (!selectedNodeId || !data) return null;
    const node = data.nodes.find((n) => n.data.id === selectedNodeId);
    return node || null;
  }, [selectedNodeId, data]);

  const relatedEdges: CytoscapeEdge[] = useMemo(() => {
    if (!selectedNodeId || !data) return [];
    return data.edges.filter(
      (e) => e.data.source === selectedNodeId || e.data.target === selectedNodeId
    );
  }, [selectedNodeId, data]);

  const handleClosePanel = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  return (
    <div className={styles.app}>
      <Toolbar depth={depth} onDepthChange={setDepth}>
        <SearchBar onSelect={handleSearch} />
      </Toolbar>

      {error && (
        <div className={styles.error} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageBar intent="error" style={{ flex: 1 }}>
            {error.message}
          </MessageBar>
          <Button onClick={retry}>Retry</Button>
        </div>
      )}

      <div className={styles.main}>
        <GraphViewer
          elements={data}
          loading={loading}
          onNodeClick={handleNodeClick}
          selectedNode={selectedNodeId}
        />
        <ObjectPanel
          selectedNode={selectedNode}
          relatedEdges={relatedEdges}
          onClose={handleClosePanel}
          onNavigate={handleNavigate}
        />
      </div>
    </div>
  );
}

export default App;

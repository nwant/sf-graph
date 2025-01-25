/**
 * Cytoscape Transformer
 * 
 * Transforms Neo4j graph data into Cytoscape.js-compatible format
 * for the graph visualization SPA.
 */

import type { 
  GraphObject, 
  GraphRelationship, 
  RelatedObjectPreview 
} from './neo4j/graph-service.js';

/**
 * Cytoscape node data
 */
export interface CytoscapeNode {
  data: {
    id: string;
    label: string;
    category: string;
    fieldCount?: number;
    description?: string;
    depth?: number;
    isCenter?: boolean;
  };
}

/**
 * Cytoscape edge data
 */
export interface CytoscapeEdge {
  data: {
    id: string;
    source: string;
    target: string;
    label: string;
    type: string;
    fieldApiName?: string;
  };
}

/**
 * Cytoscape elements format
 */
export interface CytoscapeElements {
  nodes: CytoscapeNode[];
  edges: CytoscapeEdge[];
}

/**
 * Transform neighborhood data into Cytoscape format.
 * 
 * @param centerObject - The center object of the graph
 * @param neighborsByDepth - Related objects grouped by depth
 * @param relationships - Relationship data for edges
 * @returns Cytoscape-compatible elements
 */
export function transformNeighborhood(
  centerObject: GraphObject,
  neighborsByDepth: Record<number, RelatedObjectPreview[]>,
  relationships: GraphRelationship[]
): CytoscapeElements {
  const nodes: CytoscapeNode[] = [];
  const edges: CytoscapeEdge[] = [];
  const nodeSet = new Set<string>();

  // Add center node
  nodes.push({
    data: {
      id: centerObject.apiName,
      label: centerObject.label || centerObject.apiName,
      category: centerObject.category || 'standard',
      fieldCount: centerObject.fieldCount,
      description: centerObject.description || '',
      depth: 0,
      isCenter: true,
    },
  });
  nodeSet.add(centerObject.apiName.toLowerCase());

  // Add neighbor nodes grouped by depth
  for (const [depthStr, neighbors] of Object.entries(neighborsByDepth)) {
    const depth = parseInt(depthStr, 10);
    for (const neighbor of neighbors) {
      const normalizedName = neighbor.apiName.toLowerCase();
      if (!nodeSet.has(normalizedName)) {
        nodes.push({
          data: {
            id: neighbor.apiName,
            label: neighbor.label || neighbor.apiName,
            category: neighbor.category || 'standard',
            description: neighbor.description || '',
            depth,
            isCenter: false,
          },
        });
        nodeSet.add(normalizedName);
      }
    }
  }

  // Add edges from relationships
  const edgeSet = new Set<string>();
  for (const rel of relationships) {
    // Only add edges where both nodes exist
    const sourceNorm = rel.sourceObject.toLowerCase();
    const targetNorm = rel.targetObject.toLowerCase();
    
    if (nodeSet.has(sourceNorm) && nodeSet.has(targetNorm)) {
      // Create unique edge ID to prevent duplicates
      const edgeId = `${rel.sourceObject}-${rel.fieldApiName || rel.relationshipName || 'ref'}-${rel.targetObject}`;
      
      if (!edgeSet.has(edgeId.toLowerCase())) {
        edges.push({
          data: {
            id: edgeId,
            source: rel.sourceObject,
            target: rel.targetObject,
            // Use relationshipName for display (e.g., "Contacts", "Account")
            label: rel.relationshipName || rel.fieldApiName || '',
            // Use relationshipType for styling (e.g., "Lookup", "MasterDetail")
            type: rel.relationshipType || 'Lookup',
            fieldApiName: rel.fieldApiName,
          },
        });
        edgeSet.add(edgeId.toLowerCase());
      }
    }
  }

  return { nodes, edges };
}

/**
 * Transform search results into minimal Cytoscape nodes (no edges).
 * Used for search highlighting.
 */
export function transformSearchResults(objects: GraphObject[]): CytoscapeElements {
  return {
    nodes: objects.map((obj) => ({
      data: {
        id: obj.apiName,
        label: obj.label || obj.apiName,
        category: obj.category || 'standard',
        fieldCount: obj.fieldCount,
        description: obj.description || '',
        isCenter: false,
      },
    })),
    edges: [],
  };
}

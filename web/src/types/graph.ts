/**
 * Graph Visualization Types
 * Copied from backend src/core/types.ts for frontend use
 */

export interface GraphObject {
  apiName: string;
  label: string;
  description: string;
  category: string;
  fieldCount?: number;
}

export interface GraphRelationship {
  sourceObject: string;
  targetObject: string;
  relationshipType: string;
  fieldCount: number;
  direction: 'incoming' | 'outgoing';
  fieldApiName?: string;
  relationshipName?: string;
}

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

export interface CytoscapeElements {
  nodes: CytoscapeNode[];
  edges: CytoscapeEdge[];
}

export interface NeighborhoodResponse {
  success: boolean;
  centerObject: string;
  depth: number;
  nodeCount: number;
  edgeCount: number;
  elements: CytoscapeElements;
  error?: string;
}

export interface ObjectsResponse {
  success: boolean;
  count: number;
  objects: GraphObject[];
  error?: string;
}

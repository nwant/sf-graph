// Type declarations for react-cytoscapejs
declare module 'react-cytoscapejs' {
  import { Core, ElementDefinition, Stylesheet, LayoutOptions } from 'cytoscape';
  import { Component } from 'react';

  interface CytoscapeComponentProps {
    elements: ElementDefinition[];
    stylesheet?: Stylesheet[];
    layout?: LayoutOptions;
    className?: string;
    cy?: (cy: Core) => void;
    style?: React.CSSProperties;
    zoom?: number;
    pan?: { x: number; y: number };
    minZoom?: number;
    maxZoom?: number;
    zoomingEnabled?: boolean;
    userZoomingEnabled?: boolean;
    panningEnabled?: boolean;
    userPanningEnabled?: boolean;
    boxSelectionEnabled?: boolean;
    autoungrabify?: boolean;
    autounselectify?: boolean;
  }

  export default class CytoscapeComponent extends Component<CytoscapeComponentProps> {}
}

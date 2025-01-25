// Cytoscape Transformer Unit Tests

// Import the transformer functions
const { transformNeighborhood, transformSearchResults } = await import(
  '../../../dist/services/cytoscape-transformer.js'
);

describe('Cytoscape Transformer', () => {
  describe('transformNeighborhood', () => {
    it('should transform center object into a node with isCenter=true', () => {
      const centerObject = {
        apiName: 'Account',
        label: 'Account',
        description: 'Standard Account',
        category: 'standard',
        fieldCount: 50,
      };
      const neighbors = {};
      const relationships = [];

      const result = transformNeighborhood(centerObject, neighbors, relationships);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].data).toMatchObject({
        id: 'Account',
        label: 'Account',
        category: 'standard',
        fieldCount: 50,
        depth: 0,
        isCenter: true,
      });
    });

    it('should add neighbor nodes grouped by depth', () => {
      const centerObject = {
        apiName: 'Account',
        label: 'Account',
        category: 'standard',
      };
      const neighbors = {
        1: [
          { apiName: 'Contact', label: 'Contact', category: 'standard', description: '' },
          { apiName: 'Case', label: 'Case', category: 'standard', description: '' },
        ],
        2: [
          { apiName: 'User', label: 'User', category: 'standard', description: '' },
        ],
      };
      const relationships = [];

      const result = transformNeighborhood(centerObject, neighbors, relationships);

      expect(result.nodes).toHaveLength(4); // Account + Contact + Case + User

      const contactNode = result.nodes.find((n) => n.data.id === 'Contact');
      expect(contactNode.data.depth).toBe(1);
      expect(contactNode.data.isCenter).toBe(false);

      const userNode = result.nodes.find((n) => n.data.id === 'User');
      expect(userNode.data.depth).toBe(2);
    });

    it('should not add duplicate nodes', () => {
      const centerObject = {
        apiName: 'Account',
        label: 'Account',
        category: 'standard',
      };
      const neighbors = {
        1: [
          { apiName: 'Contact', label: 'Contact', category: 'standard', description: '' },
        ],
        2: [
          { apiName: 'Contact', label: 'Contact', category: 'standard', description: '' }, // Duplicate
        ],
      };
      const relationships = [];

      const result = transformNeighborhood(centerObject, neighbors, relationships);

      expect(result.nodes).toHaveLength(2); // Account + Contact (no duplicate)
    });

    it('should create edges from relationships', () => {
      const centerObject = {
        apiName: 'Account',
        label: 'Account',
        category: 'standard',
      };
      const neighbors = {
        1: [{ apiName: 'Contact', label: 'Contact', category: 'standard', description: '' }],
      };
      const relationships = [
        {
          sourceObject: 'Contact',
          targetObject: 'Account',
          relationshipType: 'Lookup',
          fieldApiName: 'AccountId',
          relationshipName: 'Account',
          direction: 'outgoing',
        },
      ];

      const result = transformNeighborhood(centerObject, neighbors, relationships);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].data).toMatchObject({
        source: 'Contact',
        target: 'Account',
        label: 'Account',
        type: 'Lookup',
        fieldApiName: 'AccountId',
      });
    });

    it('should not create edges for nodes not in the graph', () => {
      const centerObject = {
        apiName: 'Account',
        label: 'Account',
        category: 'standard',
      };
      const neighbors = {};
      const relationships = [
        {
          sourceObject: 'Contact', // Not in nodes
          targetObject: 'Account',
          relationshipType: 'Lookup',
          fieldApiName: 'AccountId',
          relationshipName: 'Account',
          direction: 'outgoing',
        },
      ];

      const result = transformNeighborhood(centerObject, neighbors, relationships);

      expect(result.edges).toHaveLength(0);
    });

    it('should not create duplicate edges', () => {
      const centerObject = {
        apiName: 'Account',
        label: 'Account',
        category: 'standard',
      };
      const neighbors = {
        1: [{ apiName: 'Contact', label: 'Contact', category: 'standard', description: '' }],
      };
      const relationships = [
        {
          sourceObject: 'Contact',
          targetObject: 'Account',
          relationshipType: 'Lookup',
          fieldApiName: 'AccountId',
          relationshipName: 'Account',
          direction: 'outgoing',
        },
        {
          // Duplicate edge
          sourceObject: 'Contact',
          targetObject: 'Account',
          relationshipType: 'Lookup',
          fieldApiName: 'AccountId',
          relationshipName: 'Account',
          direction: 'outgoing',
        },
      ];

      const result = transformNeighborhood(centerObject, neighbors, relationships);

      expect(result.edges).toHaveLength(1);
    });
  });

  describe('transformSearchResults', () => {
    it('should transform objects into minimal nodes', () => {
      const objects = [
        { apiName: 'Account', label: 'Account', category: 'standard', fieldCount: 50, description: 'Desc' },
        { apiName: 'Contact', label: 'Contact', category: 'standard', description: '' },
      ];

      const result = transformSearchResults(objects);

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(0);
      expect(result.nodes[0].data).toMatchObject({
        id: 'Account',
        label: 'Account',
        category: 'standard',
        fieldCount: 50,
      });
    });

    it('should return empty arrays for empty input', () => {
      const result = transformSearchResults([]);

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });
  });
});

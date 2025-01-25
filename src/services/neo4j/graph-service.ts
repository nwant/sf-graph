import neo4j, { QueryResult, RecordShape, Path, Node } from 'neo4j-driver';
import { getDriver } from './driver.js';
import type { PathFindingResult, DetailedPath, PathHop, SoqlPathSegment, SoqlPath, SoqlPathResult, PicklistValue, PicklistMatch } from '../../core/types.js';
import { Neo4jQueryError } from '../../core/errors.js';
import { createLogger } from '../../core/index.js';

const log = createLogger('neo4j:graph');

export async function executeRead<T extends RecordShape = RecordShape>(
  query: string,
  params: Record<string, unknown> = {}
): Promise<QueryResult<T>['records']> {
  const driver = getDriver();
  const session = driver.session();
  try {
    const result = await session.executeRead((tx) => tx.run<T>(query, params));
    return result.records;
  } finally {
    await session.close();
  }
}

export async function executeWrite<T extends RecordShape = RecordShape>(
  query: string,
  params: Record<string, unknown> = {}
): Promise<QueryResult<T>> {
  const driver = getDriver();
  const session = driver.session();
  try {
    const result = await session.executeWrite((tx) => tx.run<T>(query, params));
    return result;
  } finally {
    await session.close();
  }
}

export interface MetadataRelationship {
  source: string;
  relationship: string;
  target: string;
}

export async function getMetadataRelationships(): Promise<MetadataRelationship[]> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (n)-[r]->(m)
        RETURN n.name as source, type(r) as relationship, m.name as target
        `
      )
    );

    const relationships = result.records.map((record) => ({
      source: record.get('source'),
      relationship: record.get('relationship'),
      target: record.get('target'),
    }));
    return relationships;
  } catch (error) {
    log.error({ err: error }, 'Error getting metadata relationships');
    throw new Neo4jQueryError(
      `Failed to get metadata relationships: ${error instanceof Error ? error.message : String(error)}`,
      'MATCH (n)-[r]->(m) RETURN ...',
      error instanceof Error ? error : undefined
    );
  } finally {
    await session.close();
  }
}

export interface GraphObject {
  apiName: string;
  label: string;
  description: string;
  category: string;
  subtype?: string | null;
  namespace?: string | null;
  parentObjectName?: string | null;
  lastRefreshed: string | null;
  name: string;
  orgId: string | null;
  fieldCount?: number;
  [key: string]: unknown;
}

export interface GraphRelationship {
  sourceObject: string;
  targetObject: string;
  relationshipType: string;
  fieldCount: number;
  fields?: string[];
  direction: 'incoming' | 'outgoing';
  fieldApiName?: string;
  fieldLabel?: string;
  fieldDescription?: string;
  relationshipName?: string;
  referenceTo?: string[];
}

/**
 * Get all Object nodes from Neo4j
 * @param {Object} options - Query options
 * @param {string} options.orgId - Optional org ID to filter by
 */
export async function getAllObjects({ orgId }: { orgId?: string } = {}): Promise<GraphObject[]> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const orgFilter = orgId ? 'WHERE o.orgId = $orgId' : '';


    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (o:Object)
        ${orgFilter}
        RETURN o {
            .apiName,
            .label,
            .description,
            .category,
            .subtype,
            .namespace,
            .parentObjectName,
            .lastRefreshed,
            .name,
            .orgId
        } as object
        ORDER BY o.apiName
        `,
        { orgId }
      )
    );

    const objects = result.records.map((record) => {
      const obj = record.get('object');
      return {
        apiName: obj.apiName,
        label: obj.label || '',
        description: obj.description || '',
        category: obj.category || 'standard',
        subtype: obj.subtype || null,
        namespace: obj.namespace || null,
        parentObjectName: obj.parentObjectName || null,
        lastRefreshed: obj.lastRefreshed ? new Date(obj.lastRefreshed).toISOString() : null,
        name: obj.name || '',
        orgId: obj.orgId || null,
      };
    });
    return objects;
  } catch (error) {
    log.error({ err: error }, 'Error retrieving objects');
    throw new Neo4jQueryError(
      `Failed to retrieve objects: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

/**
 * Get an Object node by API name
 * @param {string} objectApiName - The API name of the object
 * @param {Object} options - Query options
 * @param {string} options.orgId - Optional org ID to filter by
 */
export async function getObjectByApiName(
  objectApiName: string,
  { orgId }: { orgId?: string } = {}
): Promise<GraphObject | null> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const orgFilter = orgId ? 'AND o.orgId = $orgId' : '';

    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (o:Object)
        WHERE toLower(o.apiName) = toLower($apiName)
        ${orgFilter}
        RETURN o {
            .apiName,
            .label,
            .description,
            .category,
            .subtype,
            .namespace,
            .parentObjectName,
            .lastRefreshed,
            .name,
            .orgId
        } as object
        `,
        { apiName: objectApiName, orgId }
      )
    );

    if (result.records.length === 0) {
      return null;
    }
    
    // Explicitly define what we expect in the record
    interface GraphObjectRow {
      object: {
        apiName: string;
        label: string;
        description: string;
        category: string;
        subtype: string | null;
        namespace: string | null;
        parentObjectName: string | null;
        lastRefreshed: string | null;
        name: string;
        orgId: string | null;
      };
    }
    
    const row = result.records[0].toObject() as unknown as GraphObjectRow;
    const obj = row.object;
    
    const object: GraphObject = {
      apiName: obj.apiName,
      label: obj.label || '',
      description: obj.description || '',
      category: obj.category || 'standard',
      subtype: obj.subtype || null,
      namespace: obj.namespace || null,
      parentObjectName: obj.parentObjectName || null,
      lastRefreshed: obj.lastRefreshed ? new Date(obj.lastRefreshed).toISOString() : null,
      name: obj.name || '',
      orgId: obj.orgId || null,
    };

    // Get field count
    const fieldCountResult = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (o:Object)-[:HAS_FIELD]->(f:Field)
        WHERE toLower(o.apiName) = toLower($apiName)
        ${orgFilter}
        RETURN count(f) as fieldCount
        `,
        { apiName: objectApiName, orgId }
      )
    );

    object.fieldCount = fieldCountResult.records[0].get('fieldCount').toNumber();
    return object;
  } catch (error) {
    log.error({ err: error, objectApiName }, 'Error retrieving Object node');
    throw new Neo4jQueryError(
      `Failed to retrieve Object node for ${objectApiName}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

export interface GraphField {
  apiName: string;
  sobjectType: string;
  label: string;
  type: string;
  description: string;
  helpText: string;
  nillable: boolean;
  unique: boolean;
  category: string;
  namespace?: string | null;
  lastRefreshed: string | null;
  name: string;
  referenceTo?: string[] | null;
  relationshipName?: string | null;
  relationshipType?: string | null;
  // SOQL-relevant properties
  calculated?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  length?: number | null;
  precision?: number | null;
  scale?: number | null;
  picklistValues?: PicklistValue[];
}

/**
 * Get fields for an object
 * @param {string} objectApiName - The API name of the object
 * @param {Object} options - Query options
 * @param {string} options.orgId - Optional org ID to filter by
 */
export async function getObjectFields(
  objectApiName: string,
  { orgId }: { orgId?: string } = {}
): Promise<GraphField[]> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const orgFilter = orgId ? 'AND o.orgId = $orgId' : '';

    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (o:Object)-[:HAS_FIELD]->(f:Field)
        WHERE toLower(o.apiName) = toLower($apiName)
        ${orgFilter}
        WITH f
        ORDER BY f.lastRefreshed DESC
        WITH f.apiName as name, head(collect(f)) as f
        RETURN f {
            .apiName,
            .sobjectType,
            .label,
            .type,
            .description,
            .helpText,
            .nillable,
            .unique,
            .category,
            .namespace,
            .lastRefreshed,
            .name,
            .referenceTo,
            .relationshipName,
            .relationshipType,
            .calculated,
            .filterable,
            .sortable,
            .groupable,
            .length,
            .precision,
            .scale
        } as field
        ORDER BY field.apiName
        `,
        { apiName: objectApiName, orgId }
      )
    );

    const fields = result.records.map((record) => {
      const f = record.get('field');
      return {
        apiName: f.apiName,
        sobjectType: f.sobjectType,
        label: f.label || '',
        type: f.type || '',
        description: f.description || '',
        helpText: f.helpText || '',
        nillable: f.nillable || false,
        unique: f.unique || false,
        category: f.category || 'standard',
        namespace: f.namespace || null,
        lastRefreshed: f.lastRefreshed ? new Date(f.lastRefreshed).toISOString() : null,
        name: f.name || '',
        referenceTo: f.referenceTo || null,
        relationshipName: f.relationshipName || null,
        relationshipType: f.relationshipType || null,
        calculated: f.calculated ?? false,
        filterable: f.filterable ?? true,
        sortable: f.sortable ?? true,
        groupable: f.groupable ?? true,
        length: f.length ?? null,
        precision: f.precision ?? null,
        scale: f.scale ?? null,
      };
    });
    return fields;
  } catch (error) {
    log.error({ err: error, objectApiName }, 'Error retrieving fields for object');
    throw new Neo4jQueryError(
      `Failed to retrieve fields for object ${objectApiName}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}



export async function getObjectRelationships(
  objectApiName: string,
  { orgId }: { orgId?: string } = {}
): Promise<GraphRelationship[]> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const orgFilter = orgId ? 'AND source.orgId = $orgId AND target.orgId = $orgId AND f.orgId = $orgId' : '';

    // Get outgoing relationships (where this object references other objects)
    // Query typed edges: LOOKS_UP and MASTER_DETAIL
    const outgoingResult = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (source:Object)-[:HAS_FIELD]->(f:Field)-[:LOOKS_UP|MASTER_DETAIL]->(target:Object)
        WHERE toLower(source.apiName) = toLower($apiName)
        ${orgFilter}
        WITH f, target
        ORDER BY f.lastRefreshed DESC
        WITH f.apiName as fieldApiName, head(collect({f:f, target:target})) as group
        RETURN {
            sourceObject: $apiName,
            targetObject: group.target.apiName,
            relationshipType: COALESCE(group.f.relationshipType, 'Lookup'),
            fieldCount: 1,
            direction: 'outgoing',
            fieldApiName: fieldApiName,
            fieldLabel: group.f.label,
            fieldDescription: group.f.description,
            relationshipName: group.f.relationshipName,
            referenceTo: group.f.referenceTo
        } as relationship
        ORDER BY fieldApiName
        `,
        { apiName: objectApiName, orgId }
      )
    );

    // Get incoming relationships (where other objects reference this object)
    // Query typed edges: LOOKS_UP and MASTER_DETAIL
    const incomingResult = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (source:Object)-[:HAS_FIELD]->(f:Field)-[:LOOKS_UP|MASTER_DETAIL]->(target:Object)
        WHERE toLower(target.apiName) = toLower($apiName)
        ${orgFilter}
        WITH source, f, target
        ORDER BY f.lastRefreshed DESC
        WITH source.apiName + '.' + f.apiName as key, head(collect({f:f, source:source, target:target})) as group
        RETURN {
            sourceObject: group.source.apiName,
            targetObject: group.target.apiName,
            relationshipType: COALESCE(group.f.relationshipType, 'Lookup'),
            fieldCount: 1,
            direction: 'incoming',
            fieldApiName: group.f.apiName,
            fieldLabel: group.f.label,
            fieldDescription: group.f.description,
            relationshipName: group.f.relationshipName,
            referenceTo: group.f.referenceTo
        } as relationship
        ORDER BY group.source.apiName, group.f.apiName
        `,
        { apiName: objectApiName, orgId }
      )
    );

    // Combine and process results
    const outgoingRelationships = outgoingResult.records.map((record) =>
      record.get('relationship')
    );
    const incomingRelationships = incomingResult.records.map((record) =>
      record.get('relationship')
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const relationships = [...outgoingRelationships, ...incomingRelationships] as GraphRelationship[];
    return relationships;
  } catch (error) {
    log.error({ err: error, objectApiName }, 'Error retrieving relationships for object');
    throw new Neo4jQueryError(
      `Failed to retrieve relationships for object ${objectApiName}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

export interface PathSegment {
  sourceObject: string;
  targetObject: string;
  relationshipType: string;
  fields?: string[];
}

export interface ObjectPath {
  length: number;
  segments: PathSegment[];
}

export async function findObjectPaths(
  sourceObjectApiName: string,
  targetObjectApiName: string,
  maxDepth = 5,
  { orgId }: { orgId?: string } = {}
): Promise<ObjectPath[]> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const orgFilter = orgId ? 'AND source.orgId = $orgId AND target.orgId = $orgId' : '';

    // Use standard Cypher allShortestPaths
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (source:Object), (target:Object)
        WHERE toLower(source.apiName) = toLower($sourceApiName) ${orgFilter ? 'AND source.orgId = $orgId' : ''}
        AND toLower(target.apiName) = toLower($targetApiName) ${orgFilter ? 'AND target.orgId = $orgId' : ''}
        MATCH path = allShortestPaths((source)-[:REFERENCES*..${maxDepth}]->(target))
        RETURN path
        LIMIT 10
        `,
        {
          sourceApiName: sourceObjectApiName,
          targetApiName: targetObjectApiName,
          orgId: orgId || null,
        }
      )
    );

    // Process the paths
    const paths = result.records.map((record) => {
      const path = record.get('path') as Path;
      const segments: PathSegment[] = [];

      // Extract nodes and relationships from the path
      const nodes: Node[] = path.segments.map((segment) => segment.start);
      nodes.push(path.end); // Add the last node

      // Create path segments
      for (let i = 0; i < nodes.length - 1; i++) {
        const sourceNode = nodes[i];
        const targetNode = nodes[i + 1];
        const relationship = path.segments[i].relationship;

        segments.push({
          sourceObject: sourceNode.properties.apiName as string,
          targetObject: targetNode.properties.apiName as string,
          relationshipType: (relationship.properties.relationshipType as string) || 'LOOKUP',
          fields: (relationship.properties.fields as string[]) || [],
        });
      }

      return {
        length: segments.length,
        segments: segments,
      };
    });
    return paths;
  } catch (error) {
    log.error({ err: error, sourceObjectApiName, targetObjectApiName }, 'Error finding paths between objects');
    throw new Neo4jQueryError(
      `Failed to find paths between objects: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

export interface RelatedObjectPreview {
  apiName: string;
  label: string;
  description: string;
  category: string;
}

export async function findRelatedObjects(
  objectApiName: string,
  maxDepth = 2,
  { orgId }: { orgId?: string } = {}
): Promise<Record<number, RelatedObjectPreview[]>> {
  const driver = getDriver();
  const session = driver.session();

  try {
    // Query for BOTH incoming and outgoing relationships
    // Many objects have lookup fields TO Account (incoming), not FROM it
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (source:Object)
        WHERE toLower(source.apiName) = toLower($apiName)
        ${orgId ? 'AND source.orgId = $orgId' : ''}
        MATCH path = (source)-[:REFERENCES*1..${maxDepth}]-(related:Object)
        WHERE source <> related
        ${orgId ? 'AND related.orgId = $orgId' : ''}
        WITH related, min(length(path)) as distance
        RETURN DISTINCT related, distance
        ORDER BY distance, related.apiName
        LIMIT 100
        `,
        {
          apiName: objectApiName,
          orgId: orgId || null,
        }
      )
    );

    // Group related objects by distance
    const relatedObjectsByDistance: Record<number, RelatedObjectPreview[]> = {};

    result.records.forEach((record) => {
      const relatedNode = record.get('related');
      const distance = record.get('distance').toNumber();

      if (!relatedObjectsByDistance[distance]) {
        relatedObjectsByDistance[distance] = [];
      }

      relatedObjectsByDistance[distance].push({
        apiName: relatedNode.properties.apiName,
        label: relatedNode.properties.label || '',
        description: relatedNode.properties.description || '',
        category: relatedNode.properties.category || 'standard',
      });
    });

    // Count total related objects
    let totalRelatedObjects = 0;
    Object.values(relatedObjectsByDistance).forEach((objects) => {
      totalRelatedObjects += objects.length;
    });
    return relatedObjectsByDistance;
  } catch (error) {
    log.error({ err: error, objectApiName }, 'Error finding objects related');
    throw new Neo4jQueryError(
      `Failed to find related objects: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

/**
 * Get all edges within an N-hop neighborhood of an object.
 * Returns edges where BOTH source and target are within the neighborhood.
 */
export async function getNeighborhoodEdges(
  objectApiName: string,
  maxDepth = 2,
  { orgId }: { orgId?: string } = {}
): Promise<GraphRelationship[]> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const orgFilter = orgId ? 'AND source.orgId = $orgId AND target.orgId = $orgId' : '';

    // Find all edges where both endpoints are within maxDepth of the center object
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        // First, find all objects within the neighborhood
        MATCH (center:Object)
        WHERE toLower(center.apiName) = toLower($apiName)
        ${orgId ? 'AND center.orgId = $orgId' : ''}
        
        MATCH path = (center)-[:REFERENCES*0..${maxDepth}]-(neighbor:Object)
        WITH collect(DISTINCT neighbor) AS neighbors, center
        
        // Now find all edges between neighbors (including center)
        UNWIND neighbors AS source
        UNWIND neighbors AS target
        WITH source, target, center WHERE source <> target
        
        MATCH (source)-[:HAS_FIELD]->(f:Field)-[:LOOKS_UP|MASTER_DETAIL]->(target)
        ${orgFilter}
        
        RETURN DISTINCT {
          sourceObject: source.apiName,
          targetObject: target.apiName,
          relationshipType: COALESCE(f.relationshipType, 'Lookup'),
          fieldCount: 1,
          direction: CASE WHEN source = center THEN 'outgoing' ELSE 'outgoing' END,
          fieldApiName: f.apiName,
          fieldLabel: f.label,
          relationshipName: f.relationshipName
        } as relationship
        ORDER BY relationship.sourceObject, relationship.fieldApiName
        `,
        {
          apiName: objectApiName,
          orgId: orgId || null,
        }
      )
    );

    return result.records.map((record) => record.get('relationship') as GraphRelationship);
  } catch (error) {
    log.error({ err: error, objectApiName }, 'Error getting neighborhood edges');
    throw new Neo4jQueryError(
      `Failed to get neighborhood edges: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

/**
 * Lightweight 1-hop neighbor summary for schema context enrichment.
 */
export interface NeighborSummary {
  apiName: string;
  label: string;
  relationshipName?: string;
  fieldApiName?: string;
  direction: 'outgoing' | 'incoming';
}

/**
 * Get 1-hop neighbors of an object with lightweight metadata.
 * Used for "peripheral vision" in schema context - helps the LLM discover
 * related objects that weren't explicitly requested by the Decomposer.
 * 
 * Protections against hub object token explosion:
 * - Caps results at `limit` (default 20)
 * - Filters out system tables (Share, Feed, History, ChangeEvent)
 * 
 * @param objectApiName - The source object API name
 * @param options.orgId - Optional org ID filter
 * @param options.limit - Max neighbors to return (default 20)
 */
export async function get1HopNeighborSummaries(
  objectApiName: string, 
  { orgId, limit = 20 }: { orgId?: string; limit?: number } = {}
): Promise<NeighborSummary[]> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const orgFilter = orgId ? 'AND target.orgId = $orgId' : '';
    
    // Query outgoing relationships (this object → other objects)
    const outgoingResult = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (o:Object)-[:HAS_FIELD]->(f:Field)-[:LOOKS_UP|MASTER_DETAIL]->(target:Object)
        WHERE toLower(o.apiName) = toLower($objName)
          AND NOT target.apiName ENDS WITH 'Share' 
          AND NOT target.apiName ENDS WITH 'Feed'
          AND NOT target.apiName ENDS WITH 'History'
          AND NOT target.apiName ENDS WITH 'ChangeEvent'
          ${orgFilter}
        RETURN DISTINCT 
          target.apiName AS apiName, 
          target.label AS label, 
          f.relationshipName AS relationshipName,
          f.apiName AS fieldApiName,
          'outgoing' AS direction
        LIMIT $limit
        `,
        { objName: objectApiName, orgId, limit: neo4j.int(limit) }
      )
    );

    // Query incoming relationships (other objects → this object)
    const remainingLimit = limit - outgoingResult.records.length;
    let incomingRecords: typeof outgoingResult.records = [];
    
    if (remainingLimit > 0) {
      const incomingResult = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (source:Object)-[:HAS_FIELD]->(f:Field)-[:LOOKS_UP|MASTER_DETAIL]->(o:Object)
          WHERE toLower(o.apiName) = toLower($objName)
            AND NOT source.apiName ENDS WITH 'Share' 
            AND NOT source.apiName ENDS WITH 'Feed'
            AND NOT source.apiName ENDS WITH 'History'
            AND NOT source.apiName ENDS WITH 'ChangeEvent'
            ${orgFilter ? 'AND source.orgId = $orgId' : ''}
          RETURN DISTINCT 
            source.apiName AS apiName, 
            source.label AS label, 
            f.relationshipName AS relationshipName,
            f.apiName AS fieldApiName,
            'incoming' AS direction
          LIMIT $limit
          `,
          { objName: objectApiName, orgId, limit: neo4j.int(remainingLimit) }
        )
      );
      incomingRecords = incomingResult.records;
    }

    // Combine results
    const allRecords = [...outgoingResult.records, ...incomingRecords];
    
    return allRecords.map((record) => ({
      apiName: record.get('apiName'),
      label: record.get('label') || record.get('apiName'),
      relationshipName: record.get('relationshipName') || undefined,
      fieldApiName: record.get('fieldApiName') || undefined,
      direction: record.get('direction') as 'outgoing' | 'incoming',
    }));
  } catch (error) {
    log.error({ err: error, objectApiName }, 'Error getting 1-hop neighbor summaries');
    return []; // Fail gracefully - neighbors are enhancement, not critical
  } finally {
    await session.close();
  }
}


export async function findDetailedPaths(
  sourceObjectApiName: string,
  targetObjectApiName: string,
  {
    maxHops = 3,
    orgId,
  }: { minHops?: number; maxHops?: number; orgId?: string } = {}
): Promise<PathFindingResult> {
  const driver = getDriver();
  // Add 30-second timeout to prevent query from hanging indefinitely
  const session = driver.session({ defaultAccessMode: 'READ' });

  try {
    const orgFilter = orgId ? 'AND source.orgId = $orgId AND target.orgId = $orgId' : '';

    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (source:Object), (target:Object)
        WHERE toLower(source.apiName) = toLower($sourceApiName) ${orgFilter}
        AND toLower(target.apiName) = toLower($targetApiName)
        
        // Use allShortestPaths for efficient path finding
        MATCH path = allShortestPaths((source)-[:REFERENCES*..${maxHops}]-(target))
        WHERE source <> target
        
        WITH path ORDER BY length(path) ASC LIMIT 25
        WITH nodes(path) as nodes, path
        
        UNWIND range(0, size(nodes)-2) as i
        WITH nodes[i] as a, nodes[i+1] as b, nodes, i, path
        
        // Find fields based on explicit lookup patterns between adjacent nodes
        // a->b: a has a lookup field pointing to b (direction = 'up' from a's perspective)
        // b->a: b has a lookup field pointing to a (direction = 'down' from a's perspective)
        
        OPTIONAL MATCH (a)-[:HAS_FIELD]->(f1:Field)-[:LOOKS_UP|MASTER_DETAIL]->(b)
        OPTIONAL MATCH (b)-[:HAS_FIELD]->(f2:Field)-[:LOOKS_UP|MASTER_DETAIL]->(a)
        
        WITH path, nodes, i,
             collect(DISTINCT f1 { 
                 .apiName, 
                 .label, 
                 .category, 
                 .relationshipName, 
                 .relationshipType,
                 referenceTo: [b.apiName],
                 toObject: b.apiName,
                 direction: 'up'
             }) as upFields,
             collect(DISTINCT f2 { 
                 .apiName, 
                 .label, 
                 .category, 
                 .relationshipName, 
                 .relationshipType,
                 referenceTo: [a.apiName],
                 toObject: a.apiName,
                 direction: 'down'
             }) as downFields
             
        WITH path, nodes, i,
             [x IN upFields WHERE x.apiName IS NOT NULL] as validUpFields,
             [x IN downFields WHERE x.apiName IS NOT NULL] as validDownFields

        ORDER BY i ASC
             
        WITH path, collect({
            fromObject: nodes[i].apiName,
            toObject: nodes[i+1].apiName,
            validUpFields: validUpFields,
            validDownFields: validDownFields
        }) as rawHops
        
        RETURN [n in nodes(path) | n.apiName] as objectNames, rawHops
        ORDER BY size(objectNames) ASC
        `
        ,
        {
          sourceApiName: sourceObjectApiName,
          targetApiName: targetObjectApiName,
          orgId: orgId || null,
        }
      )
    );

    const paths: DetailedPath[] = result.records.map((record) => {
      const objects = record.get('objectNames') as string[];
      const rawHops = record.get('rawHops') as any[];

      // Build merged hops with direction-aware fields
      const mergedHops: PathHop[] = rawHops.map((hop: any) => {
        const stepFields: any[] = [];
        
        if (hop.validUpFields?.length > 0) {
          stepFields.push(...hop.validUpFields.map((f: any) => ({
            ...f,
            direction: 'up'
          })));
        }
        
        if (hop.validDownFields?.length > 0) {
          stepFields.push(...hop.validDownFields.map((f: any) => ({
            ...f,
            direction: 'down'
          })));
        }

        if (stepFields.length > 0) {
          return {
            fromObject: hop.fromObject,
            toObject: hop.toObject,
            direction: stepFields.some(f => f.direction === 'up') ? 'up' : 'down',
            fields: stepFields.map((f: any) => ({
              apiName: f.apiName,
              label: f.label,
              toObject: f.toObject,
              referenceTo: f.referenceTo,
              category: f.category,
              relationshipName: f.relationshipName,
              relationshipType: f.relationshipType,
              direction: f.direction
            }))
          };
        }

        // Fallback for unknown relationship
        return {
          fromObject: hop.fromObject,
          toObject: hop.toObject,
          direction: 'up' as const,
          fields: [{
            apiName: 'Unknown',
            label: 'Unknown Relationship',
            toObject: hop.toObject,
            category: 'standard',
            relationshipType: 'Lookup',
            referenceTo: [],
            relationshipName: 'Unknown',
            direction: 'up' as const
          }]
        };
      });

      return {
        objects,
        hops: mergedHops,
        hopCount: mergedHops.length,
      };
    });

    // Consolidate paths based on object sequence
    const consolidatedPaths = consolidatePaths(paths);

    // Calculate stats on consolidated paths
    const pathCount = consolidatedPaths.length;
    let minHopsFound = 0;
    let maxHopsFound = 0;
    
    if (pathCount > 0) {
        minHopsFound = Math.min(...consolidatedPaths.map(p => p.hopCount));
        maxHopsFound = Math.max(...consolidatedPaths.map(p => p.hopCount));
        
        consolidatedPaths.sort((a, b) => a.hopCount - b.hopCount);
    }

    return {
      fromObject: sourceObjectApiName,
      toObject: targetObjectApiName,
      pathCount,
      minHops: minHopsFound,
      maxHops: maxHopsFound,
      paths: consolidatedPaths
    };

  } catch (error) {
    log.error({ err: error }, 'Error finding detailed paths');
    throw new Neo4jQueryError(
      `Failed to find detailed paths: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

/**
 * Consolidate paths that follow the same object sequence.
 * Merges fields from multiple edges/directions into a single path entry.
 */
function consolidatePaths(paths: DetailedPath[]): DetailedPath[] {
    const pathMap = new Map<string, DetailedPath>();

    paths.forEach(path => {
        const signature = path.objects.join('|');
        
        if (!pathMap.has(signature)) {
            pathMap.set(signature, JSON.parse(JSON.stringify(path))); // Deep copy
        } else {
            const existing = pathMap.get(signature)!;
            
            // Merge hops
            existing.hops.forEach((hop, index) => {
                const newHop = path.hops[index];
                if (!newHop) return;

                // Merge fields
                newHop.fields.forEach(newField => {
                    const fieldExists = hop.fields.some(f => 
                        f.apiName === newField.apiName && 
                        f.direction === newField.direction
                    );
                    
                    if (!fieldExists) {
                        hop.fields.push(newField);
                    }
                });
                
                // Update direction priority (if 'up' exists anywhere, make the hop 'up')
                if (hop.direction === 'down' && newHop.direction === 'up') {
                    hop.direction = 'up';
                }
            });
        }
    });

    return Array.from(pathMap.values());
}

// === SOQL Path Finding ===

/** Maximum relationship depth allowed by SOQL */
const SOQL_MAX_DEPTH = 5;

/**
 * Find paths between two objects with SOQL-ready metadata.
 * Returns paths with relationship names suitable for generating SOQL dot notation
 * and subqueries.
 * 
 * @example
 * // For Contact -> Account path, returns:
 * // { relationshipName: 'Account', childRelationshipName: 'Contacts', direction: 'up' }
 * // This enables: SELECT Account.Name FROM Contact (using relationshipName)
 * // And: SELECT (SELECT Name FROM Contacts) FROM Account (using childRelationshipName)
 */
export async function findSoqlPaths(
  sourceObjectApiName: string,
  targetObjectApiName: string,
  options: { maxHops?: number; orgId?: string } = {}
): Promise<SoqlPathResult> {
  const driver = getDriver();
  const session = driver.session();
  const maxHops = options.maxHops ?? 5;
  const orgId = options.orgId;

  try {
    const orgFilter = orgId ? 'AND source.orgId = $orgId AND target.orgId = $orgId' : '';

    // Query paths and extract relationship metadata from REFERENCES edges and Field nodes
    const result = await session.executeRead((tx) =>
      tx.run(
        `

        MATCH (source:Object), (target:Object)
        WHERE toLower(source.apiName) = toLower($sourceApiName) ${orgFilter}
        AND toLower(target.apiName) = toLower($targetApiName)
        
        // Find paths using UNION to check both directions efficiently
        // Direction 1: Source refers to Target (Lookups from Source)
        CALL {
            WITH source, target
            MATCH path = (source)-[:REFERENCES*1..${maxHops}]->(target)
            RETURN path
            UNION
            WITH source, target
            MATCH path = (target)-[:REFERENCES*1..${maxHops}]->(source)
            RETURN path
        }
        
        WITH path, nodes(path) as pathNodes, relationships(path) as pathRels
        ORDER BY length(path) ASC
        LIMIT 20
        
        // For each hop, get the relationship metadata
        UNWIND range(0, size(pathNodes)-2) as i
        WITH path, pathNodes, pathRels, i,
             pathNodes[i] as fromNode,
             pathNodes[i+1] as toNode
        
        // Determine direction by checking which node has the lookup field
        // If fromNode has a field pointing to toNode: direction = 'up' (parent lookup)
        // If toNode has a field pointing to fromNode: direction = 'down' (child relationship)
        OPTIONAL MATCH (fromNode)-[:HAS_FIELD]->(fUp:Field)-[:LOOKS_UP|MASTER_DETAIL]->(toNode)
        OPTIONAL MATCH (toNode)-[:HAS_FIELD]->(fDown:Field)-[:LOOKS_UP|MASTER_DETAIL]->(fromNode)
        
        WITH path, pathNodes, i, fromNode.apiName as fromObj, toNode.apiName as toObj,
             CASE 
               WHEN fUp IS NOT NULL THEN 'up'
               WHEN fDown IS NOT NULL THEN 'down'
               ELSE 'unknown'
             END as direction,
             COALESCE(fUp, fDown) as field,
             pathRels[i].childRelationshipNames as childRelNames
        
        // Build segment data with field info
        WITH path, pathNodes, collect(DISTINCT {
          fromObject: fromObj,
          toObject: toObj,
          direction: direction,
          fieldApiName: COALESCE(field.apiName, 'Unknown'),
          relationshipName: COALESCE(field.relationshipName, ''),
          relationshipType: COALESCE(field.relationshipType, 'Lookup'),
          childRelationshipNames: COALESCE(childRelNames, [])
        }) as segments
        
        RETURN [n in pathNodes | n.apiName] as objects, segments
        ORDER BY size(objects) ASC
        `,
        {
          sourceApiName: sourceObjectApiName,
          targetApiName: targetObjectApiName,
          orgId: orgId || null,
        }
      )
    );

    // Process results into SoqlPath format
    const processedPaths: SoqlPath[] = [];
    const seenSignatures = new Set<string>();

    for (const record of result.records) {
      const objects = record.get('objects') as string[];
      const rawSegments = record.get('segments') as any[];
      
      // Deduplicate by object sequence
      const signature = objects.join('|');
      if (seenSignatures.has(signature)) continue;
      seenSignatures.add(signature);

      const segments: SoqlPathSegment[] = rawSegments.map((seg: any) => ({
        fromObject: seg.fromObject,
        toObject: seg.toObject,
        direction: seg.direction as 'up' | 'down',
        fieldApiName: seg.fieldApiName,
        relationshipName: seg.relationshipName,
        childRelationshipName: seg.childRelationshipNames?.[0] || undefined,
        relationshipType: seg.relationshipType as 'Lookup' | 'MasterDetail' | 'Hierarchical',
      }));

      // Check if all segments go 'up' (child-to-parent) for dot notation
      const allUp = segments.every(s => s.direction === 'up');
      const allDown = segments.every(s => s.direction === 'down');
      
      // Build dot notation for child-to-parent traversals
      // Only set if ALL segments have valid relationshipName
      let dotNotation: string | undefined;
      if (allUp && segments.length > 0) {
        const relNames = segments.map(s => s.relationshipName).filter(Boolean);
        // Only set dotNotation if we have names for all segments
        if (relNames.length === segments.length) {
          dotNotation = relNames.join('.');
        }
      }

      const soqlPath: SoqlPath = {
        objects,
        segments,
        hopCount: segments.length,
        dotNotation,
        canUseSubquery: allDown,
        exceedsDepthLimit: segments.length > SOQL_MAX_DEPTH,
      };

      processedPaths.push(soqlPath);
    }

    // Sort by hop count
    processedPaths.sort((a, b) => a.hopCount - b.hopCount);

    // Find recommended path (shortest that doesn't exceed depth limit)
    const validPaths = processedPaths.filter(p => !p.exceedsDepthLimit);
    const shortestPath = processedPaths[0];
    const recommendedPath = validPaths[0];

    return {
      fromObject: sourceObjectApiName,
      toObject: targetObjectApiName,
      paths: processedPaths,
      shortestPath,
      recommendedPath,
    };

  } catch (error) {
    log.error({ err: error, sourceObjectApiName, targetObjectApiName }, 'Error finding SOQL paths');
    throw new Neo4jQueryError(
      `Failed to find SOQL paths: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

// === Child Relationship Queries ===

/**
 * Child relationship info for SOQL subquery validation.
 */
export interface ChildRelationshipInfo {
  childObject: string;
  relationshipName: string;
  fieldApiName: string;
  isMasterDetail: boolean;
}

/**
 * Get child relationships for an object (objects that reference this object).
 * Returns data needed to validate SOQL subqueries.
 * 
 * @param objectApiName - The parent object API name
 * @param options - Query options including orgId
 * @returns Array of child relationship info
 */
export async function getPicklistValues(
  objectApiName: string,
  fieldApiName: string,
  orgId?: string
): Promise<PicklistValue[]> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (f:Field {apiName: $fieldApiName, sobjectType: $objectApiName})
        WHERE ($orgId IS NULL OR f.orgId = $orgId)
        MATCH (f)-[:HAS_VALUE]->(v:PicklistValue)
        RETURN v
        ORDER BY v.value
        `,
        {
          fieldApiName,
          objectApiName,
          orgId: orgId || null,
        }
      )
    );

    return result.records.map((record) => {
      const node = record.get('v');
      return {
        value: node.properties.value,
        label: node.properties.label,
        active: node.properties.isActive,
        defaultValue: node.properties.defaultValue,
      };
    });
  } catch (error) {
    log.error(
      { err: error, objectApiName, fieldApiName },
      'Error getting picklist values'
    );
    throw new Neo4jQueryError(
      `Failed to get picklist values: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

export async function getChildRelationships(
  objectApiName: string,
  { orgId }: { orgId?: string } = {}
): Promise<ChildRelationshipInfo[]> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const orgFilter = orgId ? 'AND source.orgId = $orgId AND target.orgId = $orgId' : '';

    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (source:Object)-[r:REFERENCES]->(target:Object)
        WHERE toLower(target.apiName) = toLower($apiName)
        ${orgFilter}
        WITH source, r
        UNWIND coalesce(r.childRelationshipNames, []) AS relName
        WITH source, r, relName
        UNWIND coalesce(r.fields, []) AS fieldName
        RETURN DISTINCT
          source.apiName AS childObject,
          relName AS relationshipName,
          fieldName AS fieldApiName,
          r.relationshipType = 'MASTER_DETAIL' AS isMasterDetail
        ORDER BY relName
        `,
        { apiName: objectApiName, orgId }
      )
    );

    return result.records.map((record) => ({
      childObject: record.get('childObject'),
      relationshipName: record.get('relationshipName'),
      fieldApiName: record.get('fieldApiName'),
      isMasterDetail: record.get('isMasterDetail'),
    }));
  } catch (error) {
    log.error({ err: error, objectApiName }, 'Error fetching child relationships');
    throw new Neo4jQueryError(
      `Failed to fetch child relationships: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

/**
 * Find objects that have a picklist field containing a specific value.
 * Used for discovering which objects/fields match a term that might be a picklist value.
 * Only returns matches for active picklist values.
 */
export async function findObjectsByPicklistValue(
  value: string,
  orgId?: string
): Promise<PicklistMatch[]> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (v:PicklistValue {isActive: true})
        WHERE toLower(v.value) = toLower($value)
          AND ($orgId IS NULL OR v.orgId = $orgId)
        MATCH (v)<-[:HAS_VALUE]-(f:Field)<-[:HAS_FIELD]-(o:Object)
        WHERE ($orgId IS NULL OR o.orgId = $orgId)
        RETURN o, f, v.value as matchedValue
        LIMIT 20
        `,
        {
          value,
          orgId: orgId || null,
        }
      )
    );

    return result.records.map((record) => {
      const objNode = record.get('o');
      const fieldNode = record.get('f');
      const matchedValue = record.get('matchedValue');

      return {
        object: {
          apiName: objNode.properties.apiName,
          label: objNode.properties.label || '',
          description: objNode.properties.description || '',
          category: objNode.properties.category || 'standard',
          name: objNode.properties.name || '',
          orgId: objNode.properties.orgId || null,
          lastRefreshed: objNode.properties.lastRefreshed || null
        },
        field: {
          apiName: fieldNode.properties.apiName,
          sobjectType: fieldNode.properties.sobjectType,
          label: fieldNode.properties.label || '',
          type: fieldNode.properties.type || 'picklist',
          description: fieldNode.properties.description || '',
          helpText: fieldNode.properties.helpText || '',
          nillable: fieldNode.properties.nillable ?? true,
          unique: fieldNode.properties.unique ?? false,
          category: fieldNode.properties.category || 'standard',
          name: fieldNode.properties.name || '',
          lastRefreshed: fieldNode.properties.lastRefreshed || null
        },
        value: matchedValue
      };
    });
  } catch (error) {
    log.error({ err: error, value }, 'Error finding objects by picklist value');
    throw new Neo4jQueryError(
      `Failed to find objects by picklist value: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await session.close();
  }
}

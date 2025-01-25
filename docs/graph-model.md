# Neo4j Graph Model Documentation

## Overview

The CRM Metadata API uses Neo4j to store and manage Salesforce metadata relationships. The graph model represents Salesforce objects, fields, record types, and their relationships in a way that makes it easy to traverse and analyze the metadata structure.

## Node Types

### Object Node (:Object)

Represents a Salesforce object (standard or custom).

Properties:

- `apiName`: String (unique, indexed) - The API name of the object (e.g., "Account", "Contact", "Custom_Object\_\_c")
- `label`: String - The display label of the object
- `description`: String - Object description from Salesforce
- `category`: String (indexed) - The category of the object (e.g., 'standard', 'custom', 'platform_event', 'metadata_type', 'external', 'system')
- `subtype`: String - Detailed subtype (e.g., 'Feed', 'Share', 'History') or null
- `namespace`: String - The namespace prefix for managed package objects, or null for local/unmanaged
- `parentObjectName`: String - For derived objects (like Feed/Share), the API name of the parent object
- `keyPrefix`: String - The 3-character ID prefix for this object's records
- `lastRefreshed`: DateTime - Timestamp of the last refresh


### Field Node (:Field)

Represents a field within a Salesforce object.

Properties:

- `apiName`: String - The API name of the field
- `sobjectType`: String - The API name of the object this field belongs to
- `label`: String - The display label of the field
- `type`: String (indexed) - The field type (e.g., "string", "reference", "picklist")
- `description`: String - Field description from Salesforce
- `helpText`: String - Field help text from Salesforce
- `referenceTo`: String[] (indexed) - For reference fields, the API name(s) of the object(s) this field references. Stored as an array to support polymorphic lookups (e.g., Task.WhatId can reference Account, Opportunity, etc.)
- `relationshipName`: String - The relationship name for traversing to related records
- `relationshipType`: String - The type of relationship: 'Lookup', 'MasterDetail', or 'Hierarchical' (self-referential lookups)
- `nillable`: Boolean - Whether the field is nullable
- `unique`: Boolean - Whether the field must be unique
- `category`: String - The category of the field (e.g., 'standard', 'custom', 'system')
- `namespace`: String - The namespace prefix for managed package fields
- `controllerName`: String - API name of the controlling field (for dependent fields)
- `lastRefreshed`: DateTime - Timestamp of the last refresh

SOQL-relevant properties:

- `calculated`: Boolean - Whether the field is a formula field
- `filterable`: Boolean - Whether the field can be used in WHERE clauses
- `sortable`: Boolean - Whether the field can be used in ORDER BY clauses
- `groupable`: Boolean - Whether the field can be used in GROUP BY clauses
- `length`: Integer - Maximum length for string fields
- `precision`: Integer - Total number of digits for numeric fields
- `scale`: Integer - Number of digits to the right of the decimal point


### RecordType Node (:RecordType)

Represents a record type configuration for a Salesforce object.

Properties:

- `apiName`: String - The API name of the record type
- `sobjectType`: String - The API name of the object this record type belongs to
- `label`: String - The display label of the record type
- `description`: String - Record type description
- `isActive`: Boolean - Whether the record type is active
- `isDefault`: Boolean - Whether this is the default record type
- `lastRefreshed`: DateTime - Timestamp of the last refresh


### PicklistValue Node (:PicklistValue)

Represents a specific value within a picklist field.

Properties:

- `value`: String - The actual value (API name)
- `label`: String - The display label
- `isActive`: Boolean - Whether the value is active
- `defaultValue`: Boolean - Whether this is the default value
- `validFor`: String - Base64 encoded bitmap indicating valid controlling values (for dependent picklists)
- `apiName`: String - Same as value (for consistency)
- `objectApiName`: String - The object this value belongs to
- `fieldApiName`: String - The field this value belongs to
- `orgId`: String - The Org ID


## Relationships

### HAS_FIELD

Connects an Object node to its Field nodes. This relationship represents field ownership.

**Properties**: None

**Example**:

```cypher
// Account object has a Name field
(Account:Object)-[:HAS_FIELD]->(Name:Field)
```

**Creation**:

```cypher
MATCH (o:Object {apiName: "Account"})
MERGE (f:Field {apiName: "Name", sobjectType: "Account"})
MERGE (o)-[:HAS_FIELD]->(f)
```

### HAS_RECORD_TYPE

Connects an Object node to its RecordType nodes. This relationship defines which record types are available for an object.

**Properties**: None

**Example**:

```cypher
// Account object has a Customer record type
(Account:Object)-[:HAS_RECORD_TYPE]->(Customer:RecordType)
```

**Creation**:

```cypher
MATCH (o:Object {apiName: "Account"})
MERGE (rt:RecordType {apiName: "Customer", sobjectType: "Account"})
MATCH (o:Object {apiName: "Account"})
MERGE (rt:RecordType {apiName: "Customer", sobjectType: "Account"})
MERGE (o)-[:HAS_RECORD_TYPE]->(rt)
```

### DERIVED_FROM

Connects a system-derived object (like `AccountFeed` or `AccountShare`) to its parent object (`Account`).

- **Source Label**: `Object` (The derived object)
- **Target Label**: `Object` (The parent object)
- **Properties**: None

### CONTROLLED_BY

Connects a dependent Field node to its controlling Field node.

- **Source Label**: `Field` (The dependent field)
- **Target Label**: `Field` (The controlling field)
- **Properties**: None

**Example**:
```cypher
// City depends on Country
(City:Field)-[:CONTROLLED_BY]->(Country:Field)
```

### HAS_VALUE

Connects a Field node to its PicklistValue nodes.

- **Source Label**: `Field`
- **Target Label**: `PicklistValue`
- **Properties**: None

### Relationships

#### Field-Object Relationships

Represents how fields reference other objects. Uses two distinct relationship types:

1. **LOOKS_UP**: For lookup and hierarchical (self-referential) relationships
   **Properties**:

- `relationshipType`: String - "Lookup" or "Hierarchical"

2. **MASTER_DETAIL**: For master-detail relationships
   **Properties**:

- `relationshipType`: String - Always "MasterDetail"

Note: **Hierarchical** relationships are a special case of lookups where a field references its own object (e.g., `Account.ParentId` references `Account`). These are stored with `LOOKS_UP` edges but with `relationshipType: "Hierarchical"` on the Field node.

**Polymorphic Lookups**: Some fields can reference multiple object types (e.g., `Task.WhatId` can reference Account, Opportunity, Case, etc.). These fields have their `referenceTo` property stored as an array, and multiple `LOOKS_UP` edges are created - one to each possible target object.

**Examples**:

```cypher
// Lookup relationship
(f:Field {apiName: "AccountId", sobjectType: "Contact"})-[:LOOKS_UP]->(Account:Object)

// Master-detail relationship
(f:Field {apiName: "OpportunityId", sobjectType: "OpportunityLineItem"})-[:MASTER_DETAIL]->(Opportunity:Object)

// Hierarchical (self-referential) relationship
(f:Field {apiName: "ParentId", sobjectType: "Account", relationshipType: "Hierarchical"})-[:LOOKS_UP]->(Account:Object)

// Polymorphic lookup (multiple edges from same field)
(f:Field {apiName: "WhatId", sobjectType: "Task", referenceTo: ["Account", "Opportunity", "Case"]})-[:LOOKS_UP]->(Account:Object)
(f:Field {apiName: "WhatId", sobjectType: "Task"})-[:LOOKS_UP]->(Opportunity:Object)
(f:Field {apiName: "WhatId", sobjectType: "Task"})-[:LOOKS_UP]->(Case:Object)
```

#### REFERENCES Relationship

Represents aggregated relationships between Salesforce objects.

**Properties**:

- `fields`: String[] - Array of field API names that reference the target object
- `fieldCount`: Integer - Number of fields that reference the target object (derived from `size(fields)`)
- `relationshipType`: String - The strongest type of relationship ("LOOKUP" or "MASTER_DETAIL")
- `childRelationshipNames`: String[] - Array of relationship names used for SOQL subqueries from the target object back to the source (e.g., `["Contacts"]` for Account→Contact)

**SOQL Usage**:

The `childRelationshipNames` property enables generating SOQL subqueries. For example, if `Account` has a `REFERENCES` edge to `Contact` with `childRelationshipNames: ["Contacts"]`, you can write:

```sql
SELECT Name, (SELECT FirstName, LastName FROM Contacts) FROM Account
```

**Example**:

```cypher
// Contact has two reference fields to Account
(Contact:Object)-[:REFERENCES {
  fields: ["AccountId", "ReportsToId"],
  fieldCount: 2,
  relationshipType: "MASTER_DETAIL",
  childRelationshipNames: ["Contacts"]
}]->(Account:Object)
```

**Creation**:

```cypher
// Create or update object-level REFERENCES edge
MATCH (source:Object {apiName: "Contact"})
MATCH (target:Object {apiName: "Account"})
MERGE (source)-[r:REFERENCES]->(target)
ON CREATE SET
  r.fields = [$fieldName],
  r.relationshipType = $relationshipType
ON MATCH SET
  r.fields = CASE
    WHEN $fieldName IN coalesce(r.fields, []) THEN r.fields
    ELSE coalesce(r.fields, []) + $fieldName
  END,
  r.relationshipType = CASE
    WHEN $relationshipType = 'MASTER_DETAIL' THEN 'MASTER_DETAIL'
    WHEN r.relationshipType = 'MASTER_DETAIL' THEN 'MASTER_DETAIL'
    ELSE 'LOOKUP'
  END
WITH r
SET r.fieldCount = size(r.fields)
```

**Common Queries**:

1. Find all objects that reference a specific object:

```cypher
MATCH (source:Object)-[r:REFERENCES]->(target:Object {apiName: 'Account'})
RETURN source.apiName, r.fields, r.fieldCount, r.relationshipType
```

2. Find objects with master-detail relationships:

```cypher
MATCH (source:Object)-[r:REFERENCES {relationshipType: 'MASTER_DETAIL'}]->(target:Object)
RETURN source.apiName, target.apiName, r.fields, r.fieldCount
```

3. Find objects with multiple reference fields:

```cypher
MATCH (source:Object)-[r:REFERENCES]->(target:Object)
WHERE r.fieldCount > 1
RETURN source.apiName, target.apiName, r.fields, r.relationshipType
```

**Maintenance**:

REFERENCES edges are automatically maintained during incremental sync:
- When fields are soft-deleted, `fields` and `fieldCount` are recalculated from active fields
- REFERENCES edges with no active fields are deleted

## Constraints

### Uniqueness Constraints

1. Object nodes must be unique by `apiName` only

2. Field nodes must be unique by the composite key (`apiName`, `sobjectType`)

   ```cypher
   CREATE CONSTRAINT FOR (n:Field) REQUIRE (n.apiName, n.sobjectType) IS UNIQUE
   ```

3. RecordType nodes must be unique by the composite key (`apiName`, `sobjectType`)

   ```cypher
   CREATE CONSTRAINT FOR (n:RecordType) REQUIRE (n.apiName, n.sobjectType) IS UNIQUE
   ```

Notes:

- Always use composite constraints for Field and RecordType nodes
- Never create individual property constraints when composite uniqueness is required
- Use the exact syntax shown above for creating constraints

## Example Queries

### Find all lookup relationships for an object

```cypher
MATCH (o:Object {apiName: "Account"})-[:HAS_FIELD]->(f:Field)-[:LOOKS_UP]->(related:Object)
RETURN o.apiName as source, f.apiName as field, related.apiName as target
```

### Find all master-detail relationships for an object

```cypher
MATCH (o:Object {apiName: "Contact"})-[:HAS_FIELD]->(f:Field)-[:MASTER_DETAIL]->(related:Object)
RETURN o.apiName as source, f.apiName as field, related.apiName as target
```

### Find all objects referencing another object (using REFERENCES edge)

```cypher
MATCH (source:Object)-[r:REFERENCES]->(target:Object {apiName: 'Account'})
RETURN source.apiName, r.fields, r.fieldCount, r.relationshipType
```

### Get all fields for an object with their types

```cypher
MATCH (o:Object {apiName: "Account"})-[:HAS_FIELD]->(f:Field)
RETURN f.apiName as fieldName, f.type as fieldType
ORDER BY f.apiName
```

### Find objects with their record types

```cypher
MATCH (o:Object)-[:HAS_RECORD_TYPE]->(rt:RecordType)
RETURN o.apiName as object, collect(rt.apiName) as recordTypes
```

## Verification Queries

After a sync, run these queries to verify the data model:

### Verify polymorphic lookups stored as arrays

```cypher
MATCH (f:Field)
WHERE size(f.referenceTo) > 1
RETURN f.sobjectType, f.apiName, f.referenceTo LIMIT 10
```

### Verify typed Field→Object edges

```cypher
MATCH ()-[r:LOOKS_UP|MASTER_DETAIL]->()
RETURN type(r) as edgeType, count(*) as count
```

### Verify DERIVED_FROM edges exist

```cypher
MATCH (d:Object)-[:DERIVED_FROM]->(p:Object)
RETURN d.apiName as derivedObject, p.apiName as parentObject LIMIT 10
```

### Verify hierarchical relationships

```cypher
MATCH (f:Field {relationshipType: 'Hierarchical'})
RETURN f.sobjectType, f.apiName, f.referenceTo LIMIT 10
```

### Verify new field properties

```cypher
MATCH (f:Field)
WHERE f.calculated = true
RETURN f.sobjectType, f.apiName, f.type LIMIT 10
```

### Find formula fields that cannot be filtered

```cypher
MATCH (f:Field)
WHERE f.calculated = true AND f.filterable = false
RETURN f.sobjectType, f.apiName
```

## Semantic Knowledge Graph Extensions

The following extensions support semantic search and value-based grounding.

### Vector Embedding Properties

The following node types support vector embeddings for semantic similarity search:

**Object Node Additional Properties:**
- `embedding`: float[] - Vector representation of object metadata (label, description)
- `contentHash`: String - SHA-256 hash of source content for change detection

**Field Node Additional Properties:**
- `embedding`: float[] - Vector representation of field metadata (label, description, helpText, type)
- `contentHash`: String - SHA-256 hash of source content for change detection

**PicklistValue Node Additional Properties:**
- `embedding`: float[] - Vector representation of value and context
- `contentHash`: String - SHA-256 hash of source content for change detection

### Category Node (:Category)

Represents a semantic category for schema classification.

Properties:
- `name`: String (unique) - Category name (see available categories below)
- `description`: String - Human-readable description
- `embedding`: float[] - Vector representation for semantic matching
- `isAutoGenerated`: Boolean - Whether derived from heuristic analysis
- `parentCategory`: String - Optional parent category for hierarchy
- `examples`: String[] - Example values/entities for this category
- `heuristicRule`: String - The rule that generated this category (e.g., "HAS_LOOKUP_TO:Account")

**Available Object Categories:**

| Category | Description | How Identified |
|----------|-------------|----------------|
| `business_core` | Core CRM objects (Account, Contact, Lead, Opportunity, Case, etc.) | Explicit list + standard objects fallback |
| `business_extended` | Custom objects linked to core objects | HAS_LOOKUP_TO:Account/Contact/Opportunity |
| `system_derived` | Feed, History, Share, ChangeEvent objects | `o.category = 'system'` from object-classifier |
| `custom_metadata` | Custom Metadata Types (`__mdt`) | `o.category = 'metadata_type'` |
| `platform_event` | Platform Events (`__e`) | `o.category = 'platform_event'` |
| `external_object` | External Objects (`__x`) | `o.category = 'external'` |
| `managed_package` | Objects from managed packages | Non-system namespace detected |
| `system` | System/Tooling API objects | Tooling or Metadata namespace |

**Available Field Categories:**

| Category | Description | How Identified |
|----------|-------------|----------------|
| `lifecycle` | Status, Stage, Phase fields | Field name pattern matching |
| `financial` | Amount, Revenue, Price fields | Field name pattern matching |
| `temporal` | Date and DateTime fields | Field type matching |

Categories are assigned via `sf graph categorize` or `sf graph sync --categorize`.

### CATEGORIZED_AS Relationship

Connects Object or Field nodes to Category nodes.

**Properties:**
- `confidence`: Float (0-1) - Confidence score of the categorization
- `source`: String - How the categorization was determined: 'heuristic', 'manual', or 'semantic'
- `rule`: String - The specific rule that created this categorization (for heuristic sources)

**Example:**
```cypher
(o:Object {apiName: "Invoice__c"})-[:CATEGORIZED_AS {
  confidence: 0.9,
  source: 'heuristic',
  rule: 'HAS_LOOKUP_TO:Account'
}]->(c:Category {name: 'business_core'})
```

### Vector Indexes

The following vector indexes support semantic similarity search (requires Neo4j 5.11+):

```cypher
CREATE VECTOR INDEX object_embedding FOR (o:Object) ON (o.embedding)
OPTIONS {indexConfig: {`vector.dimensions`: 768, `vector.similarity_function`: 'cosine'}}

CREATE VECTOR INDEX field_embedding FOR (f:Field) ON (f.embedding)
OPTIONS {indexConfig: {`vector.dimensions`: 768, `vector.similarity_function`: 'cosine'}}

CREATE VECTOR INDEX picklist_value_embedding FOR (p:PicklistValue) ON (p.embedding)
OPTIONS {indexConfig: {`vector.dimensions`: 768, `vector.similarity_function`: 'cosine'}}

CREATE VECTOR INDEX category_embedding FOR (c:Category) ON (c.embedding)
OPTIONS {indexConfig: {`vector.dimensions`: 768, `vector.similarity_function`: 'cosine'}}
```

Note: Vector dimensions depend on the embedding provider (768 for Ollama nomic-embed-text, 1536 for OpenAI text-embedding-3-small).

### Semantic Search Query Examples

**Find objects similar to a query:**
```cypher
CALL db.index.vector.queryNodes('object_embedding', 10, $queryEmbedding)
YIELD node, score
RETURN node.apiName, node.label, score
ORDER BY score DESC
```

**Find fields with semantic similarity within an object:**
```cypher
CALL db.index.vector.queryNodes('field_embedding', 10, $queryEmbedding)
YIELD node, score
WHERE node.sobjectType = 'Account'
RETURN node.apiName, node.label, score
ORDER BY score DESC
```

**Find objects by category:**
```cypher
MATCH (o:Object)-[r:CATEGORIZED_AS]->(c:Category {name: 'business_core'})
RETURN o.apiName, o.label, r.confidence
ORDER BY r.confidence DESC
```

## Best Practices

1. Always use MERGE for creating nodes to handle upsert scenarios
2. Use composite key constraints for Field and RecordType nodes
3. Include both field-level and object-level relationships for complete metadata representation
4. Use the updatedAt timestamp to track metadata changes
5. Always validate relationship types when creating LOOKS_UP or MASTER_DETAIL relationships
6. Store referenceTo as an array to support polymorphic lookups
7. Use contentHash to detect changes before re-embedding to avoid unnecessary API calls
8. Vector indexes require Neo4j 5.11+ with community or enterprise edition

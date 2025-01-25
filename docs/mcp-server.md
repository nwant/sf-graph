# Model Context Protocol (MCP) Server Documentation

## Overview

The Model Context Protocol (MCP) server provides a standardized way for AI applications to understand and consume Salesforce metadata. It follows the [Model Context Protocol](https://modelcontextprotocol.io/) standard, which enables seamless integration between LLM applications and external data sources.

The MCP server exposes Salesforce metadata as both resources and tools that can be discovered and consumed by AI applications, making it easier for AI models to reason about the structure of Salesforce objects, fields, and their relationships.

## Protocol Implementation

Our MCP server implements the following features of the Model Context Protocol:

1. **Server Capabilities**: The server declares its capabilities during initialization
2. **Resources**: The server exposes Salesforce metadata as resources that can be listed and read
3. **Resource Templates**: The server provides templates for parameterized resource access
4. **Tools**: The server provides tools for interacting with Salesforce metadata

All communication follows the JSON-RPC 2.0 message format as specified by the MCP standard.

## Server Types

The MCP server is available in two forms:

1. **HTTP Server**: Accessible via HTTP endpoints (described below)
2. **STDIO Server**: For direct integration with desktop applications like Claude for Desktop

To use the STDIO server, run:

```bash
npm run mcp
```

## Endpoints

### Server Initialization

#### `POST /mcp/initialize`

Initializes the MCP server and returns its capabilities.

**Request Format:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {}
}
```

**Response Format:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "capabilities": {
      "resources": {
        "subscribe": false,
        "listChanged": false
      }
    }
  }
}
```

### Resources

#### `POST /mcp/resources/list`

Lists all available Salesforce metadata resources.

**Request Format:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/list",
  "params": {
    "cursor": null
  }
}
```

**Response Format:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "resources": [
      {
        "uri": "salesforce://object/Account",
        "name": "Account",
        "description": "Salesforce Account object",
        "mimeType": "application/json"
      },
      {
        "uri": "salesforce://object/Contact",
        "name": "Contact",
        "description": "Salesforce Contact object",
        "mimeType": "application/json"
      }
    ],
    "nextCursor": null
  }
}
```

#### `POST /mcp/resources/read`

Reads the content of a specific Salesforce metadata resource.

**Request Format:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "resources/read",
  "params": {
    "uri": "salesforce://object/Account"
  }
}
```

**Response Format:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "contents": [
      {
        "uri": "salesforce://object/Account",
        "mimeType": "application/json",
        "text": "{\"object\":{\"apiName\":\"Account\",\"label\":\"Account\",\"description\":\"Standard Salesforce Account object\",\"category\":\"standard\"},\"fields\":[...],\"relationships\":[...]}"
      }
    ]
  }
}
```

### Resource Templates

#### `POST /mcp/resources/templates/list`

Lists available resource templates for parameterized access to Salesforce metadata.

**Request Format:**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "resources/templates/list",
  "params": {}
}
```

**Response Format:**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "resourceTemplates": [
      {
        "uriTemplate": "salesforce://object/{objectApiName}",
        "name": "Salesforce Object",
        "description": "Access metadata for a specific Salesforce object",
        "mimeType": "application/json"
      }
    ]
  }
}
```

## Resource URI Format

The MCP server uses the following URI format for Salesforce metadata resources:

- `salesforce://object/{objectApiName}`: Represents a Salesforce object and its metadata

For example:

- `salesforce://object/Account`: The Account object
- `salesforce://object/Contact`: The Contact object
- `salesforce://object/Custom_Object__c`: A custom object

## Resource Content Format

When reading a resource, the content is returned as a JSON object with the following structure:

```json
{
  "object": {
    "apiName": "Account",
    "label": "Account",
    "description": "Standard Salesforce Account object",
    "category": "standard"
  },
  "fields": [
    {
      "apiName": "Name",
      "label": "Account Name",
      "description": "Name of the account",
      "type": "string",
      "category": "standard",
      "nullable": false,
      "unique": false,
      "helpText": "Enter the account name"
    }
  ],
  "relationships": [
    {
      "sourceObject": "Account",
      "targetObject": "Contact",
      "relationshipType": "MASTER_DETAIL",
      "fieldCount": 1,
      "direction": "outgoing"
    }
  ]
}
```

## Tools

The MCP server provides the following tools for interacting with Salesforce metadata:

### `list-objects`

Lists all Salesforce objects in the metadata graph.

**Input Parameters**: None

**Output**: JSON array of Salesforce objects with their metadata

### `get-object`

Gets detailed information about a specific Salesforce object.

**Input Parameters**:

- `apiName` (string): API name of the Salesforce object (case insensitive)

**Output**: JSON object containing:

- Object metadata (apiName, label, description, category)
- Fields (apiName, label, description, type, category, nullable, unique, helpText)
- Relationships (sourceObject, targetObject, relationshipType, fieldCount, direction)

### `find-object`

Checks if a specific Salesforce object exists in the graph and returns summary information. Useful for verifying object API names before query planning.

**Input Parameters**:

- `objectApiName` (string): API name of the Salesforce object (case insensitive)
- `orgId` (string, optional): Target org ID

**Output**: JSON object containing:

- `found` (boolean): Whether the object exists
- `apiName` (string): Standard API name (if found)
- `label` (string): Object label
- `relationshipHints` (array): Names of related objects


### `generate-soql`

Generates a SOQL query for a Salesforce object.

**Input Parameters**:

- `objectApiName` (string): API name of the Salesforce object
- `fields` (array of strings, optional): Fields to include in the query
- `whereClause` (string, optional): WHERE clause for the query
- `limit` (number, optional): Limit the number of records returned

**Output**: A SOQL query string

### `validate-soql`

Validates a SOQL query against the schema, active picklist values, and aggregation rules.

**Input Parameters**:

- `query` (string): The SOQL query to validate

**Output**: JSON object containing:
- `valid` (boolean): Whether the query is valid
- `messages` (array): List of validation errors, warnings, or corrections
- `correctedQuery` (string, optional): Automatically corrected SOQL if applicable

**Features**:
1. **Schema Validation**: Checks if objects, fields, and relationships exist
2. **Hallucination Detection**: Identifies potential entity hallucinations (e.g., matching "Apple" to an Account name instead of a field)
3. **Aggregate Validation**: Enforces `GROUP BY` rules for aggregate functions (e.g., `COUNT`, `SUM`)
4. **Smart Corrections**: Suggests valid field/relationship names using fuzzy matching

### `mediate-query-intent`

Analyzes natural language to identify entities, user intent, and required filters.

**Input Parameters**:

- `query` (string): Natural language query describing the desired data

**Output**: JSON object containing:
- `primaryEntity` (string): The main Salesforce object (e.g., "Account")
- `explanation` (string): Reasoning behind the entity selection
- `filters` (array): List of required filters (field names and semantic values)

### `resolve-entity`

Resolves a specific entity name (company, person, status) to valid SOQL filter patterns using the semantic grounding service.

**Input Parameters**:

- `entityName` (string): The name/value to resolve (e.g., "Microsoft", "High Priority")
- `entityType` (string, optional): Type hint: 'company', 'person', 'status', 'priority', 'unknown'
- `targetObject` (string, optional): Target object context (e.g., "Account")
- `orgId` (string, optional): Target org ID

**Output**: JSON object containing:
- `found` (boolean): Whether the entity was grounded
- `type` (string): Resolved type (e.g., "account_name", "picklist_value")
- `confidence` (number): Confidence score (0-1)
- `suggestedFilter` (string): Valid SOQL filter pattern
- `alternatives` (array): Alternative interpretations

### `get-filter-recommendation`

Recommends valid SOQL filter syntax for a given field and natural language value, checking against active picklist values.

**Input Parameters**:

- `sobject` (string): Salesforce object name
- `field` (string): Field name
- `value` (string): Natural language value (e.g., "high", "Microsoft")

**Output**: JSON object containing:
- `recommendedFilter` (string): Valid SOQL filter (e.g., `Priority = 'High'`)
- `isStandardPicklist` (boolean): Whether it matched a picklist value


### `execute-soql`

Executes a SOQL query against Salesforce and returns the results.

**Input Parameters**:

- `query` (string): SOQL query to execute

**Output**: JSON object containing:

- `totalSize`: Number of records returned
- `done`: Whether the query is complete
- `records`: Array of records returned by the query

### `explore-relationships`

Finds paths between two Salesforce objects in the metadata graph. Returns SOQL-ready metadata for generating relationship queries.

**Input Parameters**:

- `sourceObjectApiName` (string): API name of the source object
- `targetObjectApiName` (string): API name of the target object
- `maxDepth` (number, optional): Maximum path depth to search (default: 5)

**Output**: JSON object containing:

- `sourceObject`: Source object API name
- `targetObject`: Target object API name
- `pathCount`: Number of paths found
- `paths`: Array of paths between the objects, each with segments showing:
  - `direction`: "up" (child-to-parent) or "down" (parent-to-child)
  - `relationshipName`: Used for SOQL dot notation (e.g., `Account.Name`)
  - `childRelationshipName`: Used for SOQL subqueries (e.g., `SELECT Id FROM Contacts`)

### `find-related-objects`

Finds all objects related to a specific Salesforce object.

**Input Parameters**:

- `objectApiName` (string): API name of the Salesforce object
- `maxDepth` (number, optional): Maximum relationship depth to search (default: 2)

**Output**: JSON object containing:

- `sourceObject`: Source object API name
- `relatedObjects`: Object containing related objects grouped by distance

### `generate-sample-data`

Generates sample data for a Salesforce object.

**Input Parameters**:

- `objectApiName` (string): API name of the Salesforce object
- `count` (number, optional): Number of records to generate (default: 5)
- `includeRelated` (boolean, optional): Whether to include related objects (default: false)

**Output**: JSON object containing sample records for the requested object (and related objects if requested)

## Using the MCP Server with AI Applications

AI applications can use the MCP server in two ways:

### HTTP API

1. **Discover available Salesforce objects**: Use the `/mcp/resources/list` endpoint to get a list of all available Salesforce objects.

2. **Understand object structure**: Use the `/mcp/resources/read` endpoint with a specific object URI to get detailed information about a Salesforce object, including its fields and relationships.

3. **Use parameterized access**: Use the resource templates to access specific objects by name.

### Claude for Desktop Integration

1. Configure Claude for Desktop to use the MCP server by adding the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sf-graph": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/path/to/sf-graph"
    }
  }
}
```

2. Restart Claude for Desktop

3. Use the tools directly in your conversations with Claude

The consistent format of the MCP responses makes it easier for AI applications to reason about the structure of Salesforce metadata and provide more accurate and helpful responses to users.

## Semantic Search Tools

The following tools leverage the Semantic Knowledge Graph for advanced search capabilities:

### `semantic-search`

Find objects or fields using semantic similarity search.

**Input Parameters**:

- `query` (string): Natural language search query
- `searchType` (string): 'objects' or 'fields'
- `targetObject` (string, optional): Limit field search to specific object
- `topK` (number, optional): Number of results (default: 10)
- `orgId` (string, optional): Target org ID

**Output**: JSON array of matches with similarity scores

### `ground-entity`

Ground a value against org data to determine the correct SOQL filter pattern.

**Input Parameters**:

- `value` (string): The value to ground (e.g., "Microsoft", "Closed Won")
- `targetObject` (string, optional): Target object context
- `enableSoslFallback` (boolean, optional): Enable SOSL search for instance data verification

**Output**: JSON object containing:
- `isGrounded` (boolean): Whether the value was successfully grounded
- `type` (string): Grounded type (e.g., "account_name", "picklist_value")
- `suggestedFilter` (string): Valid SOQL filter pattern
- `evidence` (object): Source of grounding (picklist, category, semantic, sosl_verified)

### `get-schema-category`

Get the semantic category of an object or field based on graph structure analysis.

**Input Parameters**:

- `objectName` (string): Object API name
- `fieldName` (string): Field API name
- `orgId` (string, optional): Target org ID

**Output**: JSON object containing:
- `category` (string): Semantic category (e.g., "business_core", "lifecycle", "system")
- `confidence` (number): Confidence score
- `source` (string): How the category was determined ('heuristic', 'manual')

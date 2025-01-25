# Contributing to sf-graph

First off, thanks for taking the time to contribute! 🎉

The following is a set of guidelines for contributing to `sf-graph`. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Development Setup

1.  **Prerequisites**:
    - Node.js (v18+)
    - Docker Desktop (for Neo4j)

2.  **Installation**:

    ```bash
    git clone https://github.com/nwant/sf-graph.git
    cd sf-graph
    npm install
    
    # Configure Neo4j and Salesforce
    sf graph db config
    sf graph org config
    ```

3.  **Running Locally**:
    - Start Neo4j: `docker-compose up -d`
    - Start the server: `npm run dev`

## Architecture & Extensibility

This project uses a **Strategy Pattern** for handling different Salesforce metadata types. If you want to add support for a new metadata type (e.g., `Layout` or `PermissionSet`), you **do not** need to modify the core Neo4j services.

### How to add a new Metadata Type

1.  **Create a Handler**:
    Create a new file in `src/services/handlers/` (e.g., `LayoutHandler.ts`) that extends `BaseHandler`.

    ```typescript
    import { BaseHandler } from './BaseHandler.js';
    import { Transaction } from 'neo4j-driver';

    export class LayoutHandler extends BaseHandler {
      async process(tx: Transaction, item: unknown): Promise<void> {
        // Your logic to create nodes/relationships
        await tx.run('CREATE (l:Layout {name: $name})', { name: (item as {name: string}).name });
      }
    }
    ```

2.  **Register the Handler**:
    Add it to `src/services/HandlerRegistry.ts` in the `HANDLER_CLASSES` map.

3.  **Update Configuration**:
    Add your new type to `sf-graph.config.json`:
    ```json
    { "name": "Layout", "handler": "LayoutHandler" }
    ```

## Testing

We use Jest for unit and integration tests.

- **Run all tests**: `npm test`
- **Run unit tests**: `npm test -- --testPathPattern="tests/unit"`
- **Run E2E tests**: `npm run test:e2e` (requires running Neo4j)

### Test Structure

```
tests/
├── unit/
│   ├── core/           # api-service, object-classifier tests
│   ├── mcp/            # MCP tools tests
│   └── neo4j/          # graph-service, sync-service tests
├── integration/        # Full sync cycle tests
└── e2e/                # End-to-end tests
```

### Writing Tests

For ESM modules, use Jest's `unstable_mockModule`:

```javascript
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../dist/services/neo4j/driver.js', () => ({
  getDriver: jest.fn(),
}));

const { functionUnderTest } = await import('../../../dist/path/to/module.js');
```

## Error Handling

Use custom error classes from `src/core/errors.ts`:

- `SfGraphError` - Base error class with error code and cause chaining
- `Neo4jConnectionError` - Neo4j connection issues
- `Neo4jQueryError` - Neo4j query execution failures
- `Neo4jTransactionConflictError` - Deadlock/retry scenarios (transient)
- `SalesforceConnectionError` - Salesforce auth issues
- `SalesforceApiError` - Salesforce API call failures
- `SalesforceRateLimitError` - Rate limiting with retry-after hint
- `ObjectNotFoundError` - Object not in graph
- `SyncError` - Sync operation failures
- `PartialSyncError` - Partial sync with aggregated errors
- `ConfigurationError` - Invalid/missing configuration
- `LlmError` - LLM service issues

## Concurrency Utilities

For parallel operations, use utilities from `src/core/concurrency.ts`:

```typescript
import { pLimit, retryWithBackoff, batchProcess } from './concurrency.js';

// Limit concurrent API calls
const limit = pLimit(10);
await Promise.all(items.map(item => limit(() => fetchItem(item))));

// Retry with exponential backoff
const result = await retryWithBackoff(
  () => connection.describe(objectName),
  { attempts: 3, shouldRetry: isRetryableError }
);

// Process items in batches
await batchProcess(items, 50, async (batch) => {
  await session.executeWrite(tx => tx.run(query, { items: batch }));
});
```

## Pull Request Process

1.  Ensure any install or build dependencies are removed before the end of the layer when doing a build.
2.  Update the README.md with details of changes to the interface, this includes new environment variables, exposed ports, useful file locations and container parameters.
3.  Increase the version numbers in any examples files and the README.md to the new version that this Pull Request would represent.

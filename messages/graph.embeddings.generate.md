# summary

Generate embeddings for graph nodes (objects and fields).

# description

Generates vector embeddings for objects and fields in the graph using the configured embedding provider.

Features:
- Content hashing: Only re-embeds nodes when content changes
- Batch processing: Efficiently processes large schemas
- Smart rate limiting: Exponential backoff for API rate limits

Typical workflow:
1. sf graph sync (sync metadata)
2. sf graph embeddings init (create vector indexes)
3. sf graph embeddings generate (generate embeddings)

# examples

- Generate embeddings for all objects and fields:

  <%= config.bin %> <%= command.id %>

- Force re-embed everything (ignore content hashes):

  <%= config.bin %> <%= command.id %> --force

- Only generate object embeddings:

  <%= config.bin %> <%= command.id %> --skip-fields

- Only generate field embeddings:

  <%= config.bin %> <%= command.id %> --skip-objects

- Use smaller batch size for rate-limited APIs:

  <%= config.bin %> <%= command.id %> --batch-size 10

# flags.force.summary

Re-embed all nodes regardless of content hash.

# flags.objects.summary

Comma-separated list of object API names to embed.

# flags.skip-objects.summary

Skip object embeddings, only generate field embeddings.

# flags.skip-fields.summary

Skip field embeddings, only generate object embeddings.

# flags.batch-size.summary

Number of items to embed per API call.

# flags.provider.summary

Override the configured embedding provider.

# flags.quiet.summary

Suppress non-essential output.

# flags.model.summary

Override the embedding model.

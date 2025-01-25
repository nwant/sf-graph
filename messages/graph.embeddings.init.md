# summary

Initialize Neo4j vector indexes for semantic search.

# description

Creates vector indexes in Neo4j for semantic search capabilities. Requires Neo4j 5.11+ with vector index support.

Vector indexes enable:
- Semantic search for objects and fields by natural language
- Value grounding to match user input against org data
- Schema categorization for anti-pattern detection

The embedding dimensions are automatically determined from your configured embedding provider (OpenAI: 1536, Ollama nomic-embed-text: 768).

# examples

- Initialize vector indexes:

  <%= config.bin %> <%= command.id %>

- Show current vector index status:

  <%= config.bin %> <%= command.id %> --show

- Force recreate indexes (use after changing embedding provider):

  <%= config.bin %> <%= command.id %> --force

# flags.force.summary

Drop and recreate indexes if they already exist.

# flags.show.summary

Show current vector indexes without creating new ones.

# flags.provider.summary

Override the configured embedding provider.

# flags.model.summary

Override the embedding model.

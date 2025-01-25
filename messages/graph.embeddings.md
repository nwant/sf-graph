# summary

Manage vector embeddings for semantic search.

# description

Commands for generating and managing vector embeddings in Neo4j.
Embeddings enable semantic search across Salesforce objects and fields.

## Prerequisites

- Neo4j 5.11+ with vector index support
- Configured embedding provider (Ollama or OpenAI)

## Typical Workflow

1. `sf graph embeddings init` - Create vector indexes
2. `sf graph embeddings generate` - Generate embeddings
3. `sf graph embeddings status` - Check progress

## Configuration

Configure your embedding provider:

```bash
sf graph config set embeddingProvider=ollama
sf graph config set embeddingModel=nomic-embed-text
```

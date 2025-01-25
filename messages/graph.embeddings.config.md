# summary

Configure embedding provider and semantic search settings.

# description

Interactive wizard to configure embedding generation and semantic search features.

This command allows you to:
- Select an embedding provider (Ollama or OpenAI)
- Choose an embedding model
- Enable/disable semantic search features

Settings are saved to your user configuration at ~/.sf-graph/config.json.

# examples

- <%= config.bin %> <%= command.id %>

Configure embeddings using the interactive wizard.

# flags.provider.summary

Override embedding provider for this session.

# flags.model.summary

Override embedding model for this session.

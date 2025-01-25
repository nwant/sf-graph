# summary
Set a configuration setting value

# description
Sets the value of a specific configuration setting.

If you set an Ollama model (e.g., `model=ollama:qwen2.5:0.5b`), the CLI will automatically attempt to pull it if it's not present locally.

# examples
  Set the Neo4j URI:
  $ sf graph config set neo4jUri bolt://localhost:7687

  Set the AI model:
  $ sf graph config set model gpt-4

  Set model with explicit provider (updates both settings):
  $ sf graph config set model openai:gpt-4o

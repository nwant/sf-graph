# summary
Generate SOQL queries from natural language using AI.

# description
Convert natural language descriptions into valid SOQL queries. Uses the metadata graph to understand your schema and generates optimized queries with proper relationship handling.

Supports parent lookups (dot notation) and child subqueries automatically based on natural language patterns.

# examples
- Basic query: sf graph ai soql "get all accounts"
- With relationships: sf graph ai soql "contacts with their account name"
- Child subquery: sf graph ai soql "accounts with their opportunities"
- Quiet mode (for piping): sf graph ai soql "active cases" --quiet
- Use specific model: sf graph ai soql "get contacts" --model openai:gpt-4o

# args.query.description
Natural language description of the data you want to query.

# flags.quiet.summary
Output only the SOQL query (for scripting/piping).

# flags.target-org.summary
Target org alias or username for schema context.

# flags.model.summary
Model to use. Format: provider:model (e.g., openai:gpt-4o, ollama:llama3.2).

# flags.decomposer-model.summary
Override the model used for decomposition (default: gpt-4o-mini).

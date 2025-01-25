# summary
Interactive AI chat for Salesforce schema exploration.

# description
Start an interactive chat session with an AI agent to explore your Salesforce schema. The agent can list objects, describe fields, find relationships, generate SOQL queries, and more.

Supports multiple LLM providers: Ollama (local), OpenAI, Claude (Anthropic), and Gemini (Google). Set API keys via environment variables: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY.

# examples
- Start interactive mode: <%= config.bin %> <%= command.id %>
- Single query: <%= config.bin %> <%= command.id %> "What custom objects do we have?"
- Use OpenAI: <%= config.bin %> <%= command.id %> --model openai:gpt-4o
- Use local Ollama: <%= config.bin %> <%= command.id %> --model ollama:llama3.1:8b
- Disable streaming: <%= config.bin %> <%= command.id %> --no-stream
- Show verbose output: <%= config.bin %> <%= command.id %> --verbose

# args.query.description
Natural language query to process. If omitted, starts interactive mode.

# flags.model.summary
Model to use. Format: provider:model (e.g., openai:gpt-4o, ollama:llama3.2).

# flags.stream.summary
Stream tokens as they are generated.

# flags.history.summary
Enable conversation history for this session.

# flags.verbose.summary
Show tool calls, parameters, and timing information.

# flags.target-org.summary
Target org alias or username for schema context.

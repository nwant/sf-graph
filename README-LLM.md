# LLM Integration for Salesforce Metadata Graph

This document provides instructions for setting up and using the LLM integration.

## Supported Providers

| Provider | Type | Model Examples |
|----------|------|----------------|
| **Ollama** | Local | `llama3.1:8b`, `qwen2.5:7b` |
| **OpenAI** | Cloud | `gpt-4o`, `gpt-4o-mini` |
| **Claude** | Cloud | `claude-sonnet-4-20250514` |
| **Gemini** | Cloud | `gemini-2.0-flash` |

## Setup

### Option 1: Ollama (Local, Private)

```bash
# Download Ollama
# https://ollama.com/download

# Pull a model
ollama pull llama3.1:8b

# Start chat (uses Ollama by default)
sf graph chat
```

### Option 2: Cloud Providers (BYOK)

Configure your API key using the CLI:

```bash
# Interactive wizard (recommended)
sf graph ai config

# Or set manually:
# OpenAI
sf graph config set openaiApiKey sk-...
sf graph config set provider openai
sf graph chat

# Claude (Anthropic)
sf graph config set anthropicApiKey sk-ant-...
sf graph config set provider claude
sf graph chat

# Gemini (Google)
sf graph config set googleApiKey AIza...
sf graph config set provider gemini
sf graph chat
```

## Configuration

### Interactive Wizard

```bash
sf graph ai config  # Guided setup for provider and API keys
```

### CLI Commands

```bash
# View configuration
sf graph config list

# Set provider and model
sf graph config set provider openai
sf graph config set model gpt-4o

# Set API keys
sf graph config set openaiApiKey sk-...
sf graph config set anthropicApiKey sk-ant-...
sf graph config set googleApiKey AIza...

# Smart model setting (sets both provider and model)
sf graph config set model openai:gpt-4o
```

### CLI Flags

Override config for a single command:

```bash
sf graph chat --provider openai --model gpt-4o
```

### Config File

Persistent config stored at `~/.sf-graph/agent-config.json`:

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "openaiApiKey": "sk-..."
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `check-llm-status` | Check LLM availability |
| `natural-language-to-soql` | Convert NL to SOQL |
| `process-with-llm` | Send prompt to LLM |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Ollama not available | Run `ollama serve` |
| API key missing | Run `sf graph ai config` |
| Model not found | Check model name for provider |

## Additional Documentation

- [docs/llm-integration.md](docs/llm-integration.md) - Architecture details
- [README-AGENT.md](README-AGENT.md) - Agent usage guide

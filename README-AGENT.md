# sf-graph AI Agent

The sf-graph agent provides an **agentic AI experience** for Salesforce schema exploration. Supports local (Ollama) and cloud (OpenAI, Claude, Gemini) LLM providers.

## 🚀 Quick Start

### Prerequisites

- sf-graph synced with your Salesforce org
- Neo4j running with your schema data
- LLM provider configured (see below)

### Using Ollama (Local)

```bash
ollama pull llama3.1:8b
sf graph chat
```

### Using Cloud Providers

```bash
# Use interactive wizard (recommended)
sf graph ai config

# Or set manually
sf graph config set openaiApiKey sk-...
sf graph config set provider openai
sf graph chat

# Claude
sf graph config set anthropicApiKey sk-ant-...
sf graph config set provider claude

# Gemini
sf graph config set googleApiKey AIza...
sf graph config set provider gemini
```

## 💬 Chat Command

```bash
sf graph chat [QUERY] [FLAGS]
```

### Flags

| Flag | Description |
|------|-------------|
| `-p, --provider` | LLM provider: `ollama`, `openai`, `claude`, `gemini` |
| `-m, --model` | Model to use |
| `--[no-]stream` | Stream tokens (default: true) |
| `-v, --verbose` | Show tool calls |

### Examples

```bash
# Interactive mode
sf graph chat

# Single query with OpenAI
sf graph chat "What custom objects do we have?" --provider openai

# Verbose mode
sf graph chat --verbose
```

### Interactive Commands

| Command | Description |
|---------|-------------|
| `exit` | Exit chat |
| `clear` | Clear history |

## ⚙️ Configuration

```bash
# View settings
sf graph config list

# Use interactive wizard
sf graph ai config

# Or set manually
sf graph config set provider openai
sf graph config set model gpt-4o
```

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `provider` | `ollama` | Default LLM provider |
| `model` | `llama3.1:8b` | Default model |
| `confirmTools` | `false` | Confirm before executing tools |

Config stored at `~/.sf-graph/agent-config.json`.

## 🤖 Recommended Models

| Provider | Model | Notes |
|----------|-------|-------|
| Ollama | `llama3.1:8b` | Best local option |
| Ollama | `qwen2.5:7b` | Good structured output |
| OpenAI | `gpt-4o` | Excellent tool calling |
| Claude | `claude-sonnet-4-20250514` | Great reasoning |
| Gemini | `gemini-2.0-flash` | Fast and capable |

## 🔧 How It Works

```
User → Agent → LLM Provider → MCP Tools → Neo4j/Salesforce
```

1. You ask a question
2. LLM reasons about which tools to use
3. MCP tools query your graph and Salesforce
4. LLM summarizes the results

### Available Tools

| Tool | Description |
|------|-------------|
| `list-objects` | List Salesforce objects |
| `get-object` | Get object with fields |
| `find-related-objects` | Find related objects |
| `generate-soql` | Build SOQL queries |
| `execute-soql` | Run queries |
| `natural-language-to-soql` | Convert NL to SOQL |

## 🔒 Privacy

- **Ollama**: Everything runs locally
- **Cloud**: Only prompts sent to provider (no schema data unless requested)
- Salesforce credentials handled via SF CLI

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot connect to Ollama | Run `ollama serve` |
| API key missing | Run `sf graph ai config` or `sf graph config set <provider>ApiKey <key>` |
| Slow responses | Use smaller model or cloud provider |
| Tool calls failing | Check `sf graph chat --verbose` |

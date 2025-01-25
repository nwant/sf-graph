# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability, please email the maintainer directly. You should receive a response within 48 hours.

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

## Security Considerations

This project:

- **Does NOT store Salesforce credentials** — Authentication is handled by Salesforce CLI
- **Does NOT transmit record data** — Only schema metadata is synchronized
- **Stores configuration locally** in `~/.sf-graph/agent-config.json`
- API keys (OpenAI, etc.) are stored locally and masked in CLI output

When using LLM providers:

- Schema metadata may be sent to external LLM APIs for SOQL generation
- Consider using local Ollama if data sensitivity is a concern

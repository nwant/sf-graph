# summary

Reset all configuration to factory defaults.

# description

Resets all configuration values in `~/.sf-graph/agent-config.json` back to their default values. This will clear all custom settings including API keys, database passwords, and org preferences.

This is useful for:
- Troubleshooting configuration issues
- Starting fresh with a clean slate
- Removing sensitive values before sharing logs

# examples

- Reset configuration to defaults (with confirmation):
  <%= config.bin %> <%= command.id %>

- Force reset without confirmation prompt:
  <%= config.bin %> <%= command.id %> --force

# flags.force.summary

Skip confirmation prompt and reset immediately.

# summary

Invoke MCP tools directly from the CLI.

# description

Execute Model Context Protocol (MCP) tools directly from the command line. These tools provide schema exploration, SOQL generation, and org management capabilities. Use --list to see available tools based on current capabilities (Neo4j, Ollama LLM, SF CLI).

# examples

- List available MCP tools:

  <%= config.bin %> <%= command.id %> --list

- Execute a tool without parameters:

  <%= config.bin %> <%= command.id %> list-objects

- Execute a tool with parameters:

  <%= config.bin %> <%= command.id %> get-object --param apiName=Account

- Execute a tool with multiple parameters:

  <%= config.bin %> <%= command.id %> compare-schemas -p sourceOrg=prod -p targetOrg=dev

# flags.param.summary

Tool parameter in key=value format.

# flags.param.description

Pass parameters to the MCP tool. Use multiple --param (or -p) flags for multiple parameters. Values are parsed as JSON if valid, otherwise treated as strings.

# flags.list.summary

List available MCP tools.

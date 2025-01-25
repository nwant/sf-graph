# summary

List all Salesforce objects in the metadata graph.

# description

Lists all Salesforce objects that have been synced to the Neo4j graph. You can filter to show only custom objects or only standard objects.

# examples

- List all objects:

  <%= config.bin %> <%= command.id %>

- List only custom objects:

  <%= config.bin %> <%= command.id %> --custom

- List only standard objects:

  <%= config.bin %> <%= command.id %> --standard

- Output as JSON:

  <%= config.bin %> <%= command.id %> --json

# flags.custom.summary

Show only custom objects (ending in \_\_c).

# flags.standard.summary

Show only standard objects.

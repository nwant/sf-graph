# summary

Find paths between two Salesforce objects in the metadata graph.

# description

Identifies all paths between a source object and a target object within the specified number of hops. Displays rich information about each hop, including relationship changes and fields used.

# examples

- Find paths between Account and Contact:

  <%= config.bin %> <%= command.id %> Account Contact

- Find paths with detailed JSON output:

  <%= config.bin %> <%= command.id %> Account Contact --json

- Find paths with up to 5 hops:

  <%= config.bin %> <%= command.id %> Account Opportunity --max-hops 5

- Find paths with minimum 2 hops:

  <%= config.bin %> <%= command.id %> Account User --min-hops 2

# flags.min-hops.summary

Minimum number of hops in the path (default: 1).

# flags.max-hops.summary

Maximum number of hops in the path (default: 10).

# flags.target-org.summary

The org to verify object existence against (optional).

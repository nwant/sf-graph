# summary

List authenticated Salesforce orgs and their sync status.

# description

Shows all orgs authenticated via SF CLI and indicates which ones have been synced to the metadata graph.

# examples

- List all authenticated orgs:

  <%= config.bin %> <%= command.id %>

- Show only synced orgs:

  <%= config.bin %> <%= command.id %> --synced

# flags.synced.summary

Show only orgs that have been synced to the graph.

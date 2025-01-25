# summary

Check if the metadata graph has been populated.

# description

Check if the metadata graph has been populated with Salesforce object metadata and get sync status. Shows the number of objects in the graph and when it was last synced.

# examples

- Check graph status:

  <%= config.bin %> <%= command.id %>

- Check graph status for a specific org:

  <%= config.bin %> <%= command.id %> --target-org my-sandbox

# flags.target-org.summary

Salesforce org alias or username to check.

# flags.target-org.description

The org alias or username to check the graph status for. If not specified, checks the default graph.

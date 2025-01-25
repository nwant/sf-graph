# summary

Detect schema drift between two orgs.

# description

Compares Salesforce schema between two synced orgs and shows differences including objects that exist only in one org and objects with different properties.

# examples

- Compare two orgs:

  <%= config.bin %> <%= command.id %> --source-org prod --target-org sandbox

- Compare specific objects:

  <%= config.bin %> <%= command.id %> --source-org prod --target-org sandbox -b Account -b Contact

# flags.source-org.summary

First org to compare (org ID or alias).

# flags.target-org.summary

Second org to compare (org ID or alias).

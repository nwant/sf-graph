# summary

Describe a Salesforce object from the metadata graph.

# description

Shows details about a specific Salesforce object including its label, type (custom/standard), field count, and relationship count. Use flags to see the full list of fields or relationships.

# examples

- Describe the Account object:

  <%= config.bin %> <%= command.id %> Account

- Describe a custom object with fields:

  <%= config.bin %> <%= command.id %> My_Custom_Object\_\_c --show-fields

- Describe with relationships:

  <%= config.bin %> <%= command.id %> Account --show-relationships

- Full details as JSON:

  <%= config.bin %> <%= command.id %> Account -f -r --json

# flags.show-fields.summary

Show all fields for this object.

# flags.show-relationships.summary

Show all relationships for this object.

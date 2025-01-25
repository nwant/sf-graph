# summary

Create Neo4j indexes and constraints.

# description

Creates database indexes and unique constraints based on sf-graph.config.json. Indexes improve query performance, and constraints ensure data integrity.

# examples

- Create all indexes and constraints:

  <%= config.bin %> <%= command.id %>

- Show current indexes without creating:

  <%= config.bin %> <%= command.id %> --show

# flags.show.summary

Show current indexes and constraints without creating new ones.

# summary

Run heuristic categorization on graph objects.

# description

Analyzes the graph structure to automatically categorize objects and fields.
Categories like 'business_core', 'system_derived', and 'lifecycle' are assigned
based on relationships and naming patterns, enabling smarter SOQL generation.

# examples

- <%= config.bin %> <%= command.id %>
- <%= config.bin %> <%= command.id %> --force

# flags.force.summary

Re-categorize all objects regardless of existing assignments.

# flags.quiet.summary

Suppress non-essential output.

# info.noCategorized

No objects were categorized. This may indicate an empty graph.

# info.complete

Categorization complete.

# error.noGraph

Graph is empty. Run "sf graph sync" first.

# error.failed

Categorization failed.

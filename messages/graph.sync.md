# summary

Sync Salesforce metadata to the Neo4j graph.

# description

Fetches Salesforce object metadata from the target org and syncs it to the Neo4j graph database. You can sync all objects or a specific object by name.

The sync process includes:
- Objects and Fields
- Record Types
- Picklist Values (including dependencies)
- Relationships (Lookup, MasterDetail, Hierarchy)
- Field Dependencies (Controlling fields)

# examples

- Sync all metadata from the default org:

  <%= config.bin %> <%= command.id %> --target-org my-org

- Sync a specific object:

  <%= config.bin %> <%= command.id %> Account --target-org my-org

- Sync with relationships:

  <%= config.bin %> <%= command.id %> Account --target-org my-org --relationships

# flags.target-org.summary

Salesforce org alias or username to sync from.

# flags.relationships.summary

Also sync object relationships.

# flags.rebuild.summary

Delete all existing data for this org and rebuild from scratch.

# flags.docs.summary

Fetch and cache standard object documentation from Salesforce Docs (recommended after SF releases, ~3x/year).

# flags.docs.description

Downloads curated standard object documentation (descriptions, usage, access rules, supported calls) and field properties (filterable, sortable, etc.) from Salesforce documentation and applies them to the graph. This is an offline process that uses a versioned data file.

# args.objectApiName.description

Optional: API name of a specific object to sync (e.g., Account, Contact).

# flags.embeddings.summary

Generate vector embeddings for objects and fields after sync.

# flags.categorize.summary

Run heuristic categorization on objects after sync.

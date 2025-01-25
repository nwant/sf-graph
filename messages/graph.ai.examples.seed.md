# summary
Seed the few-shot example store with SOQL examples

# description
Loads curated Question-SOQL pairs and generates embeddings for similarity search. This enables dynamic few-shot prompting for improved SOQL generation accuracy.

# examples
- <%= config.bin %> <%= command.id %>
- <%= config.bin %> <%= command.id %> --force

# flags.force.summary
Re-embed all examples even if already seeded

# flags.json.summary
Format output as JSON

# info.initializing
Initializing...

# info.loading
Loading examples...

# info.embedding
Generating embeddings for %s examples...

# success.existing
✅ Example store already seeded with %s examples (%s)

# success.seeded
✅ Seeded %s few-shot examples using %s

# info.force-hint
Use --force to re-embed all examples.

# info.model-change
Embedding model changed (%s → %s). Re-embedding...

# info.list-hint
Run "sf graph ai examples list" to view examples.

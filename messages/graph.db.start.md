# summary
Start the Neo4j database container.

# description
Starts the Neo4j database using Docker Compose with the configured data path for persistence. The data path is read from your configuration (set via `sf graph db config`) or defaults to `~/.sf-graph/neo4j`.

This command:
- Creates the data and logs directories if they don't exist
- Passes the configured credentials to Docker
- Starts Neo4j in detached mode by default

# examples
- Start Neo4j in the background:
  $ sf graph db start

- Start Neo4j in the foreground (attached):
  $ sf graph db start --no-detach

# flags.detach.summary
Run container in background (default: true).

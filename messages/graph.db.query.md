# summary
Execute a Cypher query against the graph database.

# description
Executes a read-only Cypher query against the Neo4j database and displays the results.
You can use the `$orgId` parameter in your query if you provide a target org.

# flags.query.summary
The Cypher query to execute.

# flags.target-org.summary
The target Salesforce org to filter by (injects $orgId parameter).

# examples
- Execute a simple query:
  <%= config.bin %> <%= command.id %> "MATCH (n:Object) RETURN n.apiName LIMIT 5"

- Execute a query using the target org ID parameter:
  <%= config.bin %> <%= command.id %> "MATCH (n:Object) WHERE n.orgId = \$orgId RETURN n.apiName" --target-org my-org

- Execute a query using the query flag:
  <%= config.bin %> <%= command.id %> --query "MATCH (n) RETURN count(n)"

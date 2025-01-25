import neo4j from 'neo4j-driver';
import { loadConfig } from '../../src/agent/config.js';

async function testConnection() {
  const config = loadConfig();
  const uri = config.neo4jUri || 'neo4j://localhost:7687';
  const username = config.neo4jUser || 'neo4j';
  const password = config.neo4jPassword || 'password';

  console.error('Testing Neo4j connection...');
  console.error(`URI: ${uri}`);
  console.error(`Username: ${username}`);
  console.error(`Password: ${password.substring(0, 3)}...`);

  try {
    const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));

    console.error('Verifying connectivity...');
    await driver.verifyConnectivity();
    console.error('Successfully connected to Neo4j!');

    // Run a simple query
    const session = driver.session();
    try {
      const result = await session.run('MATCH (n) RETURN count(n) as count');
      const count = result.records[0].get('count').toNumber();
      console.error(`Database contains ${count} nodes`);
    } finally {
      await session.close();
    }

    await driver.close();
  } catch (error) {
    console.error('Neo4j connection failed:', error);
  }
}

testConnection();

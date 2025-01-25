/**
 * Jest Global Setup
 * Runs once before all test suites.
 *
 * Note: This runs in a separate process from tests, so we use globalTeardown
 * for cleanup and set a flag file to communicate state.
 */
import neo4j from 'neo4j-driver';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../dist/agent/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '.neo4j-test-state.json');

export default async function globalSetup() {
  console.log('\n🔧 Jest Global Setup: Verifying Neo4j connection...');

  let neo4jAvailable = false;

  try {
    const config = loadConfig();
    
    if (config.neo4jUri) {
      const driver = neo4j.driver(
        config.neo4jUri,
        neo4j.auth.basic(config.neo4jUser, config.neo4jPassword)
      );

      try {
        await driver.verifyConnectivity();
        neo4jAvailable = true;
        console.log('✅ Neo4j connection verified');
      } catch (error) {
        console.warn('⚠️  Neo4j not available:', error.message);
      } finally {
        await driver.close();
      }
    } else {
      console.warn('⚠️  Neo4j URI not configured. Run: sf graph db config');
    }
  } catch (error) {
    console.warn('⚠️  Could not load config:', error.message);
  }

  // Write state file for tests to read
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({
      neo4jAvailable,
      timestamp: new Date().toISOString(),
    })
  );

  console.log('📝 Test state written to', STATE_FILE);
}

import neo4j, { Driver } from 'neo4j-driver';
import { loadConfig } from '../../agent/config.js';

let driver: Driver | null = null;

export async function initNeo4jDriver(): Promise<boolean> {
  try {
    if (driver) {
      return true;
    }

    const config = loadConfig();
    const uri = config.neo4jUri;
    const user = config.neo4jUser;
    const password = config.neo4jPassword;

    if (!uri) {
      return false;
    }

    driver = neo4j.driver(
      uri,
      neo4j.auth.basic(
        user,
        password
      )
    );

    await driver.verifyConnectivity();
    return true;
  } catch (error) {
    // Connection failed silently - caller can check return value
    return false;
  }
}

export function getDriver(): Driver {
  if (!driver) {
    throw new Error('Neo4j driver not initialized');
  }
  return driver;
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

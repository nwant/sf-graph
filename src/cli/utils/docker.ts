/**
 * Shared utilities for db commands
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find the docker-compose.yml file.
 * Checks current directory first, then the sf-graph project directory.
 */
export function findComposeFile(): string | null {
  const candidates = [
    path.join(process.cwd(), 'docker-compose.yml'),
    path.join(process.cwd(), 'docker-compose.yaml'),
    // Check sf-graph project directory (relative to dist/cli/utils/)
    path.join(__dirname, '..', '..', '..', 'docker-compose.yml'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Get the default Neo4j data path
 */
export function getDefaultDataPath(): string {
  return path.join(os.homedir(), '.sf-graph', 'neo4j');
}

/**
 * Ensure Neo4j data directories exist
 */
export function ensureDataDirectories(dataPath: string): { created: string[] } {
  const created: string[] = [];
  const dataDirData = path.join(dataPath, 'data');
  const dataDirLogs = path.join(dataPath, 'logs');

  if (!fs.existsSync(dataDirData)) {
    fs.mkdirSync(dataDirData, { recursive: true });
    created.push(dataDirData);
  }
  if (!fs.existsSync(dataDirLogs)) {
    fs.mkdirSync(dataDirLogs, { recursive: true });
    created.push(dataDirLogs);
  }

  return { created };
}

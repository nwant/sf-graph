/**
 * Shared test utilities and helpers.
 * Tests should import helpers from here rather than managing connections themselves.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initNeo4jDriver, getDriver, closeDriver } from '../dist/services/neo4j/driver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '.neo4j-test-state.json');

// Per-test-file driver management
// Each test file gets its own driver instance to avoid cross-file interference
let localDriver = null;
let localDriverInitialized = false;

/**
 * Check if Neo4j is expected to be available based on global setup.
 */
export function isNeo4jConfigured() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      return state.neo4jAvailable === true;
    }
  } catch {
    // Fall back to checking env
  }
  return !!process.env.NEO4J_URI;
}

/**
 * Initialize Neo4j driver for this test file.
 * Call this in beforeAll() of test files that need database access.
 *
 * @returns {Promise<boolean>} - true if initialization succeeded
 */
export async function initTestDriver() {
  if (localDriverInitialized) {
    return true;
  }

  try {
    const result = await initNeo4jDriver();
    localDriverInitialized = result;
    if (result) {
      localDriver = getDriver();
    }
    return result;
  } catch (error) {
    console.warn('Test driver initialization failed:', error.message);
    return false;
  }
}

/**
 * Get the driver for this test file.
 * @returns {object|null} - The Neo4j driver or null if not available
 */
export function getTestDriver() {
  return localDriver;
}

/**
 * Close the driver for this test file.
 * Call this in afterAll() of test files that called initTestDriver().
 */
export async function closeTestDriver() {
  if (localDriver) {
    try {
      await closeDriver();
    } catch (_error) {
      // Ignore close errors - driver may already be closed
    }
    localDriver = null;
    localDriverInitialized = false;
  }
}

/**
 * Helper to skip a test if Neo4j is not available.
 * Usage: test('my test', skipIfNoNeo4j(async () => { ... }));
 */
export function skipIfNoNeo4j(testFn) {
  return async () => {
    if (!localDriverInitialized) {
      console.log('⏭️  Skipping test - Neo4j not available');
      return;
    }
    return testFn();
  };
}

// === E2E Test Helpers ===

/**
 * Initializes Neo4j driver and wipes the database for a clean E2E test state.
 * @returns {Promise<object>} - The Neo4j driver
 */
export async function setupE2ETest() {
  try {
    await initNeo4jDriver();
    const driver = getDriver();

    // Clean up DB before run
    const session = driver.session();
    await session.run('MATCH (n) DETACH DELETE n');
    await session.close();
    console.log('Cleaned up Neo4j database.');

    return driver;
  } catch (error) {
    console.error('Failed to initialize connections for E2E test:', error);
    throw error;
  }
}

/**
 * Closes the Neo4j driver after E2E tests.
 */
export async function teardownE2ETest() {
  await closeDriver();
}

// === Mock Factory Helpers for Unit Tests ===

/**
 * Creates a mock Neo4j driver with configurable run behavior.
 * Use in unit tests to mock the driver module.
 *
 * @param {Function} [mockRunFn] - Custom implementation for session.run()
 * @returns {object} - Object containing mockRun, mockSession, mockDriver, mockGetDriver
 *
 * @example
 * const { mockRun, mockGetDriver } = createMockDriver();
 * jest.unstable_mockModule('driver.js', () => ({ getDriver: mockGetDriver }));
 * mockRun.mockResolvedValue({ records: [] });
 */
export function createMockDriver(mockRunFn) {
  const mockRun = mockRunFn || jest.fn();
  const mockClose = jest.fn().mockResolvedValue(undefined);
  const mockSession = jest.fn().mockReturnValue({
    executeRead: jest.fn(callback => callback({ run: mockRun })),
    executeWrite: jest.fn(async callback => {
      const mockTx = { run: mockRun };
      return await callback(mockTx);
    }),
    close: mockClose
  });
  const mockDriver = { session: mockSession };
  const mockGetDriver = jest.fn().mockReturnValue(mockDriver);
  
  return {
    mockRun,
    mockClose,
    mockSession,
    mockDriver,
    mockGetDriver
  };
}


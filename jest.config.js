export default {
  transform: {},
  testEnvironment: 'node',
  forceExit: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  testMatch: ['**/tests/integration/**/*.test.js', '**/tests/unit/**/*.test.js'],
  // Run tests sequentially to avoid connection pool conflicts
  maxWorkers: 1,
  // Global setup/teardown for shared resources
  globalSetup: './tests/globalSetup.js',
  globalTeardown: './tests/globalTeardown.js',
  // Increase timeout for integration tests
  testTimeout: 30000,
  verbose: true,
};

// Minor helper for test development. Allows for specific file testing.
const mainTestMatch = process.env.SPECIFIC_INTEGRATION_TEST_FILE
  ? `<rootDir>/__tests__/integration/**/${process.env.SPECIFIC_INTEGRATION_TEST_FILE}.test.js`
  : '<rootDir>/__tests__/integration/**/*.test.js';

module.exports = {
  testRunner: "jest-jasmine2",
  clearMocks: true,
  coverageDirectory: 'coverage-integration',
  testEnvironment: 'node',
  collectCoverage: true,
  collectCoverageFrom: ['<rootDir>/src/**/*.js', '<rootDir>/src/**/*.ts'],
  testMatch: [mainTestMatch],
  coverageReporters: ['text-summary', 'lcov', 'clover'],
  testTimeout: 20 * 60 * 1000, // May be adjusted with optimizations
  setupFilesAfterEnv: ['<rootDir>/setupTests-integration.js'],
  maxConcurrency: 1,
  coverageThreshold: {
    global: {
      statements: 42,
      branches: 30,
      functions: 40,
      lines: 42
    },
    // We need a high coverage for the HathorWallet class
    './src/new/wallet.js': {
      statements: 92,
      branches: 85,
      functions: 90,
      lines: 92
    }
  },
};

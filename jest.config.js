module.exports = {
  setupFilesAfterEnv: ["<rootDir>/setupTests.js"],
  coverageDirectory: 'coverage',
  collectCoverage: true,
  collectCoverageFrom: ["<rootDir>/src/**/*.js","<rootDir>/src/**/*.ts","!<rootDir>/node_modules/"],
  coverageReporters: ['text-summary', 'lcov', 'clover'],
  modulePathIgnorePatterns: ["__fixtures__/*","integration/*","__mocks__/*","__mock_helpers__/"],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 50,
      lines: 48,
      statements: 49
    }
  },
};

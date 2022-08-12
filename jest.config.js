module.exports = {
  setupFilesAfterEnv: ["<rootDir>/setupTests.js"],
  coverageDirectory: 'coverage',
  collectCoverage: true,
  collectCoverageFrom: ["<rootDir>/src/**/*.js","<rootDir>/src/**/*.ts","!<rootDir>/node_modules/"],
  coverageReporters: ['text-summary', 'lcov', 'clover'],
  modulePathIgnorePatterns: ["__fixtures__/*","integration/*"],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 85,
      lines: 85,
      statements: 85
    }
  },
};

module.exports = {
  setupFilesAfterEnv: ["<rootDir>/setupTests.js"],
  coverageDirectory: 'coverage',
  collectCoverage: true,
  collectCoverageFrom: ["<rootDir>/src/**/*.js","<rootDir>/src/**/*.ts","!<rootDir>/node_modules/"],
  coverageReporters: ['text-summary', 'lcov', 'clover'],
  modulePathIgnorePatterns: ["__fixtures__/*","integration/*"],
  coverageThreshold: {
    global: {
      branches: 43,
      functions: 58,
      lines: 55,
      statements: 55
    }
  },
};

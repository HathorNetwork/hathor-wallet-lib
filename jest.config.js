module.exports = {
  setupFilesAfterEnv: ["<rootDir>/setupTests.js"],
  coverageDirectory: 'coverage',
  collectCoverage: true,
  collectCoverageFrom: ["<rootDir>/src/**/*.js","<rootDir>/src/**/*.ts","!<rootDir>/node_modules/"],
  coverageReporters: ['text-summary', 'lcov', 'clover'],
  modulePathIgnorePatterns: ["__fixtures__/*","integration/*","__mocks__/*"],
  coverageThreshold: {
    global: {
      branches: 45,
      functions: 58,
      lines: 55,
      statements: 55
    }
  },
};

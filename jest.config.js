module.exports = {
  setupFilesAfterEnv: ["<rootDir>/setupTests.js"],
  collectCoverageFrom: ["<rootDir>/src/**/*.js","<rootDir>/src/**/*.ts","!<rootDir>/node_modules/"],
  modulePathIgnorePatterns: ["__fixtures__/*","integration/*"],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 85,
      lines: 85,
      statements: 85
    }
  },
  coverageReporters: ["html","text"]
};

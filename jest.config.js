const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  clearMocks: true,
  coverageProvider: 'v8',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^server-only$': '<rootDir>/test/mocks/server-only.js',
  },
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
};

module.exports = createJestConfig(config);

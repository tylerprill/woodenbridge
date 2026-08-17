const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  clearMocks: true,
  maxWorkers: 1,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@vercel/postgres$': '<rootDir>/test/integration/postgres-adapter.ts',
    '^server-only$': '<rootDir>/test/mocks/server-only.js',
  },
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.integration.ts'],
  testTimeout: 60_000,
};

module.exports = createJestConfig(config);

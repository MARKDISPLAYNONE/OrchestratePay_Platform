/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/db/migrate.ts',    // one-shot script, not unit-testable
    '!src/index.ts',         // server bootstrap, tested via integration
  ],
  coverageThreshold: {
    global: { branches: 60, functions: 70, lines: 70 },
  },
  // Silence Winston output during tests
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
}

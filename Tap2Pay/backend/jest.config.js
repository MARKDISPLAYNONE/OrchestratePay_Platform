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
  // uuid v14 is pure ESM — map it to a CJS-compatible shim so ts-jest can load routes that use it
  moduleNameMapper: {
    '^uuid$': '<rootDir>/src/__tests__/__mocks__/uuid.js',
  },
  // ws-server-full opens a real HTTP/WS server; forceExit ensures Jest doesn't hang
  // on the lingering ping setInterval after all tests pass.
  forceExit: true,
}

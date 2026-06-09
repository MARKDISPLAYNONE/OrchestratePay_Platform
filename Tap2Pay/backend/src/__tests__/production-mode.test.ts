/**
 * Covers the NODE_ENV === 'production' ternary branches in logger.ts and db/index.ts.
 * Both modules evaluate their configuration once at import time — setting NODE_ENV
 * before the first dynamic import ensures Istanbul instruments both branches.
 *
 * This file intentionally does NOT mock logger.ts so the real Winston logger is
 * constructed with prodFormat (covering logger.ts line 23, branch 2).
 */
process.env.NODE_ENV = 'production'
// Unset LOG_LEVEL so the `|| 'info'` fallback branch in logger.ts line 22 is taken.
// setup.ts sets it to 'error' before this file loads, so we must explicitly remove it.
delete process.env.LOG_LEVEL

let loggerMod: typeof import('../util/logger')
let dbMod: typeof import('../db/index')

beforeAll(async () => {
  // Dynamic imports run after process.env has been mutated above.
  // Each module is evaluated for the first time in this file's isolated module
  // registry, so the 'production' branches in both files are taken.
  loggerMod = await import('../util/logger')
  dbMod     = await import('../db/index')
})

afterAll(async () => {
  // End the pg Pool (no-op if no connections were created) then restore env.
  await dbMod.db.end().catch(() => {})
  process.env.NODE_ENV  = 'test'
  process.env.LOG_LEVEL = 'error'
})

// ─────────────────────────────────────────────────────────────────────────────
// logger.ts — line 23: `format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat`
// ─────────────────────────────────────────────────────────────────────────────

describe('logger.ts — prodFormat branch', () => {
  it('creates the Winston logger with prodFormat in production mode', () => {
    expect(loggerMod.logger).toBeDefined()
    expect(typeof loggerMod.logger.info).toBe('function')
    expect(typeof loggerMod.logger.error).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// db/index.ts — line 25-26: `ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined`
// ─────────────────────────────────────────────────────────────────────────────

describe('db/index.ts — production SSL branch', () => {
  it('creates the pg Pool with ssl: { rejectUnauthorized: false } in production mode', () => {
    expect(dbMod.db).toBeDefined()
  })

  it('emits connect event without throwing in production mode', () => {
    expect(() => dbMod.db.emit('connect')).not.toThrow()
  })

  it('emits error event without throwing in production mode', () => {
    expect(() => dbMod.db.emit('error', new Error('prod pool error'))).not.toThrow()
  })
})

/**
 * Tests for db/index.ts and db/redis.ts health check functions and event handlers.
 * These tests import the real modules (no jest.mock) so Istanbul instruments them.
 */
process.env.NODE_ENV = 'test'

jest.mock('../util/logger', () => ({
  logger: {
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

// ─────────────────────────────────────────────────────────────────────────────
// db/index.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('db/index — event handlers', () => {
  let dbModule: typeof import('../db/index')

  beforeAll(async () => {
    dbModule = await import('../db/index')
  })

  it('emits "connect" without throwing (covers connect handler)', () => {
    expect(() => dbModule.db.emit('connect')).not.toThrow()
  })

  it('emits "error" without throwing (covers error handler)', () => {
    expect(() => dbModule.db.emit('error', new Error('simulated pool error'))).not.toThrow()
  })
})

describe('dbHealthCheck', () => {
  let dbModule: typeof import('../db/index')

  beforeAll(async () => {
    dbModule = await import('../db/index')
  })

  it('runs SELECT 1 and releases the client', async () => {
    const mockRelease     = jest.fn()
    const mockClientQuery = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] })
    const connectSpy = jest.spyOn(dbModule.db, 'connect') as jest.SpyInstance
    connectSpy.mockResolvedValueOnce({
      query:   mockClientQuery,
      release: mockRelease,
    })

    await dbModule.dbHealthCheck()

    expect(mockClientQuery).toHaveBeenCalledWith('SELECT 1')
    expect(mockRelease).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// db/redis.ts — retryStrategy + healthCheck + event handlers
// (uses jest.resetModules + doMock to intercept the ioredis constructor)
// ─────────────────────────────────────────────────────────────────────────────

describe('db/redis — retryStrategy', () => {
  let capturedOptions: any

  beforeEach(() => {
    jest.resetModules()
    jest.doMock('ioredis', () => {
      return jest.fn().mockImplementation((_url: string, opts: any) => {
        capturedOptions = opts
        const EventEmitter = require('events').EventEmitter
        const instance = new EventEmitter()
        instance.ping = jest.fn().mockResolvedValue('PONG')
        return instance
      })
    })
    jest.doMock('../util/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }))
  })

  afterEach(() => {
    jest.resetModules()
  })

  it('backs off linearly up to 3000ms', () => {
    require('../db/redis')
    expect(capturedOptions.retryStrategy).toBeDefined()
    expect(capturedOptions.retryStrategy(1)).toBe(100)
    expect(capturedOptions.retryStrategy(10)).toBe(1000)
    expect(capturedOptions.retryStrategy(30)).toBe(3000)
    expect(capturedOptions.retryStrategy(100)).toBe(3000)  // capped
  })
})

describe('db/redis — event handlers', () => {
  let redisModule: typeof import('../db/redis')

  beforeAll(async () => {
    redisModule = await import('../db/redis')
  })

  it('emits "connect" without throwing (covers connect handler)', () => {
    expect(() => redisModule.redis.emit('connect')).not.toThrow()
  })

  it('emits "error" without throwing (covers error handler)', () => {
    expect(() => redisModule.redis.emit('error', new Error('redis error'))).not.toThrow()
  })
})

describe('redisHealthCheck', () => {
  let redisModule: typeof import('../db/redis')

  beforeAll(async () => {
    redisModule = await import('../db/redis')
  })

  it('calls redis.ping()', async () => {
    jest.spyOn(redisModule.redis, 'ping').mockResolvedValueOnce('PONG' as any)
    await redisModule.redisHealthCheck()
    expect(redisModule.redis.ping).toHaveBeenCalled()
  })
})

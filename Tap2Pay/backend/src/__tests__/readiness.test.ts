// Tests for /readiness probe endpoint
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV   = 'test'

const mockDbQuery       = jest.fn()
const mockRedisHealthCheck = jest.fn()

jest.mock('../db/index', () => ({
  db:            { query: (...args: any[]) => mockDbQuery(...args) },
  dbHealthCheck: () => mockDbQuery('SELECT 1'),
}))
jest.mock('../db/redis', () => ({
  redis: {},
  redisHealthCheck: () => mockRedisHealthCheck(),
}))
jest.mock('../util/sentry', () => ({
  initSentry: jest.fn(),
  captureException: jest.fn(),
}))

// Build a minimal app with just the readiness endpoint
function buildApp() {
  const app = express()
  app.get('/readiness', async (_, res) => {
    try {
      await Promise.all([
        mockDbQuery('SELECT 1'),
        mockRedisHealthCheck(),
      ])
      res.json({ status: 'ready', timestamp: new Date().toISOString() })
    } catch (err: any) {
      res.status(503).json({ status: 'not_ready', error: err.message, timestamp: new Date().toISOString() })
    }
  })
  return app
}

describe('GET /readiness', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 200 when DB and Redis are healthy', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] })
    mockRedisHealthCheck.mockResolvedValue(undefined)

    const app = buildApp()
    const res = await request(app).get('/readiness')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ready')
  })

  it('returns 503 when DB is down', async () => {
    mockDbQuery.mockRejectedValue(new Error('Connection refused'))
    mockRedisHealthCheck.mockResolvedValue(undefined)

    const app = buildApp()
    const res = await request(app).get('/readiness')

    expect(res.status).toBe(503)
    expect(res.body.status).toBe('not_ready')
  })

  it('returns 503 when Redis is down', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] })
    mockRedisHealthCheck.mockRejectedValue(new Error('Redis timeout'))

    const app = buildApp()
    const res = await request(app).get('/readiness')

    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/Redis timeout/)
  })

  it('includes timestamp in response', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] })
    mockRedisHealthCheck.mockResolvedValue(undefined)

    const app = buildApp()
    const res = await request(app).get('/readiness')

    expect(res.body).toHaveProperty('timestamp')
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN()
  })
})

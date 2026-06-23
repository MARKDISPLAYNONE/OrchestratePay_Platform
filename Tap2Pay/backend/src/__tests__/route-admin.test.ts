/**
 * Integration tests for routes/admin.ts
 */
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET   = 'test-secret'
process.env.ADMIN_SECRET = 'test-admin'
process.env.NODE_ENV     = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockRedisPing = jest.fn()
jest.mock('../db/redis', () => ({
  redis: {
    ping: (...args: any[]) => mockRedisPing(...args),
    get:  jest.fn().mockResolvedValue(null),
  },
}))

jest.mock('../integrations/daraja', () => ({
  getDarajaCircuitStatus: jest.fn().mockReturnValue('CLOSED'),
  stkPush:                jest.fn(),
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('nfc-key'),
}))

jest.mock('../util/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/admin', require('../routes/admin').default)
  return app
}

const ADMIN_HDR = { 'X-Admin-Secret': 'test-admin' }

beforeEach(() => {
  jest.clearAllMocks()
  mockRedisPing.mockResolvedValue('PONG')
})

// ── GET /api/v1/admin/stats ───────────────────────────────────────────────────

describe('GET /api/v1/admin/stats', () => {
  it('returns 403 without admin secret', async () => {
    const res = await request(buildApp()).get('/api/v1/admin/stats')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/admin/i)
  })

  it('returns 403 with wrong admin secret', async () => {
    const res = await request(buildApp())
      .get('/api/v1/admin/stats')
      .set('X-Admin-Secret', 'wrong')
    expect(res.status).toBe(403)
  })

  it('returns stats with all time, 24h, 7d, timing, and hourly data', async () => {
    const countRow = { total: '100', confirmed: '80', declined: '10', expired: '5', failed: '3', pending: '2' }
    const timingRow = { avg_confirm_ms: '3000', median_confirm_ms: '2500', p95_confirm_ms: '8000' }

    mockQuery
      .mockResolvedValueOnce({ rows: [countRow] })     // all-time
      .mockResolvedValueOnce({ rows: [countRow] })     // last 24h
      .mockResolvedValueOnce({ rows: [countRow] })     // last 7d
      .mockResolvedValueOnce({ rows: [timingRow] })    // timing
      .mockResolvedValueOnce({ rows: [            // hourly
        { hour: new Date(), total: '10', confirmed: '8' },
      ] })
      .mockResolvedValueOnce({ rows: [{ count: '42' }] })  // merchantCount
      .mockResolvedValueOnce({ rows: [{ count: '15' }] })  // consumerCount

    const res = await request(buildApp())
      .get('/api/v1/admin/stats')
      .set(ADMIN_HDR)

    expect(res.status).toBe(200)
    expect(res.body.allTime.total).toBe(100)
    expect(res.body.last24h.confirmed).toBe(80)
    expect(res.body.last24h.successRate).toBe(80)
    expect(res.body.timing.avgConfirmMs).toBe(3000)
    expect(res.body.hourly).toHaveLength(1)
    expect(res.body.infrastructure.redis).toBe('ok')
    expect(res.body.infrastructure.darajaCircuit).toBe('CLOSED')
  })

  it('reports redis as down when ping fails', async () => {
    mockRedisPing.mockRejectedValue(new Error('Redis down'))

    const countRow  = { total: '0', confirmed: '0', declined: '0', expired: '0', failed: '0', pending: '0' }
    const timingRow = { avg_confirm_ms: null, median_confirm_ms: null, p95_confirm_ms: null }

    mockQuery
      .mockResolvedValueOnce({ rows: [countRow] })
      .mockResolvedValueOnce({ rows: [countRow] })
      .mockResolvedValueOnce({ rows: [countRow] })
      .mockResolvedValueOnce({ rows: [timingRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })

    const res = await request(buildApp())
      .get('/api/v1/admin/stats')
      .set(ADMIN_HDR)

    expect(res.status).toBe(200)
    expect(res.body.infrastructure.redis).toBe('down')
  })

  it('returns 500 when DB query fails', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'))

    const res = await request(buildApp())
      .get('/api/v1/admin/stats')
      .set(ADMIN_HDR)

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/stats query failed/i)
  })

  it('returns null successRate when no transactions in last 24h', async () => {
    const emptyRow  = { total: '0', confirmed: '0', declined: '0', expired: '0', failed: '0', pending: '0' }
    const timingRow = { avg_confirm_ms: null, median_confirm_ms: null, p95_confirm_ms: null }

    mockQuery
      .mockResolvedValueOnce({ rows: [emptyRow] })
      .mockResolvedValueOnce({ rows: [emptyRow] })
      .mockResolvedValueOnce({ rows: [emptyRow] })
      .mockResolvedValueOnce({ rows: [timingRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })

    const res = await request(buildApp())
      .get('/api/v1/admin/stats')
      .set(ADMIN_HDR)

    expect(res.status).toBe(200)
    expect(res.body.last24h.successRate).toBeNull()
    expect(res.body.last24h.timeoutRate).toBeNull()
    expect(res.body.timing.avgConfirmMs).toBeNull()
  })
})

// ── GET /api/v1/admin/pending ─────────────────────────────────────────────────

describe('GET /api/v1/admin/pending', () => {
  it('returns 403 without admin secret', async () => {
    const res = await request(buildApp()).get('/api/v1/admin/pending')
    expect(res.status).toBe(403)
  })

  it('returns pending transactions list', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        { id: 'txn-1', amount_cents: 5000, created_at: new Date(), age_seconds: 45, merchant_name: 'Shop A', stk_sent: true },
        { id: 'txn-2', amount_cents: 3000, created_at: new Date(), age_seconds: 120, merchant_name: 'Shop B', stk_sent: false },
      ],
    })

    const res = await request(buildApp())
      .get('/api/v1/admin/pending')
      .set(ADMIN_HDR)

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
    expect(res.body.transactions).toHaveLength(2)
    expect(res.body.note).toBeDefined()
  })

  it('returns empty list when no pending transactions', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/admin/pending')
      .set(ADMIN_HDR)

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(0)
    expect(res.body.transactions).toHaveLength(0)
  })

  it('returns 500 when DB query fails', async () => {
    mockQuery.mockRejectedValue(new Error('DB error'))

    const res = await request(buildApp())
      .get('/api/v1/admin/pending')
      .set(ADMIN_HDR)

    expect(res.status).toBe(500)
  })
})

// ── GET /api/v1/admin/circuit ─────────────────────────────────────────────────

describe('GET /api/v1/admin/circuit', () => {
  it('returns 403 without admin secret', async () => {
    const res = await request(buildApp()).get('/api/v1/admin/circuit')
    expect(res.status).toBe(403)
  })

  it('returns circuit breaker status', async () => {
    const res = await request(buildApp())
      .get('/api/v1/admin/circuit')
      .set(ADMIN_HDR)

    expect(res.status).toBe(200)
    expect(res.body.daraja).toBe('CLOSED')
    expect(res.body.description).toContain('CLOSED')
  })
})

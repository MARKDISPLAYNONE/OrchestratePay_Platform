/**
 * Integration tests for routes/accounting.ts — accounting integration management.
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET   = 'test-secret'
process.env.NODE_ENV     = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockRedisGet = jest.fn()
jest.mock('../db/redis', () => ({
  redis: { get: (...args: any[]) => mockRedisGet(...args) },
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('key'),
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// runGlPostingJob is imported and called with .catch(() => {}) — mock it
jest.mock('../jobs/gl-posting', () => ({
  runGlPostingJob: jest.fn().mockResolvedValue(undefined),
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'

function merchantToken(deviceId = 'device-1') {
  return jwt.sign(
    { sub: MERCHANT_ID, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret', { expiresIn: '1h' }
  )
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/accounting', require('../routes/accounting').default)
  return app
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('device-1')
    return Promise.resolve(null)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/accounting/integrations
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/accounting/integrations', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).get('/api/v1/accounting/integrations')
    expect(res.status).toBe(401)
  })

  it('returns list of connected integrations', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'integ-1', platform: 'xero', status: 'ACTIVE', realm_id: 'realm-1', settings: {} },
      ],
    })

    const res = await request(buildApp())
      .get('/api/v1/accounting/integrations')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.integrations).toHaveLength(1)
    expect(res.body.integrations[0].platform).toBe('xero')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/accounting/integrations/:platform/connect
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/accounting/integrations/:platform/connect', () => {
  it('returns 400 for unsupported platform', async () => {
    const res = await request(buildApp())
      .post('/api/v1/accounting/integrations/freshbooks/connect')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ accessToken: 'tok' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unsupported platform/i)
    expect(res.body.supported).toContain('quickbooks')
  })

  it('returns 400 when accessToken is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/accounting/integrations/xero/connect')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ realmId: 'realm-1' })  // no accessToken

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/accessToken/i)
  })

  it('connects integration and returns 201', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'integ-1', platform: 'xero', status: 'ACTIVE', connected_at: new Date() }],
    })

    const res = await request(buildApp())
      .post('/api/v1/accounting/integrations/xero/connect')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        accessToken:    'at-token',
        refreshToken:   'rt-token',
        tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        realmId:        'xero-realm-1',
        settings:       { revenueAccount: '200' },
      })

    expect(res.status).toBe(201)
    expect(res.body.integration.platform).toBe('xero')
  })

  it('supports all 4 allowed platforms', async () => {
    const platforms = ['quickbooks', 'xero', 'sage', 'wave']
    for (const platform of platforms) {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: `integ-${platform}`, platform, status: 'ACTIVE', connected_at: new Date() }],
      })
      const res = await request(buildApp())
        .post(`/api/v1/accounting/integrations/${platform}/connect`)
        .set('Authorization', `Bearer ${merchantToken()}`)
        .send({ accessToken: 'tok' })
      expect(res.status).toBe(201)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/accounting/integrations/:platform
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/accounting/integrations/:platform', () => {
  it('disconnects the integration and returns ok', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .delete('/api/v1/accounting/integrations/xero')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DISCONNECTED'),
      [MERCHANT_ID, 'xero']
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/accounting/integrations/:platform/settings
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/accounting/integrations/:platform/settings', () => {
  it('returns 400 when settings is not an object', async () => {
    const res = await request(buildApp())
      .patch('/api/v1/accounting/integrations/xero/settings')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ settings: 'invalid' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/settings object required/i)
  })

  it('returns 404 when integration not found', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 })

    const res = await request(buildApp())
      .patch('/api/v1/accounting/integrations/sage/settings')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ settings: { revenueAccount: '100' } })

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/integration not found/i)
  })

  it('updates settings and returns ok', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })

    const res = await request(buildApp())
      .patch('/api/v1/accounting/integrations/xero/settings')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ settings: { revenueAccount: '200', vatAccount: '820' } })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/accounting/gl-postings
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/accounting/gl-postings', () => {
  it('returns GL postings list', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'gl-1', platform: 'xero', status: 'POSTED', amount_cents: 50_000, journal_date: '2026-06-01' },
      ],
    })

    const res = await request(buildApp())
      .get('/api/v1/accounting/gl-postings')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.postings).toHaveLength(1)
    expect(res.body.limit).toBe(50)
    expect(res.body.offset).toBe(0)
  })

  it('accepts custom limit and offset query params', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/accounting/gl-postings?limit=10&offset=20&status=FAILED')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.limit).toBe(10)
    expect(res.body.offset).toBe(20)
    // Query should include status filter
    expect(mockQuery.mock.calls[0][0]).toMatch(/AND status = \$4/)
  })

  it('caps limit at 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/accounting/gl-postings?limit=500')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.body.limit).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/accounting/gl-postings/:id/retry
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/accounting/gl-postings/:id/retry', () => {
  it('returns 404 when no FAILED GL posting matches', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 })

    const res = await request(buildApp())
      .post('/api/v1/accounting/gl-postings/gl-uuid-1/retry')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/failed gl posting not found/i)
  })

  it('resets posting to PENDING and triggers job', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })
    const { runGlPostingJob } = require('../jobs/gl-posting')

    const res = await request(buildApp())
      .post('/api/v1/accounting/gl-postings/gl-uuid-1/retry')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(runGlPostingJob).toHaveBeenCalled()
  })
})

/**
 * Integration tests for routes/merchants.ts
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET    = 'test-secret'
process.env.ADMIN_SECRET  = 'test-admin'
process.env.NODE_ENV      = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockRedisGet   = jest.fn()
const mockRedisSetex = jest.fn()
const mockRedisDel   = jest.fn()

jest.mock('../db/redis', () => ({
  redis: {
    get:   (...args: any[]) => mockRedisGet(...args),
    setex: (...args: any[]) => mockRedisSetex(...args),
    del:   (...args: any[]) => mockRedisDel(...args),
  },
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('nfc-key'),
}))

jest.mock('../util/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'

function merchantToken(id = MERCHANT_ID, deviceId = 'device-1') {
  return jwt.sign({ sub: id, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret', { expiresIn: '1h' })
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/merchants', require('../routes/merchants').default)
  return app
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('device-1')
    return Promise.resolve(null)
  })
  mockRedisSetex.mockResolvedValue('OK')
  mockRedisDel.mockResolvedValue(1)
})

// ── POST /api/v1/merchants ────────────────────────────────────────────────────

describe('POST /api/v1/merchants', () => {
  it('returns 401 without admin secret', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/merchants')
      .send({ name: 'Shop', email: 'a@b.com', password: 'Pass1234!', phone: '254700000001' })

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/admin|auth/i)
  })

  it('returns 403 with wrong admin secret', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/merchants')
      .set('X-Admin-Secret', 'wrong-secret')
      .send({ name: 'Shop', email: 'a@b.com', password: 'Pass1234!', phone: '254700000001' })

    expect(res.status).toBe(403)
  })

  it('returns 409 when email already exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/merchants')
      .set('X-Admin-Secret', 'test-admin')
      .send({ name: 'Shop', email: 'taken@test.com', password: 'Pass1234!', phone: '254700000001' })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already exists/i)
  })

  it('creates merchant and returns 201', async () => {
    const now = new Date().toISOString()
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                       // email uniqueness check
      .mockResolvedValueOnce({ rows: [{ id: 'new-id', name: 'New Shop', email: 'new@test.com', phone: '254700000001', kra_pin: null, active: true, created_at: now }] })  // INSERT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })           // audit log INSERT

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/merchants')
      .set('X-Admin-Secret', 'test-admin')
      .send({ name: 'New Shop', email: 'new@test.com', password: 'Pass1234!', phone: '254700000001' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('New Shop')
    expect(res.body.email).toBe('new@test.com')
  })

  it('returns 400 for invalid payload (too-short name)', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/merchants')
      .set('X-Admin-Secret', 'test-admin')
      .send({ name: 'A', email: 'a@b.com', password: 'Pass1234!', phone: '254700000001' })

    expect(res.status).toBe(400)
  })
})

// ── GET /api/v1/merchants/me ──────────────────────────────────────────────────

describe('GET /api/v1/merchants/me', () => {
  it('returns merchant profile', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: MERCHANT_ID, name: 'Test Shop', phone: '254700000001',
        email: 'test@shop.com', mpesa_shortcode: '174379',
        mpesa_account_ref: null, kra_pin: null, active: true,
        has_active_session: true, created_at: new Date(),
      }],
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/merchants/me')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Test Shop')
    expect(res.body.email).toBe('test@shop.com')
  })

  it('returns 404 when merchant record is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/merchants/me')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('returns 401 without auth token', async () => {
    const app = buildApp()
    const res = await request(app).get('/api/v1/merchants/me')
    expect(res.status).toBe(401)
  })
})

// ── PUT /api/v1/merchants/me ──────────────────────────────────────────────────

describe('PUT /api/v1/merchants/me', () => {
  it('updates merchant profile fields', async () => {
    const updated = { id: MERCHANT_ID, name: 'Updated Shop', phone: '254711111111', email: 'test@shop.com', mpesa_shortcode: null, mpesa_account_ref: null, kra_pin: null, active: true, updated_at: new Date() }
    mockQuery.mockResolvedValueOnce({ rows: [updated] })

    const app = buildApp()
    const res = await request(app)
      .put('/api/v1/merchants/me')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'Updated Shop', phone: '254711111111' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Updated Shop')
  })

  it('returns 404 when update affects no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app)
      .put('/api/v1/merchants/me')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'Ghost Shop' })

    expect(res.status).toBe(404)
  })

  it('returns 400 when no fields are provided (Joi .min(1))', async () => {
    const app = buildApp()
    const res = await request(app)
      .put('/api/v1/merchants/me')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({})

    expect(res.status).toBe(400)
  })
})

// ── GET /api/v1/merchants/me/z-report ────────────────────────────────────────

describe('GET /api/v1/merchants/me/z-report', () => {
  it('returns Z-Report for a given date', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { status: 'CONFIRMED', count: '12', total_cents: '450000', first_txn: '2026-05-25T07:14:23', last_txn: '2026-05-25T18:52:01', merchant_name: 'Test Shop' },
        { status: 'DECLINED',  count: '2',  total_cents: '0',      first_txn: '2026-05-25T08:00:00', last_txn: '2026-05-25T09:00:00', merchant_name: 'Test Shop' },
      ],
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/merchants/me/z-report?date=2026-05-25')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.date).toBe('2026-05-25')
    expect(res.body.merchantName).toBe('Test Shop')
    expect(res.body.transactions.confirmed.count).toBe(12)
    expect(res.body.transactions.confirmed.totalCents).toBe(450000)
    expect(res.body.transactions.declined.count).toBe(2)
  })

  it('returns empty Z-Report when no transactions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/merchants/me/z-report?date=2026-01-01')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.transactions.confirmed.count).toBe(0)
    expect(res.body.transactions.total.count).toBe(0)
    expect(res.body.firstTxnAt).toBeNull()
  })

  it('defaults to today when no date param is supplied', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/merchants/me/z-report')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns 500 when DB query fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/merchants/me/z-report?date=2026-05-25')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ── Analytics endpoints ───────────────────────────────────────────────────────

describe('GET /api/v1/merchants/me/analytics/*', () => {
  it('returns weekly analytics', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ week_start: '2026-05-18', revenue_cents: 100000, confirmed_count: 5, declined_count: 1 }],
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/merchants/me/analytics/weekly')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('returns peak-hours analytics', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ day_of_week: 1, hour_of_day: 10, avg_revenue_cents: 5000, avg_transactions: 2 }],
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/merchants/me/analytics/peak-hours')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('returns sources analytics', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { source: 'NFC_TAG', count: 30, revenue_cents: 150000 },
        { source: 'QR_CODE', count: 10, revenue_cents:  50000 },
      ],
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/merchants/me/analytics/sources')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })
})

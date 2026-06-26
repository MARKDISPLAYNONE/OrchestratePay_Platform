/**
 * routes-settlement.test.ts — Full coverage for src/routes/settlement.ts
 *
 * Covers:
 *   GET  /api/v1/settlements           — paginated list, auth required, DB error
 *   GET  /api/v1/settlements/:id       — single settlement + txns, 404, DB error
 *   GET  /api/v1/settlements/account/me — primary account or null, DB error
 *   POST /api/v1/settlements/account   — MPESA (phone validation), BANK, replaces existing, DB error
 *   adminSettlementRouter GET /        — status filter, pagination, DB error
 */
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET    = 'test-secret'
process.env.ADMIN_SECRET  = 'test-admin-secret'
process.env.NODE_ENV      = 'test'

// ── Mock requireAuth (bypass real JWT + device binding) ───────────────────────
const mockRequireAuth = jest.fn()
jest.mock('../middleware/auth', () => ({
  requireAuth:  (...args: any[]) => mockRequireAuth(...args),
  requireRole:  jest.fn().mockImplementation(() => (_req: any, _res: any, next: any) => next()),
  DEVICE_CACHE_TTL_S: 32400,
}))

// ── Mock DB ───────────────────────────────────────────────────────────────────
const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...a: any[]) => mockQuery(...a) },
}))

// ── Mock Redis ────────────────────────────────────────────────────────────────
const mockRedisGet = jest.fn()
jest.mock('../db/redis', () => ({
  redis: { get: (...a: any[]) => mockRedisGet(...a) },
}))

// ── Mock logger ───────────────────────────────────────────────────────────────
jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import settlementRouter, { adminSettlementRouter } from '../routes/settlement'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MERCHANT_ID   = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const SETTLEMENT_ID = 'b2b3b4b5-c1c2-4d1d-e1e2-f3f4f5f6f7f8'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/settlements', settlementRouter)
  return app
}

function buildAdminApp() {
  const app = express()
  app.use(express.json())
  app.use((_req, _res, next) => { _req.headers['x-admin-secret'] = process.env.ADMIN_SECRET!; next() })
  app.use('/api/v1/admin/settlements', adminSettlementRouter)
  return app
}

const SAMPLE_SETTLEMENT = {
  id:                  SETTLEMENT_ID,
  period_start:        '2026-06-20T00:00:00Z',
  period_end:          '2026-06-20T23:59:59Z',
  gross_amount_cents:  100_000,
  fee_cents:           1_500,
  net_amount_cents:    98_500,
  transaction_count:   5,
  status:              'COMPLETED',
  payout_method:       'MPESA',
  b2c_receipt:         'ABC123XYZ',
  failure_reason:      null,
  settled_at:          '2026-06-21T00:00:00Z',
  created_at:          '2026-06-20T23:50:00Z',
  account_type:        'MPESA',
  mpesa_phone:         '254712345678',
  bank_name:           null,
  account_number:      null,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockRedisGet.mockResolvedValue(null)

  // Inject authenticated merchant
  mockRequireAuth.mockImplementation((req: any, _res: any, next: any) => {
    req.merchant = { sub: MERCHANT_ID, name: 'Test Merchant', role: 'MERCHANT', deviceId: 'dev-1' }
    next()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/v1/settlements — list
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/settlements', () => {
  it('returns paginated settlement list with defaults (page=1, limit=20)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SAMPLE_SETTLEMENT] })  // main query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })     // count query

    const res = await request(buildApp()).get('/api/v1/settlements')

    expect(res.status).toBe(200)
    expect(res.body.settlements).toHaveLength(1)
    expect(res.body.settlements[0].id).toBe(SETTLEMENT_ID)
    expect(res.body.total).toBe(1)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(20)
  })

  it('respects custom page and limit query params', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })

    const res = await request(buildApp()).get('/api/v1/settlements?page=2&limit=5')

    expect(res.status).toBe(200)
    expect(res.body.page).toBe(2)
    expect(res.body.limit).toBe(5)
  })

  it('caps limit at 100', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })

    const res = await request(buildApp()).get('/api/v1/settlements?limit=999')

    expect(res.status).toBe(200)
    expect(res.body.limit).toBe(100)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireAuth.mockImplementationOnce((_req: any, res: any) => {
      res.status(401).json({ error: 'Unauthorized' })
    })

    const res = await request(buildApp()).get('/api/v1/settlements')
    expect(res.status).toBe(401)
  })

  it('returns 500 when DB throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'))

    const res = await request(buildApp()).get('/api/v1/settlements')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to fetch settlements')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/v1/settlements/:id — single settlement
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/settlements/:id', () => {
  it('returns settlement with transactions', async () => {
    const txn = { id: 'txn-1', amount_cents: 50_000, status: 'CONFIRMED', confirmed_at: '2026-06-20T12:00:00Z', source: 'NFC_TAG' }
    mockQuery
      .mockResolvedValueOnce({ rows: [SAMPLE_SETTLEMENT] })  // settlement fetch
      .mockResolvedValueOnce({ rows: [txn] })                // transactions

    const res = await request(buildApp()).get(`/api/v1/settlements/${SETTLEMENT_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(SETTLEMENT_ID)
    expect(res.body.transactions).toHaveLength(1)
    expect(res.body.transactions[0].id).toBe('txn-1')
  })

  it('returns 404 when settlement not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp()).get('/api/v1/settlements/non-existent-id')
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Settlement not found')
  })

  it('returns 500 when DB throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Query timeout'))

    const res = await request(buildApp()).get(`/api/v1/settlements/${SETTLEMENT_ID}`)
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to fetch settlement')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/v1/settlements/account/me — primary settlement account
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/settlements/account/me', () => {
  it('returns primary settlement account when it exists', async () => {
    const account = { id: 'acct-1', account_type: 'MPESA', mpesa_phone: '254712345678', is_primary: true }
    mockQuery.mockResolvedValueOnce({ rows: [account] })

    const res = await request(buildApp()).get('/api/v1/settlements/account/me')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('acct-1')
    expect(res.body.account_type).toBe('MPESA')
  })

  it('returns null when no primary account exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp()).get('/api/v1/settlements/account/me')

    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })

  it('returns 500 when DB throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildApp()).get('/api/v1/settlements/account/me')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to fetch settlement account')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/v1/settlements/account — register/replace settlement account
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/settlements/account', () => {
  const MPESA_ACCOUNT = { id: 'acct-mpesa', account_type: 'MPESA', mpesa_phone: '254712345678', is_primary: true }
  const BANK_ACCOUNT  = {
    id: 'acct-bank', account_type: 'BANK',
    bank_name: 'Equity Bank', account_number: '0123456789', account_name: 'Test Merchant Ltd',
    is_primary: true,
  }

  it('creates an MPESA settlement account with valid Safaricom phone (07xx)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // deactivate existing
      .mockResolvedValueOnce({ rows: [MPESA_ACCOUNT] })  // INSERT

    const res = await request(buildApp())
      .post('/api/v1/settlements/account')
      .send({ accountType: 'MPESA', mpesaPhone: '0712345678' })

    expect(res.status).toBe(201)
    expect(res.body.account_type).toBe('MPESA')
  })

  it('creates an MPESA account with 254-prefixed phone', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [MPESA_ACCOUNT] })

    const res = await request(buildApp())
      .post('/api/v1/settlements/account')
      .send({ accountType: 'MPESA', mpesaPhone: '254712345678' })

    expect(res.status).toBe(201)
  })

  it('rejects MPESA account with invalid phone format', async () => {
    const res = await request(buildApp())
      .post('/api/v1/settlements/account')
      .send({ accountType: 'MPESA', mpesaPhone: '1234567890' })

    expect(res.status).toBe(400)
    // validate middleware returns { error: 'Validation failed', details: '...' }
    expect(res.body.details).toContain('mpesaPhone must be a valid Safaricom number')
  })

  it('rejects MPESA account when mpesaPhone is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/settlements/account')
      .send({ accountType: 'MPESA' })

    expect(res.status).toBe(400)
  })

  it('creates a BANK settlement account with all required fields', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [BANK_ACCOUNT] })

    const res = await request(buildApp())
      .post('/api/v1/settlements/account')
      .send({
        accountType:   'BANK',
        bankName:      'Equity Bank',
        accountNumber: '0123456789',
        accountName:   'Test Merchant Ltd',
      })

    expect(res.status).toBe(201)
    expect(res.body.account_type).toBe('BANK')
    expect(res.body.bank_name).toBe('Equity Bank')
  })

  it('rejects BANK account when required fields are missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/settlements/account')
      .send({ accountType: 'BANK', bankName: 'Equity Bank' })  // missing accountNumber and accountName

    expect(res.status).toBe(400)
  })

  it('deactivates existing primary account before inserting new one', async () => {
    const existing = { id: 'old-acct', account_type: 'MPESA', mpesa_phone: '254700000001', is_primary: false }
    mockQuery
      .mockResolvedValueOnce({ rows: [existing], rowCount: 1 })  // deactivate existing
      .mockResolvedValueOnce({ rows: [MPESA_ACCOUNT] })          // INSERT new

    await request(buildApp())
      .post('/api/v1/settlements/account')
      .send({ accountType: 'MPESA', mpesaPhone: '0712345678' })

    const deactivateCall = mockQuery.mock.calls[0]
    expect(String(deactivateCall[0])).toContain('is_primary = false')
    expect(String(deactivateCall[0])).toContain('active = false')
  })

  it('returns 400 for unknown accountType', async () => {
    const res = await request(buildApp())
      .post('/api/v1/settlements/account')
      .send({ accountType: 'CRYPTO' })

    expect(res.status).toBe(400)
  })

  it('returns 500 when DB throws during INSERT', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // deactivate OK
      .mockRejectedValueOnce(new Error('Constraint violation'))  // INSERT fails

    const res = await request(buildApp())
      .post('/api/v1/settlements/account')
      .send({ accountType: 'MPESA', mpesaPhone: '0712345678' })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to save settlement account')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// adminSettlementRouter GET / — admin settlement list
// ═════════════════════════════════════════════════════════════════════════════

describe('adminSettlementRouter GET /', () => {
  it('returns all settlements without status filter', async () => {
    const row = { ...SAMPLE_SETTLEMENT, merchant_name: 'Test Merchant', merchant_email: 'merchant@example.com' }
    mockQuery.mockResolvedValueOnce({ rows: [row] })

    const res = await request(buildAdminApp()).get('/api/v1/admin/settlements')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].merchant_name).toBe('Test Merchant')
  })

  it('filters settlements by status query param', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildAdminApp()).get('/api/v1/admin/settlements?status=PENDING')
    expect(res.status).toBe(200)
    // Verify the status param was passed to the query
    const queryCall = mockQuery.mock.calls[0]
    expect(queryCall[1][0]).toBe('PENDING')
  })

  it('uses default limit=50 and offset=0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await request(buildAdminApp()).get('/api/v1/admin/settlements')
    const queryCall = mockQuery.mock.calls[0]
    expect(queryCall[1][1]).toBe(50)   // limit
    expect(queryCall[1][2]).toBe(0)    // offset
  })

  it('respects custom limit and offset', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await request(buildAdminApp()).get('/api/v1/admin/settlements?limit=10&offset=20')
    const queryCall = mockQuery.mock.calls[0]
    expect(queryCall[1][1]).toBe(10)
    expect(queryCall[1][2]).toBe(20)
  })

  it('caps limit at 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await request(buildAdminApp()).get('/api/v1/admin/settlements?limit=500')
    const queryCall = mockQuery.mock.calls[0]
    expect(queryCall[1][1]).toBe(200)
  })

  it('returns 500 when DB throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildAdminApp()).get('/api/v1/admin/settlements')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to fetch settlements')
  })
})

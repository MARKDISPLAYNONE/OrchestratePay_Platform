import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.NODE_ENV   = 'test'
process.env.JWT_SECRET = 'test-secret'

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({ db: { query: (...a: any[]) => mockQuery(...a) } }))

const mockRedisGet = jest.fn()
jest.mock('../db/redis', () => ({
  redis: { get: (...a: any[]) => mockRedisGet(...a) },
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

const mockInitiateB2c = jest.fn()
jest.mock('../integrations/daraja', () => ({
  ...jest.requireActual('../integrations/daraja'),
  initiateB2cPayout: (...a: any[]) => mockInitiateB2c(...a),
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('key'),
}))

import refundsRouter from '../routes/refunds'

// ── Helpers ────────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const OTHER_ID    = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const TXN_ID      = 'cccccccc-cccc-4ccc-cccc-cccccccccccc'
const REFUND_ID   = 'dddddddd-dddd-4ddd-dddd-dddddddddddd'

function merchantToken(merchantId = MERCHANT_ID) {
  return jwt.sign(
    { sub: merchantId, name: 'Test Merchant', role: 'MERCHANT', deviceId: 'dev-1' },
    'test-secret',
    { expiresIn: '1h' }
  )
}

function adminToken() {
  return jwt.sign(
    { sub: 'admin-1', name: 'Admin', role: 'ADMIN' },
    'test-secret',
    { expiresIn: '1h' }
  )
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/refunds', refundsRouter)
  app.use('/api/v1/admin',   refundsRouter)
  return app
}

const SAMPLE_TXN = {
  id:           TXN_ID,
  merchant_id:  MERCHANT_ID,
  amount_cents: 10_000,
  status:       'CONFIRMED',
}

const SAMPLE_REFUND = {
  id:             REFUND_ID,
  transaction_id: TXN_ID,
  merchant_id:    MERCHANT_ID,
  amount_cents:   5_000,
  reason:         'Customer request',
  status:         'PENDING',
  initiated_by:   'MERCHANT',
  b2c_request_id: null,
  b2c_receipt:    null,
  approved_by:    null,
  notes:          null,
  created_at:     new Date().toISOString(),
  updated_at:     new Date().toISOString(),
  mpesa_receipt:  'MP12345',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('dev-1')
    return Promise.resolve(null)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/refunds
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/refunds', () => {
  const VALID_BODY = {
    transactionId: TXN_ID,
    amountCents:   5_000,
    reason:        'Customer request',
  }

  it('returns 401 without auth token', async () => {
    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .send(VALID_BODY)
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid body (amountCents too small)', async () => {
    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...VALID_BODY, amountCents: 50 })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid body (missing reason)', async () => {
    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ transactionId: TXN_ID, amountCents: 1000 })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid body (reason too long)', async () => {
    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...VALID_BODY, reason: 'x'.repeat(501) })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid transactionId (not a UUID)', async () => {
    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...VALID_BODY, transactionId: 'not-a-uuid' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when transaction does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/transaction not found/i)
  })

  it('returns 404 when transaction belongs to a different merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...SAMPLE_TXN, merchant_id: OTHER_ID }] })

    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/transaction not found/i)
  })

  it('returns 422 when transaction status is not CONFIRMED', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...SAMPLE_TXN, status: 'PENDING' }] })

    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/CONFIRMED/i)
  })

  it('returns 422 when refund amount exceeds transaction amount', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SAMPLE_TXN] })

    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...VALID_BODY, amountCents: 99_999 })

    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/exceeds/i)
  })

  it('returns 409 when a non-REJECTED/FAILED refund already exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SAMPLE_TXN] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-refund-id' }] })

    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already exists/i)
  })

  it('creates a refund and returns 201 on success', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SAMPLE_TXN] })      // SELECT transaction
      .mockResolvedValueOnce({ rows: [] })                 // duplicate check
      .mockResolvedValueOnce({ rows: [] })                 // INSERT refund

    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('PENDING')
    expect(res.body.amountCents).toBe(5_000)
    expect(res.body.transactionId).toBe(TXN_ID)
    expect(res.body.refundId).toBeDefined()
  })

  it('returns 500 on unexpected DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'))

    const res = await request(buildApp())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/failed to create refund/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/refunds
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/refunds', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).get('/api/v1/refunds')
    expect(res.status).toBe(401)
  })

  it('returns paginated refunds with defaults (page=1, limit=20)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SAMPLE_REFUND] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })

    const res = await request(buildApp())
      .get('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.refunds).toHaveLength(1)
    expect(res.body.total).toBe(1)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(20)
  })

  it('respects custom page and limit query params', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '42' }] })

    const res = await request(buildApp())
      .get('/api/v1/refunds?page=3&limit=5')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.page).toBe(3)
    expect(res.body.limit).toBe(5)
    expect(res.body.total).toBe(42)

    const listCall = mockQuery.mock.calls[0]
    expect(listCall[1]).toContain(5)   // limit
    expect(listCall[1]).toContain(10)  // offset = (3-1)*5
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildApp())
      .get('/api/v1/refunds')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/refunds/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/refunds/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).get(`/api/v1/refunds/${REFUND_ID}`)
    expect(res.status).toBe(401)
  })

  it('returns the refund when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SAMPLE_REFUND] })

    const res = await request(buildApp())
      .get(`/api/v1/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(REFUND_ID)
    expect(res.body.mpesa_receipt).toBe('MP12345')
  })

  it('returns 404 when refund not found or belongs to another merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get(`/api/v1/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB timeout'))

    const res = await request(buildApp())
      .get(`/api/v1/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/admin/refunds/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/refunds/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .patch(`/api/v1/admin/refunds/${REFUND_ID}`)
      .send({ action: 'APPROVE' })
    expect(res.status).toBe(401)
  })

  it('returns 403 when called with a merchant token', async () => {
    const res = await request(buildApp())
      .patch(`/api/v1/admin/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ action: 'APPROVE' })
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid action value', async () => {
    const res = await request(buildApp())
      .patch(`/api/v1/admin/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ action: 'CANCEL' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when action is missing', async () => {
    const res = await request(buildApp())
      .patch(`/api/v1/admin/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 404 when refund does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .patch(`/api/v1/admin/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ action: 'APPROVE' })

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('REJECT: updates status to REJECTED and stores notes', async () => {
    const rejectedRefund = { ...SAMPLE_REFUND, status: 'REJECTED', notes: 'Policy violation' }
    mockQuery
      .mockResolvedValueOnce({ rows: [SAMPLE_REFUND] })
      .mockResolvedValueOnce({ rows: [rejectedRefund] })

    const res = await request(buildApp())
      .patch(`/api/v1/admin/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ action: 'REJECT', notes: 'Policy violation' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('REJECTED')
    expect(res.body.notes).toBe('Policy violation')

    const updateCall = mockQuery.mock.calls[1]
    expect(updateCall[0]).toContain("status = 'REJECTED'")
  })

  it('REJECT: works without notes field', async () => {
    const rejectedRefund = { ...SAMPLE_REFUND, status: 'REJECTED', notes: null }
    mockQuery
      .mockResolvedValueOnce({ rows: [SAMPLE_REFUND] })
      .mockResolvedValueOnce({ rows: [rejectedRefund] })

    const res = await request(buildApp())
      .patch(`/api/v1/admin/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ action: 'REJECT' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('REJECTED')
  })

  it('APPROVE: initiates B2C payout and updates to PROCESSING on success', async () => {
    const processingRefund = { ...SAMPLE_REFUND, status: 'PROCESSING', b2c_request_id: 'b2c-req-1' }
    mockQuery
      .mockResolvedValueOnce({ rows: [SAMPLE_REFUND] })   // SELECT refund
      .mockResolvedValueOnce({ rows: [] })                 // UPDATE → APPROVED
      .mockResolvedValueOnce({ rows: [processingRefund] }) // UPDATE → PROCESSING
    mockInitiateB2c.mockResolvedValueOnce({ requestId: 'b2c-req-1' })

    const res = await request(buildApp())
      .patch(`/api/v1/admin/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ action: 'APPROVE' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('PROCESSING')
    expect(res.body.b2c_request_id).toBe('b2c-req-1')
    expect(mockInitiateB2c).toHaveBeenCalledWith(
      expect.objectContaining({
        refundId:    REFUND_ID,
        merchantId:  MERCHANT_ID,
        amountCents: 5_000,
      })
    )
  })

  it('APPROVE: updates to FAILED and returns 502 when B2C payout throws', async () => {
    const failedRefund = { ...SAMPLE_REFUND, status: 'FAILED', notes: 'B2C payout failed: Network error' }
    mockQuery
      .mockResolvedValueOnce({ rows: [SAMPLE_REFUND] })  // SELECT refund
      .mockResolvedValueOnce({ rows: [] })                // UPDATE → APPROVED
      .mockResolvedValueOnce({ rows: [failedRefund] })    // UPDATE → FAILED
    mockInitiateB2c.mockRejectedValueOnce(new Error('Network error'))

    const res = await request(buildApp())
      .patch(`/api/v1/admin/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ action: 'APPROVE' })

    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/B2C payout failed/i)
    expect(res.body.refund.status).toBe('FAILED')
  })

  it('returns 500 on unexpected DB error during action processing', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB crash'))

    const res = await request(buildApp())
      .patch(`/api/v1/admin/refunds/${REFUND_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ action: 'APPROVE' })

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/failed to process refund/i)
  })
})

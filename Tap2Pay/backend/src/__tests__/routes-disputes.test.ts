/**
 * Integration tests for routes/disputes.ts — dispute / chargeback endpoints.
 *
 * DB and logger are fully mocked; no live Postgres or Redis required.
 * The requireMerchantOrConsumer middleware decodes the JWT directly (no Redis
 * device-binding check), so no Redis mock is needed for these tests.
 */

process.env.NODE_ENV    = 'test'
process.env.JWT_SECRET  = 'test-secret'
process.env.ADMIN_SECRET = 'test-admin-secret'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({ db: { query: (...a: any[]) => mockQuery(...a) } }))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import disputesRouter, { adminDisputeRouter } from '../routes/disputes'

// ── App factory ────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/disputes', disputesRouter)
  return app
}

// injectSecret=true: injects X-Admin-Secret header so admin routes pass auth
// injectSecret=false: mounts adminDisputeRouter without injecting the secret (for auth failure tests)
function buildAdminApp(injectSecret = false) {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/disputes', disputesRouter)
  if (injectSecret) {
    app.use((_req, _res, next) => { _req.headers['x-admin-secret'] = process.env.ADMIN_SECRET!; next() })
  }
  app.use('/api/v1/admin/disputes', adminDisputeRouter)
  return app
}

// ── Token helpers ──────────────────────────────────────────────────────────────

function merchantToken(merchantId = 'merchant-uuid') {
  return jwt.sign(
    { sub: merchantId, name: 'Test Merchant', role: 'MERCHANT', deviceId: 'dev-1' },
    'test-secret',
    { expiresIn: '1h' }
  )
}

function consumerToken(consumerId = 'consumer-uuid') {
  return jwt.sign(
    { sub: consumerId, name: 'Consumer', role: 'CONSUMER' },
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

// ── Constants ──────────────────────────────────────────────────────────────────

const MERCHANT_ID   = 'merchant-uuid'
const OTHER_MERCHANT = 'other-merchant-uuid'
const CONSUMER_ID   = 'consumer-uuid'
const TXN_ID        = '11111111-1111-4111-a111-111111111111'
const DISPUTE_ID    = '22222222-2222-4222-a222-222222222222'

const VALID_BODY = {
  transactionId: TXN_ID,
  reasonCode:    'DUPLICATE_CHARGE',
  description:   'I was charged twice for the same item.',
}

const MERCHANT_TXN_ROW = {
  id:             TXN_ID,
  merchant_id:    MERCHANT_ID,
  consumer_id:    CONSUMER_ID,
  consumer_phone: '254712345678',
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
})

// =============================================================================
// POST /api/v1/disputes
// =============================================================================

describe('POST /api/v1/disputes — merchant raises dispute', () => {
  it('returns 201 with disputeId on success', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MERCHANT_TXN_ROW] })   // transaction lookup
      .mockResolvedValueOnce({ rows: [] })                    // no existing dispute
      .mockResolvedValueOnce({ rows: [] })                    // INSERT

    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(res.body.disputeId).toBeDefined()
    expect(res.body.status).toBe('OPEN')
    expect(res.body.reasonCode).toBe('DUPLICATE_CHARGE')
    expect(res.body.transactionId).toBe(TXN_ID)
  })

  it('returns 404 when transaction not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/transaction not found/i)
  })

  it('returns 403 when transaction belongs to a different merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MERCHANT_TXN_ROW, merchant_id: OTHER_MERCHANT }] })

    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${merchantToken()}`)  // MERCHANT_ID, not OTHER_MERCHANT
      .send(VALID_BODY)

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/does not belong/i)
  })

  it('returns 409 when an active dispute already exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MERCHANT_TXN_ROW] })
      .mockResolvedValueOnce({ rows: [{ id: DISPUTE_ID }] })  // existing OPEN dispute

    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/active dispute already exists/i)
    expect(res.body.disputeId).toBe(DISPUTE_ID)
  })

  it('returns 400 when description is too short (< 10 chars)', async () => {
    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...VALID_BODY, description: 'Short' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/validation/i)
  })

  it('returns 400 when reasonCode is invalid', async () => {
    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...VALID_BODY, reasonCode: 'WRONG_CODE' })

    expect(res.status).toBe(400)
  })

  it('returns 400 when evidenceUrl is not a valid URI', async () => {
    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...VALID_BODY, evidenceUrl: 'not-a-url' })

    expect(res.status).toBe(400)
  })

  it('returns 500 when DB throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection error'))

    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/failed to create dispute/i)
  })
})

describe('POST /api/v1/disputes — consumer raises dispute', () => {
  it('returns 201 when consumer is linked via consumer_id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MERCHANT_TXN_ROW] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${consumerToken(CONSUMER_ID)}`)
      .send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('OPEN')
  })

  it('returns 403 when consumer is not linked to the transaction', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MERCHANT_TXN_ROW, consumer_id: 'some-other-consumer', consumer_phone: '254799999999' }],
    })

    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${consumerToken(CONSUMER_ID)}`)
      .send(VALID_BODY)

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/does not belong/i)
  })
})

// =============================================================================
// Authentication / role guard
// =============================================================================

describe('POST /api/v1/disputes — auth failures', () => {
  it('returns 401 when no Authorization header', async () => {
    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .send(VALID_BODY)

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/missing authentication token/i)
  })

  it('returns 401 for a malformed token', async () => {
    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', 'Bearer not.a.jwt')
      .send(VALID_BODY)

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/invalid authentication token/i)
  })

  it('returns 403 when role is ADMIN (not merchant/consumer)', async () => {
    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/invalid role/i)
  })

  it('returns 401 for an expired token', async () => {
    const expired = jwt.sign(
      { sub: MERCHANT_ID, name: 'T', role: 'MERCHANT', deviceId: 'dev' },
      'test-secret',
      { expiresIn: '-1s' }
    )

    const res = await request(buildApp())
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${expired}`)
      .send(VALID_BODY)

    expect(res.status).toBe(401)
  })
})

// =============================================================================
// GET /api/v1/disputes
// =============================================================================

describe('GET /api/v1/disputes — merchant view', () => {
  it('returns disputes for the authenticated merchant', async () => {
    const disputes = [
      { id: DISPUTE_ID, transaction_id: TXN_ID, status: 'OPEN', reason_code: 'FRAUD' },
    ]
    mockQuery.mockResolvedValueOnce({ rows: disputes })

    const res = await request(buildApp())
      .get('/api/v1/disputes')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.disputes).toHaveLength(1)
    expect(res.body.total).toBe(1)
    expect(res.body.disputes[0].id).toBe(DISPUTE_ID)
  })

  it('passes status filter to the query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/disputes?status=OPEN')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    // Verify that the query was called with 'OPEN' as a parameter
    const callArgs = mockQuery.mock.calls[0]
    expect(callArgs[1]).toContain('OPEN')
  })

  it('returns 400 for an unrecognised status filter', async () => {
    const res = await request(buildApp())
      .get('/api/v1/disputes?status=BOGUS')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid status filter/i)
  })

  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).get('/api/v1/disputes')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/disputes — consumer view', () => {
  it('returns disputes raised by the authenticated consumer', async () => {
    const disputes = [
      { id: DISPUTE_ID, transaction_id: TXN_ID, status: 'OPEN', raised_by: 'CONSUMER' },
    ]
    mockQuery.mockResolvedValueOnce({ rows: disputes })

    const res = await request(buildApp())
      .get('/api/v1/disputes')
      .set('Authorization', `Bearer ${consumerToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.disputes).toHaveLength(1)
    expect(res.body.total).toBe(1)
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildApp())
      .get('/api/v1/disputes')
      .set('Authorization', `Bearer ${consumerToken()}`)

    expect(res.status).toBe(500)
  })
})

// =============================================================================
// GET /api/v1/disputes/:id
// =============================================================================

describe('GET /api/v1/disputes/:id', () => {
  const DISPUTE_ROW = {
    id:                 DISPUTE_ID,
    transaction_id:     TXN_ID,
    raised_by:          'MERCHANT',
    reason_code:        'DUPLICATE_CHARGE',
    description:        'Charged twice for the same order.',
    status:             'OPEN',
    evidence_url:       null,
    resolved_by:        null,
    resolved_at:        null,
    resolution_notes:   null,
    created_at:         new Date().toISOString(),
    updated_at:         new Date().toISOString(),
    amount_cents:       5000,
    transaction_status: 'CONFIRMED',
    merchant_id:        MERCHANT_ID,
    consumer_id:        CONSUMER_ID,
  }

  it('returns the dispute for the owning merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [DISPUTE_ROW] })

    const res = await request(buildApp())
      .get(`/api/v1/disputes/${DISPUTE_ID}`)
      .set('Authorization', `Bearer ${merchantToken(MERCHANT_ID)}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(DISPUTE_ID)
    // merchant_id and consumer_id are internal FK fields — should be stripped
    expect(res.body.merchant_id).toBeUndefined()
    expect(res.body.consumer_id).toBeUndefined()
  })

  it('returns the dispute for the linked consumer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...DISPUTE_ROW, raised_by: 'CONSUMER' }] })

    const res = await request(buildApp())
      .get(`/api/v1/disputes/${DISPUTE_ID}`)
      .set('Authorization', `Bearer ${consumerToken(CONSUMER_ID)}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(DISPUTE_ID)
  })

  it('returns 404 when dispute does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get(`/api/v1/disputes/${DISPUTE_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/dispute not found/i)
  })

  it('returns 404 (not 403) when merchant does not own the dispute', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...DISPUTE_ROW, merchant_id: OTHER_MERCHANT }],
    })

    const res = await request(buildApp())
      .get(`/api/v1/disputes/${DISPUTE_ID}`)
      .set('Authorization', `Bearer ${merchantToken(MERCHANT_ID)}`)

    expect(res.status).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).get(`/api/v1/disputes/${DISPUTE_ID}`)
    expect(res.status).toBe(401)
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildApp())
      .get(`/api/v1/disputes/${DISPUTE_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// =============================================================================
// PATCH /api/v1/admin/disputes/:id
// =============================================================================

describe('PATCH /api/v1/admin/disputes/:id', () => {
  const DISPUTE_ROW = {
    id:               DISPUTE_ID,
    transaction_id:   TXN_ID,
    status:           'UNDER_REVIEW',
    resolved_by:      'admin-1',
    resolved_at:      null,
    resolution_notes: 'Reviewed',
    updated_at:       new Date().toISOString(),
  }

  it('transitions to UNDER_REVIEW successfully', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: DISPUTE_ID }] })  // existence check
      .mockResolvedValueOnce({ rows: [{ ...DISPUTE_ROW, status: 'UNDER_REVIEW' }] })  // UPDATE

    const res = await request(buildAdminApp(true))
      .patch(`/api/v1/admin/disputes/${DISPUTE_ID}`)
      .send({ status: 'UNDER_REVIEW' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('UNDER_REVIEW')
  })

  it('transitions to RESOLVED_MERCHANT_FAVOR and sets resolved_at', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: DISPUTE_ID }] })
      .mockResolvedValueOnce({
        rows: [{
          ...DISPUTE_ROW,
          status:     'RESOLVED_MERCHANT_FAVOR',
          resolved_at: new Date().toISOString(),
          resolution_notes: 'Merchant provided valid receipt.',
        }],
      })

    const res = await request(buildAdminApp(true))
      .patch(`/api/v1/admin/disputes/${DISPUTE_ID}`)
      .send({ status: 'RESOLVED_MERCHANT_FAVOR', resolutionNotes: 'Merchant provided valid receipt.' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('RESOLVED_MERCHANT_FAVOR')
    expect(res.body.resolved_at).toBeDefined()
  })

  it('transitions to RESOLVED_CONSUMER_FAVOR', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: DISPUTE_ID }] })
      .mockResolvedValueOnce({
        rows: [{ ...DISPUTE_ROW, status: 'RESOLVED_CONSUMER_FAVOR', resolved_at: new Date().toISOString() }],
      })

    const res = await request(buildAdminApp(true))
      .patch(`/api/v1/admin/disputes/${DISPUTE_ID}`)
      .send({ status: 'RESOLVED_CONSUMER_FAVOR', resolutionNotes: 'Duplicate confirmed.' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('RESOLVED_CONSUMER_FAVOR')
  })

  it('transitions to CLOSED', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: DISPUTE_ID }] })
      .mockResolvedValueOnce({ rows: [{ ...DISPUTE_ROW, status: 'CLOSED', resolved_at: new Date().toISOString() }] })

    const res = await request(buildAdminApp(true))
      .patch(`/api/v1/admin/disputes/${DISPUTE_ID}`)
      .send({ status: 'CLOSED' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CLOSED')
  })

  it('returns 404 when dispute does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildAdminApp(true))
      .patch(`/api/v1/admin/disputes/${DISPUTE_ID}`)
      .send({ status: 'UNDER_REVIEW' })

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/dispute not found/i)
  })

  it('returns 400 when status is invalid', async () => {
    const res = await request(buildAdminApp(true))
      .patch(`/api/v1/admin/disputes/${DISPUTE_ID}`)
      .send({ status: 'INVENTED_STATUS' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/validation/i)
  })

  it('returns 403 when called by a merchant (not admin)', async () => {
    const res = await request(buildAdminApp(false))
      .patch(`/api/v1/admin/disputes/${DISPUTE_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ status: 'UNDER_REVIEW' })

    expect(res.status).toBe(403)
  })

  it('returns 401 without auth', async () => {
    const res = await request(buildAdminApp(false))
      .patch(`/api/v1/admin/disputes/${DISPUTE_ID}`)
      .send({ status: 'UNDER_REVIEW' })

    expect(res.status).toBe(401)
  })

  it('returns 500 on DB error', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: DISPUTE_ID }] })
      .mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildAdminApp(true))
      .patch(`/api/v1/admin/disputes/${DISPUTE_ID}`)
      .send({ status: 'UNDER_REVIEW' })

    expect(res.status).toBe(500)
  })
})

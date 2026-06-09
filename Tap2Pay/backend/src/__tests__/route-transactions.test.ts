/**
 * Integration tests for routes/transactions.ts
 * Covers POST /, GET /:id/status, GET /, POST /merchant-hce-token
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET               = 'test-secret'
process.env.ADMIN_SECRET             = 'test-admin'
process.env.NODE_ENV                 = 'test'
process.env.PLAY_INTEGRITY_REQUIRED  = 'false'
process.env.HCE_TOKEN_SECRET         = 'a'.repeat(32)
process.env.DARAJA_CALLBACK_BASE_URL = 'https://example.com'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockRedisGet    = jest.fn()
const mockRedisSetex  = jest.fn()
const mockRedisDel    = jest.fn()
const mockRedisPublish = jest.fn()

jest.mock('../db/redis', () => ({
  redis: {
    get:     (...args: any[]) => mockRedisGet(...args),
    setex:   (...args: any[]) => mockRedisSetex(...args),
    del:     (...args: any[]) => mockRedisDel(...args),
    publish: (...args: any[]) => mockRedisPublish(...args),
  },
}))

const mockStkPush = jest.fn()
jest.mock('../integrations/daraja', () => ({
  stkPush:                (...args: any[]) => mockStkPush(...args),
  getDarajaCircuitStatus: jest.fn().mockReturnValue('CLOSED'),
}))

const mockVerifyHceToken = jest.fn()
jest.mock('../util/hce-token', () => ({
  verifyHceToken: (...args: any[]) => mockVerifyHceToken(...args),
  issueHceToken:  jest.fn().mockReturnValue({ token: 'tok123', exp: Date.now() + 60_000 }),
}))

const mockConvertToKes        = jest.fn()
const mockIsSupportedCurrency = jest.fn()
jest.mock('../util/fx', () => ({
  convertToKes:        (...args: any[]) => mockConvertToKes(...args),
  isSupportedCurrency: (...args: any[]) => mockIsSupportedCurrency(...args),
}))

const mockScoreFraud = jest.fn()
jest.mock('../util/fraud', () => ({
  scoreFraud: (...args: any[]) => mockScoreFraud(...args),
}))

const mockCheckCbkCompliance = jest.fn()
jest.mock('../util/cbk-compliance', () => ({
  checkCbkCompliance: (...args: any[]) => mockCheckCbkCompliance(...args),
}))

jest.mock('../util/latency-tracker', () => ({
  recordLatency:     jest.fn().mockResolvedValue(undefined),
  parseTapTimestamp: jest.fn().mockReturnValue(null),
}))

jest.mock('../util/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('test-nfc-key'),
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const CONSUMER_ID = 'b2b3b4b5-c2c3-4d4d-e5e5-f1f2f3f4f5f6'
const IDEM_KEY    = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
const TIMESTAMP   = 1_700_000_000_000

const MERCHANT_ROW = { id: MERCHANT_ID, name: 'Test Shop', approval_status: 'APPROVED' }
const CONSUMER_ROW = { id: CONSUMER_ID, phone: '254700000001' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function merchantToken(id = MERCHANT_ID, deviceId = 'device-1') {
  return jwt.sign({ sub: id, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret', { expiresIn: '1h' })
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/transactions', require('../routes/transactions').default)
  return app
}

const BASE_BODY = {
  merchantId:     MERCHANT_ID,
  amountCents:    5000,
  source:         'NFC_TAG',
  tagId:          'TAG-001',
  idempotencyKey: IDEM_KEY,
  timestamp:      TIMESTAMP,
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()  // clear once-queue so stale values don't bleed between tests
  // Device binding: return device-1 for the merchant, null elsewhere
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('device-1')
    return Promise.resolve(null)
  })
  mockRedisSetex.mockResolvedValue('OK')
  mockRedisDel.mockResolvedValue(1)
  mockRedisPublish.mockResolvedValue(1)
  mockIsSupportedCurrency.mockReturnValue(true)
  mockConvertToKes.mockResolvedValue({ kesAmountCents: 5000, fxRate: 1 })
  mockCheckCbkCompliance.mockResolvedValue({ allowed: true })
  mockScoreFraud.mockResolvedValue({ decision: 'ALLOW', score: 10, reasons: [] })
  mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'chk-1', merchantRequestId: 'mreq-1' })
})

// ── POST /api/v1/transactions ─────────────────────────────────────────────────

describe('POST /api/v1/transactions', () => {
  it('returns 401 without auth token', async () => {
    const app = buildApp()
    const res = await request(app).post('/api/v1/transactions').send(BASE_BODY)
    expect(res.status).toBe(401)
  })

  it('returns 403 when merchantId in body does not match JWT sub', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...BASE_BODY, merchantId: 'other-merchant-id' })
    expect(res.status).toBe(400)  // Joi UUID validation on mismatched id, or 403 mismatch
  })

  it('returns 403 when merchantId is valid UUID but mismatches JWT', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...BASE_BODY, merchantId: 'ffffffff-ffff-4fff-bfff-ffffffffffff' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/mismatch/i)
  })

  it('returns cached response on Redis idempotency hit', async () => {
    const cached = JSON.stringify({ status: 'STK_SENT', txnId: 'txn-cached' })
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('merchant:device:')) return Promise.resolve('device-1')
      if (key.startsWith('idempotency:'))     return Promise.resolve(cached)
      return Promise.resolve(null)
    })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('STK_SENT')
    expect(res.body.txnId).toBe('txn-cached')
  })

  it('returns DB idempotency hit when Redis misses', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'txn-db', status: 'CONFIRMED', mpesa_receipt: 'MP123' }],
    })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
  })

  it('returns 404 when merchant not found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // idempotency miss
      .mockResolvedValueOnce({ rows: [] })  // merchant not found

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/merchant not found/i)
  })

  it('returns 403 when merchant is not approved', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...MERCHANT_ROW, approval_status: 'PENDING' }] })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not approved/i)
  })

  it('returns 400 when HCE_PHONE source is missing hceToken', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...BASE_BODY, source: 'HCE_PHONE', consumerPhone: '254700000001', tagId: null })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/hceToken/i)
  })

  it('returns 401 when HCE token verification fails', async () => {
    mockVerifyHceToken.mockReturnValue(false)
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        ...BASE_BODY,
        source:        'HCE_PHONE',
        tagId:         null,
        consumerPhone: '254700000001',
        hceToken:      'a'.repeat(32),
        hceExp:        Date.now() + 60_000,
      })

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/invalid.*hce/i)
  })

  it('creates new consumer and succeeds for HCE_PHONE first tap', async () => {
    mockVerifyHceToken.mockReturnValue(true)
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                           // idempotency miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })               // merchant
      .mockResolvedValueOnce({ rows: [] })                           // consumer not found (first tap)
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })               // INSERT consumer
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })              // INSERT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })              // UPDATE STK_SENT

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        ...BASE_BODY,
        source:        'HCE_PHONE',
        tagId:         null,
        consumerPhone: '254700000001',
        hceToken:      'a'.repeat(32),
        hceExp:        Date.now() + 60_000,
      })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('STK_SENT')
  })

  it('returns 401 when consumer QR token is expired', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('merchant:device:'))  return Promise.resolve('device-1')
      if (key.startsWith('consumer:qr:'))      return Promise.resolve(null)
      return Promise.resolve(null)
    })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        ...BASE_BODY,
        source:          'CONSUMER_QR',
        tagId:           null,
        consumerQrToken: 'b2b3b4b5-c2c3-4d4d-e5e5-f1f2f3f4f5f6',
      })

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/expired/i)
  })

  it('returns 400 for unsupported currency', async () => {
    // Use a Joi-valid currency but mock isSupportedCurrency to return false so the
    // route-level check is reached (Joi would reject 'ZZZ' before the route runs)
    mockIsSupportedCurrency.mockReturnValue(false)
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })      // tag consumer
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })     // UPDATE nfc_tags

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...BASE_BODY, currency: 'USD' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unsupported currency/i)
  })

  it('returns 503 when FX service is unavailable', async () => {
    mockConvertToKes.mockRejectedValue(new Error('FX service down'))
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/exchange rate/i)
  })

  it('returns 403 when CBK daily limit is exceeded', async () => {
    mockCheckCbkCompliance.mockResolvedValue({ allowed: false, reason: 'Daily limit reached' })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('CBK_LIMIT_EXCEEDED')
  })

  it('returns 402 when fraud engine declines the transaction', async () => {
    mockScoreFraud.mockResolvedValue({ decision: 'DECLINE', score: 95, reasons: ['velocity'] })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    expect(res.status).toBe(402)
    expect(res.body.code).toBe('FRAUD_DECLINED')
  })

  it('returns 502 when STK Push fails', async () => {
    mockStkPush.mockResolvedValue({ success: false, errorMessage: 'Daraja timeout' })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE FAILED

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/m-pesa/i)
  })

  it('creates transaction via NFC tag and returns 201 STK_SENT', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                     // idempotency miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })         // merchant
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })         // consumer via tag
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // UPDATE nfc_tags
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // INSERT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // UPDATE STK_SENT

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('STK_SENT')
    expect(res.body.txnId).toBeDefined()
  })

  it('proceeds with REVIEW fraud decision', async () => {
    mockScoreFraud.mockResolvedValue({ decision: 'REVIEW', score: 75, reasons: ['first-time'] })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('STK_SENT')
  })

  it('creates transaction via consumerTagId', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })   // consumerTagId lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE STK_SENT

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        ...BASE_BODY,
        source:        'CONSUMER_TAG',
        tagId:         null,
        consumerTagId: CONSUMER_ID,
      })

    expect(res.status).toBe(201)
  })

  it('returns 400 when no consumer can be identified', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...BASE_BODY, tagId: null, source: 'QR_CODE' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/consumer/i)
  })

  it('returns 403 for SOFTPOS_MOBILE when device has no valid attestation', async () => {
    process.env.PLAY_INTEGRITY_REQUIRED = 'true'
    try {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })                // idempotency DB miss
        .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })   // merchant found
        .mockResolvedValueOnce({ rows: [] })                // attestation query — no verified device

      const app = buildApp()
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${merchantToken()}`)
        .send({ ...BASE_BODY, source: 'SOFTPOS_MOBILE', tagId: 'TAG-001' })

      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/attestation/i)
    } finally {
      process.env.PLAY_INTEGRITY_REQUIRED = 'false'
    }
  })

  it('proceeds past SOFTPOS_MOBILE attestation check when device is verified', async () => {
    process.env.PLAY_INTEGRITY_REQUIRED = 'true'
    try {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })                                             // idempotency DB miss
        .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })                                // merchant
        .mockResolvedValueOnce({ rows: [{ device_integrity_verified_at: new Date() }] }) // attestation found
        .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })                                // consumer via tag
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })                               // UPDATE nfc_tags
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })                               // INSERT transaction
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })                               // UPDATE STK_SENT

      const app = buildApp()
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${merchantToken()}`)
        .send({ ...BASE_BODY, source: 'SOFTPOS_MOBILE', tagId: 'TAG-001' })

      expect(res.status).toBe(201)
    } finally {
      process.env.PLAY_INTEGRITY_REQUIRED = 'false'
    }
  })

  it('returns 400 for SOFTPOS_MOBILE when deviceType mismatches source', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })   // merchant

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...BASE_BODY, source: 'SOFTPOS_MOBILE', tagId: 'TAG-001', deviceType: 'HARDWARE_TERMINAL' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/device type/i)
  })

  it('returns 201 for HCE_PHONE when consumer already exists (returning tap)', async () => {
    mockVerifyHceToken.mockReturnValue(true)
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })   // merchant
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })   // existing consumer found
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE STK_SENT

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        ...BASE_BODY,
        source:        'HCE_PHONE',
        tagId:         null,
        consumerPhone: '254700000001',
        hceToken:      'a'.repeat(32),
        hceExp:        Date.now() + 60_000,
      })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('STK_SENT')
  })

  it('returns 404 when consumerQrToken resolves but consumer account does not exist', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('merchant:device:'))  return Promise.resolve('device-1')
      if (key.startsWith('consumer:qr:'))      return Promise.resolve(CONSUMER_ID)
      return Promise.resolve(null)
    })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })   // merchant
      .mockResolvedValueOnce({ rows: [] })                // consumer not found

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        ...BASE_BODY,
        source:          'CONSUMER_QR',
        tagId:           null,
        consumerQrToken: 'b2b3b4b5-c2c3-4d4d-e5e5-f1f2f3f4f5f6',
      })

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/consumer.*not found/i)
  })

  it('creates transaction via MERCHANT_HCE when session is valid', async () => {
    const hceSessionData = JSON.stringify({ merchantId: MERCHANT_ID, consumerId: CONSUMER_ID, amountCents: 5000 })
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('merchant:device:'))  return Promise.resolve('device-1')
      if (key.startsWith('merchant:hce:'))     return Promise.resolve(hceSessionData)
      return Promise.resolve(null)
    })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })   // merchant
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })   // consumer from HCE session
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE STK_SENT

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        ...BASE_BODY,
        source:           'MERCHANT_HCE',
        tagId:            null,
        merchantHceToken: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('STK_SENT')
  })

  it('returns 403 for MERCHANT_HCE when HCE token belongs to a different merchant', async () => {
    const hceSessionData = JSON.stringify({
      merchantId: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
      consumerId: CONSUMER_ID,
      amountCents: 5000,
    })
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('merchant:device:'))  return Promise.resolve('device-1')
      if (key.startsWith('merchant:hce:'))     return Promise.resolve(hceSessionData)
      return Promise.resolve(null)
    })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })   // merchant

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        ...BASE_BODY,
        source:           'MERCHANT_HCE',
        tagId:            null,
        merchantHceToken: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      })

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/does not belong/i)
  })

  it('returns 404 for MERCHANT_HCE when consumer in session is not found in DB', async () => {
    const hceSessionData = JSON.stringify({ merchantId: MERCHANT_ID, consumerId: CONSUMER_ID, amountCents: 5000 })
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('merchant:device:'))  return Promise.resolve('device-1')
      if (key.startsWith('merchant:hce:'))     return Promise.resolve(hceSessionData)
      return Promise.resolve(null)
    })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })   // merchant
      .mockResolvedValueOnce({ rows: [] })                // consumer not found

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        ...BASE_BODY,
        source:           'MERCHANT_HCE',
        tagId:            null,
        merchantHceToken: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      })

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/consumer not found/i)
  })

  it('returns 404 when consumerTagId does not match any active consumer', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })   // merchant
      .mockResolvedValueOnce({ rows: [] })                // consumerTagId lookup — no match

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        ...BASE_BODY,
        source:        'CONSUMER_TAG',
        tagId:         null,
        consumerTagId: CONSUMER_ID,
      })

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/consumer not found/i)
  })

  it('returns 201 even when checkout_request_id DB update fails after successful STK Push', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                              // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })                  // merchant
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })                  // consumer via tag
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                 // UPDATE nfc_tags
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                 // INSERT transaction
      .mockRejectedValueOnce(new Error('DB connection lost'))            // UPDATE STK_SENT throws (CRITICAL path)

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('STK_SENT')
  })

  it('does not fail when recordLatency rejects (fire-and-forget catch path)', async () => {
    const { recordLatency: mockRecordLatency } = require('../util/latency-tracker')
    mockRecordLatency.mockRejectedValueOnce(new Error('latency DB error'))

    mockQuery
      .mockResolvedValueOnce({ rows: [] })                // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })   // merchant
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })   // consumer via tag
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE nfc_tags
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE STK_SENT

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(BASE_BODY)

    await new Promise(r => setImmediate(r))  // drain microtask queue so .catch fires

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('STK_SENT')
  })
})

// ── GET /api/v1/transactions/:id/status ───────────────────────────────────────

describe('GET /api/v1/transactions/:id/status', () => {
  it('returns cached status from Redis', async () => {
    const txnData  = JSON.stringify({ txnId: 'txn-1', idempotencyKey: IDEM_KEY })
    const cached   = JSON.stringify({ status: 'CONFIRMED', txnId: 'txn-1', mpesaRef: 'MP001' })

    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('merchant:device:'))  return Promise.resolve('device-1')
      if (key === 'txn:txn-1')                 return Promise.resolve(txnData)
      if (key.startsWith('idempotency:'))      return Promise.resolve(cached)
      return Promise.resolve(null)
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/transactions/txn-1/status')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
    expect(res.body.mpesaRef).toBe('MP001')
  })

  it('falls back to DB when Redis has no entry', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'txn-1', status: 'STK_SENT', mpesa_receipt: null,
        amount_cents: 5000, mpesa_result_desc: null,
        merchant_name: 'Test Shop', consumer_phone: '254700000001',
      }],
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/transactions/txn-1/status')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('STK_SENT')
    expect(res.body.consumerPhone).toMatch(/\*{4}/)  // masked
  })

  it('returns 404 when transaction is not found in DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/transactions/txn-missing/status')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })
})

// ── GET /api/v1/transactions ──────────────────────────────────────────────────

describe('GET /api/v1/transactions', () => {
  it('returns transaction list for merchant', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'txn-1', status: 'CONFIRMED', amount_cents: 5000, mpesa_receipt: 'MP1', created_at: new Date(), confirmed_at: new Date() },
        { id: 'txn-2', status: 'DECLINED',  amount_cents: 3000, mpesa_receipt: null,  created_at: new Date(), confirmed_at: null },
      ],
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/transactions')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.transactions).toHaveLength(2)
    expect(res.body.limit).toBe(50)
    expect(res.body.offset).toBe(0)
  })

  it('respects limit and offset query params', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/transactions?limit=10&offset=20')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.limit).toBe(10)
    expect(res.body.offset).toBe(20)
  })
})

// ── POST /api/v1/transactions/merchant-hce-token ──────────────────────────────

describe('POST /api/v1/transactions/merchant-hce-token', () => {
  it('returns 403 when merchant is not approved', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions/merchant-hce-token')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ amountCents: 5000 })

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not approved/i)
  })

  it('issues a merchant HCE token for approved merchant', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: MERCHANT_ID, name: 'Test Shop' }],
    })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions/merchant-hce-token')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ amountCents: 5000 })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.amountCents).toBe(5000)
    expect(res.body.merchantName).toBe('Test Shop')
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringMatching(/^merchant:hce:/),
      60,
      expect.any(String),
    )
  })

  it('returns 400 for missing amountCents', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/transactions/merchant-hce-token')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({})

    expect(res.status).toBe(400)
  })
})

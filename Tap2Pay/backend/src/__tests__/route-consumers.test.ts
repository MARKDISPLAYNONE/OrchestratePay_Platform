/**
 * Integration tests for routes/consumers.ts
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET               = 'test-secret'
process.env.ADMIN_SECRET             = 'test-admin'
process.env.NODE_ENV                 = 'test'
process.env.DARAJA_CALLBACK_BASE_URL = 'https://example.com'
process.env.PLATFORM_MERCHANT_ID     = 'platform-merchant-id'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockRedisGet    = jest.fn()
const mockRedisSetex  = jest.fn()
const mockRedisDel    = jest.fn()

jest.mock('../db/redis', () => ({
  redis: {
    get:   (...args: any[]) => mockRedisGet(...args),
    setex: (...args: any[]) => mockRedisSetex(...args),
    del:   (...args: any[]) => mockRedisDel(...args),
  },
}))

const mockStkPush = jest.fn()
jest.mock('../integrations/daraja', () => ({
  stkPush:                (...args: any[]) => mockStkPush(...args),
  getDarajaCircuitStatus: jest.fn().mockReturnValue('CLOSED'),
}))

const mockConvertToKes        = jest.fn()
const mockIsSupportedCurrency = jest.fn()
jest.mock('../util/fx', () => ({
  convertToKes:        (...args: any[]) => mockConvertToKes(...args),
  isSupportedCurrency: (...args: any[]) => mockIsSupportedCurrency(...args),
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('nfc-key'),
}))

jest.mock('../util/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const CONSUMER_ID = 'b2b3b4b5-c2c3-4d4d-e5e5-f1f2f3f4f5f6'
const IDEM_KEY    = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
const TIMESTAMP   = 1_700_000_000_000

const MERCHANT_ROW = { id: MERCHANT_ID, name: 'Test Shop', approval_status: 'APPROVED', active: true }
const CONSUMER_ROW = { id: CONSUMER_ID, phone: '254700000001', display_name: 'Jane Doe' }

function merchantToken(id = MERCHANT_ID, deviceId = 'device-1') {
  return jwt.sign({ sub: id, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret', { expiresIn: '1h' })
}

function consumerToken(id = CONSUMER_ID) {
  return jwt.sign({ sub: id, name: 'Jane Doe', role: 'CONSUMER' },
    'test-secret', { expiresIn: '1h' })
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/consumers', require('../routes/consumers').default)
  return app
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()  // clear once-queue so stale values don't bleed between tests
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('device-1')
    return Promise.resolve(null)
  })
  mockRedisSetex.mockResolvedValue('OK')
  mockRedisDel.mockResolvedValue(1)
  mockIsSupportedCurrency.mockReturnValue(true)
  mockConvertToKes.mockResolvedValue({ kesAmountCents: 5000, fxRate: 1 })
  mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'chk-1', merchantRequestId: 'mreq-1' })
})

// ── GET /api/v1/consumers/pay/:merchantId (public) ───────────────────────────

describe('GET /api/v1/consumers/pay/:merchantId', () => {
  it('returns 404 when merchant not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app).get(`/api/v1/consumers/pay/${MERCHANT_ID}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/merchant not found/i)
  })

  it('returns 403 when merchant is not approved', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MERCHANT_ROW, approval_status: 'PENDING' }],
    })

    const app = buildApp()
    const res = await request(app).get(`/api/v1/consumers/pay/${MERCHANT_ID}`)

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not accepting/i)
  })

  it('returns merchant info when approved', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MERCHANT_ROW] })

    const app = buildApp()
    const res = await request(app).get(`/api/v1/consumers/pay/${MERCHANT_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.merchant.name).toBe('Test Shop')
  })
})

// ── GET /api/v1/consumers/c/:consumerId (merchant auth) ──────────────────────

describe('GET /api/v1/consumers/c/:consumerId', () => {
  it('returns 404 when consumer not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app)
      .get(`/api/v1/consumers/c/${CONSUMER_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
  })

  it('returns masked consumer info', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [CONSUMER_ROW] })

    const app = buildApp()
    const res = await request(app)
      .get(`/api/v1/consumers/c/${CONSUMER_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.consumerId).toBe(CONSUMER_ID)
    expect(res.body.displayName).toBe('Jane Doe')
    expect(res.body.maskedPhone).toMatch(/\*{4}/)
  })

  it('returns 401 without merchant token', async () => {
    const app = buildApp()
    const res = await request(app).get(`/api/v1/consumers/c/${CONSUMER_ID}`)
    expect(res.status).toBe(401)
  })
})

// ── POST /api/v1/consumers/qr-token ──────────────────────────────────────────

describe('POST /api/v1/consumers/qr-token', () => {
  it('issues a QR token for the consumer', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/qr-token')
      .set('Authorization', `Bearer ${consumerToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.expiresAt).toBeGreaterThan(Date.now())
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringMatching(/^consumer:qr:/),
      90,
      CONSUMER_ID,
    )
  })

  it('returns 401 without consumer token', async () => {
    const app = buildApp()
    const res = await request(app).post('/api/v1/consumers/qr-token')
    expect(res.status).toBe(401)
  })
})

// ── POST /api/v1/consumers/me/fcm-token ──────────────────────────────────────

describe('POST /api/v1/consumers/me/fcm-token', () => {
  it('returns 400 when fcmToken is missing', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/me/fcm-token')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/fcmToken/i)
  })

  it('stores FCM token and returns ok', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/me/fcm-token')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send({ fcmToken: 'fcm-token-abc123' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

// ── GET /api/v1/consumers/me ──────────────────────────────────────────────────

describe('GET /api/v1/consumers/me', () => {
  it('returns 404 when consumer not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/consumers/me')
      .set('Authorization', `Bearer ${consumerToken()}`)

    expect(res.status).toBe(404)
  })

  it('returns masked consumer profile', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: CONSUMER_ID, phone: '254700000001', email: 'jane@example.com',
        display_name: 'Jane Doe', email_verified: true, sms_opt_in: true,
        created_at: new Date(),
      }],
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/consumers/me')
      .set('Authorization', `Bearer ${consumerToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.phone).toMatch(/\*{4}/)
    expect(res.body.display_name).toBe('Jane Doe')
  })
})

// ── PUT /api/v1/consumers/me ──────────────────────────────────────────────────

describe('PUT /api/v1/consumers/me', () => {
  it('returns 400 when no fields are provided', async () => {
    const app = buildApp()
    const res = await request(app)
      .put('/api/v1/consumers/me')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/nothing to update/i)
  })

  it('updates displayName and returns ok', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const app = buildApp()
    const res = await request(app)
      .put('/api/v1/consumers/me')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send({ displayName: 'Jane Updated' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('updates smsOptIn flag', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const app = buildApp()
    const res = await request(app)
      .put('/api/v1/consumers/me')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send({ smsOptIn: false })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

// ── GET /api/v1/consumers/me/transactions ────────────────────────────────────

describe('GET /api/v1/consumers/me/transactions', () => {
  it('returns transaction history with pagination', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'txn-1', status: 'CONFIRMED', amount_cents: 5000, original_currency: 'KES',
          original_amount_cents: 5000, mpesa_receipt: 'MP001', source: 'NFC_TAG',
          created_at: new Date(), confirmed_at: new Date(), merchant_name: 'Test Shop' },
      ],
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/consumers/me/transactions?limit=10&offset=0')
      .set('Authorization', `Bearer ${consumerToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.transactions).toHaveLength(1)
    expect(res.body.limit).toBe(10)
  })
})

// ── GET /api/v1/consumers/me/loyalty ─────────────────────────────────────────

describe('GET /api/v1/consumers/me/loyalty', () => {
  it('returns loyalty balances', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        merchant_id: MERCHANT_ID, merchant_name: 'Test Shop',
        reward_type: 'POINTS', points_per_ksh: 1, stamps_per_visit: null,
        redeem_threshold: 1000, points_balance: 250, stamps_balance: 0,
        lifetime_points: 500, lifetime_stamps: 0,
      }],
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/consumers/me/loyalty')
      .set('Authorization', `Bearer ${consumerToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.balances).toHaveLength(1)
    expect(res.body.balances[0].points_balance).toBe(250)
  })
})

// ── POST /api/v1/consumers/pay/:merchantId ───────────────────────────────────

describe('POST /api/v1/consumers/pay/:merchantId', () => {
  const validBody = {
    amountCents:    5000,
    idempotencyKey: IDEM_KEY,
    timestamp:      TIMESTAMP,
  }

  it('returns 404 when merchant not found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // idempotency miss
      .mockResolvedValueOnce({ rows: [] })  // merchant not found

    const app = buildApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/merchant not found/i)
  })

  it('returns 403 when merchant not approved', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...MERCHANT_ROW, approval_status: 'SUSPENDED' }] })

    const app = buildApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(403)
  })

  it('returns idempotency hit from Redis', async () => {
    const cached = JSON.stringify({ status: 'STK_SENT', txnId: 'txn-old' })
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('idempotency:')) return Promise.resolve(cached)
      return Promise.resolve(null)
    })

    const app = buildApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('STK_SENT')
  })

  it('creates payment and returns 201 STK_SENT', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                    // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })        // merchant
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })        // consumer
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })       // INSERT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })       // UPDATE STK_SENT

    const app = buildApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('STK_SENT')
  })

  it('returns 502 when STK Push fails', async () => {
    mockStkPush.mockResolvedValue({ success: false, errorMessage: 'Daraja error' })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                    // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })        // merchant
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })        // consumer
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })       // INSERT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })       // UPDATE FAILED

    const app = buildApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(502)
  })

  it('returns idempotency DB hit when Redis misses but DB has the transaction', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'txn-old', status: 'CONFIRMED', mpesa_receipt: 'MP001' }],
    })

    const app = buildApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
    expect(res.body.txnId).toBe('txn-old')
    expect(res.body.mpesaRef).toBe('MP001')
  })

  it('returns 404 when consumer account is not found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })   // merchant found
      .mockResolvedValueOnce({ rows: [] })                // consumer not found

    const app = buildApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/consumer.*not found/i)
  })

  it('returns 422 when consumer has no M-Pesa phone on file', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                        // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })                            // merchant found
      .mockResolvedValueOnce({ rows: [{ ...CONSUMER_ROW, phone: null }] })        // consumer: no phone

    const app = buildApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/phone/i)
  })

  it('returns 503 when FX conversion fails', async () => {
    mockConvertToKes.mockRejectedValueOnce(new Error('FX service down'))
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                // idempotency DB miss
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })   // merchant
      .mockResolvedValueOnce({ rows: [CONSUMER_ROW] })   // consumer

    const app = buildApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/exchange rate/i)
  })
})

// ── POST /api/v1/consumers/p2p-token ─────────────────────────────────────────

describe('POST /api/v1/consumers/p2p-token', () => {
  it('returns 404 when consumer not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-token')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send({})

    expect(res.status).toBe(404)
  })

  it('issues a P2P token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, display_name: 'Jane Doe' }] })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-token')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send({ amountCents: 10000 })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.displayName).toBe('Jane Doe')
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringMatching(/^consumer:p2p:/),
      90,
      expect.any(String),
    )
  })
})

// ── POST /api/v1/consumers/p2p-pay ───────────────────────────────────────────

describe('POST /api/v1/consumers/p2p-pay', () => {
  const PAYEE_ID  = 'cccccccc-cccc-4ccc-dcdc-cccccccccccc'
  const validBody = {
    payeeConsumerId: PAYEE_ID,
    amountCents:     5000,
    idempotencyKey:  IDEM_KEY,
    timestamp:       TIMESTAMP,
    source:          'P2P_QR',
  }

  it('returns 503 when PLATFORM_MERCHANT_ID is not configured', async () => {
    const saved = process.env.PLATFORM_MERCHANT_ID
    delete process.env.PLATFORM_MERCHANT_ID

    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                     // p2p idempotency miss
      .mockResolvedValueOnce({ rows: [{ id: PAYEE_ID, display_name: null }] }) // payee lookup
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] }) // payer

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    process.env.PLATFORM_MERCHANT_ID = saved
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/P2P payments/i)
  })

  it('returns 400 when payer tries to pay themselves', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // p2p idempotency miss
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, display_name: null }] })  // payee found (same as payer)

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send({ ...validBody, payeeConsumerId: CONSUMER_ID })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/yourself/i)
  })

  it('returns 401 when P2P token is expired', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('consumer:p2p:')) return Promise.resolve(null)
      return Promise.resolve(null)
    })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // p2p idempotency miss

    const P2P_TOKEN = 'dddddddd-dddd-4ddd-eded-dddddddddddd'
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send({ p2pToken: P2P_TOKEN, amountCents: 5000, idempotencyKey: IDEM_KEY, timestamp: TIMESTAMP, source: 'P2P_NFC' })

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/expired/i)
  })

  it('creates P2P payment and returns 201', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // p2p idempotency miss
      .mockResolvedValueOnce({ rows: [{ id: PAYEE_ID, display_name: 'Bob' }] })    // payee
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] }) // payer
      .mockResolvedValueOnce({ rows: [{ id: 'platform-merchant-id', name: 'OrchestrateP2P' }] }) // platform merchant
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                             // INSERT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                             // INSERT p2p_transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                             // UPDATE STK_SENT

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('STK_SENT')
    expect(res.body.p2pTxnId).toBeDefined()
  })

  it('returns idempotency DB hit when p2p_transactions already has this key', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'p2p-existing', status: 'STK_SENT' }],
    })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('STK_SENT')
    expect(res.body.p2pTxnId).toBe('p2p-existing')
  })

  it('returns 400 when p2pToken preset amount differs from body amount', async () => {
    const P2P_TOKEN = 'dddddddd-dddd-4ddd-eded-dddddddddddd'
    const tokenData = JSON.stringify({ consumerId: PAYEE_ID, displayName: 'Bob', amountCents: 9999 })
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('consumer:p2p:')) return Promise.resolve(tokenData)
      return Promise.resolve(null)
    })
    mockQuery.mockResolvedValueOnce({ rows: [] })  // p2p idempotency miss

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send({ p2pToken: P2P_TOKEN, amountCents: 5000, idempotencyKey: IDEM_KEY, timestamp: TIMESTAMP, source: 'P2P_NFC' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/amount mismatch/i)
  })

  it('returns 404 when payeeConsumerId is not found in DB', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // p2p idempotency miss
      .mockResolvedValueOnce({ rows: [] })  // payee not found

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/payee.*not found/i)
  })

  it('returns 404 when payer consumer is not found in DB', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                           // p2p idempotency miss
      .mockResolvedValueOnce({ rows: [{ id: PAYEE_ID, display_name: 'Bob' }] })     // payee found
      .mockResolvedValueOnce({ rows: [] })                                            // payer not found

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/payer.*not found/i)
  })

  it('returns 503 when platform merchant is inactive or missing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                           // p2p idempotency miss
      .mockResolvedValueOnce({ rows: [{ id: PAYEE_ID, display_name: 'Bob' }] })     // payee
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] }) // payer
      .mockResolvedValueOnce({ rows: [] })                                            // platform merchant not found

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/P2P payments/i)
  })

  it('returns 503 when FX conversion fails for p2p payment', async () => {
    mockConvertToKes.mockRejectedValueOnce(new Error('FX service down'))
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                           // p2p idempotency miss
      .mockResolvedValueOnce({ rows: [{ id: PAYEE_ID, display_name: 'Bob' }] })     // payee
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] }) // payer
      .mockResolvedValueOnce({ rows: [{ id: 'platform-merchant-id', name: 'OrchestrateP2P' }] }) // platform

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/exchange rate/i)
  })

  it('returns 502 when STK Push fails for p2p payment', async () => {
    mockStkPush.mockResolvedValue({ success: false, errorMessage: 'Daraja timeout' })
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                           // p2p idempotency miss
      .mockResolvedValueOnce({ rows: [{ id: PAYEE_ID, display_name: 'Bob' }] })     // payee
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] }) // payer
      .mockResolvedValueOnce({ rows: [{ id: 'platform-merchant-id', name: 'OrchestrateP2P' }] }) // platform
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                             // INSERT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                             // INSERT p2p_transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                             // UPDATE txn FAILED
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                             // UPDATE p2p FAILED

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .set('Authorization', `Bearer ${consumerToken()}`)
      .send(validBody)

    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/m-pesa/i)
  })
})

// ── GET /api/v1/consumers/transactions/:txnId/status ─────────────────────────

describe('GET /api/v1/consumers/transactions/:txnId/status', () => {
  it('returns 404 when transaction not found or belongs to another consumer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/consumers/transactions/txn-missing/status')
      .set('Authorization', `Bearer ${consumerToken()}`)

    expect(res.status).toBe(404)
  })

  it('returns cached status via Redis fast path', async () => {
    const txnIndex = JSON.stringify({ txnId: 'txn-1', idempotencyKey: IDEM_KEY })
    const cached   = JSON.stringify({ status: 'CONFIRMED', txnId: 'txn-1', mpesaRef: 'MP001' })

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'txn-1', status: 'CONFIRMED', mpesa_receipt: 'MP001', amount_cents: 5000,
               mpesa_result_desc: null, idempotency_key: IDEM_KEY, merchant_name: 'Test Shop' }],
    })
    mockRedisGet.mockImplementation((key: string) => {
      if (key === `txn:txn-1`)                return Promise.resolve(txnIndex)
      if (key.startsWith('idempotency:'))     return Promise.resolve(cached)
      return Promise.resolve(null)
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/consumers/transactions/txn-1/status')
      .set('Authorization', `Bearer ${consumerToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
  })

  it('returns DB status when Redis has no cache', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'txn-1', status: 'STK_SENT', mpesa_receipt: null,
               amount_cents: 5000, mpesa_result_desc: null,
               idempotency_key: IDEM_KEY, merchant_name: 'Test Shop' }],
    })

    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/consumers/transactions/txn-1/status')
      .set('Authorization', `Bearer ${consumerToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('STK_SENT')
    expect(res.body.merchantName).toBe('Test Shop')
  })
})

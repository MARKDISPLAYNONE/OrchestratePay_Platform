/**
 * Targeted tests for uncovered branches in route handlers, jobs, and integrations.
 * Covers all remaining gaps identified in the Istanbul/Jest coverage report.
 */
import request from 'supertest'
import express from 'express'
import jwt     from 'jsonwebtoken'

process.env.JWT_SECRET   = 'test-secret'
process.env.ADMIN_SECRET = 'test-admin'
process.env.NODE_ENV     = 'test'

// ── Auth middleware mock (bypass JWT + device binding for all route tests) ─────
// Variables starting with 'mock' are hoisted by Jest alongside jest.mock calls.
const mockRequireAuth = jest.fn()
const mockRequireConsumerAuth = jest.fn()

jest.mock('../middleware/auth', () => ({
  requireAuth:             (...args: any[]) => mockRequireAuth(...args),
  requireConsumerAuth:     (...args: any[]) => mockRequireConsumerAuth(...args),
  requireApprovedMerchant: (_req: any, _res: any, next: any) => next(),
  DEVICE_CACHE_TTL_S:      9 * 60 * 60,
  requireRole: jest.fn().mockImplementation(() => (_req: any, _res: any, next: any) => next()),
}))

// ── Shared mock fns ───────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: {
    query:   (...args: any[]) => mockQuery(...args),
    connect: jest.fn(),
  },
}))

const mockRedisGet     = jest.fn()
const mockRedisSetex   = jest.fn()
const mockRedisDel     = jest.fn()
const mockRedisPublish = jest.fn()
const mockRedisExists  = jest.fn()
const mockRedisIncr    = jest.fn()
const mockRedisExpire  = jest.fn()
jest.mock('../db/redis', () => ({
  redis: {
    get:     (...args: any[]) => mockRedisGet(...args),
    setex:   (...args: any[]) => mockRedisSetex(...args),
    del:     (...args: any[]) => mockRedisDel(...args),
    publish: (...args: any[]) => mockRedisPublish(...args),
    exists:  (...args: any[]) => mockRedisExists(...args),
    incr:    (...args: any[]) => mockRedisIncr(...args),
    expire:  (...args: any[]) => mockRedisExpire(...args),
  },
}))

const mockBcryptCompare = jest.fn()
const mockBcryptHash    = jest.fn()
jest.mock('bcrypt', () => ({
  compare:   (...args: any[]) => mockBcryptCompare(...args),
  hash:      (...args: any[]) => mockBcryptHash(...args),
  getRounds: jest.fn().mockReturnValue(12),
}))

const mockDeriveMerchantSigningKey = jest.fn().mockReturnValue('test-signing-key')
jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: (...args: any[]) => mockDeriveMerchantSigningKey(...args),
  buildSignedUri:           (...args: any[]) => mockBuildSignedUri(...args),
  verifyTagSignature:       jest.fn().mockReturnValue(true),
}))

const mockBuildSignedUri = jest.fn().mockReturnValue('nfc://tag/signed')

jest.mock('../util/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

jest.mock('../integrations/africas-talking', () => ({
  sendSms:     jest.fn().mockResolvedValue({ success: true }),
  SmsTemplate: {
    paymentConfirmed: jest.fn().mockReturnValue('SMS confirmed'),
    digitalReceipt:   jest.fn().mockReturnValue('SMS receipt'),
    paymentDeclined:  jest.fn().mockReturnValue('SMS declined'),
    deviceAlert:      jest.fn().mockReturnValue('SMS alert'),
  },
}))

jest.mock('../integrations/daraja', () => ({
  stkPush:                jest.fn().mockResolvedValue({ CheckoutRequestID: 'chk-1', resultCode: 0 }),
  stkQuery:               jest.fn().mockResolvedValue({ resultCode: 0 }),
  getDarajaCircuitStatus: jest.fn().mockReturnValue('CLOSED'),
}))

jest.mock('../util/fcm', () => ({
  sendFcmNotification: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../util/fraud', () => ({
  scoreFraud: jest.fn().mockResolvedValue({ score: 0, reasons: [], blocked: false }),
}))

jest.mock('../util/cbk-compliance', () => ({
  checkCbkCompliance: jest.fn().mockResolvedValue({ allowed: true, usedCents: 0, limitCents: 1000000, tier: 'BASIC' }),
}))

jest.mock('../util/merchant-limits', () => ({
  checkMerchantLimits: jest.fn().mockResolvedValue({ allowed: true }),
}))

jest.mock('../util/fx', () => ({
  getRate:              jest.fn().mockResolvedValue(130),
  convertToKes:         jest.fn().mockResolvedValue({ kesAmountCents: 5000, fxRate: 130 }),
  isSupportedCurrency:  jest.fn().mockReturnValue(true),
  refreshAllRates:      jest.fn().mockResolvedValue(5),
}))

jest.mock('../util/loyalty', () => ({
  awardLoyaltyPoints: jest.fn().mockResolvedValue({ pointsDelta: 5, stampsDelta: 0 }),
  isRepeatCustomer:   jest.fn().mockResolvedValue(false),
}))

jest.mock('../integrations/etims', () => ({
  submitFiscalInvoice: jest.fn().mockResolvedValue({ success: true }),
}))

jest.mock('../jobs/gl-posting', () => ({
  enqueueGlPosting: jest.fn().mockResolvedValue(undefined),
  runGlPostingJob:  jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../util/latency-tracker', () => ({
  parseTapTimestamp: jest.fn().mockReturnValue(null),
  recordLatency:     jest.fn().mockResolvedValue(undefined),
}))

// ── Test IDs and JWTs ─────────────────────────────────────────────────────────

const MERCHANT_ID       = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const CONSUMER_ID       = 'c1c2c3c4-d1d2-4e1e-f1f2-a1a2a3a4a5a6'
const PAYEE_CONSUMER_ID = 'd1d2d3d4-e1e2-4f1f-a1a2-b1b2b3b4b5b6'
const DEVICE_ID         = 'device-001'
const TAG_UUID          = 'b1b2b3b4-c1c2-4d1d-e1e2-f1f2f3f4f5f6'
const IDEMPOTENCY_KEY   = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'  // 32 valid hex chars

const MERCHANT_ROW = {
  id:              MERCHANT_ID,
  name:            'Test Merchant',
  password_hash:   '$2b$12$hash',
  active:          true,
  device_id:       DEVICE_ID,
  kra_pin:         null,
  approval_status: 'APPROVED',
}

beforeEach(() => {
  jest.clearAllMocks()
  // Reset once-queues so failed tests don't pollute subsequent tests
  mockQuery.mockReset()
  mockRedisGet.mockReset()
  // Default: null (auth lockout = not locked; idempotency = no cache)
  mockRedisGet.mockResolvedValue(null)
  mockRedisSetex.mockResolvedValue('OK')
  mockRedisDel.mockResolvedValue(1)
  mockRedisPublish.mockResolvedValue(1)
  mockRedisExists.mockResolvedValue(0)
  mockRedisIncr.mockResolvedValue(1)
  mockRedisExpire.mockResolvedValue(1)
  mockBcryptCompare.mockResolvedValue(true)
  mockBcryptHash.mockResolvedValue('$2b$12$hashed')
  // requireAuth injects merchant payload without JWT validation
  mockRequireAuth.mockImplementation((req: any, _res: any, next: any) => {
    req.merchant = { sub: MERCHANT_ID, name: 'Test Merchant', role: 'MERCHANT', deviceId: DEVICE_ID }
    next()
  })
  // requireConsumerAuth injects consumer payload without JWT validation
  mockRequireConsumerAuth.mockImplementation((req: any, _res: any, next: any) => {
    req.consumer = { sub: CONSUMER_ID, name: 'TestUser', role: 'CONSUMER' }
    next()
  })
})

function waitAsync() {
  return new Promise(r => setImmediate(r))
}

// ═════════════════════════════════════════════════════════════════════════════
// routes/auth.ts — catch blocks and missing branches
// ═════════════════════════════════════════════════════════════════════════════

function buildAuthApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/auth', require('../routes/auth').default)
  return app
}

describe('routes/auth.ts — missing catch blocks and branches', () => {
  // ── Merchant login ──────────────────────────────────────────────────────────

  it('line 140: warns when NFC_SIGNING_SECRET not configured at login', async () => {
    mockDeriveMerchantSigningKey.mockImplementationOnce(() => {
      throw new Error('NFC_SIGNING_SECRET is not set')
    })
    // Sequence: checkLockout(redis.get)→null, SELECT merchant, UPDATE device_id,
    //           INSERT refresh token, writeAuditLog
    mockQuery
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })     // SELECT merchant
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })    // UPDATE device_id
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })    // INSERT refresh token
      .mockResolvedValue({ rows: [], rowCount: 1 })        // writeAuditLog

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password123', deviceId: DEVICE_ID })

    // Still succeeds — NFC key just omitted
    expect(res.status).toBe(200)
    const { logger } = require('../util/logger')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('NFC_SIGNING_SECRET'))
  })

  it('lines 156-157: returns 500 when db.query throws during merchant login', async () => {
    // checkLockout redis.get → null (default), then first db.query THROWS
    mockQuery.mockRejectedValueOnce(new Error('DB unavailable'))

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password123', deviceId: DEVICE_ID })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Login failed')
  })

  // ── Merchant refresh ────────────────────────────────────────────────────────

  it('lines 212-213: returns 500 when db.query throws during merchant token refresh', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection reset'))

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Token refresh failed')
  })

  // ── Merchant register ───────────────────────────────────────────────────────

  it('lines 264-265: returns 500 when db.query throws during merchant registration', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB timeout'))

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Merchant', email: 'new@example.com', password: 'password123', phone: '254700000001' })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Registration failed')
  })

  // ── Merchant logout ─────────────────────────────────────────────────────────

  it('line 291: returns 500 when db.query throws during merchant logout', async () => {
    // requireAuth is mocked → sets req.merchant, calls next
    // Route: UPDATE merchants SET device_id = NULL → THROWS → 500
    mockQuery.mockRejectedValueOnce(new Error('DB gone'))

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set({ Authorization: `Bearer ${jwt.sign({ sub: MERCHANT_ID, role: 'MERCHANT', deviceId: DEVICE_ID }, 'test-secret')}` })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Logout failed')
  })

  // ── Consumer register ───────────────────────────────────────────────────────

  it('line 317: returns 400 when consumer registration password is too short', async () => {
    // Route first queries for existing consumers, THEN checks password length
    mockQuery.mockResolvedValueOnce({ rows: [] }) // no existing consumer with that phone

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/register')
      .send({ phone: '254700000001', password: 'short' })  // 5 chars < 8

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('8 characters')
  })

  it('lines 341-342: returns 500 when db.query throws during consumer registration', async () => {
    // First db.query (SELECT existing consumers) THROWS → catch → 500
    mockQuery.mockRejectedValueOnce(new Error('INSERT failed'))

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/register')
      .send({ phone: '254700000001' })  // no password → password block skipped

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Registration failed')
  })

  // ── Consumer login ──────────────────────────────────────────────────────────

  it('lines 393-394: returns 500 when db.query throws during consumer login', async () => {
    // checkLockout redis.get → null (default, not locked), then db.query THROWS
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'))

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/login')
      .send({ email: 'user@example.com', password: 'password123' })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Login failed')
  })

  // ── Consumer OTP request ────────────────────────────────────────────────────

  it('lines 451-452: returns 500 when db.query throws during OTP request', async () => {
    // redis.get(rateKey) → null (default, not rate-limited), then db.query THROWS
    mockQuery.mockRejectedValueOnce(new Error('Query timeout'))

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/request')
      .send({ phone: '254700000001' })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to send OTP')
  })

  // ── Consumer OTP verify ─────────────────────────────────────────────────────

  it('lines 504-505: returns 500 when db.query throws during OTP verify', async () => {
    // redis.get(otp key) → valid OTP, then db.query THROWS
    mockRedisGet.mockResolvedValue('123456')

    mockQuery.mockRejectedValueOnce(new Error('consumer SELECT failed'))

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/verify')
      .send({ phone: '254700000001', otp: '123456' })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('OTP verification failed')
  })

  // ── Consumer token refresh ──────────────────────────────────────────────────

  it('lines 552-553: returns 500 when db.query throws during consumer token refresh', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Pool exhausted'))

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/refresh')
      .send({ refreshToken: 'some-refresh-token' })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Token refresh failed')
  })

  // ── Consumer logout ─────────────────────────────────────────────────────────

  it('line 574: returns 500 when db.query throws during consumer logout', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB write failed'))

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/logout')
      .send({ refreshToken: 'some-refresh-token' })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Logout failed')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/accounting.ts — 404 on missing rows (lines 121, 166)
// ═════════════════════════════════════════════════════════════════════════════

function buildAccountingApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/accounting', require('../routes/accounting').default)
  return app
}

describe('routes/accounting.ts — 404 branches (lines 121, 166)', () => {
  it('line 121: PATCH /integrations/:platform/settings → 404 when no matching integration', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] })

    const app = buildAccountingApp()
    const res = await request(app)
      .patch('/api/v1/accounting/integrations/quickbooks/settings')
      .send({ settings: { companyId: 'qb-123' } })

    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Integration not found')
  })

  it('line 166: POST /gl-postings/:id/retry → 404 when no failed posting found', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] })

    const app = buildAccountingApp()
    const res = await request(app)
      .post('/api/v1/accounting/gl-postings/nonexistent-id/retry')

    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Failed GL posting not found')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/consumers.ts — branch gaps (lines 286, 418-419, 477, 500)
// ═════════════════════════════════════════════════════════════════════════════

function buildConsumersApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/consumers', require('../routes/consumers').default)
  return app
}

describe('routes/consumers.ts — branch gaps', () => {
  it('line 286: POST /pay/:merchantId → 400 for unsupported currency', async () => {
    const { isSupportedCurrency } = require('../util/fx')
    isSupportedCurrency.mockReturnValueOnce(false)

    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // idempotency DB check
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, approval_status: 'APPROVED', active: true, name: 'Shop' }] })
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] })

    const app = buildConsumersApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .send({ amountCents: 5000, idempotencyKey: IDEMPOTENCY_KEY, timestamp: Date.now(), currency: 'KES' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Unsupported currency')
  })

  it('lines 418-419: POST /p2p-pay → 200 on idempotency Redis cache hit', async () => {
    const cachedResult = JSON.stringify({ status: 'CONFIRMED', txnId: 'txn-cached', mpesaRef: 'ABC' })
    mockRedisGet.mockResolvedValueOnce(cachedResult)

    const app = buildConsumersApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .send({
        payeeConsumerId: PAYEE_CONSUMER_ID,
        amountCents:     5000,
        idempotencyKey:  IDEMPOTENCY_KEY,
        timestamp:       Date.now(),
        source:          'P2P_QR',
      })

    expect(res.status).toBe(200)
    expect(res.body.txnId).toBe('txn-cached')
  })

  it('line 477: POST /p2p-pay → 422 when payer has no phone number on file', async () => {
    process.env.PLATFORM_MERCHANT_ID = 'platform-merchant-id'
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // no existing p2p txn
      .mockResolvedValueOnce({ rows: [{ id: PAYEE_CONSUMER_ID, display_name: 'Payee' }] })
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: null }] })  // payer → no phone

    const app = buildConsumersApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .send({
        payeeConsumerId: PAYEE_CONSUMER_ID,
        amountCents:     5000,
        idempotencyKey:  IDEMPOTENCY_KEY,
        timestamp:       Date.now(),
        source:          'P2P_QR',
      })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('No M-Pesa phone number')
    delete process.env.PLATFORM_MERCHANT_ID
  })

  it('line 500: POST /p2p-pay → 400 for unsupported currency', async () => {
    const { isSupportedCurrency } = require('../util/fx')
    isSupportedCurrency.mockReturnValueOnce(false)

    process.env.PLATFORM_MERCHANT_ID = 'platform-merchant-id'
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // no existing
      .mockResolvedValueOnce({ rows: [{ id: PAYEE_CONSUMER_ID, display_name: 'Payee' }] })
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] })  // payer has phone
      .mockResolvedValueOnce({ rows: [{ id: 'platform-merchant-id', name: 'Platform' }] })

    const app = buildConsumersApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .send({
        payeeConsumerId: PAYEE_CONSUMER_ID,
        amountCents:     5000,
        idempotencyKey:  IDEMPOTENCY_KEY,
        timestamp:       Date.now(),
        source:          'P2P_QR',
        currency:        'KES',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Unsupported currency')
    delete process.env.PLATFORM_MERCHANT_ID
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/devices.ts — evaluateAlerts branches (lines 86, 89, 93, 117)
// ═════════════════════════════════════════════════════════════════════════════

function buildDevicesApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/devices', require('../routes/devices').default)
  return app
}

describe('routes/devices.ts — evaluateAlerts branch gaps', () => {
  function mockDeviceMocks(alertRows = { rowCount: 1 }) {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'device-uuid' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ phone: '254700000001' }] })
      .mockResolvedValue(alertRows)
  }

  it('line 86: triggers "Printer overheating" alert for printerStatus=5', async () => {
    mockDeviceMocks()

    const app = buildDevicesApp()
    const res = await request(app)
      .post('/api/v1/devices/telemetry')
      .send({ deviceSerial: 'SN-001', printerStatus: 5 })

    expect(res.status).toBe(200)
    const alertInsert = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('device_alerts') && String(c[1]?.[2]).includes('overheating')
    )
    expect(alertInsert).toBeTruthy()
  })

  it('line 89: triggers "Storage low" alert for storageFreeBytes < 500MB', async () => {
    mockDeviceMocks()

    const app = buildDevicesApp()
    const res = await request(app)
      .post('/api/v1/devices/telemetry')
      .send({ deviceSerial: 'SN-002', storageFreeBytes: 200_000_000 })

    expect(res.status).toBe(200)
    const alertInsert = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('device_alerts') && String(c[1]?.[2]).includes('Storage low')
    )
    expect(alertInsert).toBeTruthy()
  })

  it('line 93: triggers "App update required" alert for outdated appVersionCode', async () => {
    process.env.MIN_APP_VERSION_CODE = '100'
    mockDeviceMocks()

    const app = buildDevicesApp()
    const res = await request(app)
      .post('/api/v1/devices/telemetry')
      .send({ deviceSerial: 'SN-003', appVersionCode: 50 })

    expect(res.status).toBe(200)
    const alertInsert = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('device_alerts') && String(c[1]?.[2]).includes('update required')
    )
    expect(alertInsert).toBeTruthy()
    delete process.env.MIN_APP_VERSION_CODE
  })

  it('line 117: swallows error when alert INSERT throws', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'device-uuid' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ phone: '254700000001' }] })
      .mockRejectedValueOnce(new Error('DB constraint violation'))

    const app = buildDevicesApp()
    const res = await request(app)
      .post('/api/v1/devices/telemetry')
      .send({ deviceSerial: 'SN-004', printerStatus: 4 })

    expect(res.status).toBe(200)
    const { logger } = require('../util/logger')
    expect(logger.error).toHaveBeenCalledWith('Alert insert failed', expect.any(Object))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/loyalty.ts — ROLLBACK on error (lines 126-127)
// ═════════════════════════════════════════════════════════════════════════════

function buildLoyaltyApp() {
  const app = express()
  app.use(express.json())

  const router = require('../routes/loyalty').default

  // Express 4 does not auto-catch async route handler throws.
  // Patch each route layer to forward rejected Promises to next(err).
  router.stack.forEach((layer: any) => {
    if (!layer.route) return
    layer.route.stack.forEach((rl: any) => {
      const orig = rl.handle
      rl.handle = function wrapAsync(req: any, res: any, next: any) {
        const result = orig.call(this, req, res, next)
        if (result && typeof result.catch === 'function') result.catch(next)
      }
    })
  })

  app.use('/api/v1/loyalty', router)
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: err.message })
  })
  return app
}

describe('routes/loyalty.ts — ROLLBACK on transaction error (lines 126-127)', () => {
  it('calls ROLLBACK and re-throws when redemption UPDATE fails', async () => {
    const mockClientQuery   = jest.fn()
    const mockClientRelease = jest.fn()

    // Balance query via db.query (pool)
    mockQuery.mockResolvedValueOnce({ rows: [{ points_balance: 100, stamps_balance: 0 }] })

    const { db } = require('../db/index')
    db.connect.mockResolvedValueOnce({
      query:   mockClientQuery,
      release: mockClientRelease,
    })

    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })               // BEGIN
      .mockRejectedValueOnce(new Error('UPDATE failed')) // UPDATE throws → catch
      .mockResolvedValueOnce({ rows: [] })               // ROLLBACK

    const app = buildLoyaltyApp()

    // Express 4 does not auto-catch async re-throws, so no HTTP response is sent.
    // Use a short timeout to let the route handler run, then verify ROLLBACK was called.
    try {
      await request(app)
        .post('/api/v1/loyalty/redeem')
        .send({ consumerId: CONSUMER_ID, redeemPoints: 10, redeemStamps: 0 })
        .timeout(300)
    } catch {
      // Timeout expected — route throws without responding
    }

    const rollbackCall = mockClientQuery.mock.calls.find(
      (c: any[]) => String(c[0]).includes('ROLLBACK')
    )
    expect(rollbackCall).toBeTruthy()
    expect(mockClientRelease).toHaveBeenCalled()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/merchants.ts — mpesaAccountRef and kraPin updates (lines 120-122)
// ═════════════════════════════════════════════════════════════════════════════

function buildMerchantsApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/merchants', require('../routes/merchants').default)
  return app
}

describe('routes/merchants.ts — dynamic field update branches (lines 120-122)', () => {
  it('lines 120-122: includes mpesaAccountRef and kraPin in dynamic UPDATE SET', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id:               MERCHANT_ID, name: 'Test Shop',
        phone:            '254700000001', email: 'shop@example.com',
        mpesa_shortcode:  '123456', mpesa_account_ref: 'NEWREF',
        kra_pin:          'A001234567B', active: true, updated_at: new Date().toISOString(),
      }],
    })

    const app = buildMerchantsApp()
    const res = await request(app)
      .put('/api/v1/merchants/me')
      .send({ mpesaAccountRef: 'NEWREF', kraPin: 'A001234567B' })

    expect(res.status).toBe(200)
    const updateCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('UPDATE merchants') &&
      String(c[0]).includes('mpesa_account_ref') &&
      String(c[0]).includes('kra_pin')
    )
    expect(updateCall).toBeTruthy()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/mpesa-callback.ts — branch gaps (lines 98, 264, 283, 297-321, 336)
// ═════════════════════════════════════════════════════════════════════════════

function buildCallbackApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/mpesa-callback', require('../routes/mpesa-callback').default)
  return app
}

const BASE_TXN = {
  id:              'txn-cb-1',
  status:          'STK_SENT',
  amount_cents:    5000,
  idempotency_key: 'ik-cb-1',
  merchant_id:     MERCHANT_ID,
  consumer_id:     CONSUMER_ID,
  source:          'NFC_TAG',
  kra_pin:         null,
  merchant_name:   'Test Shop',
  consumer_phone:  '254700000001',
  sms_opt_in:      false,
  fcm_token:       null,
}

// Callback body WITHOUT MpesaReceiptNumber — triggers all `mpesaReceipt ?? ''` branches
const SUCCESS_NO_RECEIPT = {
  Body: {
    stkCallback: {
      MerchantRequestID: 'req-nr-1',
      CheckoutRequestID: 'ws_CO_NORECEIPTTESTID',
      ResultCode:        0,
      ResultDesc:        'Success',
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 50 },
          { Name: 'TransactionDate', Value: 20260115120000 },
          // MpesaReceiptNumber intentionally ABSENT → mpesaReceipt = undefined
        ],
      },
    },
  },
}

describe('routes/mpesa-callback.ts — branch gaps', () => {
  it('line 98: callbackLogId = null when INSERT daraja_callback_log returns empty rows (?? null)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // INSERT callback_log returns EMPTY
      .mockResolvedValueOnce({ rows: [BASE_TXN] })   // SELECT transaction
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildCallbackApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_NO_RECEIPT)

    await waitAsync()
    await waitAsync()
    const confirmCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'CONFIRMED'")
    )
    expect(confirmCall).toBeTruthy()
  }, 15000)

  it('lines 264, 300, 321: covers mpesaReceipt ?? "" branches — sms_opt_in + missing MpesaReceiptNumber', async () => {
    const txnWithSms = { ...BASE_TXN, sms_opt_in: true }
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-nr' }] })
      .mockResolvedValueOnce({ rows: [txnWithSms] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildCallbackApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_NO_RECEIPT)

    await waitAsync()
    await waitAsync()

    const { enqueueGlPosting } = require('../jobs/gl-posting')
    expect(enqueueGlPosting).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(Number),
      'KES', '', expect.any(String)
    )
  })

  it('lines 283, 297: covers mpesaReceipt ?? "" in kra_pin + SOFTPOS_MOBILE branches', async () => {
    const txnSoftPos = {
      ...BASE_TXN,
      source:   'SOFTPOS_MOBILE',
      kra_pin:  'A001234567B',
      sms_opt_in: false,
    }
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-sp' }] })
      .mockResolvedValueOnce({ rows: [txnSoftPos] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildCallbackApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_NO_RECEIPT)

    await waitAsync()
    await waitAsync()

    const { SmsTemplate } = require('../integrations/africas-talking')
    expect(SmsTemplate.digitalReceipt).toHaveBeenCalledWith(
      expect.any(Number), expect.any(String), '', expect.any(String)
    )

    const { submitFiscalInvoice } = require('../integrations/etims')
    expect(submitFiscalInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ mpesaReceipt: '' }), expect.anything()
    )
  })

  it('line 336: covers mpesaReceipt ?? "" in FCM data when fcm_token is set', async () => {
    mockRedisExists.mockResolvedValue(0)
    const txnFcm = { ...BASE_TXN, fcm_token: 'fcm-tok-1' }
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-fcm' }] })
      .mockResolvedValueOnce({ rows: [txnFcm] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildCallbackApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_NO_RECEIPT)

    await waitAsync()
    await waitAsync()

    const { sendFcmNotification } = require('../util/fcm')
    expect(sendFcmNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mpesaRef: '' }),
      })
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/payment-links.ts — PAYMENT_LINK_BASE_URL env var (line 54 ?? branch)
// ═════════════════════════════════════════════════════════════════════════════

function buildPaymentLinksApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/payment-links', require('../routes/payment-links').default)
  return app
}

describe('routes/payment-links.ts — PAYMENT_LINK_BASE_URL env var (line 54)', () => {
  it('uses PAYMENT_LINK_BASE_URL when env var is set (non-null branch)', async () => {
    process.env.PAYMENT_LINK_BASE_URL = 'https://custom.pay.example.com'

    const app = buildPaymentLinksApp()
    const res = await request(app)
      .post('/api/v1/payment-links')
      .send({ amountCents: 5000, description: 'Test link' })

    expect(res.status).toBe(201)
    expect(res.body.url).toContain('https://custom.pay.example.com')

    delete process.env.PAYMENT_LINK_BASE_URL
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/split-payments.ts — description ?? null (line 77)
// ═════════════════════════════════════════════════════════════════════════════

function buildSplitPaymentsApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/split-payments', require('../routes/split-payments').default)
  return app
}

describe('routes/split-payments.ts — description ?? null (line 77)', () => {
  it('stores null when description is not provided in split session', async () => {
    const app = buildSplitPaymentsApp()
    const res = await request(app)
      .post('/api/v1/split-payments')
      .send({
        totalAmountCents: 5000,
        // NO description field → description ?? null fires at line 77
        participants: [
          { name: 'Alice', phone: '254700000001', shareCents: 2500 },
          { name: 'Bob',   phone: '254700000002', shareCents: 2500 },
        ],
      })

    expect(res.status).toBe(201)
    const setexCall = mockRedisSetex.mock.calls[0]
    const session = JSON.parse(setexCall[2])
    expect(session.description).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/tags.ts — NFC signing error → 503 (lines 68-69, 86)
// ═════════════════════════════════════════════════════════════════════════════

function buildTagsApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/tags', require('../routes/tags').default)
  return app
}

describe('routes/tags.ts — NFC signing error → 503 (lines 68-69, 86)', () => {
  it('lines 68-69: POST /sign returns 503 when buildSignedUri throws with NFC_SIGNING_SECRET', async () => {
    mockBuildSignedUri.mockImplementationOnce(() => {
      throw new Error('NFC_SIGNING_SECRET is not configured')
    })
    mockQuery.mockResolvedValueOnce({ rows: [{ tag_id: TAG_UUID }] })

    const app = buildTagsApp()
    const res = await request(app)
      .post('/api/v1/tags/sign')
      .send({ merchantId: MERCHANT_ID, tagId: TAG_UUID })

    expect(res.status).toBe(503)
    expect(res.body.error).toContain('NFC signing not configured')
  })

  it('line 86: GET /signing-key returns 503 when deriveMerchantSigningKey throws with NFC_SIGNING_SECRET', async () => {
    mockDeriveMerchantSigningKey.mockImplementationOnce(() => {
      throw new Error('NFC_SIGNING_SECRET is not set on this server')
    })

    const app = buildTagsApp()
    const res = await request(app)
      .get('/api/v1/tags/signing-key')

    expect(res.status).toBe(503)
    expect(res.body.error).toContain('NFC signing not configured')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/transactions.ts — consumer not found branches (lines 191, 201, 239)
// ═════════════════════════════════════════════════════════════════════════════

function buildTransactionsApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/transactions', require('../routes/transactions').default)
  return app
}

describe('routes/transactions.ts — consumer not found branches (lines 191, 201, 239)', () => {
  const BASE_TXN_BODY = {
    merchantId:     MERCHANT_ID,
    amountCents:    5000,
    idempotencyKey: IDEMPOTENCY_KEY,
    timestamp:      Date.now(),
  }

  it('line 191: returns 404 when QR_CODE consumer account not found', async () => {
    const consumerQrToken = 'f1f2f3f4-a1a2-4b1b-c1c2-d1d2d3d4d5d6'
    const qrBody = { ...BASE_TXN_BODY, source: 'QR_CODE', consumerQrToken }

    mockRedisGet
      .mockResolvedValueOnce(null)                                        // no idempotency cache
      .mockResolvedValueOnce(JSON.stringify('consumer-not-found'))        // QR token found → consumerId string

    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                // idempotency DB check
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, name: 'Shop', approval_status: 'APPROVED' }] }) // merchant
      .mockResolvedValueOnce({ rows: [] })                                // SELECT consumer → not found

    const app = buildTransactionsApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .send(qrBody)

    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Consumer account not found')
  })

  it('line 201: returns 404 when MERCHANT_HCE consumer not found', async () => {
    const merchantHceToken = 'e1e2e3e4-f1f2-4a1a-b1b2-c1c2c3c4c5c6'
    const hceBody = { ...BASE_TXN_BODY, source: 'MERCHANT_HCE', merchantHceToken }

    const hceSession = { merchantId: MERCHANT_ID, consumerId: 'ghost-consumer', amountCents: 5000 }
    mockRedisGet
      .mockResolvedValueOnce(null)                           // no idempotency cache
      .mockResolvedValueOnce(JSON.stringify(hceSession))     // HCE token found

    mockQuery
      .mockResolvedValueOnce({ rows: [] })                   // idempotency DB check
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, name: 'Shop', approval_status: 'APPROVED' }] }) // merchant
      .mockResolvedValueOnce({ rows: [] })                   // SELECT consumer → not found

    const app = buildTransactionsApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .send(hceBody)

    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Consumer not found')
  })

  it('line 239: returns 404 when NFC tagId not found in nfc_tags', async () => {
    const nfcBody = { ...BASE_TXN_BODY, source: 'NFC_TAG', tagId: 'TAG-UNKNOWN' }

    mockRedisGet.mockResolvedValueOnce(null)  // no idempotency cache

    mockQuery
      .mockResolvedValueOnce({ rows: [] })                   // idempotency DB check
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, name: 'Shop', approval_status: 'APPROVED' }] }) // merchant
      .mockResolvedValueOnce({ rows: [] })                   // SELECT nfc_tags → empty → 404

    const app = buildTransactionsApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .send(nfcBody)

    expect(res.status).toBe(404)
    expect(res.body.error).toContain('NFC tag not registered or inactive')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/auth.ts — consumer register with password (line 317: bcrypt.hash)
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/auth.ts — consumer register with valid password (line 317)', () => {
  it('hashes the password when length >= 8 (covers bcrypt.hash call)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // SELECT existing consumers → none
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001', email: null, display_name: 'Alice' }] })
      .mockResolvedValueOnce({ rows: [] })   // issueRefreshToken INSERT

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/register')
      .send({ phone: '254700000001', password: 'validpass' })  // 9 chars >= 8

    expect(res.status).toBe(201)
    expect(mockBcryptHash).toHaveBeenCalledWith('validpass', expect.any(Number))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/tags.ts — non-NFC errors → 500 (lines 68-69, 86)
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/tags.ts — non-NFC signing errors → 500', () => {
  it('POST /sign → 500 when buildSignedUri throws a non-NFC-secret error', async () => {
    mockBuildSignedUri.mockImplementationOnce(() => {
      throw new Error('Internal cryptography failure')
    })
    mockQuery.mockResolvedValueOnce({ rows: [{ tag_id: TAG_UUID }] })

    const app = buildTagsApp()
    const res = await request(app)
      .post('/api/v1/tags/sign')
      .send({ merchantId: MERCHANT_ID, tagId: TAG_UUID })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to sign tag')
  })

  it('GET /signing-key → 500 when deriveMerchantSigningKey throws a non-NFC-secret error', async () => {
    mockDeriveMerchantSigningKey.mockImplementationOnce(() => {
      throw new Error('Key derivation failure')
    })

    const app = buildTagsApp()
    const res = await request(app)
      .get('/api/v1/tags/signing-key')

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to derive signing key')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/transactions.ts — MERCHANT_HCE session expired (line 201 → 401)
// and QR_CODE consumer found (line 191 = consumer assignment)
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/transactions.ts — additional branch coverage', () => {
  const BASE_TXN_BODY = {
    merchantId:     MERCHANT_ID,
    amountCents:    5000,
    idempotencyKey: IDEMPOTENCY_KEY,
    timestamp:      Date.now(),
  }

  it('line 201: returns 401 when MERCHANT_HCE session has expired (redis returns null for hce key)', async () => {
    const merchantHceToken = 'e1e2e3e4-f1f2-4a1a-b1b2-c1c2c3c4c5c6'
    const hceBody = { ...BASE_TXN_BODY, source: 'MERCHANT_HCE', merchantHceToken }

    // redis.get: idempotency miss, then HCE key → null (expired)
    mockRedisGet
      .mockResolvedValueOnce(null)  // idempotency cache miss
      .mockResolvedValueOnce(null)  // HCE key expired → 401

    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // idempotency DB check
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, name: 'Shop', approval_status: 'APPROVED' }] })

    const app = buildTransactionsApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .send(hceBody)

    expect(res.status).toBe(401)
    expect(res.body.error).toContain('HCE session expired')
  })

  it('line 191: QR_CODE consumer assignment runs when consumer is found (then fails currency check)', async () => {
    const consumerQrToken = 'f1f2f3f4-a1a2-4b1b-c1c2-d1d2d3d4d5d6'
    const qrBody = { ...BASE_TXN_BODY, source: 'QR_CODE', consumerQrToken, currency: 'USD' }

    mockRedisGet
      .mockResolvedValueOnce(null)          // idempotency miss
      .mockResolvedValueOnce(CONSUMER_ID)   // QR token → consumerId

    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // idempotency DB
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, name: 'Shop', approval_status: 'APPROVED' }] })
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] })  // consumer found

    const { isSupportedCurrency } = require('../util/fx')
    isSupportedCurrency.mockReturnValueOnce(false)  // exit early after line 191

    const app = buildTransactionsApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .send(qrBody)

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Unsupported currency')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/accounting.ts — rowCount null branches (lines 121, 166)
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/accounting.ts — rowCount null ?? 0 branches (lines 121, 166)', () => {
  it('line 121: PATCH settings → 404 when rowCount is null (not 0)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null, rows: [] })

    const app = buildAccountingApp()
    const res = await request(app)
      .patch('/api/v1/accounting/integrations/quickbooks/settings')
      .send({ settings: { companyId: 'qb-123' } })

    expect(res.status).toBe(404)
  })

  it('line 166: POST retry → 404 when rowCount is null (not 0)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null, rows: [] })

    const app = buildAccountingApp()
    const res = await request(app)
      .post('/api/v1/accounting/gl-postings/some-id/retry')

    expect(res.status).toBe(404)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/loyalty.ts — branch gaps (line 75: null values, line 121: stamps-only)
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/loyalty.ts — additional branch coverage', () => {
  it('line 75: ?? null branches fire when points_per_ksh and reward_description are absent', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'prog-1', programme_type: 'STAMPS', points_per_ksh: null, stamps_for_reward: 10 }],
    })

    const app = buildLoyaltyApp()
    // STAMPS programme: stamps_for_reward required; points_per_ksh and reward_description omitted
    // → points_per_ksh ?? null fires (undefined → null)
    // → reward_description ?? null fires (undefined → null)
    const res = await request(app)
      .post('/api/v1/loyalty/programme')
      .send({ programme_type: 'STAMPS', stamps_for_reward: 10 })

    expect(res.status).toBe(201)
  })

  it('line 121: stamps-only branch of ternary (stamps > 0, points = 0)', async () => {
    const mockClientQuery   = jest.fn()
    const mockClientRelease = jest.fn()

    const { db } = require('../db/index')
    db.connect.mockResolvedValueOnce({
      query:   mockClientQuery,
      release: mockClientRelease,
    })

    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockResolvedValueOnce({ rows: [{ points_balance: 0, stamps_balance: 20 }] })  // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [] })  // UPDATE loyalty_balances
      .mockResolvedValueOnce({ rows: [] })  // INSERT loyalty_ledger (stamps branch)
      .mockResolvedValueOnce({ rows: [] })  // COMMIT

    const app = buildLoyaltyApp()
    const res = await request(app)
      .post('/api/v1/loyalty/redeem')
      .send({ consumerId: CONSUMER_ID, redeemPoints: 0, redeemStamps: 5 })

    expect(res.status).toBe(200)
    // The ledger INSERT description should use the stamps branch
    const insertCall = mockClientQuery.mock.calls.find(
      (c: any[]) => String(c[0]).includes('INSERT INTO loyalty_ledger')
    )
    expect(insertCall[1][4]).toContain('stamps')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/merchants.ts — mpesaShortcode branch (line 120)
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/merchants.ts — mpesaShortcode update branch (line 120)', () => {
  it('includes mpesa_shortcode in dynamic UPDATE when mpesaShortcode is provided', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: MERCHANT_ID, name: 'Shop', mpesa_shortcode: '174379', updated_at: new Date() }],
    })

    const app = buildMerchantsApp()
    const res = await request(app)
      .put('/api/v1/merchants/me')
      .send({ mpesaShortcode: '174379' })

    expect(res.status).toBe(200)
    const updateCall = mockQuery.mock.calls[0]
    expect(String(updateCall[0])).toContain('mpesa_shortcode')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/transactions.ts — line 283: compliance.reason ?? 'Daily...' (missing reason)
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/transactions.ts — compliance.reason ?? default (line 283)', () => {
  it('uses fallback message when checkCbkCompliance returns allowed:false with no reason', async () => {
    const { checkCbkCompliance } = require('../util/cbk-compliance')
    checkCbkCompliance.mockResolvedValueOnce({ allowed: false })  // no reason property

    mockRedisGet
      .mockResolvedValueOnce(null)          // idempotency cache miss
      .mockResolvedValueOnce(CONSUMER_ID)   // QR token → consumerId

    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // idempotency DB miss
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, name: 'Shop', approval_status: 'APPROVED' }] })
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] })  // consumer

    const app = buildTransactionsApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .send({
        merchantId:     MERCHANT_ID,
        amountCents:    5000,
        idempotencyKey: IDEMPOTENCY_KEY,
        timestamp:      Date.now(),
        source:         'QR_CODE',
        consumerQrToken: 'f1f2f3f4-a1a2-4b1b-c1c2-d1d2d3d4d5d6',
      })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Daily transaction limit reached')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/transactions.ts — line 337: fxRate === 1 ? null : fxRate
// Requires a full success path with fxRate=1 (KES payment, no conversion needed).
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/transactions.ts — fxRate===1 null branch (line 337)', () => {
  it('stores null fx_rate when convertToKes returns fxRate=1 (KES payment)', async () => {
    const { convertToKes } = require('../util/fx')
    convertToKes.mockResolvedValueOnce({ kesAmountCents: 5000, fxRate: 1 })

    const { stkPush } = require('../integrations/daraja')
    stkPush.mockResolvedValueOnce({ success: true, checkoutRequestId: 'chk-kes', merchantRequestId: 'mr-kes' })

    mockRedisGet
      .mockResolvedValueOnce(null)          // idempotency cache miss
      .mockResolvedValueOnce(CONSUMER_ID)   // QR token

    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // idempotency DB miss
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, name: 'Shop', approval_status: 'APPROVED' }] })
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] })  // consumer
      .mockResolvedValueOnce({ rows: [] })  // INSERT transaction
      .mockResolvedValueOnce({ rows: [] })  // UPDATE to STK_SENT

    const app = buildTransactionsApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .send({
        merchantId:      MERCHANT_ID,
        amountCents:     5000,
        currency:        'KES',
        idempotencyKey:  IDEMPOTENCY_KEY,
        timestamp:       Date.now(),
        source:          'QR_CODE',
        consumerQrToken: 'f1f2f3f4-a1a2-4b1b-c1c2-d1d2d3d4d6d7',
      })

    expect(res.status).toBe(201)
    // When fxRate===1, the INSERT's $10 param should be null
    const insertCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO transactions')
    )
    expect(insertCall).toBeTruthy()
    expect(insertCall![1][9]).toBeNull()  // fx_rate param is null when fxRate===1
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/transactions.ts — line 412: tapTs !== null ? apiArrivalMs - tapTs : null
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/transactions.ts — tapTs non-null branch (line 412)', () => {
  it('computes apiRoundTripMs when parseTapTimestamp returns a numeric timestamp', async () => {
    const { parseTapTimestamp } = require('../util/latency-tracker')
    parseTapTimestamp.mockReturnValueOnce(Date.now() - 200)

    const { stkPush } = require('../integrations/daraja')
    stkPush.mockResolvedValueOnce({ success: true, checkoutRequestId: 'chk-tap', merchantRequestId: 'mr-tap' })

    mockRedisGet
      .mockResolvedValueOnce(null)         // idempotency cache miss
      .mockResolvedValueOnce(CONSUMER_ID)  // QR token

    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // idempotency DB miss
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, name: 'Shop', approval_status: 'APPROVED' }] })
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] })
      .mockResolvedValueOnce({ rows: [] })  // INSERT transaction
      .mockResolvedValueOnce({ rows: [] })  // UPDATE to STK_SENT

    const app = buildTransactionsApp()
    const res = await request(app)
      .post('/api/v1/transactions')
      .send({
        merchantId:      MERCHANT_ID,
        amountCents:     5000,
        idempotencyKey:  IDEMPOTENCY_KEY,
        timestamp:       Date.now(),
        source:          'QR_CODE',
        consumerQrToken: 'f1f2f3f4-a1a2-4b1b-c1c2-d1d2d3d4d8e8',
      })

    expect(res.status).toBe(201)
    const { recordLatency } = require('../util/latency-tracker')
    // apiRoundTripMs should be a positive number (non-null), not null
    expect(recordLatency).toHaveBeenCalledWith(
      expect.objectContaining({ apiRoundTripMs: expect.any(Number) })
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/transactions.ts — GET /:id/status: line 477 (CONFIRMED branch)
//                                            line 536 (short phone < 7 chars)
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/transactions.ts — GET /:id/status branch coverage', () => {
  it('line 477: omits reason when txn.status is CONFIRMED (takes the undefined branch)', async () => {
    mockRedisGet.mockResolvedValueOnce(null)  // txn index cache miss
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id:               'txn-conf-1',
        status:           'CONFIRMED',
        mpesa_result_desc: 'Success',
        mpesa_receipt:    'QA0T5EXAMPLE',
        amount_cents:     5000,
        merchant_name:    'Test Shop',
        consumer_phone:   '254700000001',
      }],
    })

    const app = buildTransactionsApp()
    const res = await request(app).get('/api/v1/transactions/txn-conf-1/status')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
    expect(res.body).not.toHaveProperty('reason')
  })

  it('line 536: maskPhone returns "****" when phone shorter than 7 chars', async () => {
    mockRedisGet.mockResolvedValueOnce(null)  // txn index cache miss
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id:               'txn-short-1',
        status:           'PENDING',
        mpesa_result_desc: null,
        mpesa_receipt:    null,
        amount_cents:     5000,
        merchant_name:    'Test Shop',
        consumer_phone:   '12345',  // 5 chars — shorter than 7
      }],
    })

    const app = buildTransactionsApp()
    const res = await request(app).get('/api/v1/transactions/txn-short-1/status')

    expect(res.status).toBe(200)
    expect(res.body.consumerPhone).toBe('****')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/mpesa-callback.ts — lines 309-310: loyaltyResult?.pointsDelta ?? 0
// when awardLoyaltyPoints returns null
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/mpesa-callback.ts — loyaltyResult null ?? 0 (lines 309-310)', () => {
  it('uses 0 for loyalty deltas when awardLoyaltyPoints returns null', async () => {
    const { awardLoyaltyPoints } = require('../util/loyalty')
    awardLoyaltyPoints.mockResolvedValueOnce(null)

    const txn = {
      ...BASE_TXN,
      sms_opt_in: false,
    }
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-ly' }] })   // INSERT callback log
      .mockResolvedValueOnce({ rows: [txn] })                 // SELECT transaction
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildCallbackApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send({
        Body: {
          stkCallback: {
            MerchantRequestID: 'req-ly-1',
            CheckoutRequestID: 'ws_CO_LOYALTYNULL',
            ResultCode:        0,
            ResultDesc:        'Success',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount',              Value: 50 },
                { Name: 'MpesaReceiptNumber',  Value: 'QA0TLYALTY1' },
                { Name: 'TransactionDate',     Value: 20260115120000 },
              ],
            },
          },
        },
      })

    await waitAsync()
    await waitAsync()

    expect(mockRedisPublish).toHaveBeenCalledWith(
      expect.stringContaining('txn:confirmed:'),
      expect.stringContaining('"loyaltyPoints":0')
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/consumers.ts — line 74: display_name ?? null (when display_name is null)
//                        line 146: consumer.phone ? ... : null (when phone is null)
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/consumers.ts — display_name and phone null branches', () => {
  it('line 74: displayName is null when consumer has no display_name', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CONSUMER_ID, display_name: null, phone: '254700000001' }],
    })

    const app = buildConsumersApp()
    const res = await request(app)
      .get(`/api/v1/consumers/c/${CONSUMER_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.displayName).toBeNull()
  })

  it('line 146: maskedPhone is null when consumer.phone is null in GET /me', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CONSUMER_ID, phone: null, email: null, display_name: null,
               email_verified: false, sms_opt_in: false, created_at: new Date() }],
    })

    const app = buildConsumersApp()
    const res = await request(app)
      .get('/api/v1/consumers/me')

    expect(res.status).toBe(200)
    expect(res.body.phone).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/consumers.ts — line 190: parseInt(limit) || 50 default branch
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/consumers.ts — me/transactions default limit (line 190)', () => {
  it('defaults to limit=50 when no limit query param is provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const app = buildConsumersApp()
    const res = await request(app).get('/api/v1/consumers/me/transactions')

    expect(res.status).toBe(200)
    expect(res.body.limit).toBe(50)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/consumers.ts — line 307: fxRate===1 ? null : fxRate in consumer QR pay
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/consumers.ts — consumer QR pay fxRate branches (line 307)', () => {
  it('stores non-null fx_rate when convertToKes returns fxRate≠1 (covers fxRate branch)', async () => {
    // Default mock: convertToKes returns { kesAmountCents: 5000, fxRate: 130 }
    const { stkPush } = require('../integrations/daraja')
    stkPush.mockResolvedValueOnce({ success: true, checkoutRequestId: 'chk-c2', merchantRequestId: 'mr-c2' })

    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // idempotency DB miss
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, name: 'Shop', approval_status: 'APPROVED', active: true }] })
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] })
      .mockResolvedValueOnce({ rows: [] })  // INSERT
      .mockResolvedValueOnce({ rows: [] })  // UPDATE STK_SENT

    const app = buildConsumersApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .send({ amountCents: 5000, idempotencyKey: IDEMPOTENCY_KEY, timestamp: Date.now() })

    expect(res.status).toBe(201)
    const insertCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO transactions')
    )
    expect(insertCall![1][7]).toBe(130)  // fxRate=130 stored when fxRate≠1
  })

  it('stores null fx_rate when consumer pays with KES (fxRate=1)', async () => {
    const { convertToKes } = require('../util/fx')
    convertToKes.mockResolvedValueOnce({ kesAmountCents: 5000, fxRate: 1 })

    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // idempotency DB miss
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, name: 'Shop', approval_status: 'APPROVED', active: true }] })
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] })  // consumer phone lookup
      .mockResolvedValueOnce({ rows: [] })  // INSERT transaction
      .mockResolvedValueOnce({ rows: [] })  // UPDATE txn FAILED (stkPush mock lacks success:true)

    const app = buildConsumersApp()
    const res = await request(app)
      .post(`/api/v1/consumers/pay/${MERCHANT_ID}`)
      .send({ amountCents: 5000, idempotencyKey: IDEMPOTENCY_KEY, timestamp: Date.now() })

    // The default stkPush mock returns {CheckoutRequestID, resultCode} with no `success` → 502
    expect(res.status).toBe(502)

    const insertCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO transactions')
    )
    // $8 param (index 7) = fxRate === 1 ? null : fxRate → null
    expect(insertCall![1][7]).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/consumers.ts — lines 384, 393: p2p-token null display_name and
//                                         missing amountCents → null
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/consumers.ts — p2p-token branch coverage (lines 384, 393)', () => {
  it('stores null displayName and null amountCents when omitted from request', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CONSUMER_ID, display_name: null }],
    })

    const app = buildConsumersApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-token')
      .send({})  // no amountCents — Joi allows null/absent

    expect(res.status).toBe(200)
    expect(res.body.displayName).toBeNull()

    const setexCall = mockRedisSetex.mock.calls[0]
    const stored = JSON.parse(setexCall[2])
    expect(stored.displayName).toBeNull()
    expect(stored.amountCents).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/consumers.ts — lines 521, 537: p2p-pay fxRate=1 and null payeeDisplayName
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/consumers.ts — p2p-pay fxRate branches + null payeeDisplayName (lines 521, 537)', () => {
  it('stores non-null fx_rate when fxRate≠1 (covers fxRate branch of line 521)', async () => {
    process.env.PLATFORM_MERCHANT_ID = 'platform-merchant-id'
    // Default convertToKes mock returns fxRate=130

    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // p2p_transactions idempotency miss
      .mockResolvedValueOnce({ rows: [{ id: PAYEE_CONSUMER_ID, display_name: 'Bob' }] })
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'platform-merchant-id', name: 'Platform' }] })
      .mockResolvedValueOnce({ rows: [] })  // INSERT transaction (fx_rate=130)
      .mockResolvedValueOnce({ rows: [] })  // INSERT p2p_transaction
      .mockResolvedValueOnce({ rows: [] })  // UPDATE FAILED
      .mockResolvedValueOnce({ rows: [] })  // UPDATE p2p FAILED

    const app = buildConsumersApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .send({
        payeeConsumerId: PAYEE_CONSUMER_ID,
        amountCents:     5000,
        idempotencyKey:  IDEMPOTENCY_KEY,
        timestamp:       Date.now(),
        source:          'P2P_QR',
      })

    expect(res.status).toBe(502)
    const insertTxnCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO transactions')
    )
    expect(insertTxnCall![1][8]).toBe(130)  // fxRate=130 stored

    delete process.env.PLATFORM_MERCHANT_ID
  })

  it('stores null fx_rate and uses "P2P Transfer" description when payee has no display_name', async () => {
    process.env.PLATFORM_MERCHANT_ID = 'platform-merchant-id'

    const { convertToKes } = require('../util/fx')
    convertToKes.mockResolvedValueOnce({ kesAmountCents: 5000, fxRate: 1 })

    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // p2p_transactions idempotency miss
      .mockResolvedValueOnce({ rows: [{ id: PAYEE_CONSUMER_ID, display_name: null }] })  // payee (null name)
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, phone: '254700000001' }] })       // payer
      .mockResolvedValueOnce({ rows: [{ id: 'platform-merchant-id', name: 'Platform' }] }) // platform merchant
      .mockResolvedValueOnce({ rows: [] })  // INSERT transactions (fx_rate = null for fxRate=1)
      .mockResolvedValueOnce({ rows: [] })  // INSERT p2p_transactions
      .mockResolvedValueOnce({ rows: [] })  // UPDATE transactions FAILED
      .mockResolvedValueOnce({ rows: [] })  // UPDATE p2p_transactions FAILED

    const app = buildConsumersApp()
    const res = await request(app)
      .post('/api/v1/consumers/p2p-pay')
      .send({
        payeeConsumerId: PAYEE_CONSUMER_ID,
        amountCents:     5000,
        idempotencyKey:  IDEMPOTENCY_KEY,
        timestamp:       Date.now(),
        source:          'P2P_QR',
      })

    // Default stkPush mock has no success:true → 502 failure path
    expect(res.status).toBe(502)

    const insertTxnCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO transactions')
    )
    // $9 param (index 8) = fxRate === 1 ? null : fxRate → null
    expect(insertTxnCall![1][8]).toBeNull()

    const { stkPush } = require('../integrations/daraja')
    expect(stkPush).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'P2P Transfer' })
    )

    delete process.env.PLATFORM_MERCHANT_ID
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/consumers.ts — line 627: CONFIRMED branch in /transactions/:txnId/status
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/consumers.ts — /transactions/:txnId/status CONFIRMED (line 627)', () => {
  it('omits reason field when transaction status is CONFIRMED', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id:                'txn-conf-c1',
        status:            'CONFIRMED',
        mpesa_receipt:     'QA0TCONF1',
        amount_cents:      5000,
        mpesa_result_desc: 'Success',
        idempotency_key:   IDEMPOTENCY_KEY,
        merchant_name:     'Test Shop',
      }],
    })
    mockRedisGet.mockResolvedValueOnce(null)  // no txn index cache

    const app = buildConsumersApp()
    const res = await request(app)
      .get('/api/v1/consumers/transactions/txn-conf-c1/status')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
    expect(res.body).not.toHaveProperty('reason')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/auth.ts — line 197: device_id ?? '' when device_id is null
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/auth.ts — merchant refresh device_id null (line 197)', () => {
  it('uses empty string device_id when device_id column is null in merchant refresh', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id:              'tok-id',
          merchant_id:     MERCHANT_ID,
          name:            'Test Merchant',
          active:          true,
          device_id:       null,     // null triggers device_id ?? '' branch
          approval_status: 'APPROVED',
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE revoke old token
      .mockResolvedValueOnce({ rows: [] })               // INSERT new refresh token

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/auth.ts — line 329: display_name ?? consumer.phone in consumer register
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/auth.ts — consumer register display_name null (line 329)', () => {
  it('uses phone as JWT name when consumer has no display_name after register', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // SELECT existing → none
      .mockResolvedValueOnce({
        rows: [{ id: CONSUMER_ID, phone: '254700000001', email: null, display_name: null }],
      })  // INSERT returns null display_name → triggers ?? consumer.phone
      .mockResolvedValueOnce({ rows: [] })  // issueRefreshToken INSERT

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/register')
      .send({ phone: '254700000001' })

    expect(res.status).toBe(201)
    expect(res.body.token).toBeDefined()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/auth.ts — line 366: consumer && consumer.password_hash falsy (null hash)
//                  line 381: display_name ?? consumer.phone in consumer login
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/auth.ts — consumer email login branch coverage', () => {
  it('line 366: uses dummy bcrypt timing hash when consumer.password_hash is null', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CONSUMER_ID, display_name: 'Alice', phone: '254700000001',
               password_hash: null, active: true }],
    })
    mockBcryptCompare.mockResolvedValueOnce(false)  // dummy hash never matches → 401

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/login')
      .send({ email: 'alice@example.com', password: 'wrongpass' })

    expect(res.status).toBe(401)
    expect(mockBcryptCompare).toHaveBeenCalledWith(
      'wrongpass',
      '$2b$10$invalidhashfortimingprotection'
    )
  })

  it('line 381: uses phone as JWT name when display_name is null on successful login', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: CONSUMER_ID, display_name: null, phone: '254700000001',
                 password_hash: '$2b$12$hash', active: true }],
      })
      .mockResolvedValueOnce({ rows: [] })  // issueRefreshToken INSERT
    // mockBcryptCompare defaults to true (set in beforeEach)

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/login')
      .send({ email: 'alice@example.com', password: 'correctpass' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/auth.ts — line 490: display_name ?? consumer.phone in OTP verify
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/auth.ts — consumer OTP verify display_name null (line 490)', () => {
  it('uses phone as JWT name when display_name is null after OTP verify', async () => {
    const OTP = '654321'
    mockRedisGet.mockResolvedValueOnce(OTP)  // otp:{phone} → stored OTP

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: CONSUMER_ID, display_name: null, phone: '254700000001', active: true }],
      })
      .mockResolvedValueOnce({ rows: [] })  // issueRefreshToken INSERT

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/verify')
      .send({ phone: '254700000001', otp: OTP })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/auth.ts — line 540: display_name ?? phone in consumer token refresh
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/auth.ts — consumer token refresh display_name null (line 540)', () => {
  it('uses phone as JWT name when display_name is null in consumer refresh', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id:           'tok-id-c',
          consumer_id:  CONSUMER_ID,
          display_name: null,
          phone:        '254700000001',
          active:       true,
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE revoke
      .mockResolvedValueOnce({ rows: [] })               // issueRefreshToken INSERT

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/refresh')
      .send({ refreshToken: 'valid-consumer-refresh' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/auth.ts — line 612: rowCount ?? 0 when rowCount is null (admin approve)
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/auth.ts — admin approve rowCount null (line 612)', () => {
  it('returns 404 when UPDATE rowCount is null (merchant not found)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null, rows: [] })

    const app = buildAuthApp()
    const res = await request(app)
      .post(`/api/v1/auth/admin/approve/${MERCHANT_ID}`)
      .set('x-admin-secret', 'test-admin')
      .send({ action: 'approve' })

    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Merchant not found')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/devices.ts — line 113: (rowCount ?? 0) > 0 when rowCount is null
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/devices.ts — alert rowCount null skips SMS (line 113)', () => {
  it('does not send SMS when alert INSERT rowCount is null (ON CONFLICT DO NOTHING)', async () => {
    const { sendSms } = require('../integrations/africas-talking')

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'device-uuid' }] })         // SELECT device by serial
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                  // UPDATE last_heartbeat
      .mockResolvedValueOnce({ rows: [{ phone: '254700000001' }] })      // SELECT merchant phone
      .mockResolvedValue({ rowCount: null, rows: [] })                    // alert INSERT → null rowCount

    const app = buildDevicesApp()
    const res = await request(app)
      .post('/api/v1/devices/telemetry')
      .send({ deviceSerial: 'SN-001', printerStatus: 5 })  // triggers "Printer overheating"

    expect(res.status).toBe(200)
    // (null ?? 0) = 0 which is NOT > 0, so SMS must NOT be sent
    expect(sendSms).not.toHaveBeenCalled()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/devices.ts — line 114: sendSms().catch(() => {}) fires when sendSms rejects
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/devices.ts — sendSms catch swallows error (line 114)', () => {
  it('continues normally when sendSms rejects on new device alert', async () => {
    const { sendSms } = require('../integrations/africas-talking')
    sendSms.mockRejectedValueOnce(new Error('SMS service unavailable'))

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'dev-sms-catch' }] })       // SELECT device by serial
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                   // UPDATE last_heartbeat
      .mockResolvedValueOnce({ rows: [{ phone: '254700000001' }] })       // SELECT merchant phone
      .mockResolvedValue({ rowCount: 1, rows: [] })                        // alert INSERT → rowCount=1 → SMS triggered

    const app = buildDevicesApp()
    const res = await request(app)
      .post('/api/v1/devices/telemetry')
      .send({ deviceSerial: 'SN-002', printerStatus: 5 })  // triggers "Printer overheating"

    await waitAsync()

    expect(res.status).toBe(200)
    expect(sendSms).toHaveBeenCalled()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/accounting.ts — line 171: runGlPostingJob().catch(() => {}) fires
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/accounting.ts — runGlPostingJob catch swallows error (line 171)', () => {
  it('returns 200 when runGlPostingJob rejects on retry (non-blocking catch)', async () => {
    const { runGlPostingJob } = require('../jobs/gl-posting')
    runGlPostingJob.mockRejectedValueOnce(new Error('GL job crash'))

    // Route does ONE db.query: UPDATE gl_postings SET status='PENDING' WHERE id=$1 AND merchant_id=$2
    // rowCount must be > 0 to proceed past the 404 check
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] })

    const app = buildAccountingApp()
    const res = await request(app)
      .post(`/api/v1/accounting/gl-postings/${MERCHANT_ID}/retry`)
      .set('Authorization', `Bearer ${jwt.sign({ sub: MERCHANT_ID, role: 'MERCHANT', deviceId: DEVICE_ID }, 'test-secret')}`)

    await waitAsync()  // flush the non-blocking Promise rejection

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/payment-links.ts — line 147: redis.setex().catch(() => {}) fires
// when restoring a single-use link after transaction INSERT failure
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/payment-links.ts — setex catch swallows error on link restore (line 147)', () => {
  it('returns 500 and swallows setex rejection when single-use link restore fails', async () => {
    const linkPayload = {
      merchantId:  MERCHANT_ID,
      amountCents: 5000,
      singleUse:   true,
      description: 'Test catch link',
      expiresAt:   null,
    }
    const rawLink = JSON.stringify(linkPayload)

    mockRedisGet
      .mockResolvedValueOnce(null)     // idempotency key: not cached
      .mockResolvedValueOnce(rawLink)  // payment:link:{token}: found

    mockRedisDel.mockResolvedValueOnce(1)  // single-use del → 1 (deleted)
    mockQuery.mockRejectedValueOnce(new Error('DB INSERT failed'))  // transaction INSERT throws
    // setex to restore the link rejects → line 147 catch swallows it
    mockRedisSetex.mockRejectedValueOnce(new Error('setex restore failed'))

    const app = buildPaymentLinksApp()
    const res = await request(app)
      .post('/api/v1/payment-links/catch-test-token/pay')
      .send({ consumerPhone: '254700000001', idempotencyKey: IDEMPOTENCY_KEY })

    expect(res.status).toBe(500)
    expect(mockRedisSetex).toHaveBeenCalledWith(
      'payment:link:catch-test-token',
      60,
      rawLink
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// routes/auth.ts — redis .catch() handlers in helper functions
// lines 54, 60, 61, 65, 72, 415, 465
// ═════════════════════════════════════════════════════════════════════════════

describe('routes/auth.ts — redis .catch() handlers in login helpers', () => {
  it('line 54: redis.get rejects in checkLockout — falls back to null (login proceeds)', async () => {
    // checkLockout: redis.get rejects → .catch(() => null) → null → not locked
    mockRedisGet.mockRejectedValueOnce(new Error('Redis down'))
    // clearFailedAttempts uses mockRedisDel (default resolves)
    mockQuery
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })     // SELECT merchant
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })    // UPDATE device_id
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })    // INSERT refresh token
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password123', deviceId: DEVICE_ID })

    expect(res.status).toBe(200)
  })

  it('line 60: redis.incr rejects in recordFailedAttempt — falls back to 0 (no lockout)', async () => {
    // Password mismatch → recordFailedAttempt called → incr rejects → count=0 → no lockout
    // Must use a password ≥ 8 chars so Joi validates it; bcryptCompare mock returns false
    mockBcryptCompare.mockResolvedValueOnce(false)
    mockRedisIncr.mockRejectedValueOnce(new Error('Redis incr failed'))
    mockQuery
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword123', deviceId: DEVICE_ID })

    expect(res.status).toBe(401)
  })

  it('line 61: redis.expire rejects in recordFailedAttempt — swallowed (returns 401)', async () => {
    // Password mismatch → recordFailedAttempt → incr=1 → expire rejects → swallowed
    mockBcryptCompare.mockResolvedValueOnce(false)
    mockRedisIncr.mockResolvedValueOnce(1)
    mockRedisExpire.mockRejectedValueOnce(new Error('Redis expire failed'))
    mockQuery
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword123', deviceId: DEVICE_ID })

    expect(res.status).toBe(401)
  })

  it('line 65: redis.setex rejects in recordFailedAttempt lockout path — swallowed', async () => {
    // Password mismatch → incr returns MAX_ATTEMPTS (5) → lockout setex rejects → swallowed
    mockBcryptCompare.mockResolvedValueOnce(false)
    mockRedisIncr.mockResolvedValueOnce(5)  // >= MAX_ATTEMPTS triggers lockout setex
    mockRedisSetex.mockRejectedValueOnce(new Error('Redis setex lockout failed'))
    mockQuery
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword123', deviceId: DEVICE_ID })

    expect(res.status).toBe(401)
  })

  it('line 72: redis.del rejects in clearFailedAttempts — swallowed (login still succeeds)', async () => {
    // Successful login → clearFailedAttempts → redis.del rejects → swallowed
    mockRedisDel.mockRejectedValueOnce(new Error('Redis del failed'))
    mockQuery
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE device_id
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT refresh token
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password123', deviceId: DEVICE_ID })

    expect(res.status).toBe(200)
  })
})

describe('routes/auth.ts — redis .catch() handlers in OTP routes', () => {
  it('line 415: redis.get rejects in OTP rate check — falls back to null (OTP proceeds)', async () => {
    // POST /consumer/otp/request → redis.get(rateKey) rejects → catch → null (not rate-limited)
    mockRedisGet.mockRejectedValueOnce(new Error('Redis rate key failed'))
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID, display_name: 'Alice', active: true }] })  // SELECT consumer by phone

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/request')
      .send({ phone: '254700000001' })

    expect(res.status).toBe(200)
  })

  it('line 465: redis.get rejects in OTP verify — falls back to null (OTP not found → 401)', async () => {
    // POST /consumer/otp/verify → redis.get(otpKey) rejects → catch → null → 401
    mockRedisGet.mockRejectedValueOnce(new Error('Redis OTP key failed'))

    const app = buildAuthApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/verify')
      .send({ phone: '254700000001', otp: '123456' })

    expect(res.status).toBe(401)
    expect(res.body.error).toContain('OTP expired or not found')
  })
})

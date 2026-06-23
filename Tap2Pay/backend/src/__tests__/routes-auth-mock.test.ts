/**
 * Mock-based integration tests for routes/auth.ts.
 * Covers all major paths without requiring a real database.
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET   = 'test-secret'
process.env.ADMIN_SECRET = 'test-admin'
process.env.NODE_ENV     = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockBcryptCompare = jest.fn()
const mockBcryptHash    = jest.fn()
jest.mock('bcrypt', () => ({
  compare: (...args: any[]) => mockBcryptCompare(...args),
  hash:    (...args: any[]) => mockBcryptHash(...args),
  getRounds: jest.fn().mockReturnValue(12),
}))

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockRedisGet    = jest.fn()
const mockRedisSetex  = jest.fn()
const mockRedisDel    = jest.fn()
const mockRedisIncr   = jest.fn()
const mockRedisExpire = jest.fn()
jest.mock('../db/redis', () => ({
  redis: {
    get:    (...args: any[]) => mockRedisGet(...args),
    setex:  (...args: any[]) => mockRedisSetex(...args),
    del:    (...args: any[]) => mockRedisDel(...args),
    incr:   (...args: any[]) => mockRedisIncr(...args),
    expire: (...args: any[]) => mockRedisExpire(...args),
  },
}))

jest.mock('../util/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('test-nfc-signing-key'),
}))

jest.mock('../integrations/africas-talking', () => ({
  sendSms:     jest.fn().mockResolvedValue({ success: true }),
  SmsTemplate: { paymentConfirmed: jest.fn() },
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const CONSUMER_ID = 'b2b3b4b5-c2c3-4d4d-e5e5-f1f2f3f4f5f6'
const ADMIN_HDR   = { 'X-Admin-Secret': 'test-admin' }

function merchantJwt(deviceId = 'device-1') {
  return jwt.sign(
    { sub: MERCHANT_ID, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret', { expiresIn: '1h' }
  )
}

const MERCHANT_ROW = {
  id:               MERCHANT_ID,
  name:             'Test Merchant',
  password_hash:    '$2b$12$hash',
  active:           true,
  device_id:        'device-1',
  kra_pin:          'A001234567B',
  approval_status:  'APPROVED',
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/auth', require('../routes/auth').default)
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: err.message })
  })
  return app
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockBcryptCompare.mockResolvedValue(true)
  mockBcryptHash.mockResolvedValue('$2b$12$hashedpassword')
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('device-1')
    return Promise.resolve(null)   // no lockout, no OTP rate limit
  })
  mockRedisSetex.mockResolvedValue('OK')
  mockRedisDel.mockResolvedValue(1)
  mockRedisIncr.mockResolvedValue(1)
  mockRedisExpire.mockResolvedValue(1)
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/login
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  const VALID_BODY = {
    email:    'merchant@test.com',
    password: 'password123',
    deviceId: 'device-1',
  }

  it('returns 400 when required fields are missing (Joi)', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.com' })   // no password, no deviceId
    expect(res.status).toBe(400)
  })

  it('returns 429 when account is locked out', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('auth:lockout:')) return Promise.resolve('1')
      return Promise.resolve(null)
    })
    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send(VALID_BODY)
    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/locked/i)
  })

  it('returns 401 when merchant not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockBcryptCompare.mockResolvedValue(false)
    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send(VALID_BODY)
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/invalid credentials/i)
  })

  it('returns 401 when password is wrong', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
    mockBcryptCompare.mockResolvedValue(false)
    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send(VALID_BODY)
    expect(res.status).toBe(401)
  })

  it('returns 403 when account is inactive', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...MERCHANT_ROW, active: false }] })
    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send(VALID_BODY)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/deactivated/i)
  })

  it('allows PENDING_REVIEW merchants to log in so they can submit KYC docs', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...MERCHANT_ROW, approval_status: 'PENDING_REVIEW' }] })
      .mockResolvedValueOnce({ rows: [] })   // UPDATE device_id
      .mockResolvedValueOnce({ rows: [] })   // INSERT refresh token
    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send(VALID_BODY)
    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.role).toBe('MERCHANT')
  })

  it('returns 403 when approval_status is REJECTED', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MERCHANT_ROW, approval_status: 'REJECTED' }],
    })
    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send(VALID_BODY)
    expect(res.status).toBe(403)
    expect(res.body.status).toBe('REJECTED')
  })

  it('returns 403 when approval_status is SUSPENDED', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MERCHANT_ROW, approval_status: 'SUSPENDED' }],
    })
    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send(VALID_BODY)
    expect(res.status).toBe(403)
    expect(res.body.status).toBe('SUSPENDED')
  })

  it('returns 200 with token on successful login', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MERCHANT_ROW] })        // SELECT merchant
      .mockResolvedValueOnce({ rows: [] })                     // UPDATE device_id
      .mockResolvedValueOnce({ rows: [] })                     // INSERT refresh token
    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send(VALID_BODY)
    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.refreshToken).toBeDefined()
    expect(res.body.role).toBe('MERCHANT')
    expect(res.body.merchantId).toBe(MERCHANT_ID)
    expect(res.body.nfcSigningKey).toBe('test-nfc-signing-key')
  })

  it('locks account after MAX_ATTEMPTS failed logins', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MERCHANT_ROW] })
    mockBcryptCompare.mockResolvedValue(false)
    mockRedisIncr.mockResolvedValue(5)  // 5th failure — triggers lockout

    await request(buildApp()).post('/api/v1/auth/login').send(VALID_BODY)

    // setex should have been called for the lockout key
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringContaining('auth:lockout:'),
      expect.any(Number),
      '1'
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/refresh
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/refresh', () => {
  it('returns 400 when refreshToken is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/refresh')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 401 for invalid/expired refresh token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const res = await request(buildApp())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid-token' })
    expect(res.status).toBe(401)
  })

  it('returns 403 when merchant is not active', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'rt-1', merchant_id: MERCHANT_ID, name: 'Merchant',
        active: false, device_id: 'dev-1', approval_status: 'APPROVED',
      }],
    })
    const res = await request(buildApp())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' })
    expect(res.status).toBe(403)
  })

  it('rotates refresh token and returns new tokens', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'rt-1', merchant_id: MERCHANT_ID, name: 'Merchant',
          active: true, device_id: 'dev-1', approval_status: 'APPROVED',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })   // UPDATE revoke old token
      .mockResolvedValueOnce({ rows: [] })   // INSERT new refresh token

    const res = await request(buildApp())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.refreshToken).toBeDefined()
    expect(res.body.role).toBe('MERCHANT')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/register
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/register')
      .send({ email: 'a@b.com' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/required/i)
  })

  it('returns 400 when password is too short', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/register')
      .send({ name: 'X', email: 'x@test.com', password: 'short', phone: '0722000001' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/8 characters/i)
  })

  it('returns 409 when email already registered', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing' }] })
    const res = await request(buildApp())
      .post('/api/v1/auth/register')
      .send({ name: 'X', email: 'x@test.com', password: 'password123', phone: '0722000001' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already registered/i)
  })

  it('registers merchant and returns 201 PENDING_REVIEW', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // SELECT check
      .mockResolvedValueOnce({ rows: [{ id: MERCHANT_ID, name: 'Newco', email: 'new@co.com', approval_status: 'PENDING_REVIEW' }] })  // INSERT

    const res = await request(buildApp())
      .post('/api/v1/auth/register')
      .send({ name: 'Newco', email: 'new@co.com', password: 'password123', phone: '0722000001' })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('PENDING_REVIEW')
    expect(res.body.merchantId).toBe(MERCHANT_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/logout
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/logout', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(buildApp()).post('/api/v1/auth/logout')
    expect(res.status).toBe(401)
  })

  it('logs out with optional refresh token revocation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // UPDATE revoke refresh token
      .mockResolvedValueOnce({ rows: [] })   // UPDATE merchant device_id = NULL

    const res = await request(buildApp())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${merchantJwt()}`)
      .send({ refreshToken: 'some-refresh-token' })

    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/logged out/i)
    expect(mockRedisDel).toHaveBeenCalledWith(`merchant:device:${MERCHANT_ID}`)
  })

  it('logs out without refresh token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })  // UPDATE merchant device_id = NULL

    const res = await request(buildApp())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${merchantJwt()}`)
      .send({})

    expect(res.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/consumer/register
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/consumer/register', () => {
  it('returns 400 when phone is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/register')
      .send({ email: 'c@test.com' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/phone is required/i)
  })

  it('returns 400 for invalid phone format', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/register')
      .send({ phone: '0700000001' })  // must start with 254
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/254/i)
  })

  it('returns 400 when password is too short', async () => {
    // Password length check happens after the existing-user DB lookup
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/register')
      .send({ phone: '254700000001', password: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/8 characters/i)
  })

  it('returns 409 when phone already registered', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CONSUMER_ID }] })
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/register')
      .send({ phone: '254700000001' })
    expect(res.status).toBe(409)
  })

  it('registers consumer and returns 201 with token', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // SELECT check
      .mockResolvedValueOnce({
        rows: [{ id: CONSUMER_ID, phone: '254700000001', email: null, display_name: 'Alice' }],
      })  // INSERT consumer
      .mockResolvedValueOnce({ rows: [] })   // INSERT refresh token

    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/register')
      .send({ phone: '254700000001', displayName: 'Alice' })

    expect(res.status).toBe(201)
    expect(res.body.token).toBeDefined()
    expect(res.body.role).toBe('CONSUMER')
    expect(res.body.consumerId).toBe(CONSUMER_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/consumer/login
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/consumer/login', () => {
  it('returns 400 when email or password is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/login')
      .send({ email: 'a@b.com' })
    expect(res.status).toBe(400)
  })

  it('returns 429 when account is locked out', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('auth:lockout:')) return Promise.resolve('1')
      return Promise.resolve(null)
    })
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/login')
      .send({ email: 'c@test.com', password: 'password123' })
    expect(res.status).toBe(429)
  })

  it('returns 401 for wrong password', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CONSUMER_ID, display_name: 'Alice', phone: '254700000001', password_hash: '$2b$12$hash', active: true }],
    })
    mockBcryptCompare.mockResolvedValue(false)
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/login')
      .send({ email: 'c@test.com', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('returns 403 when consumer account is deactivated', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CONSUMER_ID, display_name: 'Alice', phone: '254700000001', password_hash: '$2b$12$hash', active: false }],
    })
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/login')
      .send({ email: 'c@test.com', password: 'password123' })
    expect(res.status).toBe(403)
  })

  it('returns 200 with token on success', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: CONSUMER_ID, display_name: 'Alice', phone: '254700000001', password_hash: '$2b$12$hash', active: true }],
      })
      .mockResolvedValueOnce({ rows: [] })  // INSERT refresh token
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/login')
      .send({ email: 'c@test.com', password: 'password123' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.role).toBe('CONSUMER')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/consumer/otp/request
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/consumer/otp/request', () => {
  it('returns 400 when phone is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/otp/request')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid phone format', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/otp/request')
      .send({ phone: '0700000001' })
    expect(res.status).toBe(400)
  })

  it('returns 429 when OTP was recently requested', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('otp:rate:')) return Promise.resolve('1')
      return Promise.resolve(null)
    })
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/otp/request')
      .send({ phone: '254700000001' })
    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/wait 60 seconds/i)
  })

  it('returns OK silently when phone is not registered', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/otp/request')
      .send({ phone: '254700000001' })
    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/if this number is registered/i)
  })

  it('returns 403 when consumer account is deactivated', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CONSUMER_ID, display_name: 'Alice', active: false }],
    })
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/otp/request')
      .send({ phone: '254700000001' })
    expect(res.status).toBe(403)
  })

  it('sends OTP and returns 200', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CONSUMER_ID, display_name: 'Alice', active: true }],
    })
    const { sendSms } = require('../integrations/africas-talking')
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/otp/request')
      .send({ phone: '254700000001' })
    expect(res.status).toBe(200)
    expect(sendSms).toHaveBeenCalledWith('254700000001', expect.stringContaining('verification code'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/consumer/otp/verify
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/consumer/otp/verify', () => {
  it('returns 400 when phone or otp is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/otp/verify')
      .send({ phone: '254700000001' })
    expect(res.status).toBe(400)
  })

  it('returns 401 when OTP not found or expired', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/otp/verify')
      .send({ phone: '254700000001', otp: '123456' })
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/otp expired/i)
  })

  it('returns 401 for wrong OTP', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'otp:254700000001') return Promise.resolve('654321')
      return Promise.resolve(null)
    })
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/otp/verify')
      .send({ phone: '254700000001', otp: '111111' })
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/invalid otp/i)
  })

  it('verifies OTP and returns JWT', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'otp:254700000001') return Promise.resolve('123456')
      return Promise.resolve(null)
    })
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: CONSUMER_ID, display_name: 'Alice', phone: '254700000001', active: true }],
      })
      .mockResolvedValueOnce({ rows: [] })  // INSERT refresh token

    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/otp/verify')
      .send({ phone: '254700000001', otp: '123456' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.role).toBe('CONSUMER')
    expect(mockRedisDel).toHaveBeenCalledWith('otp:254700000001')
  })

  it('returns 403 when account not found after OTP success', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'otp:254700000001') return Promise.resolve('123456')
      return Promise.resolve(null)
    })
    mockQuery.mockResolvedValueOnce({ rows: [] })  // consumer not found

    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/otp/verify')
      .send({ phone: '254700000001', otp: '123456' })

    expect(res.status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/consumer/refresh
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/consumer/refresh', () => {
  it('returns 400 when refreshToken missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/refresh')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 401 for invalid token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/refresh')
      .send({ refreshToken: 'invalid' })
    expect(res.status).toBe(401)
  })

  it('returns 403 when consumer is inactive', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rt-1', consumer_id: CONSUMER_ID, display_name: 'Alice', phone: '254700000001', active: false }],
    })
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/refresh')
      .send({ refreshToken: 'some-token' })
    expect(res.status).toBe(403)
  })

  it('rotates token and returns new tokens', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'rt-1', consumer_id: CONSUMER_ID, display_name: 'Alice', phone: '254700000001', active: true }],
      })
      .mockResolvedValueOnce({ rows: [] })   // revoke old
      .mockResolvedValueOnce({ rows: [] })   // insert new
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/refresh')
      .send({ refreshToken: 'valid-token' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.role).toBe('CONSUMER')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/consumer/logout
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/consumer/logout', () => {
  it('returns 400 when refreshToken missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/logout')
      .send({})
    expect(res.status).toBe(400)
  })

  it('logs out consumer and returns 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const res = await request(buildApp())
      .post('/api/v1/auth/consumer/logout')
      .send({ refreshToken: 'some-token' })
    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/logged out/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Admin routes
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/auth/admin/pending', () => {
  it('returns 403 without admin secret', async () => {
    const res = await request(buildApp()).get('/api/v1/auth/admin/pending')
    expect(res.status).toBe(403)
  })

  it('returns list of PENDING_REVIEW merchants', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: MERCHANT_ID, name: 'Newco', email: 'new@co.com' }],
    })
    const res = await request(buildApp())
      .get('/api/v1/auth/admin/pending')
      .set(ADMIN_HDR)
    expect(res.status).toBe(200)
    expect(res.body.merchants).toHaveLength(1)
  })
})

describe('POST /api/v1/auth/admin/approve/:merchantId', () => {
  it('returns 400 for invalid action', async () => {
    const res = await request(buildApp())
      .post(`/api/v1/auth/admin/approve/${MERCHANT_ID}`)
      .set(ADMIN_HDR)
      .send({ action: 'archive' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/approve, reject, or suspend/i)
  })

  it('returns 404 when merchant not found', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 })
    const res = await request(buildApp())
      .post(`/api/v1/auth/admin/approve/${MERCHANT_ID}`)
      .set(ADMIN_HDR)
      .send({ action: 'approve' })
    expect(res.status).toBe(404)
  })

  it('approves merchant and returns ok', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })
    const res = await request(buildApp())
      .post(`/api/v1/auth/admin/approve/${MERCHANT_ID}`)
      .set(ADMIN_HDR)
      .send({ action: 'approve', notes: 'Documents verified' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('APPROVED')
  })

  it('rejects merchant and returns ok', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })
    const res = await request(buildApp())
      .post(`/api/v1/auth/admin/approve/${MERCHANT_ID}`)
      .set(ADMIN_HDR)
      .send({ action: 'reject' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('REJECTED')
  })

  it('suspends merchant and returns ok', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })
    const res = await request(buildApp())
      .post(`/api/v1/auth/admin/approve/${MERCHANT_ID}`)
      .set(ADMIN_HDR)
      .send({ action: 'suspend' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('SUSPENDED')
  })
})

// Tests for account lockout: 5 failed logins → 15-minute ban
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET    = 'test-secret'
process.env.ADMIN_SECRET  = 'test-admin'
process.env.NODE_ENV      = 'test'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockRedisGet    = jest.fn()
const mockRedisSet    = jest.fn()
const mockRedisSetex  = jest.fn()
const mockRedisIncr   = jest.fn()
const mockRedisExpire = jest.fn()
const mockRedisDel    = jest.fn()

jest.mock('../db/redis', () => ({
  redis: {
    get:    (...args: any[]) => mockRedisGet(...args),
    set:    (...args: any[]) => mockRedisSet(...args),
    setex:  (...args: any[]) => mockRedisSetex(...args),
    incr:   (...args: any[]) => mockRedisIncr(...args),
    expire: (...args: any[]) => mockRedisExpire(...args),
    del:    (...args: any[]) => mockRedisDel(...args),
  },
}))

jest.mock('../integrations/africas-talking', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
  SmsTemplate: { paymentConfirmed: jest.fn() },
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('test-key'),
}))

jest.mock('../util/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

function buildApp() {
  const app = express()
  app.use(express.json())
  const authRouter = require('../routes/auth').default
  app.use('/api/v1/auth', authRouter)
  return app
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Account lockout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRedisGet.mockResolvedValue(null)
    mockRedisSetex.mockResolvedValue('OK')
    mockRedisIncr.mockResolvedValue(0)
    mockRedisExpire.mockResolvedValue(1)
    mockRedisDel.mockResolvedValue(1)
  })

  it('returns 429 when account is locked out', async () => {
    mockRedisGet.mockResolvedValueOnce('1')  // lockout key exists

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'locked@test.com', password: 'anything', deviceId: 'dev-1' })

    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/temporarily locked/)
  })

  it('increments attempt counter on failed login', async () => {
    mockRedisIncr.mockResolvedValue(1)  // override default 0
    mockQuery.mockResolvedValueOnce({ rows: [] })  // merchant not found

    const app = buildApp()
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'fail@test.com', password: 'wrongpassword1!', deviceId: 'dev-1' })

    expect(mockRedisIncr).toHaveBeenCalledWith('auth:attempts:fail@test.com')
  })

  it('locks account when attempt count reaches MAX_ATTEMPTS', async () => {
    mockRedisIncr.mockResolvedValue(5)     // 5th failure → lockout
    mockQuery.mockResolvedValueOnce({ rows: [] })  // merchant not found

    const app = buildApp()
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'victim@test.com', password: 'wrongpassword1!', deviceId: 'dev-1' })

    // Should have set the lockout key
    const lockoutCall = mockRedisSetex.mock.calls.find(
      (c: any[]) => String(c[0]).startsWith('auth:lockout:')
    )
    expect(lockoutCall).toBeTruthy()
    expect(lockoutCall[1]).toBe(15 * 60)  // 15 min TTL
  })

  it('clears attempt counter on successful login', async () => {
    const bcrypt = require('bcrypt')
    const hash   = await bcrypt.hash('GoodPass1!', 10)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'mid-1', name: 'Merchant', password_hash: hash, active: true, device_id: null, kra_pin: null, approval_status: 'APPROVED' }] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildApp()
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ok@test.com', password: 'GoodPass1!', deviceId: 'dev-1' })

    expect(mockRedisDel).toHaveBeenCalledWith('auth:attempts:ok@test.com')
  })
})

describe('Consumer lockout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRedisGet.mockResolvedValue(null)
    mockRedisSetex.mockResolvedValue('OK')
    mockRedisIncr.mockResolvedValue(0)
    mockRedisExpire.mockResolvedValue(1)
    mockRedisDel.mockResolvedValue(1)
  })

  it('returns 429 when consumer account is locked', async () => {
    mockRedisGet.mockResolvedValueOnce('1')  // lockout key exists

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/login')
      .send({ email: 'locked@consumer.com', password: 'anything' })

    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/temporarily locked/)
  })
})

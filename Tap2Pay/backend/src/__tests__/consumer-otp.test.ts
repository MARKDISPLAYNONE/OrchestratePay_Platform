// Tests for consumer OTP login flow
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET   = 'test-secret'
process.env.ADMIN_SECRET = 'test-admin'
process.env.NODE_ENV     = 'test'
process.env.SMS_ENABLED  = 'false'

const mockQuery      = jest.fn()
const mockRedisGet   = jest.fn()
const mockRedisSetex = jest.fn()
const mockRedisIncr  = jest.fn()
const mockRedisExpire = jest.fn()
const mockRedisDel   = jest.fn()

jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))
jest.mock('../db/redis', () => ({
  redis: {
    get:    (...args: any[]) => mockRedisGet(...args),
    setex:  (...args: any[]) => mockRedisSetex(...args),
    incr:   (...args: any[]) => mockRedisIncr(...args),
    expire: (...args: any[]) => mockRedisExpire(...args),
    del:    (...args: any[]) => mockRedisDel(...args),
  },
}))

const mockSendSms = jest.fn().mockResolvedValue({ success: true })
jest.mock('../integrations/africas-talking', () => ({
  sendSms: (...args: any[]) => mockSendSms(...args),
  SmsTemplate: {},
}))
jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn(),
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

describe('POST /api/v1/auth/consumer/otp/request', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRedisGet.mockResolvedValue(null)
    mockRedisSetex.mockResolvedValue('OK')
    mockRedisIncr.mockResolvedValue(0)
    mockRedisExpire.mockResolvedValue(1)
    mockRedisDel.mockResolvedValue(1)
    mockSendSms.mockResolvedValue({ success: true })
  })

  it('returns 400 for missing phone', async () => {
    const app = buildApp()
    const res = await request(app).post('/api/v1/auth/consumer/otp/request').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/phone is required/)
  })

  it('returns 400 for invalid phone format', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/request')
      .send({ phone: '0712345678' })  // not 254-prefixed
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/254XXXXXXXXX/)
  })

  it('returns 429 if OTP was already requested within 60s', async () => {
    mockRedisGet.mockResolvedValueOnce('1')    // rate limit key exists (overrides default null)

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/request')
      .send({ phone: '254712345678' })

    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/already sent/)
  })

  it('returns success message even for unregistered phone (no enumeration)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })  // phone not found

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/request')
      .send({ phone: '254712345678' })

    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/OTP has been sent/)
    // Must NOT have called sendSms for unregistered phone
    expect(mockSendSms).not.toHaveBeenCalled()
  })

  it('sends OTP and stores it in Redis for registered phone', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c-1', display_name: 'Alice', active: true }] })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/request')
      .send({ phone: '254712345678' })

    expect(res.status).toBe(200)
    expect(mockRedisSetex).toHaveBeenCalledWith('otp:254712345678', 5 * 60, expect.stringMatching(/^\d{6}$/))
    expect(mockSendSms).toHaveBeenCalled()
  })
})

describe('POST /api/v1/auth/consumer/otp/verify', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRedisGet.mockResolvedValue(null)
    mockRedisSetex.mockResolvedValue('OK')
    mockRedisDel.mockResolvedValue(1)
  })

  it('returns 400 for missing phone or otp', async () => {
    const app = buildApp()
    const res1 = await request(app).post('/api/v1/auth/consumer/otp/verify').send({ phone: '254712345678' })
    const res2 = await request(app).post('/api/v1/auth/consumer/otp/verify').send({ otp: '123456' })
    expect(res1.status).toBe(400)
    expect(res2.status).toBe(400)
  })

  it('returns 401 when OTP is expired or not found', async () => {
    mockRedisGet.mockResolvedValueOnce(null)  // OTP key not in Redis

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/verify')
      .send({ phone: '254712345678', otp: '123456' })

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/expired/)
  })

  it('returns 401 for wrong OTP', async () => {
    mockRedisGet.mockResolvedValueOnce('654321')  // stored OTP

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/verify')
      .send({ phone: '254712345678', otp: '000000' })  // wrong OTP

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/Invalid OTP/)
  })

  it('returns JWT + refresh token for correct OTP', async () => {
    mockRedisGet.mockResolvedValueOnce('123456')  // stored OTP
    mockRedisDel.mockResolvedValue(1)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c-1', display_name: 'Alice', phone: '254712345678', active: true }] })
      .mockResolvedValue({ rows: [], rowCount: 1 })  // insert refresh token

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/consumer/otp/verify')
      .send({ phone: '254712345678', otp: '123456' })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(res.body).toHaveProperty('refreshToken')
    expect(res.body.role).toBe('CONSUMER')
    // OTP must be deleted after use
    expect(mockRedisDel).toHaveBeenCalledWith('otp:254712345678')
  })
})

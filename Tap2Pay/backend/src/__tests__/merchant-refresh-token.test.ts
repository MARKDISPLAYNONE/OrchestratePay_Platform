// Tests for merchant JWT refresh token rotation
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'

process.env.JWT_SECRET   = 'test-secret'
process.env.ADMIN_SECRET = 'test-admin'
process.env.NODE_ENV     = 'test'

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
jest.mock('../integrations/africas-talking', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
  SmsTemplate: {},
}))
jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('nfc-key'),
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

describe('POST /api/v1/auth/refresh (merchant)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRedisExpire.mockResolvedValue(1)
    mockRedisDel.mockResolvedValue(1)
  })

  it('returns 400 when refreshToken is missing', async () => {
    const app = buildApp()
    const res = await request(app).post('/api/v1/auth/refresh').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/refreshToken is required/)
  })

  it('returns 401 for an unknown refresh token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })  // token not found in DB

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'unknown-token' })

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/expired/)
  })

  it('rotates token and returns new access + refresh token', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex')

    // DB returns a valid token row
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'rt-1', merchant_id: 'mid-1', name: 'Merchant A',
          active: true, device_id: 'dev-1', approval_status: 'APPROVED',
        }],
      })
      .mockResolvedValue({ rows: [], rowCount: 1 })  // revoke + insert new token

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rawToken })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(res.body).toHaveProperty('refreshToken')
    expect(res.body.role).toBe('MERCHANT')
    expect(res.body.merchantId).toBe('mid-1')

    const decoded = jwt.decode(res.body.token) as any
    expect(decoded.sub).toBe('mid-1')
    expect(decoded.role).toBe('MERCHANT')
  })

  it('returns 403 when merchant is suspended', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'rt-1', merchant_id: 'mid-2', name: 'Bad Merchant',
        active: true, device_id: 'dev-1', approval_status: 'SUSPENDED',
      }],
    })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: crypto.randomBytes(32).toString('hex') })

    expect(res.status).toBe(403)
  })
})

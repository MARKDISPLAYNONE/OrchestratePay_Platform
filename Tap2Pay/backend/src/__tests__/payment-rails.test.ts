// Tests for multi-currency payment rails endpoint
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET   = 'test-secret'
process.env.ADMIN_SECRET = 'test-admin'
process.env.NODE_ENV     = 'test'

jest.mock('../db/index', () => ({ db: { query: jest.fn() } }))
jest.mock('../db/redis', () => ({
  redis: { get: jest.fn().mockResolvedValue('dev-1'), setex: jest.fn(), del: jest.fn() },
}))
jest.mock('../util/audit', () => ({ writeAuditLog: jest.fn() }))

function buildApp() {
  const app = express()
  app.use(express.json())
  const paymentRailsRouter = require('../routes/payment-rails').default
  app.use('/api/v1/rails', paymentRailsRouter)
  return app
}

function merchantToken() {
  return jwt.sign(
    { sub: 'mid-1', name: 'Test Merchant', role: 'MERCHANT', deviceId: 'dev-1' },
    'test-secret',
    { expiresIn: '1h' }
  )
}

describe('GET /api/v1/rails', () => {
  it('returns all rails with their status', async () => {
    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/rails')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('rails')
    const rails: any[] = res.body.rails

    const methods = rails.map((r: any) => r.method)
    expect(methods).toContain('MPESA')
    expect(methods).toContain('VISA')
    expect(methods).toContain('MASTERCARD')
    expect(methods).toContain('EQUITY_MOBILE')

    const mpesa = rails.find((r: any) => r.method === 'MPESA')
    expect(mpesa.active).toBe(true)

    const visa = rails.find((r: any) => r.method === 'VISA')
    expect(visa.active).toBe(false)
  })
})

describe('POST /api/v1/rails/:method', () => {
  it('returns 503 for VISA (not yet active)', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/rails/VISA')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({})

    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/not configured/)
    expect(res.body.rail).toBe('VISA')
  })

  it('returns 503 for MASTERCARD (not yet active)', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/rails/MASTERCARD')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({})

    expect(res.status).toBe(503)
  })

  it('returns redirect instruction for MPESA', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/rails/MPESA')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({})

    expect(res.status).toBe(301)
    expect(res.body.redirect).toBe('/api/v1/transactions')
  })

  it('returns 400 for unknown payment method', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/rails/BITCOIN')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Unknown payment rail/)
  })

  it('returns 401 without authentication', async () => {
    const app = buildApp()
    const res = await request(app)
      .get('/api/v1/rails')
      .send({})

    expect(res.status).toBe(401)
  })
})

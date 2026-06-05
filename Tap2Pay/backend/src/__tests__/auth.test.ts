// Integration tests for POST /api/v1/auth/login.
// These tests hit a real test database (spun up in CI via docker-compose).
// They are skipped if DATABASE_URL is not set (local dev without Postgres).

import request from 'supertest'
import express from 'express'
import bcrypt from 'bcrypt'
import { Pool } from 'pg'
import jwt from 'jsonwebtoken'

const HAS_DB = !!process.env.DATABASE_URL

// Build a minimal app for testing (same stack as production, no cron/reconciliation)
function buildApp() {
  const app = express()
  app.use(express.json())
  // Dynamic import so the module only loads when the test runs
  // (avoids DB connection errors in unit-only test runs)
  const authRouter = require('../routes/auth').default
  app.use('/api/v1/auth', authRouter)
  return app
}

const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('POST /api/v1/auth/login', () => {
  let db: Pool
  let testMerchantId: string

  beforeAll(async () => {
    db = new Pool({ connectionString: process.env.DATABASE_URL })
    // Run migrations so the table exists
    const { migrate } = require('../db/migrate')
    if (typeof migrate === 'function') await migrate()

    // Insert a test merchant
    const hash = await bcrypt.hash('TestPass123!', 10)
    const result = await db.query(
      `INSERT INTO merchants (name, phone, email, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      ['Test Merchant', '254700000001', 'test@orchestratepay.co.ke', hash]
    )
    testMerchantId = result.rows[0].id
  })

  afterAll(async () => {
    await db.query('DELETE FROM merchants WHERE email = $1', ['test@orchestratepay.co.ke'])
    await db.end()
  })

  it('returns 400 when body is missing fields', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@orchestratepay.co.ke' })  // missing password + deviceId
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error', 'Validation failed')
  })

  it('returns 401 for wrong password', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@orchestratepay.co.ke', password: 'WrongPassword!', deviceId: 'device-1' })
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/Invalid credentials/)
  })

  it('returns 401 for non-existent email', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@orchestratepay.co.ke', password: 'Whatever1!', deviceId: 'device-1' })
    expect(res.status).toBe(401)
  })

  it('returns JWT token on valid login', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@orchestratepay.co.ke', password: 'TestPass123!', deviceId: 'device-test-1' })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(res.body).toHaveProperty('merchantId', testMerchantId)
    expect(res.body).toHaveProperty('expiresAt')

    // Verify the token is a valid JWT
    const payload = jwt.decode(res.body.token) as any
    expect(payload.sub).toBe(testMerchantId)
    expect(payload.deviceId).toBe('device-test-1')
  })
})

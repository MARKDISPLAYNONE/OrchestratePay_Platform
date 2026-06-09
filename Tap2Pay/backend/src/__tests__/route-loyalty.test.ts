/**
 * Integration tests for routes/loyalty.ts — loyalty programme endpoints.
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET   = 'test-secret'
process.env.ADMIN_SECRET = 'test-admin'
process.env.NODE_ENV     = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery   = jest.fn()
const mockConnect = jest.fn()
jest.mock('../db/index', () => ({
  db: {
    query:   (...args: any[]) => mockQuery(...args),
    connect: () => mockConnect(),
  },
}))

const mockRedisGet = jest.fn()
jest.mock('../db/redis', () => ({
  redis: { get: (...args: any[]) => mockRedisGet(...args) },
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('key'),
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const CONSUMER_ID = 'b2b3b4b5-c2c3-4d4d-e5e5-f1f2f3f4f5f6'

function merchantToken(id = MERCHANT_ID, deviceId = 'device-1') {
  return jwt.sign({ sub: id, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret', { expiresIn: '1h' })
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/loyalty', require('../routes/loyalty').default)
  // Catch re-thrown errors so async route failures return 500 instead of hanging
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: err.message })
  })
  return app
}

// Mock DB client for transaction tests
function mockDbClient(queries: jest.Mock[]) {
  let callIndex = 0
  const clientQuery = jest.fn().mockImplementation(() => {
    const mock = queries[callIndex] ?? jest.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    callIndex++
    return mock()
  })
  return {
    query:   clientQuery,
    release: jest.fn(),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('device-1')
    return Promise.resolve(null)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/loyalty/balance
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/loyalty/balance', () => {
  it('returns 400 when consumerId query param is missing', async () => {
    const res = await request(buildApp())
      .get('/api/v1/loyalty/balance')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/consumerId/i)
  })

  it('returns zero balances when consumer has no loyalty account here', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get(`/api/v1/loyalty/balance?consumerId=${CONSUMER_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.points_balance).toBe(0)
    expect(res.body.stamps_balance).toBe(0)
    expect(res.body.programme_type).toBeNull()
  })

  it('returns loyalty balance when account exists', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        points_balance:       250,
        stamps_balance:       3,
        lifetime_spent_cents: 25000,
        programme_type:       'POINTS',
        stamps_for_reward:    null,
        reward_description:   '10% off',
      }],
    })

    const res = await request(buildApp())
      .get(`/api/v1/loyalty/balance?consumerId=${CONSUMER_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.points_balance).toBe(250)
    expect(res.body.programme_type).toBe('POINTS')
  })

  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .get(`/api/v1/loyalty/balance?consumerId=${CONSUMER_ID}`)
    expect(res.status).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/loyalty/programme
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/loyalty/programme', () => {
  it('returns the merchant programme config', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'prog-1', merchant_id: MERCHANT_ID, programme_type: 'STAMPS', active: true }],
    })

    const res = await request(buildApp())
      .get('/api/v1/loyalty/programme')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.programme_type).toBe('STAMPS')
  })

  it('returns null when no programme is configured', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/loyalty/programme')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/loyalty/programme
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/loyalty/programme', () => {
  it('returns 400 for invalid programme_type', async () => {
    const res = await request(buildApp())
      .post('/api/v1/loyalty/programme')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ programme_type: 'CASHBACK' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/programme_type/i)
  })

  it('returns 400 for POINTS programme missing points_per_ksh', async () => {
    const res = await request(buildApp())
      .post('/api/v1/loyalty/programme')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ programme_type: 'POINTS' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/points_per_ksh/i)
  })

  it('returns 400 for STAMPS programme missing stamps_for_reward', async () => {
    const res = await request(buildApp())
      .post('/api/v1/loyalty/programme')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ programme_type: 'STAMPS' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/stamps_for_reward/i)
  })

  it('creates POINTS programme and returns 201', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'prog-1', merchant_id: MERCHANT_ID, programme_type: 'POINTS', points_per_ksh: 2 }],
    })

    const res = await request(buildApp())
      .post('/api/v1/loyalty/programme')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ programme_type: 'POINTS', points_per_ksh: 2, reward_description: '1 point per KSh 0.50' })

    expect(res.status).toBe(201)
    expect(res.body.programme_type).toBe('POINTS')
  })

  it('creates STAMPS programme and returns 201', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'prog-1', merchant_id: MERCHANT_ID, programme_type: 'STAMPS', stamps_for_reward: 10 }],
    })

    const res = await request(buildApp())
      .post('/api/v1/loyalty/programme')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ programme_type: 'STAMPS', stamps_for_reward: 10, reward_description: 'Free coffee' })

    expect(res.status).toBe(201)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/loyalty/redeem
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/loyalty/redeem', () => {
  it('returns 400 when consumerId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/loyalty/redeem')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ redeemPoints: 10 })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/consumerId/i)
  })

  it('returns 400 when neither redeemPoints nor redeemStamps is provided', async () => {
    const res = await request(buildApp())
      .post('/api/v1/loyalty/redeem')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ consumerId: CONSUMER_ID })

    expect(res.status).toBe(400)
  })

  it('returns 404 when consumer has no loyalty account', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .post('/api/v1/loyalty/redeem')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ consumerId: CONSUMER_ID, redeemPoints: 50 })

    expect(res.status).toBe(404)
  })

  it('returns 409 when points balance is insufficient', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ points_balance: 10, stamps_balance: 0 }],
    })

    const res = await request(buildApp())
      .post('/api/v1/loyalty/redeem')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ consumerId: CONSUMER_ID, redeemPoints: 100 })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/insufficient/i)
  })

  it('returns 409 when stamps balance is insufficient', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ points_balance: 0, stamps_balance: 2 }],
    })

    const res = await request(buildApp())
      .post('/api/v1/loyalty/redeem')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ consumerId: CONSUMER_ID, redeemStamps: 5 })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/insufficient/i)
  })

  it('redeems points within a DB transaction and returns ok', async () => {
    // Balance check
    mockQuery.mockResolvedValueOnce({
      rows: [{ points_balance: 500, stamps_balance: 0 }],
    })

    const clientMock = {
      query:   jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }
    mockConnect.mockResolvedValue(clientMock)

    const res = await request(buildApp())
      .post('/api/v1/loyalty/redeem')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ consumerId: CONSUMER_ID, redeemPoints: 100 })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(clientMock.query).toHaveBeenCalledWith('BEGIN')
    expect(clientMock.query).toHaveBeenCalledWith('COMMIT')
    expect(clientMock.release).toHaveBeenCalled()
  })

})

/**
 * Integration tests for routes/payment-links.ts — shareable payment link endpoints.
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET   = 'test-secret'
process.env.NODE_ENV     = 'test'

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

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('key'),
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'

function merchantToken(deviceId = 'device-1') {
  return jwt.sign(
    { sub: MERCHANT_ID, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret', { expiresIn: '1h' }
  )
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/payment-links', require('../routes/payment-links').default)
  return app
}

// Sample link payload stored in Redis
const LINK_PAYLOAD = {
  token:       'abcd1234ef567890',
  merchantId:  MERCHANT_ID,
  amountCents: 50_000,
  description: 'Lunch order',
  singleUse:   true,
  createdAt:   new Date().toISOString(),
  expiresAt:   new Date(Date.now() + 86_400_000).toISOString(),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('device-1')
    return Promise.resolve(null)
  })
  mockRedisSetex.mockResolvedValue('OK')
  mockRedisDel.mockResolvedValue(1)
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/payment-links
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/payment-links', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/v1/payment-links')
      .send({ amountCents: 5000 })
    expect(res.status).toBe(401)
  })

  it('returns 400 for validation error (amount too small)', async () => {
    const res = await request(buildApp())
      .post('/api/v1/payment-links')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ amountCents: 10 })   // below min 100
    expect(res.status).toBe(400)
  })

  it('creates a payment link and returns 201 with token and url', async () => {
    const res = await request(buildApp())
      .post('/api/v1/payment-links')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ amountCents: 50_000, description: 'Lunch', singleUse: true })

    expect(res.status).toBe(201)
    expect(res.body.token).toBeDefined()
    expect(res.body.url).toContain(res.body.token)
    expect(res.body.expiresAt).toBeDefined()
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringContaining('payment:link:'),
      86400,
      expect.any(String)
    )
  })

  it('uses PAYMENT_LINK_BASE_URL env var in the returned url', async () => {
    process.env.PAYMENT_LINK_BASE_URL = 'https://custom.pay.example.com'
    const res = await request(buildApp())
      .post('/api/v1/payment-links')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ amountCents: 10_000 })

    expect(res.body.url).toContain('https://custom.pay.example.com')
    delete process.env.PAYMENT_LINK_BASE_URL
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/payment-links/:token
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/payment-links/:token', () => {
  it('returns 404 when link not found or expired', async () => {
    mockRedisGet.mockImplementation(() => Promise.resolve(null))

    const res = await request(buildApp())
      .get('/api/v1/payment-links/nonexistent-token')

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found or expired/i)
  })

  it('returns link info with merchant name', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('merchant:device:')) return Promise.resolve('device-1')
      if (key.startsWith('payment:link:')) return Promise.resolve(JSON.stringify(LINK_PAYLOAD))
      return Promise.resolve(null)
    })
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Deli Corner' }] })

    const res = await request(buildApp())
      .get(`/api/v1/payment-links/${LINK_PAYLOAD.token}`)

    expect(res.status).toBe(200)
    expect(res.body.merchantName).toBe('Deli Corner')
    expect(res.body.amountCents).toBe(50_000)
  })

  it('uses Unknown Merchant when merchant row not found', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('payment:link:')) return Promise.resolve(JSON.stringify(LINK_PAYLOAD))
      return Promise.resolve(null)
    })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get(`/api/v1/payment-links/${LINK_PAYLOAD.token}`)

    expect(res.status).toBe(200)
    expect(res.body.merchantName).toBe('Unknown Merchant')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/payment-links/:token/pay
// ─────────────────────────────────────────────────────────────────────────────

const VALID_PAY_BODY = {
  consumerPhone:  '254700000001',
  idempotencyKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
}

describe('POST /api/v1/payment-links/:token/pay', () => {
  it('returns 400 for invalid phone format', async () => {
    const res = await request(buildApp())
      .post('/api/v1/payment-links/some-token/pay')
      .send({ consumerPhone: '0700000001', idempotencyKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' })
    expect(res.status).toBe(400)
  })

  it('returns cached idempotency result on duplicate request', async () => {
    const cached = { txnId: 'existing-txn', status: 'PENDING', amountCents: 50000 }
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('idempotency:link:')) return Promise.resolve(JSON.stringify(cached))
      return Promise.resolve(null)
    })

    const res = await request(buildApp())
      .post('/api/v1/payment-links/some-token/pay')
      .send(VALID_PAY_BODY)

    expect(res.status).toBe(200)
    expect(res.body.txnId).toBe('existing-txn')
  })

  it('returns 404 when link not found', async () => {
    mockRedisGet.mockImplementation(() => Promise.resolve(null))

    const res = await request(buildApp())
      .post('/api/v1/payment-links/expired-token/pay')
      .send(VALID_PAY_BODY)

    expect(res.status).toBe(404)
  })

  it('returns 409 when single-use link is already redeemed (DEL returns 0)', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('payment:link:')) return Promise.resolve(JSON.stringify(LINK_PAYLOAD))
      return Promise.resolve(null)
    })
    mockRedisDel.mockResolvedValue(0)  // another concurrent request already deleted it

    const res = await request(buildApp())
      .post(`/api/v1/payment-links/${LINK_PAYLOAD.token}/pay`)
      .send(VALID_PAY_BODY)

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already redeemed/i)
  })

  it('creates a transaction and returns 202', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('payment:link:')) return Promise.resolve(JSON.stringify(LINK_PAYLOAD))
      return Promise.resolve(null)
    })
    mockRedisDel.mockResolvedValue(1)
    mockQuery.mockResolvedValueOnce({ rows: [] })  // INSERT transactions

    const res = await request(buildApp())
      .post(`/api/v1/payment-links/${LINK_PAYLOAD.token}/pay`)
      .send(VALID_PAY_BODY)

    expect(res.status).toBe(202)
    expect(res.body.txnId).toBeDefined()
    expect(res.body.status).toBe('PENDING')
  })

  it('restores the link and returns 500 if DB INSERT fails', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('payment:link:')) return Promise.resolve(JSON.stringify(LINK_PAYLOAD))
      return Promise.resolve(null)
    })
    mockRedisDel.mockResolvedValue(1)
    mockQuery.mockRejectedValue(new Error('DB constraint violation'))

    const res = await request(buildApp())
      .post(`/api/v1/payment-links/${LINK_PAYLOAD.token}/pay`)
      .send(VALID_PAY_BODY)

    expect(res.status).toBe(500)
    // Link should be restored in Redis
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringContaining(LINK_PAYLOAD.token),
      60,
      expect.any(String)
    )
  })

  it('multi-use link: does not delete from Redis before transaction', async () => {
    const multiUseLink = { ...LINK_PAYLOAD, singleUse: false }
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('payment:link:')) return Promise.resolve(JSON.stringify(multiUseLink))
      return Promise.resolve(null)
    })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .post(`/api/v1/payment-links/${multiUseLink.token}/pay`)
      .send(VALID_PAY_BODY)

    expect(res.status).toBe(202)
    expect(mockRedisDel).not.toHaveBeenCalledWith(
      expect.stringContaining('payment:link:')
    )
  })
})

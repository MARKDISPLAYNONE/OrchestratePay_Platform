/**
 * Integration tests for routes/wallet.ts, routes/tags.ts, routes/fx.ts
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET    = 'test-secret'
process.env.ADMIN_SECRET  = 'test-admin'
process.env.NODE_ENV      = 'test'
process.env.HCE_TOKEN_SECRET = 'a'.repeat(32)

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockRedisGet   = jest.fn()
const mockRedisSetex = jest.fn()

jest.mock('../db/redis', () => ({
  redis: {
    get:   (...args: any[]) => mockRedisGet(...args),
    setex: (...args: any[]) => mockRedisSetex(...args),
  },
}))

const mockIssueHceToken  = jest.fn()
const mockVerifyHceToken = jest.fn()
jest.mock('../util/hce-token', () => ({
  issueHceToken:  (...args: any[]) => mockIssueHceToken(...args),
  verifyHceToken: (...args: any[]) => mockVerifyHceToken(...args),
}))

const mockBuildSignedUri      = jest.fn()
const mockVerifyTagSignature  = jest.fn()
const mockDeriveMerchantKey   = jest.fn()
jest.mock('../util/nfc-signing', () => ({
  buildSignedUri:           (...args: any[]) => mockBuildSignedUri(...args),
  verifyTagSignature:       (...args: any[]) => mockVerifyTagSignature(...args),
  deriveMerchantSigningKey: (...args: any[]) => mockDeriveMerchantKey(...args),
}))

const mockGetAllRates    = jest.fn()
const mockRefreshAllRates = jest.fn()
jest.mock('../util/fx', () => ({
  getAllRates:          (...args: any[]) => mockGetAllRates(...args),
  refreshAllRates:     (...args: any[]) => mockRefreshAllRates(...args),
  SUPPORTED_CURRENCIES: ['KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX', 'RWF'],
  convertToKes:        jest.fn().mockResolvedValue({ kesAmountCents: 5000, fxRate: 1 }),
  isSupportedCurrency: jest.fn().mockReturnValue(true),
}))

jest.mock('../util/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const TAG_ID      = 'c3c4c5c6-d3d4-4e5e-f6f7-a8b9c0d1e2f3'

function merchantToken(id = MERCHANT_ID, deviceId = 'device-1') {
  return jwt.sign({ sub: id, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret', { expiresIn: '1h' })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('device-1')
    return Promise.resolve(null)
  })
  mockRedisSetex.mockResolvedValue('OK')
})

// ── routes/wallet.ts ─────────────────────────────────────────────────────────

describe('POST /api/v1/wallet/session', () => {
  function buildApp() {
    const app = express()
    app.use(express.json())
    app.use('/api/v1/wallet', require('../routes/wallet').default)
    return app
  }

  it('returns 400 for invalid phone format', async () => {
    const res = await request(buildApp())
      .post('/api/v1/wallet/session')
      .send({ phone: '0700000001' })  // missing 254 prefix

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/validation/i)
  })

  it('returns 400 for non-numeric phone', async () => {
    const res = await request(buildApp())
      .post('/api/v1/wallet/session')
      .send({ phone: '254abc000001' })

    expect(res.status).toBe(400)
  })

  it('issues HCE session token for valid phone', async () => {
    mockIssueHceToken.mockReturnValue({ token: 'a'.repeat(32), exp: Date.now() + 60_000 })

    const res = await request(buildApp())
      .post('/api/v1/wallet/session')
      .send({ phone: '254700000001' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.exp).toBeGreaterThan(Date.now())
  })

  it('returns 503 when HCE token secret is not configured', async () => {
    mockIssueHceToken.mockImplementation(() => {
      throw new Error('HCE_TOKEN_SECRET is not set')
    })

    const res = await request(buildApp())
      .post('/api/v1/wallet/session')
      .send({ phone: '254700000001' })

    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/session service/i)
  })
})

// ── routes/tags.ts ────────────────────────────────────────────────────────────

describe('POST /api/v1/tags/sign', () => {
  function buildApp() {
    const app = express()
    app.use(express.json())
    app.use('/api/v1/tags', require('../routes/tags').default)
    return app
  }

  it("returns 403 when signing another merchant's tag", async () => {
    const res = await request(buildApp())
      .post('/api/v1/tags/sign')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ merchantId: 'ffffffff-ffff-4fff-bfff-ffffffffffff', tagId: TAG_ID })

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/own.*merchant/i)
  })

  it('returns 404 when tag not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .post('/api/v1/tags/sign')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ merchantId: MERCHANT_ID, tagId: TAG_ID })

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('returns signed URI when tag exists', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TAG_ID, tag_id: TAG_ID, phone: '254700000001' }],
    })
    mockBuildSignedUri.mockReturnValue('https://pay.test/t/TAG001?sign=abc123')

    const res = await request(buildApp())
      .post('/api/v1/tags/sign')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ merchantId: MERCHANT_ID, tagId: TAG_ID })

    expect(res.status).toBe(200)
    expect(res.body.uri).toBe('https://pay.test/t/TAG001?sign=abc123')
    expect(res.body.tagId).toBe(TAG_ID)
  })

  it('returns 503 when NFC signing secret is not configured', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TAG_ID, tag_id: TAG_ID, phone: '254700000001' }],
    })
    mockBuildSignedUri.mockImplementation(() => {
      throw new Error('NFC_SIGNING_SECRET is not set')
    })

    const res = await request(buildApp())
      .post('/api/v1/tags/sign')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ merchantId: MERCHANT_ID, tagId: TAG_ID })

    expect(res.status).toBe(503)
  })

  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/v1/tags/sign')
      .send({ merchantId: MERCHANT_ID, tagId: TAG_ID })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/tags/signing-key', () => {
  function buildApp() {
    const app = express()
    app.use(express.json())
    app.use('/api/v1/tags', require('../routes/tags').default)
    return app
  }

  it('returns signing key for authenticated merchant', async () => {
    mockDeriveMerchantKey.mockReturnValue('derived-nfc-key-abc')

    const res = await request(buildApp())
      .get('/api/v1/tags/signing-key')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.signingKey).toBe('derived-nfc-key-abc')
    expect(res.body.merchantId).toBe(MERCHANT_ID)
  })

  it('returns 503 when NFC signing secret is not configured', async () => {
    mockDeriveMerchantKey.mockImplementation(() => {
      throw new Error('NFC_SIGNING_SECRET is not set')
    })

    const res = await request(buildApp())
      .get('/api/v1/tags/signing-key')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(503)
  })

  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .get('/api/v1/tags/signing-key')

    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/tags/verify', () => {
  function buildApp() {
    const app = express()
    app.use(express.json())
    app.use('/api/v1/tags', require('../routes/tags').default)
    return app
  }

  it('returns 400 when required fields are missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/tags/verify')
      .send({ merchantId: MERCHANT_ID })  // missing tagId and sign

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/required/i)
  })

  it('returns valid:true for a valid signature', async () => {
    mockVerifyTagSignature.mockReturnValue(true)

    const res = await request(buildApp())
      .post('/api/v1/tags/verify')
      .send({ merchantId: MERCHANT_ID, tagId: TAG_ID, sign: 'valid-sig' })

    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(true)
  })

  it('returns valid:false for an invalid signature', async () => {
    mockVerifyTagSignature.mockReturnValue(false)

    const res = await request(buildApp())
      .post('/api/v1/tags/verify')
      .send({ merchantId: MERCHANT_ID, tagId: TAG_ID, sign: 'bad-sig' })

    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(false)
  })

  it('returns valid:false when verifyTagSignature throws', async () => {
    mockVerifyTagSignature.mockImplementation(() => {
      throw new Error('Crypto error')
    })

    const res = await request(buildApp())
      .post('/api/v1/tags/verify')
      .send({ merchantId: MERCHANT_ID, tagId: TAG_ID, sign: 'bad-sig' })

    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(false)
  })
})

// ── routes/fx.ts ──────────────────────────────────────────────────────────────

describe('GET /api/v1/fx/rates', () => {
  function buildApp() {
    const app = express()
    app.use(express.json())
    app.use('/api/v1/fx', require('../routes/fx').default)
    return app
  }

  it('returns exchange rates for all supported currencies', async () => {
    mockGetAllRates.mockResolvedValue([
      { currency: 'USD', rate: 130, source: 'openexchangerates', fetchedAt: new Date().toISOString(), ageMinutes: 5 },
      { currency: 'EUR', rate: 142, source: 'openexchangerates', fetchedAt: new Date().toISOString(), ageMinutes: 5 },
    ])

    const res = await request(buildApp()).get('/api/v1/fx/rates')

    expect(res.status).toBe(200)
    expect(res.body.base).toBe('KES')
    expect(res.body.kes.rate).toBe(1)
    expect(res.body.currencies).toBeDefined()

    const usd = res.body.currencies.find((c: any) => c.currency === 'USD')
    expect(usd.rate).toBe(130)
  })

  it('returns null rate for currencies not yet fetched', async () => {
    mockGetAllRates.mockResolvedValue([])  // no rates stored yet

    const res = await request(buildApp()).get('/api/v1/fx/rates')

    expect(res.status).toBe(200)
    const usd = res.body.currencies.find((c: any) => c.currency === 'USD')
    expect(usd.rate).toBeNull()
    expect(usd.source).toBeNull()
  })

  it('returns 500 when getAllRates throws', async () => {
    mockGetAllRates.mockRejectedValue(new Error('DB connection lost'))

    const res = await request(buildApp()).get('/api/v1/fx/rates')

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/exchange rates/i)
  })
})

describe('POST /api/v1/admin/fx/rates/refresh', () => {
  function buildApp() {
    const app = express()
    app.use(express.json())
    const { adminFxRouter } = require('../routes/fx')
    app.use('/api/v1/admin/fx', adminFxRouter)
    return app
  }

  it('returns 403 without admin secret', async () => {
    const res = await request(buildApp())
      .post('/api/v1/admin/fx/rates/refresh')

    expect(res.status).toBe(403)
  })

  it('refreshes rates and returns count', async () => {
    mockRefreshAllRates.mockResolvedValue(6)

    const res = await request(buildApp())
      .post('/api/v1/admin/fx/rates/refresh')
      .set('X-Admin-Secret', 'test-admin')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.ratesRefreshed).toBe(6)
  })

  it('returns 500 when refresh fails', async () => {
    mockRefreshAllRates.mockRejectedValue(new Error('OpenExchangeRates API down'))

    const res = await request(buildApp())
      .post('/api/v1/admin/fx/rates/refresh')
      .set('X-Admin-Secret', 'test-admin')

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/refresh failed/i)
  })
})

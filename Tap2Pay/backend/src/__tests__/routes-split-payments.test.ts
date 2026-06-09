/**
 * Integration tests for routes/split-payments.ts — group/bill-split sessions.
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV   = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRedisGet  = jest.fn()
const mockRedisSetex = jest.fn()
const mockRedisTtl  = jest.fn()
jest.mock('../db/redis', () => ({
  redis: {
    get:   (...args: any[]) => mockRedisGet(...args),
    setex: (...args: any[]) => mockRedisSetex(...args),
    ttl:   (...args: any[]) => mockRedisTtl(...args),
  },
}))

jest.mock('../db/index', () => ({
  db: { query: jest.fn() },
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('key'),
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const OTHER_ID    = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'

function merchantToken(id = MERCHANT_ID) {
  return jwt.sign(
    { sub: id, name: 'Merchant', role: 'MERCHANT', deviceId: 'dev-1' },
    'test-secret', { expiresIn: '1h' }
  )
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/split-payments', require('../routes/split-payments').default)
  return app
}

const TWO_PARTICIPANTS = [
  { phone: '254700000001', shareCents: 3000 },
  { phone: '254700000002', shareCents: 2000 },
]

const SAMPLE_SESSION = {
  id:          'session-uuid-1',
  merchantId:  MERCHANT_ID,
  totalCents:  5000,
  description: 'Lunch split',
  participants: TWO_PARTICIPANTS.map(p => ({ ...p, status: 'PENDING' as const })),
  createdAt:   new Date().toISOString(),
  status:      'OPEN' as const,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('dev-1')
    return Promise.resolve(null)
  })
  mockRedisSetex.mockResolvedValue('OK')
  mockRedisTtl.mockResolvedValue(250)
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/split-payments
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/split-payments', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/v1/split-payments')
      .send({ totalAmountCents: 5000, participants: TWO_PARTICIPANTS })
    expect(res.status).toBe(401)
  })

  it('returns 400 when validation fails (fewer than 2 participants)', async () => {
    const res = await request(buildApp())
      .post('/api/v1/split-payments')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ totalAmountCents: 3000, participants: [TWO_PARTICIPANTS[0]] })
    expect(res.status).toBe(400)
  })

  it('returns 400 when share amounts do not sum to totalAmountCents', async () => {
    const res = await request(buildApp())
      .post('/api/v1/split-payments')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        totalAmountCents: 9999,  // doesn't match 3000+2000=5000
        participants: TWO_PARTICIPANTS,
      })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/sum to/i)
  })

  it('creates a session and returns 201 with session data', async () => {
    const res = await request(buildApp())
      .post('/api/v1/split-payments')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ totalAmountCents: 5000, participants: TWO_PARTICIPANTS, description: 'Coffee run' })

    expect(res.status).toBe(201)
    expect(res.body.sessionId).toBeDefined()
    expect(res.body.session.status).toBe('OPEN')
    expect(res.body.session.participants).toHaveLength(2)
    expect(res.body.session.participants[0].status).toBe('PENDING')
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringContaining('split:'),
      300,
      expect.any(String)
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/split-payments/:id/join
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/split-payments/:id/join', () => {
  it('returns 404 when session not found', async () => {
    const res = await request(buildApp())
      .post('/api/v1/split-payments/nonexistent/join')
      .send({ phone: '254700000003', shareCents: 1000 })
    expect(res.status).toBe(404)
  })

  it('returns 400 when session is not OPEN', async () => {
    const initiating = { ...SAMPLE_SESSION, status: 'INITIATING' as const }
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('split:')) return Promise.resolve(JSON.stringify(initiating))
      return Promise.resolve('dev-1')
    })

    const res = await request(buildApp())
      .post(`/api/v1/split-payments/${SAMPLE_SESSION.id}/join`)
      .send({ phone: '254700000003', shareCents: 500 })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/INITIATING/i)
  })

  it('returns 409 when phone already in the session', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('split:')) return Promise.resolve(JSON.stringify(SAMPLE_SESSION))
      return Promise.resolve('dev-1')
    })

    const res = await request(buildApp())
      .post(`/api/v1/split-payments/${SAMPLE_SESSION.id}/join`)
      .send({ phone: TWO_PARTICIPANTS[0].phone, shareCents: 500 })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already in/i)
  })

  it('adds a new participant and returns updated count', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('split:')) return Promise.resolve(JSON.stringify(SAMPLE_SESSION))
      return Promise.resolve('dev-1')
    })

    const res = await request(buildApp())
      .post(`/api/v1/split-payments/${SAMPLE_SESSION.id}/join`)
      .send({ phone: '254700000003', shareCents: 500 })

    expect(res.status).toBe(200)
    expect(res.body.participantCount).toBe(3)
    expect(mockRedisSetex).toHaveBeenCalled()
  })

  it('returns 400 when max participants reached', async () => {
    const fullSession = {
      ...SAMPLE_SESSION,
      participants: Array.from({ length: 10 }, (_, i) => ({
        phone: `2547000000${String(i).padStart(2, '0')}`,
        shareCents: 500,
        status: 'PENDING' as const,
      })),
    }
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('split:')) return Promise.resolve(JSON.stringify(fullSession))
      return Promise.resolve('dev-1')
    })

    const res = await request(buildApp())
      .post(`/api/v1/split-payments/${SAMPLE_SESSION.id}/join`)
      .send({ phone: '254799999999', shareCents: 500 })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/maximum/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/split-payments/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/split-payments/:id', () => {
  it('returns 404 when session not found', async () => {
    const res = await request(buildApp()).get('/api/v1/split-payments/not-found')
    expect(res.status).toBe(404)
  })

  it('returns the session JSON', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('split:')) return Promise.resolve(JSON.stringify(SAMPLE_SESSION))
      return Promise.resolve(null)
    })

    const res = await request(buildApp())
      .get(`/api/v1/split-payments/${SAMPLE_SESSION.id}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(SAMPLE_SESSION.id)
    expect(res.body.totalCents).toBe(5000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/split-payments/:id/initiate
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/split-payments/:id/initiate', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .post(`/api/v1/split-payments/${SAMPLE_SESSION.id}/initiate`)
    expect(res.status).toBe(401)
  })

  it('returns 404 when session not found', async () => {
    const res = await request(buildApp())
      .post('/api/v1/split-payments/nonexistent/initiate')
      .set('Authorization', `Bearer ${merchantToken()}`)
    expect(res.status).toBe(404)
  })

  it('returns 403 when called by a different merchant', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('split:')) return Promise.resolve(JSON.stringify(SAMPLE_SESSION))
      if (key.startsWith('merchant:device:')) return Promise.resolve('dev-1')
      return Promise.resolve(null)
    })

    const res = await request(buildApp())
      .post(`/api/v1/split-payments/${SAMPLE_SESSION.id}/initiate`)
      .set('Authorization', `Bearer ${merchantToken(OTHER_ID)}`)

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/session creator/i)
  })

  it('returns 400 when session is not OPEN', async () => {
    const completed = { ...SAMPLE_SESSION, status: 'COMPLETE' as const }
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('split:')) return Promise.resolve(JSON.stringify(completed))
      if (key.startsWith('merchant:device:')) return Promise.resolve('dev-1')
      return Promise.resolve(null)
    })

    const res = await request(buildApp())
      .post(`/api/v1/split-payments/${SAMPLE_SESSION.id}/initiate`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/COMPLETE/i)
  })

  it('initiates STK pushes and returns INITIATING status', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('split:')) return Promise.resolve(JSON.stringify(SAMPLE_SESSION))
      if (key.startsWith('merchant:device:')) return Promise.resolve('dev-1')
      return Promise.resolve(null)
    })

    const res = await request(buildApp())
      .post(`/api/v1/split-payments/${SAMPLE_SESSION.id}/initiate`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('INITIATING')
    expect(res.body.message).toContain('2 participants')
    // Session should be updated to INITIATING in Redis
    const savedSession = JSON.parse(mockRedisSetex.mock.calls[0][2])
    expect(savedSession.status).toBe('INITIATING')
  })
})

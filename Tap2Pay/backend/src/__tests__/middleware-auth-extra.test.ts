/**
 * Tests for uncovered branches in middleware/auth.ts:
 *   - requireConsumerAuth
 *   - requireRole
 *   - checkDeviceBinding: cache miss → DB fallback, device mismatch, session revoked, error fail-open
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET   = 'test-secret'
process.env.NODE_ENV     = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery    = jest.fn()
const mockRedisGet = jest.fn()
const mockRedisSetex = jest.fn()

jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))
jest.mock('../db/redis', () => ({
  redis: {
    get:   (...args: any[]) => mockRedisGet(...args),
    setex: (...args: any[]) => mockRedisSetex(...args),
  },
}))
jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { requireAuth, requireConsumerAuth, requireRole } from '../middleware/auth'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const CONSUMER_ID = 'b2b3b4b5-c2c3-4d4d-e5e5-f1f2f3f4f5f6'

function merchantToken(extra: Record<string, any> = {}) {
  return jwt.sign(
    { sub: MERCHANT_ID, name: 'Merchant', role: 'MERCHANT', deviceId: 'dev-1', ...extra },
    'test-secret', { expiresIn: '1h' }
  )
}

function consumerToken(extra: Record<string, any> = {}) {
  return jwt.sign(
    { sub: CONSUMER_ID, name: 'Consumer', role: 'CONSUMER', ...extra },
    'test-secret', { expiresIn: '1h' }
  )
}

function buildApp(mw: (...args: any[]) => any) {
  const app = express()
  app.use(express.json())
  app.get('/protected', mw, (_req: any, res: any) => res.json({ ok: true }))
  return app
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockRedisGet.mockResolvedValue('dev-1')   // device matches by default
  mockRedisSetex.mockResolvedValue('OK')
})

// ─────────────────────────────────────────────────────────────────────────────
// requireConsumerAuth
// ─────────────────────────────────────────────────────────────────────────────

describe('requireConsumerAuth', () => {
  it('passes consumer JWT through', async () => {
    const res = await request(buildApp(requireConsumerAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${consumerToken()}`)
    expect(res.status).toBe(200)
  })

  it('returns 403 when merchant JWT is used', async () => {
    const res = await request(buildApp(requireConsumerAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${merchantToken()}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/consumer credentials required/i)
  })

  it('returns 401 when no auth header', async () => {
    const res = await request(buildApp(requireConsumerAuth)).get('/protected')
    expect(res.status).toBe(401)
  })

  it('returns 401 for expired token', async () => {
    const expired = jwt.sign(
      { sub: CONSUMER_ID, role: 'CONSUMER' },
      'test-secret',
      { expiresIn: '-1s' }
    )
    const res = await request(buildApp(requireConsumerAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${expired}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/session expired/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// requireRole
// ─────────────────────────────────────────────────────────────────────────────

describe('requireRole', () => {
  it('passes when role matches', async () => {
    const res = await request(buildApp(requireRole('CONSUMER')))
      .get('/protected')
      .set('Authorization', `Bearer ${consumerToken()}`)
    expect(res.status).toBe(200)
  })

  it('passes when one of multiple allowed roles matches', async () => {
    const res = await request(buildApp(requireRole('ADMIN', 'CONSUMER')))
      .get('/protected')
      .set('Authorization', `Bearer ${consumerToken()}`)
    expect(res.status).toBe(200)
  })

  it('returns 403 when role does not match', async () => {
    const res = await request(buildApp(requireRole('ADMIN')))
      .get('/protected')
      .set('Authorization', `Bearer ${merchantToken()}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/role required/i)
  })

  it('treats legacy tokens (no role) as MERCHANT', async () => {
    const legacyToken = jwt.sign(
      { sub: MERCHANT_ID, name: 'Legacy', deviceId: 'dev-1' },  // no role field
      'test-secret', { expiresIn: '1h' }
    )
    const res = await request(buildApp(requireRole('MERCHANT')))
      .get('/protected')
      .set('Authorization', `Bearer ${legacyToken}`)
    expect(res.status).toBe(200)
  })

  it('returns 401 with no token', async () => {
    const res = await request(buildApp(requireRole('MERCHANT'))).get('/protected')
    expect(res.status).toBe(401)
  })

  it('returns 401 for invalid token', async () => {
    const res = await request(buildApp(requireRole('MERCHANT')))
      .get('/protected')
      .set('Authorization', 'Bearer not.a.jwt')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/invalid authentication token/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// requireAuth — device binding edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('requireAuth — device binding', () => {
  it('rejects merchant JWT with CONSUMER role', async () => {
    const wrongRole = jwt.sign(
      { sub: MERCHANT_ID, name: 'X', role: 'CONSUMER', deviceId: 'dev-1' },
      'test-secret', { expiresIn: '1h' }
    )
    const res = await request(buildApp(requireAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${wrongRole}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/merchant credentials required/i)
  })

  it('cache miss → falls back to DB and backfills Redis', async () => {
    mockRedisGet.mockResolvedValue(null)  // cache miss
    mockQuery.mockResolvedValueOnce({ rows: [{ device_id: 'dev-1' }] })

    const res = await request(buildApp(requireAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT device_id FROM merchants'),
      [MERCHANT_ID]
    )
    expect(mockRedisSetex).toHaveBeenCalled()
  })

  it('session revoked — DB device_id is NULL → 401', async () => {
    mockRedisGet.mockResolvedValue(null)           // cache miss
    mockQuery.mockResolvedValueOnce({ rows: [{ device_id: null }] })  // NULL in DB

    const res = await request(buildApp(requireAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/session revoked/i)
  })

  it('device mismatch — newer login from other device → 401', async () => {
    // Redis has a different device than the JWT
    mockRedisGet.mockResolvedValue('dev-NEW')

    const res = await request(buildApp(requireAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${merchantToken({ deviceId: 'dev-OLD' })}`)

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/session invalidated/i)
  })

  it('Redis error → fails open (next() is called)', async () => {
    mockRedisGet.mockRejectedValue(new Error('Redis timeout'))

    const res = await request(buildApp(requireAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)  // fails open
  })

  it('legacy merchant token with no deviceId skips binding check', async () => {
    const noDevice = jwt.sign(
      { sub: MERCHANT_ID, name: 'Legacy' },  // no deviceId, no role
      'test-secret', { expiresIn: '1h' }
    )
    const res = await request(buildApp(requireAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${noDevice}`)
    expect(res.status).toBe(200)
    expect(mockRedisGet).not.toHaveBeenCalled()
  })

  it('cache miss and merchant not in DB → session revoked', async () => {
    mockRedisGet.mockResolvedValue(null)
    mockQuery.mockResolvedValueOnce({ rows: [] })  // no merchant row

    const res = await request(buildApp(requireAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/session revoked/i)
  })
})

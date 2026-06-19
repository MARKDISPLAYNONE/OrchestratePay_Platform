/**
 * Tests for:
 *   - routes/api-keys.ts       (POST / GET / DELETE / GET /:id)
 *   - middleware/auth.ts        requireApiKey + requireAuthOrApiKey
 *
 * No real database or Redis required — all I/O is mocked.
 */

process.env.NODE_ENV   = 'test'
process.env.JWT_SECRET = 'test-secret'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...a: any[]) => mockQuery(...a) },
}))

// requireAuth reaches into Redis for device-binding; stub it out
jest.mock('../db/redis', () => ({
  redis: {
    get:   jest.fn().mockResolvedValue('dev'),   // device matches default token
    setex: jest.fn().mockResolvedValue('OK'),
  },
}))

jest.mock('../util/logger', () => ({
  logger: {
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

import request from 'supertest'
import express, { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import apiKeysRouter from '../routes/api-keys'
import { requireApiKey, requireAuthOrApiKey } from '../middleware/auth'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee'

function merchantToken(id = MERCHANT_ID) {
  return jwt.sign(
    { sub: id, name: 'Test Merchant', role: 'MERCHANT', deviceId: 'dev' },
    'test-secret',
    { expiresIn: '1h' }
  )
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/api-keys', apiKeysRouter)
  // Generic error handler so unhandled throws don't crash the test runner
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message })
  })
  return app
}

// Sample DB row returned for a single key
const SAMPLE_KEY_ROW = {
  id:           'key-uuid-1',
  name:         'My Key',
  key_prefix:   'op_a1b2c3d4e5',
  last_used_at: null,
  expires_at:   null,
  created_at:   new Date('2026-01-01').toISOString(),
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/api-keys
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/api-keys', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/v1/api-keys')
      .send({ name: 'My Key' })
    expect(res.status).toBe(401)
  })

  it('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Validation failed/)
  })

  it('returns 400 when name exceeds 100 chars', async () => {
    const res = await request(buildApp())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'x'.repeat(101) })
    expect(res.status).toBe(400)
  })

  it('returns 400 when expiresInDays is out of range', async () => {
    const res = await request(buildApp())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'Key', expiresInDays: 400 })
    expect(res.status).toBe(400)
  })

  it('returns 201 with fullKey on success (no expiry)', async () => {
    // First call: COUNT query → 0 active keys
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      // Second call: INSERT → returns new row
      .mockResolvedValueOnce({ rows: [{ ...SAMPLE_KEY_ROW }] })

    const res = await request(buildApp())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'My Key' })

    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('fullKey')
    expect(res.body.fullKey).toMatch(/^op_[a-f0-9]{64}$/)
    expect(res.body).toHaveProperty('keyPrefix')
    expect(res.body).toHaveProperty('id')
    expect(res.body).not.toHaveProperty('keyHash')
  })

  it('fullKey prefix matches keyPrefix', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: 2 }] })
      .mockResolvedValueOnce({ rows: [{ ...SAMPLE_KEY_ROW }] })

    const res = await request(buildApp())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'My Key' })

    expect(res.status).toBe(201)
    // The real key prefix is derived from fullKey, not from the DB row in our mock,
    // but the route must call INSERT with the first 12 chars of the generated key.
    // We verify that by checking the INSERT args captured by mockQuery.
    const insertCall = mockQuery.mock.calls[1]
    const [sqlStr, params] = insertCall
    expect(sqlStr).toMatch(/INSERT INTO merchant_api_keys/)
    const [_id, _merchantId, keyHash, keyPrefix, name] = params
    expect(keyPrefix).toHaveLength(12)
    expect(keyPrefix).toMatch(/^op_/)
    expect(keyHash).toHaveLength(64)   // SHA-256 hex
    expect(name).toBe('My Key')
  })

  it('accepts expiresInDays=30 and passes a date to INSERT', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      .mockResolvedValueOnce({ rows: [{ ...SAMPLE_KEY_ROW, expires_at: new Date('2026-02-01').toISOString() }] })

    const res = await request(buildApp())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'Expiring Key', expiresInDays: 30 })

    expect(res.status).toBe(201)
    const insertParams = mockQuery.mock.calls[1][1]
    const expiresAt = insertParams[5]
    expect(expiresAt).toBeInstanceOf(Date)
    // Should be ~30 days from now (within 1 minute tolerance)
    const diffDays = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThan(29.9)
    expect(diffDays).toBeLessThan(30.1)
  })

  it('returns 409 when merchant is at the 10-key limit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 10 }] })

    const res = await request(buildApp())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'One More Key' })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/Maximum of 10/)
  })

  it('returns 500 when DB count query throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'))

    const res = await request(buildApp())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'Key' })

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/Failed to create API key/)
  })

  it('returns 500 when INSERT throws', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      .mockRejectedValueOnce(new Error('unique violation'))

    const res = await request(buildApp())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'Key' })

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/api-keys
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/api-keys', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).get('/api/v1/api-keys')
    expect(res.status).toBe(401)
  })

  it('returns keys list without secrets', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SAMPLE_KEY_ROW] })

    const res = await request(buildApp())
      .get('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('keys')
    expect(Array.isArray(res.body.keys)).toBe(true)
    const key = res.body.keys[0]
    expect(key).toHaveProperty('id')
    expect(key).toHaveProperty('name')
    expect(key).toHaveProperty('keyPrefix')
    expect(key).toHaveProperty('lastUsedAt')
    expect(key).toHaveProperty('expiresAt')
    expect(key).toHaveProperty('createdAt')
    // Must not expose secrets
    expect(key).not.toHaveProperty('fullKey')
    expect(key).not.toHaveProperty('key_hash')
    expect(key).not.toHaveProperty('keyHash')
  })

  it('returns empty array when merchant has no keys', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.keys).toHaveLength(0)
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('timeout'))

    const res = await request(buildApp())
      .get('/api/v1/api-keys')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/api-keys/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/api-keys/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).delete('/api/v1/api-keys/some-id')
    expect(res.status).toBe(401)
  })

  it('returns 200 with { revoked: true } on success', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'key-uuid-1' }] })

    const res = await request(buildApp())
      .delete('/api/v1/api-keys/key-uuid-1')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ revoked: true })
  })

  it('returns 404 when key not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .delete('/api/v1/api-keys/nonexistent-id')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/)
  })

  it('returns 404 when key belongs to different merchant', async () => {
    // UPDATE WHERE merchant_id = $2 returns 0 rows if wrong merchant
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .delete('/api/v1/api-keys/key-uuid-1')
      .set('Authorization', `Bearer ${merchantToken('other-merchant-id')}`)

    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('deadlock'))

    const res = await request(buildApp())
      .delete('/api/v1/api-keys/key-uuid-1')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/api-keys/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/api-keys/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).get('/api/v1/api-keys/some-id')
    expect(res.status).toBe(401)
  })

  it('returns key metadata without secrets', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SAMPLE_KEY_ROW] })

    const res = await request(buildApp())
      .get('/api/v1/api-keys/key-uuid-1')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('id', 'key-uuid-1')
    expect(res.body).toHaveProperty('name', 'My Key')
    expect(res.body).toHaveProperty('keyPrefix', 'op_a1b2c3d4e5')
    expect(res.body).not.toHaveProperty('fullKey')
    expect(res.body).not.toHaveProperty('keyHash')
    expect(res.body).not.toHaveProperty('key_hash')
  })

  it('returns 404 when key not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/api-keys/nonexistent-id')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/)
  })

  it('returns 404 when key belongs to different merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/api-keys/key-uuid-1')
      .set('Authorization', `Bearer ${merchantToken('other-merchant-id')}`)

    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('timeout'))

    const res = await request(buildApp())
      .get('/api/v1/api-keys/key-uuid-1')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// requireApiKey middleware (unit tests on a mini express app)
// ─────────────────────────────────────────────────────────────────────────────

describe('requireApiKey middleware', () => {
  function buildApiKeyApp() {
    const app = express()
    app.use(express.json())
    app.get('/protected', requireApiKey, (_req: Request, res: Response) => {
      res.json({ merchant: (_req as any).merchant })
    })
    return app
  }

  const VALID_KEY = 'op_' + 'a'.repeat(64)
  const VALID_HASH = crypto.createHash('sha256').update(VALID_KEY).digest('hex')

  const ACTIVE_ROW = {
    id:          'key-id-1',
    merchant_id: MERCHANT_ID,
    name:        'Test Merchant',
    expires_at:  null,
  }

  it('returns 401 when X-API-Key header is missing', async () => {
    const res = await request(buildApiKeyApp()).get('/protected')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/Missing or invalid/)
  })

  it('returns 401 when X-API-Key does not start with op_', async () => {
    const res = await request(buildApiKeyApp())
      .get('/protected')
      .set('X-API-Key', 'sk_somethingelse')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/Missing or invalid/)
  })

  it('returns 401 when key is not found in DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApiKeyApp())
      .get('/protected')
      .set('X-API-Key', VALID_KEY)
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/Invalid or revoked/)
  })

  it('returns 401 when key has expired', async () => {
    const expired = new Date(Date.now() - 1000).toISOString()  // 1 second ago
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...ACTIVE_ROW, expires_at: expired }],
    })

    const res = await request(buildApiKeyApp())
      .get('/protected')
      .set('X-API-Key', VALID_KEY)
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/expired/)
  })

  it('returns 401 when DB query throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection reset'))

    const res = await request(buildApiKeyApp())
      .get('/protected')
      .set('X-API-Key', VALID_KEY)
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/Authentication failed/)
  })

  it('sets req.merchant and calls next() for a valid, unexpired key', async () => {
    // First call: key lookup query
    mockQuery
      .mockResolvedValueOnce({ rows: [ACTIVE_ROW] })
      // Second call: fire-and-forget last_used_at UPDATE — must not throw
      .mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApiKeyApp())
      .get('/protected')
      .set('X-API-Key', VALID_KEY)

    expect(res.status).toBe(200)
    expect(res.body.merchant).toMatchObject({
      sub:  MERCHANT_ID,
      role: 'MERCHANT',
    })
  })

  it('hashes the key with SHA-256 before querying DB', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [ACTIVE_ROW] })
      .mockResolvedValueOnce({ rows: [] })

    await request(buildApiKeyApp())
      .get('/protected')
      .set('X-API-Key', VALID_KEY)

    const queryArgs = mockQuery.mock.calls[0]
    const [sql, params] = queryArgs
    expect(sql).toMatch(/key_hash = \$1/)
    expect(params[0]).toBe(VALID_HASH)
  })

  it('accepts a key with far-future expiry as valid', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...ACTIVE_ROW, expires_at: future }] })
      .mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApiKeyApp())
      .get('/protected')
      .set('X-API-Key', VALID_KEY)

    expect(res.status).toBe(200)
  })

  it('swallows DB error on fire-and-forget last_used_at UPDATE and still returns 200', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [ACTIVE_ROW] })           // key lookup
      .mockRejectedValueOnce(new Error('update failed'))        // last_used_at → catch(() => {})

    const res = await request(buildApiKeyApp())
      .get('/protected')
      .set('X-API-Key', VALID_KEY)

    expect(res.status).toBe(200)
    expect(res.body.merchant.sub).toBe(MERCHANT_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// requireAuthOrApiKey middleware
// ─────────────────────────────────────────────────────────────────────────────

describe('requireAuthOrApiKey middleware', () => {
  function buildHybridApp() {
    const app = express()
    app.use(express.json())
    app.get('/hybrid', requireAuthOrApiKey, (req: Request, res: Response) => {
      res.json({ merchant: (req as any).merchant })
    })
    return app
  }

  const VALID_KEY = 'op_' + 'b'.repeat(64)

  const ACTIVE_ROW = {
    id:          'key-id-2',
    merchant_id: MERCHANT_ID,
    name:        'Test Merchant',
    expires_at:  null,
  }

  it('uses API key path when X-API-Key header is present', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [ACTIVE_ROW] })
      .mockResolvedValueOnce({ rows: [] })

    const res = await request(buildHybridApp())
      .get('/hybrid')
      .set('X-API-Key', VALID_KEY)

    expect(res.status).toBe(200)
    expect(res.body.merchant).toMatchObject({ sub: MERCHANT_ID })
  })

  it('uses Bearer JWT path when no X-API-Key header is present', async () => {
    // requireAuth reads Redis for device binding
    const { redis } = require('../db/redis')
    ;(redis.get as jest.Mock).mockResolvedValueOnce('dev')

    const res = await request(buildHybridApp())
      .get('/hybrid')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.merchant).toMatchObject({ sub: MERCHANT_ID })
  })

  it('returns 401 when no credentials provided at all', async () => {
    const res = await request(buildHybridApp()).get('/hybrid')
    expect(res.status).toBe(401)
  })

  it('returns 401 when X-API-Key is present but invalid (non op_ prefix)', async () => {
    const res = await request(buildHybridApp())
      .get('/hybrid')
      .set('X-API-Key', 'bad_key_12345')
    expect(res.status).toBe(401)
  })

  it('returns 401 when X-API-Key is present but not found in DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildHybridApp())
      .get('/hybrid')
      .set('X-API-Key', VALID_KEY)
    expect(res.status).toBe(401)
  })

  it('returns 401 when Bearer token is invalid (no X-API-Key)', async () => {
    const res = await request(buildHybridApp())
      .get('/hybrid')
      .set('Authorization', 'Bearer invalid.token.here')
    expect(res.status).toBe(401)
  })
})

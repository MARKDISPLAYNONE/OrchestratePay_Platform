/**
 * Tests for routes/webhooks.ts and jobs/webhook-delivery.ts
 *
 * Route coverage:
 *   POST   /api/v1/webhooks              — register (201, 400, 500)
 *   GET    /api/v1/webhooks              — list (omits secrets)
 *   DELETE /api/v1/webhooks/:id          — soft-delete (200, 404)
 *   POST   /api/v1/webhooks/:id/test     — ping enqueue (202, 404)
 *   GET    /api/v1/webhooks/:id/deliveries — list (200, 404)
 *
 * Job coverage:
 *   runWebhookDeliveryJob  — successful delivery, non-2xx retry, 5th attempt FAILED, inactive skip
 *   enqueueWebhookEvent    — inserts for matching webhooks, silently handles errors
 */
process.env.NODE_ENV  = 'test'
process.env.JWT_SECRET = 'test-secret'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...a: any[]) => mockQuery(...a) },
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

const mockFetch = jest.fn()
global.fetch = mockFetch as any

// ── Imports ───────────────────────────────────────────────────────────────────

import request from 'supertest'
import express from 'express'
import jwt     from 'jsonwebtoken'
import { runWebhookDeliveryJob, enqueueWebhookEvent } from '../jobs/webhook-delivery'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MERCHANT_ID  = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee'
const WEBHOOK_ID   = 'f1111111-2222-4333-8444-555555555555'
const DELIVERY_ID  = 1

function merchantToken(deviceId = 'dev-1') {
  return jwt.sign(
    { sub: MERCHANT_ID, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret',
    { expiresIn: '1h' }
  )
}

function buildApp() {
  const app = express()
  app.use(express.json())
  // requireAuth calls redis for device binding — mock at the module level is not
  // needed because we mock the db; redis is mocked via the redis module mock.
  app.use('/api/v1/webhooks', require('../routes/webhooks').default)
  return app
}

// requireAuth checks Redis for device binding. We need the redis mock too.
// We set it up as a manual mock so that requireAuth passes.
jest.mock('../db/redis', () => ({
  redis: {
    get:    jest.fn().mockImplementation((key: string) => {
      if (key.startsWith('merchant:device:')) return Promise.resolve('dev-1')
      return Promise.resolve(null)
    }),
    setex:  jest.fn().mockResolvedValue('OK'),
    del:    jest.fn().mockResolvedValue(1),
    publish: jest.fn().mockResolvedValue(1),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockFetch.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/webhooks
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/webhooks', () => {
  const validBody = {
    url:    'https://merchant.example.com/webhooks',
    events: ['payment.confirmed', 'payment.failed'],
    name:   'My Webhook',
  }

  it('returns 401 without auth token', async () => {
    const res = await request(buildApp())
      .post('/api/v1/webhooks')
      .send(validBody)
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid URL', async () => {
    const res = await request(buildApp())
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...validBody, url: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/validation/i)
  })

  it('returns 400 when events array is empty', async () => {
    const res = await request(buildApp())
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...validBody, events: [] })
    expect(res.status).toBe(400)
  })

  it('returns 400 for unknown event type', async () => {
    const res = await request(buildApp())
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ ...validBody, events: ['payment.confirmed', 'bad.event'] })
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ url: 'https://example.com/hook', events: ['payment.confirmed'] })
    expect(res.status).toBe(400)
  })

  it('creates webhook and returns 201 with secret (once)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id:        WEBHOOK_ID,
        url:       validBody.url,
        events:    validBody.events,
        name:      validBody.name,
        active:    true,
        createdAt: new Date().toISOString(),
      }],
    })

    const res = await request(buildApp())
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(validBody)

    expect(res.status).toBe(201)
    expect(res.body.id).toBe(WEBHOOK_ID)
    expect(res.body.secret).toBeDefined()
    expect(typeof res.body.secret).toBe('string')
    expect(res.body.secret).toHaveLength(64)   // 32 bytes → 64 hex chars
    expect(res.body.active).toBe(true)
  })

  it('defaults events to payment.confirmed + payment.failed when omitted', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id:        WEBHOOK_ID,
        url:       validBody.url,
        events:    ['payment.confirmed', 'payment.failed'],
        name:      validBody.name,
        active:    true,
        createdAt: new Date().toISOString(),
      }],
    })

    const res = await request(buildApp())
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ url: validBody.url, name: validBody.name })  // no events field

    expect(res.status).toBe(201)
    // The INSERT should have been called with the default events array
    const insertCall = mockQuery.mock.calls[0]
    expect(insertCall[1][4]).toEqual(['payment.confirmed', 'payment.failed'])
  })

  it('returns 500 when DB insert fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection timeout'))

    const res = await request(buildApp())
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(validBody)

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/failed/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/webhooks
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/webhooks', () => {
  const dbRow = {
    id:             WEBHOOK_ID,
    url:            'https://merchant.example.com/webhooks',
    events:         ['payment.confirmed'],
    name:           'My Hook',
    active:         true,
    createdAt:      new Date().toISOString(),
    deliveredCount: '3',
    failedCount:    '1',
  }

  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).get('/api/v1/webhooks')
    expect(res.status).toBe(401)
  })

  it('returns list of webhooks without secret field', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dbRow] })

    const res = await request(buildApp())
      .get('/api/v1/webhooks')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.webhooks).toHaveLength(1)
    expect(res.body.webhooks[0].secret).toBeUndefined()
    expect(res.body.webhooks[0].id).toBe(WEBHOOK_ID)
  })

  it('includes 24h delivery stats', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dbRow] })

    const res = await request(buildApp())
      .get('/api/v1/webhooks')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.body.webhooks[0].stats24h).toEqual({ delivered: 3, failed: 1 })
  })

  it('returns empty array when merchant has no webhooks', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/webhooks')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.webhooks).toEqual([])
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Query failed'))

    const res = await request(buildApp())
      .get('/api/v1/webhooks')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/webhooks/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/webhooks/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).delete(`/api/v1/webhooks/${WEBHOOK_ID}`)
    expect(res.status).toBe(401)
  })

  it('soft-deletes the webhook and returns 200', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })

    const res = await request(buildApp())
      .delete(`/api/v1/webhooks/${WEBHOOK_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.active).toBe(false)
    expect(res.body.id).toBe(WEBHOOK_ID)
  })

  it('returns 404 when webhook not found or belongs to another merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 })

    const res = await request(buildApp())
      .delete('/api/v1/webhooks/nonexistent-id')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('returns 404 when rowCount is null', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null })

    const res = await request(buildApp())
      .delete(`/api/v1/webhooks/${WEBHOOK_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildApp())
      .delete(`/api/v1/webhooks/${WEBHOOK_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/webhooks/:id/test
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/webhooks/:id/test', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).post(`/api/v1/webhooks/${WEBHOOK_ID}/test`)
    expect(res.status).toBe(401)
  })

  it('enqueues a ping delivery and returns 202', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WEBHOOK_ID }] })  // ownership check
      .mockResolvedValueOnce({ rows: [] })                      // INSERT delivery

    const res = await request(buildApp())
      .post(`/api/v1/webhooks/${WEBHOOK_ID}/test`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(202)
    expect(res.body.queued).toBe(true)

    const insertCall = mockQuery.mock.calls[1]
    expect(String(insertCall[0])).toContain('webhook_deliveries')
    expect(JSON.parse(insertCall[1][1]).event).toBe('ping')
  })

  it('returns 404 when webhook not found or wrong merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .post('/api/v1/webhooks/bad-id/test')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error during ownership check', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildApp())
      .post(`/api/v1/webhooks/${WEBHOOK_ID}/test`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/webhooks/:id/deliveries
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/webhooks/:id/deliveries', () => {
  const deliveryRow = {
    id:          DELIVERY_ID,
    event:       'payment.confirmed',
    status:      'DELIVERED',
    attempt:     1,
    lastError:   null,
    deliveredAt: new Date().toISOString(),
    createdAt:   new Date().toISOString(),
  }

  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .get(`/api/v1/webhooks/${WEBHOOK_ID}/deliveries`)
    expect(res.status).toBe(401)
  })

  it('lists deliveries ordered by newest first', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WEBHOOK_ID }] })  // ownership check
      .mockResolvedValueOnce({ rows: [deliveryRow] })          // deliveries

    const res = await request(buildApp())
      .get(`/api/v1/webhooks/${WEBHOOK_ID}/deliveries`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.deliveries).toHaveLength(1)
    expect(res.body.deliveries[0].event).toBe('payment.confirmed')
    expect(res.body.deliveries[0].status).toBe('DELIVERED')
  })

  it('returns 404 when webhook not found or wrong merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/webhooks/bad-id/deliveries')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
  })

  it('returns empty deliveries array when no deliveries exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WEBHOOK_ID }] })
      .mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get(`/api/v1/webhooks/${WEBHOOK_ID}/deliveries`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.deliveries).toEqual([])
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildApp())
      .get(`/api/v1/webhooks/${WEBHOOK_ID}/deliveries`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runWebhookDeliveryJob
// ─────────────────────────────────────────────────────────────────────────────

describe('runWebhookDeliveryJob', () => {
  const pendingDelivery = {
    id:            DELIVERY_ID,
    webhookId:     WEBHOOK_ID,
    event:         'payment.confirmed',
    payload:       { event: 'payment.confirmed', txnId: 'txn-123' },
    attempt:       0,
    url:           'https://merchant.example.com/hook',
    secret:        'mysecretkey',
    webhookActive: true,
  }

  it('delivers successfully and marks DELIVERED on 2xx response', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [pendingDelivery] })  // SELECT
    mockFetch.mockResolvedValueOnce({ status: 200 })
    mockQuery.mockResolvedValueOnce({ rows: [] })  // UPDATE DELIVERED

    await runWebhookDeliveryJob()

    const updateCall = mockQuery.mock.calls[1]
    expect(String(updateCall[0])).toContain("'DELIVERED'")
  })

  it('sets correct HMAC-SHA256 signature header', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [pendingDelivery] })
    mockFetch.mockResolvedValueOnce({ status: 200 })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runWebhookDeliveryJob()

    const [, fetchOptions] = mockFetch.mock.calls[0]
    const sig = fetchOptions.headers['X-Orchestratepay-Signature']
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(fetchOptions.headers['X-Orchestratepay-Event']).toBe('payment.confirmed')
  })

  it('increments attempt and keeps PENDING on non-2xx response', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...pendingDelivery, attempt: 1 }] })
    mockFetch.mockResolvedValueOnce({ status: 503 })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runWebhookDeliveryJob()

    const updateCall = mockQuery.mock.calls[1]
    expect(updateCall[1][0]).toBe(2)           // attempt = 2
    expect(updateCall[1][2]).toBe('PENDING')   // still retryable
  })

  it('marks FAILED after 5th attempt (attempt was 4)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...pendingDelivery, attempt: 4 }] })
    mockFetch.mockResolvedValueOnce({ status: 500 })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runWebhookDeliveryJob()

    const updateCall = mockQuery.mock.calls[1]
    expect(updateCall[1][0]).toBe(5)           // attempt = 5
    expect(updateCall[1][2]).toBe('FAILED')    // terminal
  })

  it('increments attempt and retries on network error (fetch throws)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...pendingDelivery, attempt: 2 }] })
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runWebhookDeliveryJob()

    const updateCall = mockQuery.mock.calls[1]
    expect(updateCall[1][0]).toBe(3)           // attempt incremented
    expect(updateCall[1][1]).toBe('ECONNREFUSED')
  })

  it('skips inactive webhooks without making a fetch call', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...pendingDelivery, webhookActive: false }],
    })

    await runWebhookDeliveryJob()

    expect(mockFetch).not.toHaveBeenCalled()
    // Only one query call (the SELECT) — no UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('handles no pending deliveries gracefully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(runWebhookDeliveryJob()).resolves.not.toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not propagate top-level DB errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'))

    await expect(runWebhookDeliveryJob()).resolves.not.toThrow()
  })

  it('delivers on 201 (also 2xx)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [pendingDelivery] })
    mockFetch.mockResolvedValueOnce({ status: 201 })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runWebhookDeliveryJob()

    const updateCall = mockQuery.mock.calls[1]
    expect(String(updateCall[0])).toContain("'DELIVERED'")
  })

  it('fires abort timeout after DELIVERY_TIMEOUT_MS and records AbortError as network error', async () => {
    jest.useFakeTimers()
    try {
      mockQuery.mockResolvedValueOnce({ rows: [pendingDelivery] })  // SELECT

      // fetch that only rejects once the AbortSignal fires
      mockFetch.mockImplementationOnce((_url: string, opts: any) =>
        new Promise((_res, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
          })
        })
      )
      mockQuery.mockResolvedValueOnce({ rows: [] })  // UPDATE retry

      const jobPromise = runWebhookDeliveryJob()

      // Let db.query resolve and the job reach `await fetch()`
      await Promise.resolve()
      await Promise.resolve()

      // Fire the 10-second abort timer
      jest.runAllTimers()

      // Let the AbortError propagate through the catch block
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      await jobPromise

      const updateCall = mockQuery.mock.calls[1]
      expect(updateCall[1][1]).toMatch(/aborted/i)  // error message stored
      expect(String(updateCall[0])).toContain('attempt')
    } finally {
      jest.useRealTimers()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// enqueueWebhookEvent
// ─────────────────────────────────────────────────────────────────────────────

describe('enqueueWebhookEvent', () => {
  it('inserts a delivery row for each matching active webhook', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WEBHOOK_ID }, { id: 'other-hook-id' }] })  // find hooks
      .mockResolvedValueOnce({ rows: [] })  // INSERT 1
      .mockResolvedValueOnce({ rows: [] })  // INSERT 2

    await enqueueWebhookEvent(MERCHANT_ID, 'payment.confirmed', { txnId: 'txn-abc' })

    expect(mockQuery).toHaveBeenCalledTimes(3)

    const insert1 = mockQuery.mock.calls[1]
    expect(String(insert1[0])).toContain('webhook_deliveries')
    expect(insert1[1][1]).toBe('payment.confirmed')
  })

  it('does nothing when no active webhooks match the event', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await enqueueWebhookEvent(MERCHANT_ID, 'payment.confirmed', {})

    // Only the SELECT — no INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('does not propagate errors from the SELECT query', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    await expect(
      enqueueWebhookEvent(MERCHANT_ID, 'payment.confirmed', {})
    ).resolves.not.toThrow()
  })

  it('continues inserting remaining webhooks when one INSERT fails', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WEBHOOK_ID }, { id: 'hook-2' }] })
      .mockRejectedValueOnce(new Error('Insert failed'))   // first INSERT fails
      .mockResolvedValueOnce({ rows: [] })                  // second INSERT succeeds

    await expect(
      enqueueWebhookEvent(MERCHANT_ID, 'payment.failed', { txnId: 'txn-xyz' })
    ).resolves.not.toThrow()

    // Both INSERTs were attempted
    expect(mockQuery).toHaveBeenCalledTimes(3)
  })
})

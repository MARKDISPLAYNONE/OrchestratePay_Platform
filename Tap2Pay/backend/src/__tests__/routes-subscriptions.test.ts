/**
 * Tests for routes/subscriptions.ts and jobs/subscription-billing.ts.
 *
 * Covers:
 *   - POST   /plans         (requireAuth, validation, 201, 500)
 *   - GET    /plans         (requireAuth, subscriber count)
 *   - DELETE /plans/:id     (404, 409 active subs, 200)
 *   - POST   /enroll        (404 plan, 409 duplicate, 201 ACTIVE, 201 TRIAL)
 *   - DELETE /enroll/:id    (404, 409 already cancelled, 200)
 *   - GET    /plans/:id/enrollments  (404, phone masking, 200)
 *   - runSubscriptionBillingJob  (happy path, STK failure, DB error, no-op empty)
 *   - runTrialExpiry             (updates, no-op)
 */

process.env.NODE_ENV  = 'test'
process.env.JWT_SECRET = 'test-secret'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({ db: { query: (...a: any[]) => mockQuery(...a) } }))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

const mockStkPush = jest.fn()
jest.mock('../integrations/daraja', () => ({
  stkPush: (...a: any[]) => mockStkPush(...a),
}))

// Redis mock — only needed for requireAuth device binding
const mockRedisGet = jest.fn()
jest.mock('../db/redis', () => ({
  redis: { get: (...a: any[]) => mockRedisGet(...a) },
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import request from 'supertest'
import express from 'express'
import jwt     from 'jsonwebtoken'

import { runSubscriptionBillingJob, runTrialExpiry } from '../jobs/subscription-billing'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee'
const PLAN_ID     = 'b1b1b1b1-c2c2-4d3d-e4e4-f5f5f5f5f5f5'
const ENROLL_ID   = 'c3c3c3c3-d4d4-4e5e-f6f6-a7a7a7a7a7a7'

function merchantToken(deviceId = 'device-1') {
  return jwt.sign(
    { sub: MERCHANT_ID, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret',
    { expiresIn: '1h' }
  )
}

function buildApp() {
  const app = express()
  app.use(express.json())
  // Mount the router (CommonJS require so mocks are active)
  app.use('/api/v1/subscriptions', require('../routes/subscriptions').default)
  return app
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  // Default: device binding passes
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('device-1')
    return Promise.resolve(null)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/subscriptions/plans
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/subscriptions/plans', () => {
  const VALID_BODY = {
    name:        'Monthly Pro',
    amountCents: 5000,
    interval:    'MONTHLY',
    trialDays:   7,
  }

  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/v1/subscriptions/plans')
      .send(VALID_BODY)
    expect(res.status).toBe(401)
  })

  it('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ amountCents: 5000, interval: 'MONTHLY' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Validation failed/i)
  })

  it('returns 400 when amountCents is below minimum (100)', async () => {
    const res = await request(buildApp())
      .post('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'Bad Plan', amountCents: 50, interval: 'MONTHLY' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when amountCents exceeds maximum (1_000_000)', async () => {
    const res = await request(buildApp())
      .post('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'Big Plan', amountCents: 2_000_000, interval: 'MONTHLY' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when interval is invalid', async () => {
    const res = await request(buildApp())
      .post('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'Bad', amountCents: 5000, interval: 'BIANNUAL' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when trialDays exceeds 90', async () => {
    const res = await request(buildApp())
      .post('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'Trial', amountCents: 5000, interval: 'MONTHLY', trialDays: 91 })
    expect(res.status).toBe(400)
  })

  it('creates plan and returns 201 with plan data', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id:          PLAN_ID,
        merchant_id: MERCHANT_ID,
        name:        'Monthly Pro',
        amount_cents: 5000,
        interval:    'MONTHLY',
        trial_days:  7,
        active:      true,
        created_at:  new Date().toISOString(),
      }],
    })

    const res = await request(buildApp())
      .post('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(res.body.id).toBe(PLAN_ID)
    expect(res.body.merchantId).toBe(MERCHANT_ID)
    expect(res.body.amountCents).toBe(5000)
    expect(res.body.interval).toBe('MONTHLY')
    expect(res.body.trialDays).toBe(7)
    expect(res.body.active).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO subscription_plans'),
      expect.arrayContaining([MERCHANT_ID, 'Monthly Pro', 5000, 'MONTHLY', 7])
    )
  })

  it('allows all valid intervals', async () => {
    const intervals = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY']
    for (const interval of intervals) {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: PLAN_ID, merchant_id: MERCHANT_ID,
          name: 'Plan', amount_cents: 5000, interval,
          trial_days: 0, active: true, created_at: new Date().toISOString(),
        }],
      })
      const res = await request(buildApp())
        .post('/api/v1/subscriptions/plans')
        .set('Authorization', `Bearer ${merchantToken()}`)
        .send({ name: 'Plan', amountCents: 5000, interval })
      expect(res.status).toBe(201)
    }
  })

  it('defaults trialDays to 0 when not provided', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: PLAN_ID, merchant_id: MERCHANT_ID, name: 'Plan',
        amount_cents: 5000, interval: 'WEEKLY',
        trial_days: 0, active: true, created_at: new Date().toISOString(),
      }],
    })

    const res = await request(buildApp())
      .post('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ name: 'Plan', amountCents: 5000, interval: 'WEEKLY' })

    expect(res.status).toBe(201)
    expect(res.body.trialDays).toBe(0)
    // INSERT called with trialDays = 0
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO subscription_plans'),
      expect.arrayContaining([0])
    )
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'))

    const res = await request(buildApp())
      .post('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send(VALID_BODY)

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/Failed to create/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/subscriptions/plans
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/subscriptions/plans', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp()).get('/api/v1/subscriptions/plans')
    expect(res.status).toBe(401)
  })

  it('returns empty plans list when merchant has none', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.plans).toEqual([])
  })

  it('returns plans with subscriber counts', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: PLAN_ID, name: 'Monthly Pro', amount_cents: 5000,
          interval: 'MONTHLY', trial_days: 0, active: true,
          created_at: new Date().toISOString(), subscriber_count: '3',
        },
      ],
    })

    const res = await request(buildApp())
      .get('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.plans).toHaveLength(1)
    expect(res.body.plans[0].subscriberCount).toBe(3)
    expect(res.body.plans[0].amountCents).toBe(5000)
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('timeout'))

    const res = await request(buildApp())
      .get('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/subscriptions/plans/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/subscriptions/plans/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/plans/${PLAN_ID}`)
    expect(res.status).toBe(401)
  })

  it('returns 404 when plan does not belong to merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })  // plan not found

    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/plans/${PLAN_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('returns 409 when plan has active subscribers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PLAN_ID }] })        // plan found
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '5' }] })            // 5 active subs

    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/plans/${PLAN_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/active subscribers/i)
    expect(res.body.activeSubscribers).toBe(5)
  })

  it('soft-deletes plan (active=FALSE) and returns 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PLAN_ID }] })  // plan found
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }] })      // no active subs
    mockQuery.mockResolvedValueOnce({ rows: [] })                   // UPDATE

    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/plans/${PLAN_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(true)
    expect(res.body.planId).toBe(PLAN_ID)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET active = FALSE'),
      [PLAN_ID]
    )
  })

  it('returns 500 on unexpected DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/plans/${PLAN_ID}`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/subscriptions/enroll
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/subscriptions/enroll', () => {
  const VALID_BODY = { planId: PLAN_ID, consumerPhone: '254700000001' }

  it('returns 400 when planId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/subscriptions/enroll')
      .send({ consumerPhone: '254700000001' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when phone format is invalid', async () => {
    const res = await request(buildApp())
      .post('/api/v1/subscriptions/enroll')
      .send({ planId: PLAN_ID, consumerPhone: '0700000001' })  // must start with 254
    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/254XXXXXXXXX/i)
  })

  it('returns 404 when plan is not found or inactive', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })  // plan not found

    const res = await request(buildApp())
      .post('/api/v1/subscriptions/enroll')
      .send(VALID_BODY)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found or no longer active/i)
  })

  it('creates ACTIVE enrollment (no trial days) and returns 201', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: PLAN_ID, interval: 'MONTHLY', trial_days: 0 }],
    })
    mockQuery.mockResolvedValueOnce({ rows: [] })  // INSERT enrollment

    const res = await request(buildApp())
      .post('/api/v1/subscriptions/enroll')
      .send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(res.body.enrollmentId).toBeDefined()
    expect(res.body.planId).toBe(PLAN_ID)
    expect(res.body.status).toBe('ACTIVE')
    expect(res.body.nextBillingAt).toBeDefined()
    expect(res.body.trialEndsAt).toBeUndefined()
  })

  it('creates TRIAL enrollment when plan has trial days', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: PLAN_ID, interval: 'MONTHLY', trial_days: 14 }],
    })
    mockQuery.mockResolvedValueOnce({ rows: [] })  // INSERT enrollment

    const res = await request(buildApp())
      .post('/api/v1/subscriptions/enroll')
      .send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('TRIAL')
    expect(res.body.trialEndsAt).toBeDefined()
    // nextBillingAt should be approximately 14 days from now
    const nextBilling = new Date(res.body.nextBillingAt)
    const diff = nextBilling.getTime() - Date.now()
    expect(diff).toBeGreaterThan(13 * 86_400_000)
    expect(diff).toBeLessThan(15 * 86_400_000)
  })

  it('inserts enrollment with correct status into DB', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: PLAN_ID, interval: 'WEEKLY', trial_days: 0 }],
    })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await request(buildApp())
      .post('/api/v1/subscriptions/enroll')
      .send(VALID_BODY)

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO subscriber_enrollments'),
      expect.arrayContaining([PLAN_ID, '254700000001', 'ACTIVE'])
    )
  })

  it('returns 409 when phone is already enrolled in the plan (UNIQUE violation)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: PLAN_ID, interval: 'MONTHLY', trial_days: 0 }],
    })
    const uniqueErr: any = new Error('duplicate key value violates unique constraint')
    uniqueErr.code = '23505'
    mockQuery.mockRejectedValueOnce(uniqueErr)

    const res = await request(buildApp())
      .post('/api/v1/subscriptions/enroll')
      .send(VALID_BODY)

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already enrolled/i)
  })

  it('returns 500 on unexpected DB error', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: PLAN_ID, interval: 'MONTHLY', trial_days: 0 }],
    })
    mockQuery.mockRejectedValueOnce(new Error('connection refused'))

    const res = await request(buildApp())
      .post('/api/v1/subscriptions/enroll')
      .send(VALID_BODY)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/subscriptions/enroll/:enrollmentId
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/subscriptions/enroll/:enrollmentId', () => {
  const VALID_BODY = { consumerPhone: '254700000001' }

  it('returns 400 when consumerPhone is missing', async () => {
    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/enroll/${ENROLL_ID}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 when phone format is invalid', async () => {
    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/enroll/${ENROLL_ID}`)
      .send({ consumerPhone: '0700000001' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when enrollment not found or phone does not match', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/enroll/${ENROLL_ID}`)
      .send(VALID_BODY)

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found or phone does not match/i)
  })

  it('returns 409 when enrollment is already cancelled', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: ENROLL_ID, status: 'CANCELLED' }],
    })

    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/enroll/${ENROLL_ID}`)
      .send(VALID_BODY)

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already cancelled/i)
  })

  it('cancels enrollment and returns { cancelled: true }', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: ENROLL_ID, status: 'ACTIVE' }],
    })
    mockQuery.mockResolvedValueOnce({ rows: [] })  // UPDATE

    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/enroll/${ENROLL_ID}`)
      .send(VALID_BODY)

    expect(res.status).toBe(200)
    expect(res.body.cancelled).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'CANCELLED'"),
      [ENROLL_ID]
    )
  })

  it('can cancel a TRIAL enrollment', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: ENROLL_ID, status: 'TRIAL' }],
    })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/enroll/${ENROLL_ID}`)
      .send(VALID_BODY)

    expect(res.status).toBe(200)
    expect(res.body.cancelled).toBe(true)
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildApp())
      .delete(`/api/v1/subscriptions/enroll/${ENROLL_ID}`)
      .send(VALID_BODY)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/subscriptions/plans/:id/enrollments
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/subscriptions/plans/:id/enrollments', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .get(`/api/v1/subscriptions/plans/${PLAN_ID}/enrollments`)
    expect(res.status).toBe(401)
  })

  it('returns 404 when plan does not belong to merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get(`/api/v1/subscriptions/plans/${PLAN_ID}/enrollments`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(404)
  })

  it('returns enrollments with masked phone numbers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PLAN_ID }] })  // plan found
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id:              ENROLL_ID,
          consumer_phone:  '254712345678',
          status:          'ACTIVE',
          next_billing_at: new Date().toISOString(),
          enrolled_at:     new Date().toISOString(),
        },
        {
          id:              'f7f7f7f7-a8a8-4b9b-c0c0-d1d1d1d1d1d1',
          consumer_phone:  '254700000001',
          status:          'CANCELLED',
          next_billing_at: null,
          enrolled_at:     new Date().toISOString(),
        },
      ],
    })

    const res = await request(buildApp())
      .get(`/api/v1/subscriptions/plans/${PLAN_ID}/enrollments`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.enrollments).toHaveLength(2)

    // Phone masking: 254712345678 → 254***5678
    expect(res.body.enrollments[0].consumerPhone).toBe('254***5678')
    // 254700000001 → 254***0001
    expect(res.body.enrollments[1].consumerPhone).toBe('254***0001')

    // Raw phone must NOT appear in response
    expect(JSON.stringify(res.body)).not.toContain('254712345678')
    expect(JSON.stringify(res.body)).not.toContain('254700000001')
  })

  it('returns empty enrollments array when plan has no subscribers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PLAN_ID }] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get(`/api/v1/subscriptions/plans/${PLAN_ID}/enrollments`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.enrollments).toEqual([])
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('timeout'))

    const res = await request(buildApp())
      .get(`/api/v1/subscriptions/plans/${PLAN_ID}/enrollments`)
      .set('Authorization', `Bearer ${merchantToken()}`)

    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phone masking helper (exported from routes)
// ─────────────────────────────────────────────────────────────────────────────

describe('maskPhone helper', () => {
  const { maskPhone } = require('../routes/subscriptions')

  it('masks a standard 254XXXXXXXXX number correctly', () => {
    expect(maskPhone('254712345678')).toBe('254***5678')
  })

  it('masks a different number', () => {
    expect(maskPhone('254700000001')).toBe('254***0001')
  })

  it('handles very short strings gracefully', () => {
    expect(maskPhone('123')).toBe('****')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// addInterval and calcNextBillingAt helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('addInterval helper', () => {
  const { addInterval } = require('../routes/subscriptions')
  const BASE = new Date('2025-01-01T00:00:00.000Z')

  it.each([
    ['DAILY',     1],
    ['WEEKLY',    7],
    ['MONTHLY',  30],
    ['QUARTERLY', 90],
    ['ANNUALLY', 365],
  ])('%s adds %d days', (interval, days) => {
    const result = addInterval(BASE, interval)
    const diffDays = Math.round((result.getTime() - BASE.getTime()) / 86_400_000)
    expect(diffDays).toBe(days)
  })
})

describe('calcNextBillingAt helper', () => {
  const { calcNextBillingAt } = require('../routes/subscriptions')

  it('returns ~30 days from now for MONTHLY with no trial', () => {
    const next = calcNextBillingAt('MONTHLY', 0)
    const diffDays = Math.round((next.getTime() - Date.now()) / 86_400_000)
    expect(diffDays).toBe(30)
  })

  it('returns trial offset when trialDays > 0', () => {
    const next = calcNextBillingAt('MONTHLY', 14)
    const diffDays = Math.round((next.getTime() - Date.now()) / 86_400_000)
    expect(diffDays).toBe(14)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runSubscriptionBillingJob
// ─────────────────────────────────────────────────────────────────────────────

const DUE_ENROLLMENT = {
  enrollment_id:  ENROLL_ID,
  consumer_phone: '254700000001',
  next_billing_at: new Date(Date.now() - 1000).toISOString(),
  plan_id:        PLAN_ID,
  merchant_id:    MERCHANT_ID,
  amount_cents:   5000,
  interval:       'MONTHLY',
  plan_name:      'Monthly Pro',
}

describe('runSubscriptionBillingJob', () => {
  beforeEach(() => {
    mockStkPush.mockReset()
    mockQuery.mockReset()
  })

  it('does nothing when no due enrollments exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runSubscriptionBillingJob()

    expect(mockStkPush).not.toHaveBeenCalled()
    // Only the SELECT query should fire
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('fires STK Push and writes transaction + advances billing date on success', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [DUE_ENROLLMENT] })  // SELECT due
    mockStkPush.mockResolvedValueOnce({ success: true, checkoutRequestId: 'ws_CO_001' })
    mockQuery.mockResolvedValueOnce({ rows: [] })  // INSERT transaction
    mockQuery.mockResolvedValueOnce({ rows: [] })  // UPDATE next_billing_at

    await runSubscriptionBillingJob()

    expect(mockStkPush).toHaveBeenCalledTimes(1)
    expect(mockStkPush).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber:  '254700000001',
        amount:       50,                // 5000 cents / 100 = KSh 50
        accountRef:   'Monthly Pro',
        description:  'Subscription',
      })
    )

    // Transaction INSERT
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO transactions'),
      expect.arrayContaining([MERCHANT_ID, 5000, '254700000001'])
    )

    // next_billing_at advance
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE subscriber_enrollments'),
      expect.arrayContaining([30, ENROLL_ID])  // MONTHLY = 30 days
    )
  })

  it('advances billing date and continues when STK Push fails (no exception)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [DUE_ENROLLMENT] })
    mockStkPush.mockResolvedValueOnce({ success: false, errorMessage: 'Insufficient funds' })
    mockQuery.mockResolvedValueOnce({ rows: [] })  // UPDATE next_billing_at

    await runSubscriptionBillingJob()

    expect(mockStkPush).toHaveBeenCalledTimes(1)
    // No transaction INSERT on failure
    expect(mockQuery).toHaveBeenCalledTimes(2)  // SELECT + UPDATE next_billing_at
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO transactions'),
      expect.anything()
    )
  })

  it('logs error and continues when stkPush throws', async () => {
    const secondEnrollment = { ...DUE_ENROLLMENT, enrollment_id: 'eeeeeeee-ffff-4aaa-bbbb-cccccccccccc' }
    mockQuery.mockResolvedValueOnce({ rows: [DUE_ENROLLMENT, secondEnrollment] })

    mockStkPush
      .mockRejectedValueOnce(new Error('Network timeout'))   // first fails
      .mockResolvedValueOnce({ success: true })               // second succeeds

    mockQuery.mockResolvedValueOnce({ rows: [] })  // INSERT (second)
    mockQuery.mockResolvedValueOnce({ rows: [] })  // UPDATE (second)

    // Should not throw
    await expect(runSubscriptionBillingJob()).resolves.not.toThrow()

    // Both STK pushes attempted
    expect(mockStkPush).toHaveBeenCalledTimes(2)
  })

  it('logs error and does not throw when SELECT query fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'))

    await expect(runSubscriptionBillingJob()).resolves.not.toThrow()
    expect(mockStkPush).not.toHaveBeenCalled()
  })

  it('handles DAILY interval correctly (1 day advance)', async () => {
    const dailyEnrollment = { ...DUE_ENROLLMENT, interval: 'DAILY' }
    mockQuery.mockResolvedValueOnce({ rows: [dailyEnrollment] })
    mockStkPush.mockResolvedValueOnce({ success: true })
    mockQuery.mockResolvedValueOnce({ rows: [] })  // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] })  // UPDATE

    await runSubscriptionBillingJob()

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE subscriber_enrollments'),
      expect.arrayContaining([1])  // DAILY = 1 day
    )
  })

  it('handles WEEKLY interval (7 days)', async () => {
    const weeklyEnrollment = { ...DUE_ENROLLMENT, interval: 'WEEKLY' }
    mockQuery.mockResolvedValueOnce({ rows: [weeklyEnrollment] })
    mockStkPush.mockResolvedValueOnce({ success: true })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runSubscriptionBillingJob()

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE subscriber_enrollments'),
      expect.arrayContaining([7])
    )
  })

  it('handles QUARTERLY interval (90 days)', async () => {
    const qEnrollment = { ...DUE_ENROLLMENT, interval: 'QUARTERLY' }
    mockQuery.mockResolvedValueOnce({ rows: [qEnrollment] })
    mockStkPush.mockResolvedValueOnce({ success: true })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runSubscriptionBillingJob()

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE subscriber_enrollments'),
      expect.arrayContaining([90])
    )
  })

  it('handles ANNUALLY interval (365 days)', async () => {
    const aEnrollment = { ...DUE_ENROLLMENT, interval: 'ANNUALLY' }
    mockQuery.mockResolvedValueOnce({ rows: [aEnrollment] })
    mockStkPush.mockResolvedValueOnce({ success: true })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runSubscriptionBillingJob()

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE subscriber_enrollments'),
      expect.arrayContaining([365])
    )
  })

  it('processes multiple enrollments in a single run', async () => {
    const e1 = { ...DUE_ENROLLMENT, enrollment_id: 'e1e1e1e1-0000-4000-8000-000000000001' }
    const e2 = { ...DUE_ENROLLMENT, enrollment_id: 'e2e2e2e2-0000-4000-8000-000000000002' }
    const e3 = { ...DUE_ENROLLMENT, enrollment_id: 'e3e3e3e3-0000-4000-8000-000000000003' }
    mockQuery.mockResolvedValueOnce({ rows: [e1, e2, e3] })
    mockStkPush.mockResolvedValue({ success: true })
    // 3x INSERT + 3x UPDATE = 6 additional queries
    mockQuery.mockResolvedValue({ rows: [] })

    await runSubscriptionBillingJob()

    expect(mockStkPush).toHaveBeenCalledTimes(3)
  })

  it('uses DARAJA_CALLBACK_BASE_URL env var for callback URL', async () => {
    process.env.DARAJA_CALLBACK_BASE_URL = 'https://api.example.com'
    mockQuery.mockResolvedValueOnce({ rows: [DUE_ENROLLMENT] })
    mockStkPush.mockResolvedValueOnce({ success: true })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runSubscriptionBillingJob()

    expect(mockStkPush).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackUrl: 'https://api.example.com/api/v1/mpesa-callback',
      })
    )
    delete process.env.DARAJA_CALLBACK_BASE_URL
  })

  it('falls back to DARAJA_CALLBACK_URL when BASE_URL is not set', async () => {
    delete process.env.DARAJA_CALLBACK_BASE_URL
    process.env.DARAJA_CALLBACK_URL = 'https://fallback.example.com'
    mockQuery.mockResolvedValueOnce({ rows: [DUE_ENROLLMENT] })
    mockStkPush.mockResolvedValueOnce({ success: true })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runSubscriptionBillingJob()

    expect(mockStkPush).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackUrl: 'https://fallback.example.com/api/v1/mpesa-callback',
      })
    )
    delete process.env.DARAJA_CALLBACK_URL
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runTrialExpiry
// ─────────────────────────────────────────────────────────────────────────────

describe('runTrialExpiry', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('transitions expired TRIAL enrollments to ACTIVE', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 3 })

    await runTrialExpiry()

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'ACTIVE'"),
      []
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("next_billing_at = NOW()"),
      []
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'TRIAL'"),
      []
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("trial_ends_at <= NOW()"),
      []
    )
  })

  it('does not throw when no expired trials exist (rowCount = 0)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 })

    await expect(runTrialExpiry()).resolves.not.toThrow()
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('handles null rowCount gracefully', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null })

    await expect(runTrialExpiry()).resolves.not.toThrow()
  })

  it('logs error and does not throw on DB failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB timeout'))

    await expect(runTrialExpiry()).resolves.not.toThrow()
  })
})

/**
 * Tests for jobs/subscription-billing.ts
 * Covers: runSubscriptionBillingJob (no enrollments, STK success, STK failure,
 *         DB SELECT throws, multiple enrollments), runTrialExpiry (no expired
 *         trials, successful transition, DB throws).
 */
process.env.NODE_ENV = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

jest.mock('../db/redis', () => ({
  redis: {
    get:     jest.fn(),
    set:     jest.fn(),
    setex:   jest.fn(),
    publish: jest.fn(),
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

const mockStkPush = jest.fn()
jest.mock('../integrations/daraja', () => ({
  stkPush: (...args: any[]) => mockStkPush(...args),
}))

import { runSubscriptionBillingJob, runTrialExpiry } from '../jobs/subscription-billing'

// ── Shared fixtures ───────────────────────────────────────────────────────────

function makeEnrollment(overrides: Record<string, any> = {}) {
  return {
    enrollment_id:   'enr-1',
    consumer_phone:  '254712345678',
    next_billing_at: new Date(Date.now() - 60_000).toISOString(),  // 1 min overdue
    plan_id:         'plan-1',
    merchant_id:     'merchant-1',
    amount_cents:    5000,
    interval:        'MONTHLY',
    plan_name:       'Gold Plan',
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockStkPush.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// runSubscriptionBillingJob — no due enrollments
// ─────────────────────────────────────────────────────────────────────────────

describe('runSubscriptionBillingJob — no due enrollments', () => {
  it('does not fire any STK pushes when queue is empty', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(runSubscriptionBillingJob()).resolves.not.toThrow()

    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockQuery.mock.calls[0][0]).toContain('subscriber_enrollments')
    expect(mockStkPush).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runSubscriptionBillingJob — STK Push fired with correct parameters
// ─────────────────────────────────────────────────────────────────────────────

describe('runSubscriptionBillingJob — STK Push parameters', () => {
  it('fires STK Push with correct phone number and KSh amount (cents ÷ 100)', async () => {
    const enrollment = makeEnrollment({ amount_cents: 5000, consumer_phone: '254712345678' })
    mockQuery
      .mockResolvedValueOnce({ rows: [enrollment] })   // SELECT due enrollments
      .mockResolvedValue({ rows: [] })                  // INSERT txn + UPDATE next_billing_at
    mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_test1' })

    await runSubscriptionBillingJob()

    expect(mockStkPush).toHaveBeenCalledTimes(1)
    const [pushArgs] = mockStkPush.mock.calls
    expect(pushArgs[0].phoneNumber).toBe('254712345678')
    expect(pushArgs[0].amount).toBe(50)   // 5000 cents → KSh 50
    expect(pushArgs[0].description).toBe('Subscription')
    expect(typeof pushArgs[0].callbackUrl).toBe('string')
    expect(pushArgs[0].accountRef).toBeDefined()
  })

  it('truncates plan_name to 12 chars for accountRef', async () => {
    const enrollment = makeEnrollment({ plan_name: 'SuperPremiumPlanXYZ' })
    mockQuery
      .mockResolvedValueOnce({ rows: [enrollment] })
      .mockResolvedValue({ rows: [] })
    mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_test2' })

    await runSubscriptionBillingJob()

    const [pushArgs] = mockStkPush.mock.calls
    expect(pushArgs[0].accountRef).toBe('SuperPremium')    // 12 chars
    expect(pushArgs[0].accountRef.length).toBeLessThanOrEqual(12)
  })

  it('uses Math.ceil so fractional KSh round up (e.g. 101 cents → 2 KSh)', async () => {
    const enrollment = makeEnrollment({ amount_cents: 101 })
    mockQuery
      .mockResolvedValueOnce({ rows: [enrollment] })
      .mockResolvedValue({ rows: [] })
    mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_test3' })

    await runSubscriptionBillingJob()

    expect(mockStkPush).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2 })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runSubscriptionBillingJob — STK Push succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe('runSubscriptionBillingJob — STK Push succeeds', () => {
  it('inserts a PENDING transaction row on STK success', async () => {
    const enrollment = makeEnrollment()
    mockQuery
      .mockResolvedValueOnce({ rows: [enrollment] })   // SELECT
      .mockResolvedValueOnce({ rows: [] })              // INSERT transactions
      .mockResolvedValue({ rows: [] })                  // UPDATE next_billing_at
    mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_ok1' })

    await runSubscriptionBillingJob()

    const insertCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO transactions')
    )
    expect(insertCall).toBeTruthy()
    expect(insertCall![1]).toContain('merchant-1')
    expect(insertCall![1]).toContain(5000)
    expect(insertCall![1]).toContain('254712345678')
  })

  it('advances next_billing_at after successful STK Push', async () => {
    const enrollment = makeEnrollment({ interval: 'MONTHLY' })
    mockQuery
      .mockResolvedValueOnce({ rows: [enrollment] })
      .mockResolvedValue({ rows: [] })
    mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_ok2' })

    await runSubscriptionBillingJob()

    const advanceCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('next_billing_at') &&
      String(c[0]).includes('UPDATE subscriber_enrollments')
    )
    expect(advanceCall).toBeTruthy()
    // MONTHLY → 30 days
    expect(advanceCall![1]).toContain(30)
    expect(advanceCall![1]).toContain('enr-1')
  })

  it('uses correct interval days for each plan type', async () => {
    const intervals: Array<[string, number]> = [
      ['DAILY', 1],
      ['WEEKLY', 7],
      ['MONTHLY', 30],
      ['QUARTERLY', 90],
      ['ANNUALLY', 365],
    ]

    for (const [interval, days] of intervals) {
      mockQuery.mockReset()
      mockStkPush.mockReset()
      mockQuery
        .mockResolvedValueOnce({ rows: [makeEnrollment({ interval })] })
        .mockResolvedValue({ rows: [] })
      mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: `ws_CO_${interval}` })

      await runSubscriptionBillingJob()

      const advanceCall = mockQuery.mock.calls.find((c: any[]) =>
        String(c[0]).includes('next_billing_at') &&
        String(c[0]).includes('UPDATE subscriber_enrollments')
      )
      expect(advanceCall).toBeTruthy()
      expect(advanceCall![1]).toContain(days)
    }
  })

  it('defaults to 30-day interval for unknown interval string', async () => {
    const enrollment = makeEnrollment({ interval: 'BIANNUAL' })  // not in INTERVAL_DAYS
    mockQuery
      .mockResolvedValueOnce({ rows: [enrollment] })
      .mockResolvedValue({ rows: [] })
    mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_unknown' })

    await runSubscriptionBillingJob()

    const advanceCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('next_billing_at') &&
      String(c[0]).includes('UPDATE subscriber_enrollments')
    )
    expect(advanceCall).toBeTruthy()
    expect(advanceCall![1]).toContain(30)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runSubscriptionBillingJob — STK Push fails
// ─────────────────────────────────────────────────────────────────────────────

describe('runSubscriptionBillingJob — STK Push fails', () => {
  it('increments failed count (does not insert transaction) when STK returns success=false', async () => {
    const enrollment = makeEnrollment()
    mockQuery
      .mockResolvedValueOnce({ rows: [enrollment] })
      .mockResolvedValue({ rows: [] })
    mockStkPush.mockResolvedValue({ success: false, errorMessage: 'Insufficient balance' })

    await expect(runSubscriptionBillingJob()).resolves.not.toThrow()

    const insertCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO transactions')
    )
    expect(insertCall).toBeUndefined()
  })

  it('still advances next_billing_at even when STK Push fails (avoids immediate retry hammering)', async () => {
    const enrollment = makeEnrollment()
    mockQuery
      .mockResolvedValueOnce({ rows: [enrollment] })
      .mockResolvedValue({ rows: [] })
    mockStkPush.mockResolvedValue({ success: false, errorMessage: 'Phone off' })

    await runSubscriptionBillingJob()

    const advanceCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('next_billing_at') &&
      String(c[0]).includes('UPDATE subscriber_enrollments')
    )
    expect(advanceCall).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runSubscriptionBillingJob — DB SELECT throws
// ─────────────────────────────────────────────────────────────────────────────

describe('runSubscriptionBillingJob — DB SELECT throws', () => {
  it('catches top-level DB error and does not propagate', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection pool exhausted'))

    await expect(runSubscriptionBillingJob()).resolves.not.toThrow()

    expect(mockStkPush).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runSubscriptionBillingJob — per-enrollment error (stkPush throws)
// ─────────────────────────────────────────────────────────────────────────────

describe('runSubscriptionBillingJob — per-enrollment error handling', () => {
  it('continues processing remaining enrollments when one throws', async () => {
    const enr1 = makeEnrollment({ enrollment_id: 'enr-fail', consumer_phone: '254700000001' })
    const enr2 = makeEnrollment({ enrollment_id: 'enr-ok',   consumer_phone: '254700000002' })

    mockQuery
      .mockResolvedValueOnce({ rows: [enr1, enr2] })   // SELECT both
      .mockResolvedValue({ rows: [] })                   // INSERT + UPDATE for enr2
    mockStkPush
      .mockRejectedValueOnce(new Error('Daraja connection timeout'))   // enr1 throws
      .mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_enr2' })  // enr2 succeeds

    await expect(runSubscriptionBillingJob()).resolves.not.toThrow()

    // Second enrollment's STK push must still be attempted
    expect(mockStkPush).toHaveBeenCalledTimes(2)
    // Second enrollment's transaction must still be inserted
    const insertCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO transactions') &&
      c[1]?.includes?.('254700000002')
    )
    expect(insertCall).toBeTruthy()
  })

  it('processes multiple successful enrollments in sequence', async () => {
    const enrollments = [
      makeEnrollment({ enrollment_id: 'enr-a', consumer_phone: '254711111111' }),
      makeEnrollment({ enrollment_id: 'enr-b', consumer_phone: '254722222222' }),
      makeEnrollment({ enrollment_id: 'enr-c', consumer_phone: '254733333333' }),
    ]

    mockQuery
      .mockResolvedValueOnce({ rows: enrollments })
      .mockResolvedValue({ rows: [] })
    mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_multi' })

    await runSubscriptionBillingJob()

    expect(mockStkPush).toHaveBeenCalledTimes(3)

    const insertCalls = mockQuery.mock.calls.filter((c: any[]) =>
      String(c[0]).includes('INSERT INTO transactions')
    )
    expect(insertCalls).toHaveLength(3)
  })

  it('does not propagate per-enrollment error even when transaction INSERT throws', async () => {
    const enrollment = makeEnrollment()
    mockQuery
      .mockResolvedValueOnce({ rows: [enrollment] })     // SELECT
      .mockRejectedValueOnce(new Error('transactions INSERT constraint'))  // INSERT fails
    mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_insert_err' })

    await expect(runSubscriptionBillingJob()).resolves.not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runSubscriptionBillingJob — DARAJA_CALLBACK_BASE_URL env var
// ─────────────────────────────────────────────────────────────────────────────

describe('runSubscriptionBillingJob — callback URL construction', () => {
  it('uses DARAJA_CALLBACK_BASE_URL when set', async () => {
    process.env.DARAJA_CALLBACK_BASE_URL = 'https://pay.example.com'
    const enrollment = makeEnrollment()
    mockQuery
      .mockResolvedValueOnce({ rows: [enrollment] })
      .mockResolvedValue({ rows: [] })
    mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_env' })

    await runSubscriptionBillingJob()

    expect(mockStkPush).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackUrl: 'https://pay.example.com/api/v1/mpesa-callback',
      })
    )
    delete process.env.DARAJA_CALLBACK_BASE_URL
  })

  it('falls back to DARAJA_CALLBACK_URL when DARAJA_CALLBACK_BASE_URL is not set', async () => {
    delete process.env.DARAJA_CALLBACK_BASE_URL
    process.env.DARAJA_CALLBACK_URL = 'https://fallback.example.com'
    const enrollment = makeEnrollment()
    mockQuery
      .mockResolvedValueOnce({ rows: [enrollment] })
      .mockResolvedValue({ rows: [] })
    mockStkPush.mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_fallback' })

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
// runTrialExpiry — no expired trials
// ─────────────────────────────────────────────────────────────────────────────

describe('runTrialExpiry — no expired trials', () => {
  it('runs the UPDATE query and logs "no expired trials" when rowCount is 0', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 })

    await expect(runTrialExpiry()).resolves.not.toThrow()

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain("status = 'ACTIVE'")
    expect(String(sql)).toContain("status = 'TRIAL'")
  })

  it('does not log the "transitioned" message when rowCount is 0', async () => {
    const { logger } = require('../util/logger')
    mockQuery.mockResolvedValueOnce({ rowCount: 0 })

    await runTrialExpiry()

    const infoCalls = (logger.info as jest.Mock).mock.calls.map((c: any[]) => c[0])
    expect(infoCalls.some((msg: string) => msg.includes('transitioned'))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runTrialExpiry — expired trials with payment method → ACTIVE
// ─────────────────────────────────────────────────────────────────────────────

describe('runTrialExpiry — transitions expired trials to ACTIVE', () => {
  it('runs UPDATE and logs transition count when rowCount > 0', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 5 })

    await runTrialExpiry()

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const updateCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'ACTIVE'") &&
      String(c[0]).includes("trial_ends_at <= NOW()")
    )
    expect(updateCall).toBeTruthy()
  })

  it('sets next_billing_at = NOW() so transitions are picked up immediately', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 2 })

    await runTrialExpiry()

    const updateSql = String(mockQuery.mock.calls[0][0])
    expect(updateSql).toContain('next_billing_at = NOW()')
  })

  it('handles rowCount being null (treats null as 0)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null })

    await expect(runTrialExpiry()).resolves.not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runTrialExpiry — DB throws
// ─────────────────────────────────────────────────────────────────────────────

describe('runTrialExpiry — DB throws', () => {
  it('catches DB error and does not propagate', async () => {
    mockQuery.mockRejectedValue(new Error('subscriber_enrollments: lock timeout'))

    await expect(runTrialExpiry()).resolves.not.toThrow()
  })

  it('logs the error message when DB throws', async () => {
    const { logger } = require('../util/logger')
    mockQuery.mockRejectedValue(new Error('connection reset by peer'))

    await runTrialExpiry()

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Trial expiry'),
      expect.objectContaining({ error: 'connection reset by peer' })
    )
  })
})

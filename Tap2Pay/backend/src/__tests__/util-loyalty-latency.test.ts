/**
 * Unit tests for util/loyalty.ts and util/latency-tracker.ts.
 */
process.env.NODE_ENV = 'test'

// ── DB mock for latency-tracker (imports '../db/index' directly) ───────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

import { awardLoyaltyPoints, isRepeatCustomer } from '../util/loyalty'
import { recordLatency, getLatencyStats, parseTapTimestamp } from '../util/latency-tracker'

// ── loyalty.ts helpers ────────────────────────────────────────────────────────

function makeDb(query: jest.Mock) {
  return { query } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// awardLoyaltyPoints
// ─────────────────────────────────────────────────────────────────────────────

describe('awardLoyaltyPoints', () => {
  it('returns null when no loyalty programme exists for merchant', async () => {
    const dbMock = jest.fn().mockResolvedValue({ rows: [] })
    const result = await awardLoyaltyPoints('txn-1', 'merchant-1', 'consumer-1', 5000, makeDb(dbMock))
    expect(result).toBeNull()
    expect(dbMock).toHaveBeenCalledTimes(1)
  })

  it('awards POINTS based on points_per_ksh', async () => {
    const dbMock = jest.fn()
      .mockResolvedValueOnce({ rows: [{ programme_type: 'POINTS', points_per_ksh: 2 }] })
      .mockResolvedValueOnce({ rows: [] })  // INSERT loyalty_balances
      .mockResolvedValueOnce({ rows: [] })  // INSERT loyalty_ledger

    // 5000 cents = KSh 50, 50 * 2 = 100 points
    const result = await awardLoyaltyPoints('txn-1', 'merchant-1', 'consumer-1', 5000, makeDb(dbMock))
    expect(result).not.toBeNull()
    expect(result!.pointsDelta).toBe(100)
    expect(result!.stampsDelta).toBe(0)
  })

  it('awards STAMPS (1 stamp per visit)', async () => {
    const dbMock = jest.fn()
      .mockResolvedValueOnce({ rows: [{ programme_type: 'STAMPS', points_per_ksh: null }] })
      .mockResolvedValueOnce({ rows: [] })  // INSERT loyalty_balances
      .mockResolvedValueOnce({ rows: [] })  // INSERT loyalty_ledger

    const result = await awardLoyaltyPoints('txn-1', 'merchant-1', 'consumer-1', 5000, makeDb(dbMock))
    expect(result!.stampsDelta).toBe(1)
    expect(result!.pointsDelta).toBe(0)
  })

  it('returns null when points and stamps are both 0', async () => {
    // POINTS programme but points_per_ksh = 0
    const dbMock = jest.fn()
      .mockResolvedValueOnce({ rows: [{ programme_type: 'POINTS', points_per_ksh: 0 }] })

    const result = await awardLoyaltyPoints('txn-1', 'merchant-1', 'consumer-1', 5000, makeDb(dbMock))
    expect(result).toBeNull()
  })

  it('returns null and does not throw when DB INSERT fails', async () => {
    const dbMock = jest.fn()
      .mockResolvedValueOnce({ rows: [{ programme_type: 'POINTS', points_per_ksh: 1 }] })
      .mockRejectedValue(new Error('constraint violation'))

    const result = await awardLoyaltyPoints('txn-1', 'merchant-1', 'consumer-1', 5000, makeDb(dbMock))
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isRepeatCustomer
// ─────────────────────────────────────────────────────────────────────────────

describe('isRepeatCustomer', () => {
  it('returns true when consumer has a loyalty balance with the merchant', async () => {
    const dbMock = jest.fn().mockResolvedValue({ rows: [{ 1: 1 }] })
    const result = await isRepeatCustomer('consumer-1', 'merchant-1', makeDb(dbMock))
    expect(result).toBe(true)
  })

  it('returns false when no loyalty balance exists', async () => {
    const dbMock = jest.fn().mockResolvedValue({ rows: [] })
    const result = await isRepeatCustomer('consumer-1', 'merchant-1', makeDb(dbMock))
    expect(result).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// recordLatency
// ─────────────────────────────────────────────────────────────────────────────

describe('recordLatency', () => {
  it('inserts a latency record into payment_latency', async () => {
    mockQuery.mockResolvedValue({ rows: [] })

    await recordLatency({
      txnId:            'txn-1',
      apiRoundTripMs:   200,
      darajaDispatchMs: 400,
      stkConfirmMs:     3000,
      totalMs:          4500,
      source:           'NFC_TAG',
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO payment_latency'),
      expect.arrayContaining(['txn-1', 200, 400, 3000, 4500, 'NFC_TAG'])
    )
  })

  it('swallows DB errors silently', async () => {
    mockQuery.mockRejectedValue(new Error('DB down'))

    await expect(recordLatency({
      txnId: 'txn-2', apiRoundTripMs: null, darajaDispatchMs: null,
      stkConfirmMs: null, totalMs: null, source: 'HCE_PHONE',
    })).resolves.not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getLatencyStats
// ─────────────────────────────────────────────────────────────────────────────

describe('getLatencyStats', () => {
  it('returns computed stats from DB', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        p50: '2500', p95: '8000', p99: '12000',
        avg_api: '300', avg_daraja: '500', avg_stk: '2800',
        sample_count: 42,
      }],
    })

    const stats = await getLatencyStats(24)
    expect(stats.p50TotalMs).toBe(2500)
    expect(stats.p95TotalMs).toBe(8000)
    expect(stats.sampleCount).toBe(42)
    expect(stats.avgApiRoundTripMs).toBe(300)
  })

  it('returns all nulls when sample_count is 0', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ p50: null, p95: null, p99: null, avg_api: null, avg_daraja: null, avg_stk: null, sample_count: 0 }],
    })

    const stats = await getLatencyStats()
    expect(stats.p50TotalMs).toBeNull()
    expect(stats.sampleCount).toBe(0)
  })

  it('returns all nulls when DB throws', async () => {
    mockQuery.mockRejectedValue(new Error('DB error'))

    const stats = await getLatencyStats()
    expect(stats.p50TotalMs).toBeNull()
    expect(stats.sampleCount).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseTapTimestamp (pure function — no mocks needed)
// ─────────────────────────────────────────────────────────────────────────────

describe('parseTapTimestamp', () => {
  it('returns null when header is undefined', () => {
    expect(parseTapTimestamp(undefined)).toBeNull()
  })

  it('returns null for non-numeric header', () => {
    expect(parseTapTimestamp('not-a-number')).toBeNull()
  })

  it('returns null for a timestamp more than 5 minutes ago', () => {
    const old = Date.now() - 400_000  // 400 seconds ago
    expect(parseTapTimestamp(String(old))).toBeNull()
  })

  it('returns null for a timestamp in the far future', () => {
    const future = Date.now() + 60_000
    expect(parseTapTimestamp(String(future))).toBeNull()
  })

  it('returns the ms timestamp for a recent valid header', () => {
    const recent = Date.now() - 1000  // 1 second ago
    expect(parseTapTimestamp(String(recent))).toBe(recent)
  })
})

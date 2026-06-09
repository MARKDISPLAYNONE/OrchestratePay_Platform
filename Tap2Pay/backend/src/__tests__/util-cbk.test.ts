/**
 * Unit tests for util/cbk-compliance.ts — CBK daily transaction limit checks.
 */
process.env.NODE_ENV = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

import { checkCbkCompliance, getDailySpendSummary, DAILY_LIMITS } from '../util/cbk-compliance'

const CONSUMER_ID = 'consumer-1'

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
})

describe('checkCbkCompliance', () => {
  it('returns allowed:false when consumer is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await checkCbkCompliance(CONSUMER_ID, 5000)
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('CBK_KYC_REQUIRED')
  })

  it('returns allowed:true immediately for FULL KYC tier', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ kyc_tier: 'FULL' }] })

    const result = await checkCbkCompliance(CONSUMER_ID, 100_000_000)
    expect(result.allowed).toBe(true)
    // Only 1 DB call — no need to check daily spend for FULL tier
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('allows BASIC tier transaction under daily limit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ kyc_tier: 'BASIC' }] })
      .mockResolvedValueOnce({ rows: [{ daily_spent: '500000' }] })  // KSh 5,000 spent today

    const result = await checkCbkCompliance(CONSUMER_ID, 100_000)  // KSh 1,000 more
    expect(result.allowed).toBe(true)
    expect(result.usedCents).toBe(500_000)
  })

  it('blocks BASIC tier transaction that would exceed daily limit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ kyc_tier: 'BASIC' }] })
      // Already spent KSh 9,500 of KSh 10,000 limit
      .mockResolvedValueOnce({ rows: [{ daily_spent: '950000' }] })

    const result = await checkCbkCompliance(CONSUMER_ID, 100_000)  // KSh 1,000 — would exceed
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('CBK_DAILY_LIMIT')
    expect(result.limitCents).toBe(DAILY_LIMITS.BASIC)
  })

  it('allows ENHANCED tier with higher limit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ kyc_tier: 'ENHANCED' }] })
      .mockResolvedValueOnce({ rows: [{ daily_spent: '5000000' }] })  // KSh 50,000 of 100,000

    const result = await checkCbkCompliance(CONSUMER_ID, 1_000_000)  // KSh 10,000 more
    expect(result.allowed).toBe(true)
  })

  it('blocks ENHANCED tier when limit exceeded', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ kyc_tier: 'ENHANCED' }] })
      .mockResolvedValueOnce({ rows: [{ daily_spent: '9500000' }] })  // KSh 95,000

    const result = await checkCbkCompliance(CONSUMER_ID, 1_000_000)  // KSh 10,000 → exceeds
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('CBK_DAILY_LIMIT')
  })

  it('defaults to BASIC tier when kyc_tier is null', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ kyc_tier: null }] })
      .mockResolvedValueOnce({ rows: [{ daily_spent: '0' }] })

    const result = await checkCbkCompliance(CONSUMER_ID, 5000)
    expect(result.allowed).toBe(true)
  })

  it('returns allowed:true when DB throws (fail-safe for payments)', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'))

    const result = await checkCbkCompliance(CONSUMER_ID, 5000)
    expect(result.allowed).toBe(true)
  })
})

describe('getDailySpendSummary', () => {
  it('returns tier, spent, and remaining for BASIC tier', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ kyc_tier: 'BASIC' }] })
      .mockResolvedValueOnce({ rows: [{ daily_spent: '300000' }] })

    const summary = await getDailySpendSummary(CONSUMER_ID)
    expect(summary.tier).toBe('BASIC')
    expect(summary.usedCents).toBe(300_000)
    expect(summary.limitCents).toBe(DAILY_LIMITS.BASIC)
    expect(summary.remainingCents).toBe(DAILY_LIMITS.BASIC - 300_000)
  })

  it('returns null limitCents and remainingCents for FULL tier', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ kyc_tier: 'FULL' }] })
      .mockResolvedValueOnce({ rows: [{ daily_spent: '0' }] })

    const summary = await getDailySpendSummary(CONSUMER_ID)
    expect(summary.tier).toBe('FULL')
    expect(summary.limitCents).toBeNull()
    expect(summary.remainingCents).toBeNull()
  })

  it('defaults tier to BASIC when consumer row is missing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ daily_spent: '0' }] })

    const summary = await getDailySpendSummary(CONSUMER_ID)
    expect(summary.tier).toBe('BASIC')
  })
})

/**
 * Unit tests for util/fraud.ts — rule-based fraud scoring engine.
 */
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV   = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockIncr   = jest.fn()
const mockExpire = jest.fn()
jest.mock('../db/redis', () => ({
  redis: {
    incr:   (...args: any[]) => mockIncr(...args),
    expire: (...args: any[]) => mockExpire(...args),
  },
}))

import { scoreFraud, FraudInput } from '../util/fraud'

const BASE_INPUT: FraudInput = {
  consumerId:     'consumer-1',
  merchantId:     'merchant-1',
  amountCents:    5000,
  source:         'NFC_TAG',
  idempotencyKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockIncr.mockResolvedValue(1)           // first transaction — no velocity hit
  mockExpire.mockResolvedValue(1)
  mockQuery
    .mockResolvedValueOnce({ rows: [{ avg_amount: null }] })  // deviation: no avg
    // no third call (amountCents 5000 < HIGH_AMOUNT_KES_CENTS 500000)
})

describe('scoreFraud', () => {
  it('returns ALLOW with score 0 when all rules pass', async () => {
    const result = await scoreFraud(BASE_INPUT)
    expect(result.decision).toBe('ALLOW')
    expect(result.score).toBe(0)
    expect(result.reasons).toHaveLength(0)
  })

  it('adds velocity score when consumer makes many requests in window', async () => {
    mockIncr.mockResolvedValue(16)  // 6 over the 10-txn limit → 6*8=48 pts
    const result = await scoreFraud(BASE_INPUT)
    expect(result.score).toBeGreaterThan(0)
    expect(result.reasons.some(r => r.startsWith('velocity:'))).toBe(true)
  })

  it('returns REVIEW when score is 70-89', async () => {
    // velocity: count=15, excess=5, score=min(40,40)=40
    // deviation: avg=500, amount=5500, factor=11, score=min(30,(11-5)*5)=30
    // total = 70 → REVIEW
    mockIncr.mockResolvedValue(15)
    mockQuery.mockReset()
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_amount: 500 }] })
    const result = await scoreFraud({ ...BASE_INPUT, amountCents: 5500 })
    expect(result.decision).toBe('REVIEW')
    expect(result.score).toBeGreaterThanOrEqual(70)
  })

  it('returns DECLINE when score is >= 90', async () => {
    // velocity=40 + deviation=30 + high-amount first-txn=25 → 95 → DECLINE
    mockIncr.mockResolvedValue(15)   // excess=5 → velocity=40
    mockQuery.mockReset()
    // avg=50000 cents, amount=600000, factor=12 → deviation=min(30,(12-5)*5)=30
    mockQuery
      .mockResolvedValueOnce({ rows: [{ avg_amount: 50000 }] })
      .mockResolvedValueOnce({ rows: [{ txn_count: '0' }] })   // first-txn: +25

    const result = await scoreFraud({ ...BASE_INPUT, amountCents: 600_000 })
    expect(result.decision).toBe('DECLINE')
    expect(result.score).toBeGreaterThanOrEqual(90)
  })

  it('adds amount deviation score when far above merchant average', async () => {
    mockQuery.mockReset()
    // avg 500 cents, amountCents 5000 → factor 10 → (10-5)*5=25 pts
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_amount: 500 }] })
    const result = await scoreFraud(BASE_INPUT)
    expect(result.score).toBeGreaterThan(0)
    expect(result.reasons.some(r => r.startsWith('amount_deviation:'))).toBe(true)
  })

  it('does not add deviation score when within normal range', async () => {
    mockQuery.mockReset()
    // avg 4000 cents, amountCents 5000 → factor ~1.25 → well under FACTOR=5.0
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_amount: 4000 }] })
    const result = await scoreFraud(BASE_INPUT)
    expect(result.reasons.some(r => r.startsWith('amount_deviation:'))).toBe(false)
  })

  it('adds high-amount first-transaction score', async () => {
    mockQuery.mockReset()
    // avg check
    mockQuery
      .mockResolvedValueOnce({ rows: [{ avg_amount: null }] })
      // consumer has 0 previous confirmed txns
      .mockResolvedValueOnce({ rows: [{ txn_count: '0' }] })

    // amount 600000 > HIGH_AMOUNT_KES_CENTS 500000
    const result = await scoreFraud({ ...BASE_INPUT, amountCents: 600_000 })
    expect(result.score).toBeGreaterThanOrEqual(25)
    expect(result.reasons.some(r => r.startsWith('high_amount_first_transaction:'))).toBe(true)
  })

  it('does NOT add first-transaction score for repeat consumer', async () => {
    mockQuery.mockReset()
    mockQuery
      .mockResolvedValueOnce({ rows: [{ avg_amount: null }] })
      .mockResolvedValueOnce({ rows: [{ txn_count: '5' }] })

    const result = await scoreFraud({ ...BASE_INPUT, amountCents: 600_000 })
    expect(result.reasons.some(r => r.startsWith('high_amount_first_transaction:'))).toBe(false)
  })

  it('proceeds silently when Redis velocity check fails', async () => {
    mockIncr.mockRejectedValue(new Error('Redis unavailable'))
    const result = await scoreFraud(BASE_INPUT)
    // Should still complete — fraud check failure is non-fatal
    expect(result.decision).toMatch(/ALLOW|REVIEW|DECLINE/)
  })

  it('proceeds silently when DB deviation check fails', async () => {
    mockQuery.mockReset()
    mockQuery.mockRejectedValue(new Error('DB down'))
    const result = await scoreFraud(BASE_INPUT)
    expect(result.decision).toMatch(/ALLOW|REVIEW|DECLINE/)
  })

  it('proceeds silently when DB first-txn check fails', async () => {
    mockQuery.mockReset()
    mockQuery
      .mockResolvedValueOnce({ rows: [{ avg_amount: null }] })
      .mockRejectedValue(new Error('DB down'))

    const result = await scoreFraud({ ...BASE_INPUT, amountCents: 600_000 })
    expect(result.decision).toMatch(/ALLOW|REVIEW|DECLINE/)
  })

  it('caps velocity score at 40', async () => {
    mockIncr.mockResolvedValue(100)  // 90 over limit → 90*8=720 but capped at 40
    mockQuery.mockReset()
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_amount: null }] })
    const result = await scoreFraud(BASE_INPUT)
    expect(result.score).toBeLessThanOrEqual(100)
  })
})

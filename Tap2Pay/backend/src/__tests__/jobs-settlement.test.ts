/**
 * jobs-settlement.test.ts — Full coverage for src/jobs/settlement.ts
 *
 * Covers:
 *   runSettlementJob() happy path — finds unsettled transactions, groups by merchant,
 *     creates settlement, calls initiateB2cPayout for MPESA merchants
 *   No-op when no unsettled transactions (batches.length === 0)
 *   Settlement with no account → creates NO_ACCOUNT settlement (no payout)
 *   B2C payout failure → settlement FAILED with failure_reason
 *   Bank account → logs and does not call initiateB2cPayout
 *   Uses distributed lock (mocked to call through)
 *   getLastSettlementCutoff: returns 24h ago when no prior settlements
 *   getLastSettlementCutoff: returns last period_end when prior settlements exist
 */
import { runSettlementJob } from '../jobs/settlement'

process.env.NODE_ENV = 'test'

// ── Mock DB ───────────────────────────────────────────────────────────────────
const mockQuery  = jest.fn()
const mockClientQuery   = jest.fn()
const mockClientRelease = jest.fn()
const mockConnect = jest.fn()

jest.mock('../db/index', () => ({
  db: {
    query:   (...a: any[]) => mockQuery(...a),
    connect: (...a: any[]) => mockConnect(...a),
  },
}))

// ── Mock Redis (for distributed lock) ─────────────────────────────────────────
const mockRedisSet = jest.fn()
const mockRedisGet = jest.fn()
const mockRedisDel = jest.fn()

jest.mock('../db/redis', () => ({
  redis: {
    set:    (...a: any[]) => mockRedisSet(...a),
    get:    (...a: any[]) => mockRedisGet(...a),
    del:    (...a: any[]) => mockRedisDel(...a),
  },
}))

// ── Mock Daraja B2C ───────────────────────────────────────────────────────────
const mockInitiateB2cPayout = jest.fn()
jest.mock('../integrations/daraja', () => ({
  initiateB2cPayout: (...a: any[]) => mockInitiateB2cPayout(...a),
}))

// ── Mock logger ───────────────────────────────────────────────────────────────
jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID    = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const SETTLEMENT_ID  = 'settle-001'
const TXN_ID_1       = 'txn-aaa'
const TXN_ID_2       = 'txn-bbb'
const MPESA_PHONE    = '254712345678'

const MPESA_ACCOUNT = {
  id:           'acct-mpesa',
  account_type: 'MPESA',
  mpesa_phone:  MPESA_PHONE,
  is_primary:   true,
  active:       true,
}

const BANK_ACCOUNT = {
  id:            'acct-bank',
  account_type:  'BANK',
  bank_name:     'Equity Bank',
  account_number:'0123456789',
  account_name:  'Test Merchant Ltd',
  is_primary:    true,
  active:        true,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockClientQuery.mockReset()
  mockClientRelease.mockReset()

  // Distributed lock: SET returns 'OK' (acquired), GET returns token (we own it), DEL cleans up
  mockRedisSet.mockResolvedValue('OK')
  mockRedisGet.mockResolvedValue('some-token')  // will match any token since job uses random
  mockRedisDel.mockResolvedValue(1)

  // DB client for transactions
  mockConnect.mockResolvedValue({
    query:   (...a: any[]) => mockClientQuery(...a),
    release: mockClientRelease,
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBatch(overrides: Record<string, any> = {}) {
  return {
    merchant_id: MERCHANT_ID,
    gross_cents: '100000',  // KSh 1000
    txn_count:   '2',
    txn_ids:     [TXN_ID_1, TXN_ID_2],
    ...overrides,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// runSettlementJob — happy path (MPESA account)
// ═════════════════════════════════════════════════════════════════════════════

describe('runSettlementJob — MPESA happy path', () => {
  it('creates settlement and dispatches B2C payout for MPESA merchant', async () => {
    // getLastSettlementCutoff → no prior settlements → default 24h ago
    mockQuery
      .mockResolvedValueOnce({ rows: [{ last_end: null }] })  // MAX(period_end)
      .mockResolvedValueOnce({ rows: [makeBatch()] })          // unsettled batches
      .mockResolvedValueOnce({ rows: [MPESA_ACCOUNT] })        // settlement account

    // Client queries: BEGIN, INSERT settlement, INSERT settlement_transactions, COMMIT
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                             // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: SETTLEMENT_ID }] })       // INSERT settlement
      .mockResolvedValueOnce({ rows: [] })                             // INSERT settlement_transactions
      .mockResolvedValueOnce({ rows: [] })                             // COMMIT

    // B2C payout succeeds
    mockInitiateB2cPayout.mockResolvedValueOnce({ requestId: 'b2c-req-001' })

    // UPDATE settlement status after payout
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await runSettlementJob()

    expect(mockInitiateB2cPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId:    MERCHANT_ID,
        amountCents:   98500,  // 100000 - 1500 (1.5% fee)
        recipientPhone: MPESA_PHONE,
      })
    )

    // UPDATE settlement to PROCESSING
    const updateCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'PROCESSING'")
    )
    expect(updateCall).toBeTruthy()
    expect(updateCall![1][1]).toBe('b2c-req-001')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// runSettlementJob — no unsettled transactions
// ═════════════════════════════════════════════════════════════════════════════

describe('runSettlementJob — no unsettled transactions', () => {
  it('completes without creating any settlements when batches list is empty', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ last_end: null }] })  // MAX(period_end)
      .mockResolvedValueOnce({ rows: [] })                     // empty batches

    await runSettlementJob()

    expect(mockConnect).not.toHaveBeenCalled()
    expect(mockInitiateB2cPayout).not.toHaveBeenCalled()

    const { logger } = require('../util/logger')
    expect(logger.info).toHaveBeenCalledWith(
      'Settlement batches found',
      expect.objectContaining({ count: 0 })
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// runSettlementJob — no settlement account
// ═════════════════════════════════════════════════════════════════════════════

describe('runSettlementJob — no settlement account', () => {
  it('creates NO_ACCOUNT settlement and logs warning without dispatching payout', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ last_end: null }] })  // MAX(period_end)
      .mockResolvedValueOnce({ rows: [makeBatch()] })          // batches
      .mockResolvedValueOnce({ rows: [] })                     // NO settlement account

    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                             // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: SETTLEMENT_ID }] })       // INSERT settlement (NO_ACCOUNT status)
      .mockResolvedValueOnce({ rows: [] })                             // INSERT settlement_transactions
      .mockResolvedValueOnce({ rows: [] })                             // COMMIT

    await runSettlementJob()

    expect(mockInitiateB2cPayout).not.toHaveBeenCalled()

    const { logger } = require('../util/logger')
    expect(logger.warn).toHaveBeenCalledWith(
      'Settlement created — no account on file',
      expect.objectContaining({ merchantId: MERCHANT_ID, settlementId: SETTLEMENT_ID })
    )

    // Verify settlement INSERT uses NO_ACCOUNT CASE
    const insertCall = mockClientQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO settlements')
    )
    expect(insertCall).toBeTruthy()
    // settlement_account_id should be null (no account)
    expect(insertCall![1][1]).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// runSettlementJob — B2C payout failure
// ═════════════════════════════════════════════════════════════════════════════

describe('runSettlementJob — B2C payout failure', () => {
  it('marks settlement as FAILED with failure_reason when initiateB2cPayout throws', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ last_end: null }] })
      .mockResolvedValueOnce({ rows: [makeBatch()] })
      .mockResolvedValueOnce({ rows: [MPESA_ACCOUNT] })

    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: SETTLEMENT_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })  // COMMIT

    // B2C payout fails
    mockInitiateB2cPayout.mockRejectedValueOnce(new Error('M-Pesa B2C quota exceeded'))

    // UPDATE settlement to FAILED
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await runSettlementJob()

    const failedUpdateCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'FAILED'")
    )
    expect(failedUpdateCall).toBeTruthy()
    expect(failedUpdateCall![1][1]).toBe('M-Pesa B2C quota exceeded')

    const { logger } = require('../util/logger')
    expect(logger.error).toHaveBeenCalledWith(
      'Settlement M-Pesa payout failed',
      expect.objectContaining({ settlementId: SETTLEMENT_ID })
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// runSettlementJob — BANK account
// ═════════════════════════════════════════════════════════════════════════════

describe('runSettlementJob — BANK settlement account', () => {
  it('logs bank settlement queued without dispatching B2C payout', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ last_end: null }] })
      .mockResolvedValueOnce({ rows: [makeBatch()] })
      .mockResolvedValueOnce({ rows: [BANK_ACCOUNT] })

    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: SETTLEMENT_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    await runSettlementJob()

    expect(mockInitiateB2cPayout).not.toHaveBeenCalled()

    const { logger } = require('../util/logger')
    expect(logger.info).toHaveBeenCalledWith(
      'Bank settlement queued',
      expect.objectContaining({ settlementId: SETTLEMENT_ID })
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// runSettlementJob — DB error during settlement batch
// ═════════════════════════════════════════════════════════════════════════════

describe('runSettlementJob — DB transaction error', () => {
  it('calls ROLLBACK and releases client when INSERT settlement throws', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ last_end: null }] })
      .mockResolvedValueOnce({ rows: [makeBatch()] })
      .mockResolvedValueOnce({ rows: [MPESA_ACCOUNT] })

    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                     // BEGIN
      .mockRejectedValueOnce(new Error('INSERT failed'))       // INSERT settlement throws
      .mockResolvedValueOnce({ rows: [] })                     // ROLLBACK

    await runSettlementJob()

    const rollbackCall = mockClientQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('ROLLBACK')
    )
    expect(rollbackCall).toBeTruthy()
    expect(mockClientRelease).toHaveBeenCalled()
    expect(mockInitiateB2cPayout).not.toHaveBeenCalled()

    const { logger } = require('../util/logger')
    expect(logger.error).toHaveBeenCalledWith(
      'Settlement batch failed',
      expect.objectContaining({ merchantId: MERCHANT_ID })
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// getLastSettlementCutoff — via runSettlementJob
// ═════════════════════════════════════════════════════════════════════════════

describe('getLastSettlementCutoff', () => {
  it('uses existing settlement period_end as cutoff when prior settlements exist', async () => {
    const lastEnd = new Date('2026-06-19T23:50:00Z')
    mockQuery
      .mockResolvedValueOnce({ rows: [{ last_end: lastEnd }] })  // has a prior settlement
      .mockResolvedValueOnce({ rows: [] })                        // no new batches

    await runSettlementJob()

    // The second query (unsettled transactions) should use lastEnd as the periodStart
    const batchesQuery = mockQuery.mock.calls[1]
    expect(batchesQuery[1][0]).toEqual(lastEnd)
  })

  it('defaults to 24h ago when no prior settlements exist', async () => {
    const before = Date.now() - 24 * 60 * 60 * 1000
    mockQuery
      .mockResolvedValueOnce({ rows: [{ last_end: null }] })  // no prior settlements
      .mockResolvedValueOnce({ rows: [] })

    await runSettlementJob()

    const batchesQuery = mockQuery.mock.calls[1]
    const cutoff = batchesQuery[1][0] as Date
    // Should be approximately 24h ago (within 5 seconds tolerance)
    expect(cutoff.getTime()).toBeGreaterThan(before - 5000)
    expect(cutoff.getTime()).toBeLessThan(Date.now() - 24 * 60 * 60 * 1000 + 5000)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Distributed lock: already held by another instance
// ═════════════════════════════════════════════════════════════════════════════

describe('runSettlementJob — distributed lock', () => {
  it('does not run the job when lock is already held by another instance', async () => {
    mockRedisSet.mockResolvedValueOnce(null)  // lock NOT acquired (returns null, not 'OK')

    await runSettlementJob()

    // No queries should be made since lock was not acquired
    expect(mockQuery).not.toHaveBeenCalled()

    const { logger } = require('../util/logger')
    expect(logger.debug).toHaveBeenCalledWith(
      'Distributed lock: already held by another instance',
      expect.objectContaining({ lockName: 'settlement-job' })
    )
  })
})

/**
 * Tests for jobs/reconciliation.ts — stuck-transaction reconciliation job.
 * Covers: runReconciliation (lock skip + run), _reconcile (all result-code paths),
 *         transaction error handling, and old-transaction expiry.
 */
process.env.NODE_ENV = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockStkQuery = jest.fn()
jest.mock('../integrations/daraja', () => ({
  stkQuery: (...args: any[]) => mockStkQuery(...args),
}))

const mockRedisPublish = jest.fn()
const mockRedisSetex   = jest.fn()
jest.mock('../db/redis', () => ({
  redis: {
    publish: (...args: any[]) => mockRedisPublish(...args),
    setex:   (...args: any[]) => mockRedisSetex(...args),
  },
}))

// withDistributedLock: by default immediately calls the provided function.
const mockWithDistributedLock = jest.fn()
jest.mock('../util/distributed-lock', () => ({
  withDistributedLock: (...args: any[]) => mockWithDistributedLock(...args),
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { runReconciliation } from '../jobs/reconciliation'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStuckTxn(overrides: Record<string, any> = {}) {
  return {
    id:                    'txn-stuck-1',
    checkout_request_id:   'ws_CO_stuck001',
    idempotency_key:       'idem-key-1',
    amount_cents:          5000,
    created_at:            new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockStkQuery.mockReset()
  mockRedisPublish.mockResolvedValue(1)
  mockRedisSetex.mockResolvedValue('OK')
  // Default: lock acquired, calls the reconcile function
  mockWithDistributedLock.mockImplementation(async (_name: string, _ttl: number, fn: Function) => {
    await fn()
    return true
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runReconciliation — distributed lock
// ─────────────────────────────────────────────────────────────────────────────

describe('runReconciliation — lock not acquired', () => {
  it('logs "skipped" and does not call DB when another pod holds the lock', async () => {
    mockWithDistributedLock.mockResolvedValue(false)

    await runReconciliation()

    expect(mockQuery).not.toHaveBeenCalled()
  })
})

describe('runReconciliation — lock acquired', () => {
  it('proceeds with reconciliation when lock is acquired', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })       // stuck transactions query
      .mockResolvedValueOnce({ rowCount: 0 })    // expire old transactions
      .mockResolvedValue({ rows: [] })            // audit log

    await runReconciliation()

    expect(mockQuery).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// _reconcile — no stuck transactions
// ─────────────────────────────────────────────────────────────────────────────

describe('_reconcile — no stuck transactions', () => {
  it('skips stkQuery loop and proceeds straight to expiry step', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })        // no stuck txns
      .mockResolvedValueOnce({ rowCount: 0 })     // expire step (no expired)
      .mockResolvedValue({ rows: [] })             // audit log

    await runReconciliation()

    expect(mockStkQuery).not.toHaveBeenCalled()
    const expireCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'EXPIRED'")
    )
    expect(expireCall).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// _reconcile — resultCode 500 (Daraja still processing)
// ─────────────────────────────────────────────────────────────────────────────

describe('_reconcile — resultCode 500 (Daraja still processing)', () => {
  it('leaves transaction PENDING and does not update DB status', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeStuckTxn()] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValue({ rows: [] })
    mockStkQuery.mockResolvedValue({ resultCode: 500, resultDesc: 'Still processing' })

    await runReconciliation()

    const confirmCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'CONFIRMED'")
    )
    const declineCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'DECLINED'")
    )
    expect(confirmCall).toBeUndefined()
    expect(declineCall).toBeUndefined()
  })
})

describe('_reconcile — resultCode -1 (stkQuery failed)', () => {
  it('leaves transaction PENDING (circuit open or query error)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeStuckTxn()] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValue({ rows: [] })
    mockStkQuery.mockResolvedValue({ resultCode: -1, resultDesc: 'Circuit open' })

    await runReconciliation()

    const confirmCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'CONFIRMED'")
    )
    expect(confirmCall).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// _reconcile — resultCode 0 (confirmed)
// ─────────────────────────────────────────────────────────────────────────────

describe('_reconcile — resultCode 0 (confirmed)', () => {
  it('updates transaction to CONFIRMED and publishes to Redis', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeStuckTxn()] })
      .mockResolvedValueOnce({ rowCount: 0 })   // expire
      .mockResolvedValue({ rows: [] })            // all other queries
    mockStkQuery.mockResolvedValue({ resultCode: 0, resultDesc: 'Success' })

    await runReconciliation()

    const confirmCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'CONFIRMED'")
    )
    expect(confirmCall).toBeTruthy()
    expect(mockRedisPublish).toHaveBeenCalledWith(
      expect.stringContaining('txn:confirmed:txn-stuck-1'),
      expect.stringContaining('CONFIRMED')
    )
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringContaining('idempotency:idem-key-1'),
      3600,
      expect.stringContaining('CONFIRMED')
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// _reconcile — non-zero resultCode (declined)
// ─────────────────────────────────────────────────────────────────────────────

describe('_reconcile — non-zero resultCode (declined)', () => {
  it('updates transaction to DECLINED and publishes DECLINED event', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeStuckTxn()] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValue({ rows: [] })
    mockStkQuery.mockResolvedValue({ resultCode: 1032, resultDesc: 'Request cancelled by user' })

    await runReconciliation()

    const declineCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'DECLINED'")
    )
    expect(declineCall).toBeTruthy()
    expect(mockRedisPublish).toHaveBeenCalledWith(
      expect.stringContaining('txn:confirmed:txn-stuck-1'),
      expect.stringContaining('DECLINED')
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// _reconcile — transaction error (stkQuery throws)
// ─────────────────────────────────────────────────────────────────────────────

describe('_reconcile — per-transaction error', () => {
  it('logs error and continues processing remaining transactions', async () => {
    const txn1 = makeStuckTxn({ id: 'txn-fail', checkout_request_id: 'ws_CO_fail' })
    const txn2 = makeStuckTxn({ id: 'txn-ok',   checkout_request_id: 'ws_CO_ok' })

    mockQuery
      .mockResolvedValueOnce({ rows: [txn1, txn2] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValue({ rows: [] })
    mockStkQuery
      .mockRejectedValueOnce(new Error('Daraja timeout'))           // txn1 throws
      .mockResolvedValue({ resultCode: 0, resultDesc: 'Success' })  // txn2 succeeds

    await runReconciliation()

    // Second transaction should still be confirmed
    const confirmCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'CONFIRMED'") && c[1]?.includes?.('txn-ok')
    )
    expect(confirmCall).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// _reconcile — expiry step
// ─────────────────────────────────────────────────────────────────────────────

describe('_reconcile — expiry step', () => {
  it('expires very old PENDING transactions (rowCount > 0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // no stuck txns
      .mockResolvedValueOnce({ rowCount: 3 })        // expire step found 3 old txns
      .mockResolvedValue({ rows: [] })                // audit log

    await runReconciliation()

    const expireCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'EXPIRED'")
    )
    expect(expireCall).toBeTruthy()
  })

  it('writes a RECONCILIATION_RUN audit entry', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValue({ rows: [] })

    await runReconciliation()

    const auditCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('RECONCILIATION_RUN')
    )
    expect(auditCall).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// _reconcile — top-level DB error
// ─────────────────────────────────────────────────────────────────────────────

describe('_reconcile — top-level DB failure', () => {
  it('catches and logs errors without propagating', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'))

    await expect(runReconciliation()).resolves.not.toThrow()
  })
})

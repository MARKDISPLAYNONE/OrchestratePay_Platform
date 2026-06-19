/**
 * Targeted tests for uncovered branches in utility and integration modules.
 * Each describe block covers specific missing branches identified in the coverage report.
 */
process.env.NODE_ENV = 'test'

// ── Global fetch mock (accounting-shared, etims) ──────────────────────────────
const mockFetch = jest.fn()
global.fetch = mockFetch as any

// ── Redis mock — covers all methods used by any module in this file ───────────
const mockRedisSet    = jest.fn()
const mockRedisGet    = jest.fn()
const mockRedisDel    = jest.fn()
const mockRedisIncr   = jest.fn()
const mockRedisExpire = jest.fn()

jest.mock('../db/redis', () => ({
  redis: {
    set:    (...args: any[]) => mockRedisSet(...args),
    get:    (...args: any[]) => mockRedisGet(...args),
    del:    (...args: any[]) => mockRedisDel(...args),
    incr:   (...args: any[]) => mockRedisIncr(...args),
    expire: (...args: any[]) => mockRedisExpire(...args),
  },
}))

// ── DB mock ───────────────────────────────────────────────────────────────────
const mockDbQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}))

// ── Logger mock ───────────────────────────────────────────────────────────────
jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// ── VAT mock (etims) ─────────────────────────────────────────────────────────
jest.mock('../util/vat', () => ({
  vatBreakdown: jest.fn().mockReturnValue({ vatCents: 1600, netCents: 8400 }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockFetch.mockReset()
  mockDbQuery.mockReset()
  mockRedisSet.mockResolvedValue(null)
  mockRedisGet.mockResolvedValue(null)
  mockRedisDel.mockResolvedValue(1)
  mockRedisIncr.mockResolvedValue(1)
  mockRedisExpire.mockResolvedValue(1)
})

// ─────────────────────────────────────────────────────────────────────────────
// integrations/accounting-shared.ts — line 71: expires_in ?? 3600
// ─────────────────────────────────────────────────────────────────────────────

import { refreshOAuthToken } from '../integrations/accounting-shared'

describe('refreshOAuthToken — expires_in absent → defaults to 3600s (line 71)', () => {
  const PARAMS = {
    tokenUrl:     'https://identity.example.com/token',
    clientId:     'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'old-refresh-token',
    platform:     'test',
  }

  it('uses 3600s TTL when expires_in is not present in the token response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        access_token: 'new-tok',
        // deliberately omit expires_in — exercises the ?? 3600 branch
      }),
    })
    const before = Date.now()
    const result = await refreshOAuthToken(PARAMS)
    const after  = Date.now()

    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe('new-tok')
    // expiresAt should be ~3600s from now
    const expiresMs = result!.expiresAt.getTime()
    expect(expiresMs).toBeGreaterThanOrEqual(before + 3600_000 - 200)
    expect(expiresMs).toBeLessThanOrEqual(after  + 3600_000 + 200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// integrations/etims.ts — lines 148-151: catch block when postToEtims throws
// ─────────────────────────────────────────────────────────────────────────────

import { submitFiscalInvoice } from '../integrations/etims'

describe('submitFiscalInvoice — catch block when fetch throws (lines 148-151)', () => {
  const INVOICE = {
    merchantId:    'merchant-1',
    transactionId: 'txn-xyz',
    kraPin:        'A001234567B',
    amountCents:   10_000,
    mpesaReceipt:  'QA0T5EXAMPLE',
    issuedAt:      '2026-06-15T10:00:00Z',
  }

  it('writes FAILED to fiscal_log when network throws during eTIMS submission', async () => {
    process.env.ETIMS_BASE_URL = 'https://etims.example.com'
    process.env.ETIMS_API_KEY  = 'api-key-1'

    // fetch throws a network error — triggers the catch block at lines 148-151
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const mockQ = jest.fn()
      .mockResolvedValueOnce({ rows: [{ seq: 42 }] })        // nextval
      .mockResolvedValueOnce({ rows: [{ id: 'fl-5' }] })     // INSERT fiscal_log → returns id
      .mockResolvedValueOnce({ rows: [] })                    // UPDATE fiscal_log (catch UPDATE)

    await submitFiscalInvoice(INVOICE, { query: mockQ } as any)

    // Catch handler calls UPDATE with FAILED status
    const updateCall = mockQ.mock.calls[2]
    expect(updateCall[0]).toContain("etims_status='FAILED'")
    expect(String(updateCall[1][0])).toContain('ECONNREFUSED')

    delete process.env.ETIMS_BASE_URL
    delete process.env.ETIMS_API_KEY
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// util/distributed-lock.ts — line 63: catch when redis.del throws during release
// ─────────────────────────────────────────────────────────────────────────────

import { withDistributedLock } from '../util/distributed-lock'

describe('withDistributedLock — redis.del throws during release (line 63)', () => {
  it('swallows the del error and still returns true', async () => {
    let capturedToken: string | undefined
    mockRedisSet.mockImplementation((...args: any[]) => {
      capturedToken = args[1]
      return Promise.resolve('OK')
    })
    mockRedisGet.mockImplementation(() => Promise.resolve(capturedToken))
    // redis.del throws — exercises the catch branch at line 63
    mockRedisDel.mockRejectedValue(new Error('Redis connection reset'))

    const fn = jest.fn().mockResolvedValue(undefined)
    const result = await withDistributedLock('del-throw-lock', 30, fn)

    expect(result).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// util/latency-tracker.ts — lines 75, 83: empty rows from getLatencyStats
// ─────────────────────────────────────────────────────────────────────────────

import { getLatencyStats } from '../util/latency-tracker'

describe('getLatencyStats — empty rows array (lines 75, 83)', () => {
  it('returns all-null stats and sampleCount=0 when query returns empty rows', async () => {
    // rows = [] → rows[0] is undefined → rows[0] ?? {} = {} → r = {}
    // r.p50 is undefined → falsy → p50TotalMs = null
    // r.sample_count is undefined → undefined ?? 0 = 0
    mockDbQuery.mockResolvedValueOnce({ rows: [] })

    const stats = await getLatencyStats(24)

    expect(stats.p50TotalMs).toBeNull()
    expect(stats.p95TotalMs).toBeNull()
    expect(stats.p99TotalMs).toBeNull()
    expect(stats.avgApiRoundTripMs).toBeNull()
    expect(stats.avgDarajaDispatchMs).toBeNull()
    expect(stats.avgStkConfirmMs).toBeNull()
    expect(stats.sampleCount).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// util/fx.ts — line 147: .catch callback fires when db.query rejects in fetchFromApi
// ─────────────────────────────────────────────────────────────────────────────

import { getRate } from '../util/fx'

describe('getRate — db.query rejects in fetchFromApi .catch handler (line 147)', () => {
  it('still returns the live rate and swallows the DB persistence error', async () => {
    process.env.OPENEXCHANGERATES_APP_ID = 'test-app-id'

    // First DB call (SELECT) returns stale entry to bypass cache
    const staleDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ rate: '125.00', fetched_at: staleDate }] })
      .mockRejectedValueOnce(new Error('DB write failed'))  // INSERT rejects → .catch fires

    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ rates: { KES: 130, USD: 1 } }),
    })

    const rate = await getRate('USD')
    // Flush microtasks so the fire-and-forget .catch() callback has a chance to run
    await new Promise(r => setImmediate(r))

    expect(rate).toBeCloseTo(130, 0)
    // Both SELECT and INSERT were attempted
    expect(mockDbQuery).toHaveBeenCalledTimes(2)

    delete process.env.OPENEXCHANGERATES_APP_ID
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// util/fraud.ts — line 99: rows[0]?.txn_count ?? '0' when rows is empty
// ─────────────────────────────────────────────────────────────────────────────

import { scoreFraud } from '../util/fraud'

describe('scoreFraud — first-txn query returns empty rows (line 99)', () => {
  it('defaults txnCount to 0 and adds first-txn score when rows is empty', async () => {
    mockRedisIncr.mockResolvedValue(1)
    mockRedisExpire.mockResolvedValue(1)
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ avg_amount: null }] })  // deviation check
      .mockResolvedValueOnce({ rows: [] })                       // first-txn: empty rows → rows[0] undefined → ?? '0'

    // amountCents > HIGH_AMOUNT_KES_CENTS (500,000) to trigger the first-txn check
    const result = await scoreFraud({
      consumerId:     'consumer-x',
      merchantId:     'merchant-x',
      amountCents:    600_000,
      source:         'NFC_TAG',
      idempotencyKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    })

    // txnCount = parseInt(undefined ?? '0') = 0 → first-txn score of 25 added
    expect(result.score).toBeGreaterThanOrEqual(25)
    expect(result.reasons.some((r: string) => r.startsWith('high_amount_first_transaction:'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// util/cbk-compliance.ts — lines 49, 62, 115
// ─────────────────────────────────────────────────────────────────────────────

import { checkCbkCompliance, getDailySpendSummary } from '../util/cbk-compliance'

describe('checkCbkCompliance — branch gaps (lines 49, 62)', () => {
  it('falls back to BASIC limit when kyc_tier value is unrecognised (line 49: ?? DAILY_LIMITS.BASIC)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ kyc_tier: 'UNKNOWN_TIER' }] })  // consumer row
      .mockResolvedValueOnce({ rows: [{ daily_spent: '0' }] })           // spend query

    // DAILY_LIMITS['UNKNOWN_TIER'] is undefined → falls back to DAILY_LIMITS.BASIC (1,000,000 cents)
    const result = await checkCbkCompliance('consumer-1', 500_000)
    expect(result.allowed).toBe(true)
  })

  it('treats null daily_spent as 0 (line 62: parseInt(null ?? "0"))', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ kyc_tier: 'BASIC' }] })
      .mockResolvedValueOnce({ rows: [{ daily_spent: null }] })  // null → ?? '0' branch

    const result = await checkCbkCompliance('consumer-2', 100_000)
    expect(result.allowed).toBe(true)
    expect(result.usedCents).toBe(0)
  })
})

describe('getDailySpendSummary — null daily_spent branch (line 115)', () => {
  it('treats null daily_spent as 0 in getDailySpendSummary', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ kyc_tier: 'ENHANCED' }] })
      .mockResolvedValueOnce({ rows: [{ daily_spent: null }] })  // triggers ?? '0' at line 115

    const summary = await getDailySpendSummary('consumer-3')
    expect(summary.usedCents).toBe(0)
    expect(summary.tier).toBe('ENHANCED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// middleware/safaricom-ip.ts — line 49: req.ip ?? '' when ip is undefined
// ─────────────────────────────────────────────────────────────────────────────

import { requireSafaricomIp } from '../middleware/safaricom-ip'
import { Request, Response, NextFunction } from 'express'

describe('requireSafaricomIp — req.ip undefined in production (line 49)', () => {
  const origEnv = process.env.NODE_ENV

  beforeAll(() => { process.env.NODE_ENV = 'production' })
  afterAll(()  => { process.env.NODE_ENV = origEnv })

  it('treats undefined ip as empty string and blocks with 403', () => {
    const req = { ip: undefined, id: 'req-1', path: '/callback' } as any as Request
    const res: any = {}
    res.status = jest.fn().mockReturnValue(res)
    res.json   = jest.fn().mockReturnValue(res)
    const next: NextFunction = jest.fn()

    requireSafaricomIp(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// integrations/etims.ts — line 68: response.json().catch(() => ({})) fires
// when json() rejects (malformed response body)
// ─────────────────────────────────────────────────────────────────────────────

describe('submitFiscalInvoice — response.json catch fires when json() rejects (line 68)', () => {
  const INVOICE = {
    merchantId:    'merchant-1',
    transactionId: 'txn-json-err',
    kraPin:        'A001234567B',
    amountCents:   10_000,
    mpesaReceipt:  'QA0T5EXAMPLE',
    issuedAt:      '2026-06-15T10:00:00Z',
  }

  it('falls back to {} when response.json() rejects and uses auto-generated invoiceNumber', async () => {
    process.env.ETIMS_BASE_URL = 'https://etims.example.com'
    process.env.ETIMS_API_KEY  = 'api-key-json-err'

    // fetch succeeds but json() rejects — triggers .catch(() => ({})) at line 68
    mockFetch.mockResolvedValue({
      ok:     true,
      status: 200,
      json:   jest.fn().mockRejectedValue(new Error('JSON parse error')),
    })

    const mockQ = jest.fn()
      .mockResolvedValueOnce({ rows: [{ seq: 99 }] })       // nextval
      .mockResolvedValueOnce({ rows: [{ id: 'fl-json' }] }) // INSERT fiscal_log
      .mockResolvedValueOnce({ rows: [] })                   // UPDATE fiscal_log SENT

    await submitFiscalInvoice(INVOICE, { query: mockQ } as any)

    // json() rejected → raw = {} → raw.invoiceNumber is undefined
    // postToEtims returns { success: true, invoiceNumber: `ETIMS-${Date.now()}` }
    // The success UPDATE uses parameterized SQL with $2 = 'ACCEPTED'
    const updateCall = mockQ.mock.calls[2]
    expect(updateCall[0]).toContain('etims_status')
    expect(updateCall[1][1]).toBe('ACCEPTED')

    delete process.env.ETIMS_BASE_URL
    delete process.env.ETIMS_API_KEY
  })
})

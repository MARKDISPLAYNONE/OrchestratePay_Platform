/**
 * Z-Report Tests
 *
 * The Z-Report is a merchant's end-of-day summary: total revenue, transaction
 * counts by status, and first/last transaction times.
 *
 * Key invariants:
 *   1. Only CONFIRMED transactions contribute to revenue (declined/failed = KSh 0)
 *   2. Day boundaries use Africa/Nairobi time (UTC+3), not UTC
 *   3. A day with zero transactions returns valid zeroed buckets, not an error
 *   4. Total count includes confirmed + declined + failed
 *   5. Total revenue = confirmed.totalCents only
 */

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers that mirror the backend aggregation logic
// ─────────────────────────────────────────────────────────────────────────────

interface TxnRow {
  status: 'CONFIRMED' | 'DECLINED' | 'FAILED'
  amountCents: number
  createdAt: string   // ISO-8601 UTC
}

interface ZBucket { count: number; totalCents: number }
interface ZReport {
  confirmed: ZBucket
  declined:  ZBucket
  failed:    ZBucket
  total:     ZBucket
  firstTxnAt: string | null
  lastTxnAt:  string | null
}

function buildZReport(rows: TxnRow[]): ZReport {
  const buckets: Record<'CONFIRMED' | 'DECLINED' | 'FAILED', ZBucket> = {
    CONFIRMED: { count: 0, totalCents: 0 },
    DECLINED:  { count: 0, totalCents: 0 },
    FAILED:    { count: 0, totalCents: 0 },
  }
  let firstTxnAt: string | null = null
  let lastTxnAt:  string | null = null

  for (const row of rows) {
    buckets[row.status].count++
    if (row.status === 'CONFIRMED') buckets[row.status].totalCents += row.amountCents

    if (!firstTxnAt || row.createdAt < firstTxnAt) firstTxnAt = row.createdAt
    if (!lastTxnAt  || row.createdAt > lastTxnAt)  lastTxnAt  = row.createdAt
  }

  return {
    confirmed: buckets.CONFIRMED,
    declined:  buckets.DECLINED,
    failed:    buckets.FAILED,
    total: {
      count:      buckets.CONFIRMED.count + buckets.DECLINED.count + buckets.FAILED.count,
      totalCents: buckets.CONFIRMED.totalCents,  // revenue = confirmed only
    },
    firstTxnAt,
    lastTxnAt,
  }
}

// Mirrors the Africa/Nairobi day boundary logic in the backend route
function toNairobiDate(utcIso: string): string {
  const date = new Date(utcIso)
  const nairobiMs = date.getTime() + 3 * 60 * 60 * 1000  // UTC+3
  return new Date(nairobiMs).toISOString().slice(0, 10)
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Z-Report revenue bucketing', () => {

  it('a day with no transactions returns all-zero buckets', () => {
    const report = buildZReport([])
    expect(report.confirmed).toEqual({ count: 0, totalCents: 0 })
    expect(report.declined).toEqual({ count: 0, totalCents: 0 })
    expect(report.failed).toEqual({ count: 0, totalCents: 0 })
    expect(report.total).toEqual({ count: 0, totalCents: 0 })
    expect(report.firstTxnAt).toBeNull()
    expect(report.lastTxnAt).toBeNull()
  })

  it('only CONFIRMED transactions contribute to revenue', () => {
    const report = buildZReport([
      { status: 'CONFIRMED', amountCents: 50_000, createdAt: '2026-05-25T08:00:00.000Z' },
      { status: 'DECLINED',  amountCents: 20_000, createdAt: '2026-05-25T09:00:00.000Z' },
      { status: 'FAILED',    amountCents: 10_000, createdAt: '2026-05-25T10:00:00.000Z' },
    ])
    expect(report.confirmed.totalCents).toBe(50_000)
    expect(report.declined.totalCents).toBe(0)   // DECLINED never add to revenue
    expect(report.failed.totalCents).toBe(0)     // FAILED never add to revenue
    expect(report.total.totalCents).toBe(50_000) // revenue = confirmed only
  })

  it('total.count includes all statuses', () => {
    const report = buildZReport([
      { status: 'CONFIRMED', amountCents: 50_000, createdAt: '2026-05-25T08:00:00.000Z' },
      { status: 'CONFIRMED', amountCents: 30_000, createdAt: '2026-05-25T09:00:00.000Z' },
      { status: 'DECLINED',  amountCents: 20_000, createdAt: '2026-05-25T10:00:00.000Z' },
      { status: 'FAILED',    amountCents:  5_000, createdAt: '2026-05-25T11:00:00.000Z' },
    ])
    expect(report.confirmed.count).toBe(2)
    expect(report.declined.count).toBe(1)
    expect(report.failed.count).toBe(1)
    expect(report.total.count).toBe(4)
  })

  it('revenue accumulates correctly across multiple confirmed transactions', () => {
    const report = buildZReport([
      { status: 'CONFIRMED', amountCents: 10_000, createdAt: '2026-05-25T07:00:00.000Z' },
      { status: 'CONFIRMED', amountCents: 25_000, createdAt: '2026-05-25T08:00:00.000Z' },
      { status: 'CONFIRMED', amountCents:  5_000, createdAt: '2026-05-25T09:00:00.000Z' },
    ])
    expect(report.confirmed.totalCents).toBe(40_000)  // 10k + 25k + 5k
    expect(report.confirmed.count).toBe(3)
  })
})

describe('Z-Report time window (firstTxnAt / lastTxnAt)', () => {

  it('firstTxnAt is the earliest createdAt in the set', () => {
    const report = buildZReport([
      { status: 'CONFIRMED', amountCents: 10_000, createdAt: '2026-05-25T10:00:00.000Z' },
      { status: 'CONFIRMED', amountCents: 10_000, createdAt: '2026-05-25T07:30:00.000Z' },
      { status: 'CONFIRMED', amountCents: 10_000, createdAt: '2026-05-25T18:45:00.000Z' },
    ])
    expect(report.firstTxnAt).toBe('2026-05-25T07:30:00.000Z')
  })

  it('lastTxnAt is the latest createdAt in the set', () => {
    const report = buildZReport([
      { status: 'CONFIRMED', amountCents: 10_000, createdAt: '2026-05-25T10:00:00.000Z' },
      { status: 'CONFIRMED', amountCents: 10_000, createdAt: '2026-05-25T07:30:00.000Z' },
      { status: 'CONFIRMED', amountCents: 10_000, createdAt: '2026-05-25T18:45:00.000Z' },
    ])
    expect(report.lastTxnAt).toBe('2026-05-25T18:45:00.000Z')
  })

  it('a single transaction has identical firstTxnAt and lastTxnAt', () => {
    const ts = '2026-05-25T12:00:00.000Z'
    const report = buildZReport([{ status: 'CONFIRMED', amountCents: 10_000, createdAt: ts }])
    expect(report.firstTxnAt).toBe(ts)
    expect(report.lastTxnAt).toBe(ts)
  })
})

describe('Z-Report Africa/Nairobi day boundary (UTC+3)', () => {
  // A transaction at 2026-05-25T22:30:00Z = 2026-05-26T01:30:00 Nairobi time.
  // It must appear on the 2026-05-26 Z-Report, not 2026-05-25.

  it('a transaction at 22:30 UTC appears on the NEXT day in Nairobi (UTC+3 = 01:30)', () => {
    const utcTs = '2026-05-25T22:30:00.000Z'
    expect(toNairobiDate(utcTs)).toBe('2026-05-26')
  })

  it('a transaction at 21:00 UTC appears on the SAME day in Nairobi (UTC+3 = 00:00)', () => {
    // 21:00 UTC = exactly midnight Nairobi — belongs to the new day
    const utcTs = '2026-05-25T21:00:00.000Z'
    expect(toNairobiDate(utcTs)).toBe('2026-05-26')
  })

  it('a transaction at 20:59 UTC appears on the CURRENT day in Nairobi (23:59 Nairobi)', () => {
    const utcTs = '2026-05-25T20:59:59.000Z'
    expect(toNairobiDate(utcTs)).toBe('2026-05-25')
  })

  it('a noon transaction stays on the same calendar day in both UTC and Nairobi', () => {
    const utcTs = '2026-05-25T12:00:00.000Z'
    expect(toNairobiDate(utcTs)).toBe('2026-05-25')
  })
})

describe('Z-Report — no data leakage between merchants', () => {
  // The SQL query filters by merchant_id. These tests verify the application-level
  // contract: a merchant only sees their own transactions.

  interface MerchantTxn extends TxnRow { merchantId: string }

  function buildZReportForMerchant(rows: MerchantTxn[], merchantId: string): ZReport {
    return buildZReport(rows.filter(r => r.merchantId === merchantId))
  }

  const rows: MerchantTxn[] = [
    { merchantId: 'A', status: 'CONFIRMED', amountCents: 50_000, createdAt: '2026-05-25T08:00:00.000Z' },
    { merchantId: 'A', status: 'CONFIRMED', amountCents: 30_000, createdAt: '2026-05-25T09:00:00.000Z' },
    { merchantId: 'B', status: 'CONFIRMED', amountCents: 99_999, createdAt: '2026-05-25T10:00:00.000Z' },
  ]

  it('merchant A only sees their own revenue (80k, not 179k)', () => {
    const report = buildZReportForMerchant(rows, 'A')
    expect(report.confirmed.totalCents).toBe(80_000)
    expect(report.confirmed.count).toBe(2)
  })

  it('merchant B only sees their own transaction', () => {
    const report = buildZReportForMerchant(rows, 'B')
    expect(report.confirmed.totalCents).toBe(99_999)
    expect(report.confirmed.count).toBe(1)
  })

  it('a merchant with no transactions sees zeroes, not another merchant\'s data', () => {
    const report = buildZReportForMerchant(rows, 'C')
    expect(report.total.count).toBe(0)
    expect(report.total.totalCents).toBe(0)
  })
})

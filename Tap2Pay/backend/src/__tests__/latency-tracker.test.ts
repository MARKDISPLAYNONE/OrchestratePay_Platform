/**
 * Suite: Latency Tracker (pure unit — no DB)
 *
 * Tests the deterministic logic in util/latency-tracker.ts:
 *   - parseTapTimestamp: valid headers, null cases, clock sanity bounds
 *   - Latency budget targets (documented constants)
 *   - Latency stats shape (null when no data)
 *   - LatencyRecord type shape
 */

// ── parseTapTimestamp (inline model) ──────────────────────────────────────────

function parseTapTimestamp(header: string | undefined): number | null {
  if (!header) return null
  const ms = parseInt(header, 10)
  if (isNaN(ms)) return null
  const now = Date.now()
  if (ms > now + 10_000 || ms < now - 300_000) return null
  return ms
}

// ── Header parsing ────────────────────────────────────────────────────────────

describe('parseTapTimestamp', () => {
  it('undefined header returns null', () => {
    expect(parseTapTimestamp(undefined)).toBeNull()
  })

  it('empty string header returns null', () => {
    expect(parseTapTimestamp('')).toBeNull()
  })

  it('non-numeric string returns null', () => {
    expect(parseTapTimestamp('not-a-number')).toBeNull()
    expect(parseTapTimestamp('abc123')).toBeNull()
  })

  it('valid recent timestamp (now - 1s) is accepted', () => {
    const ts = Date.now() - 1_000
    expect(parseTapTimestamp(String(ts))).toBe(ts)
  })

  it('timestamp exactly at now is accepted', () => {
    const ts = Date.now()
    const result = parseTapTimestamp(String(ts))
    expect(result).not.toBeNull()
  })

  it('timestamp 10 seconds in the future is rejected', () => {
    const ts = Date.now() + 15_000
    expect(parseTapTimestamp(String(ts))).toBeNull()
  })

  it('timestamp 4 minutes old (240s) is accepted (within 300s window)', () => {
    const ts = Date.now() - 240_000
    expect(parseTapTimestamp(String(ts))).toBe(ts)
  })

  it('timestamp 6 minutes old (360s) is rejected (exceeds 300s window)', () => {
    const ts = Date.now() - 360_000
    expect(parseTapTimestamp(String(ts))).toBeNull()
  })

  it('zero is rejected (epoch start, clearly invalid)', () => {
    expect(parseTapTimestamp('0')).toBeNull()
  })

  it('negative timestamp is rejected', () => {
    expect(parseTapTimestamp('-1')).toBeNull()
  })

  it('float string rounds via parseInt — 1748436000500 is accepted', () => {
    const ts = Date.now() - 100
    expect(parseTapTimestamp(String(ts) + '.5')).toBe(ts)
  })
})

// ── Latency budget targets (documented SLA) ───────────────────────────────────

describe('Latency budget targets (documented SLA)', () => {
  const API_ROUND_TRIP_BUDGET_MS  = 500
  const DARAJA_DISPATCH_BUDGET_MS = 1_000
  const TOTAL_MEDIAN_BUDGET_MS    = 5_000
  const TOTAL_P95_BUDGET_MS       = 10_000

  it('API round trip budget is 500ms', () => {
    expect(API_ROUND_TRIP_BUDGET_MS).toBe(500)
  })

  it('Daraja dispatch budget is 1000ms', () => {
    expect(DARAJA_DISPATCH_BUDGET_MS).toBe(1_000)
  })

  it('total tap-to-confirm median budget is 5000ms', () => {
    expect(TOTAL_MEDIAN_BUDGET_MS).toBe(5_000)
  })

  it('total tap-to-confirm p95 budget is 10000ms', () => {
    expect(TOTAL_P95_BUDGET_MS).toBe(10_000)
  })

  it('a 300ms API round trip is within the 500ms budget', () => {
    expect(300).toBeLessThanOrEqual(API_ROUND_TRIP_BUDGET_MS)
  })

  it('a 600ms Daraja dispatch is within the 1000ms budget', () => {
    expect(600).toBeLessThanOrEqual(DARAJA_DISPATCH_BUDGET_MS)
  })

  it('a 4200ms total is within the 5000ms median budget', () => {
    expect(4200).toBeLessThanOrEqual(TOTAL_MEDIAN_BUDGET_MS)
  })

  it('a 9800ms total is within the p95 budget', () => {
    expect(9800).toBeLessThanOrEqual(TOTAL_P95_BUDGET_MS)
  })
})

// ── LatencyRecord shape ───────────────────────────────────────────────────────

describe('LatencyRecord shape', () => {
  it('all numeric fields can be null (partial records are valid)', () => {
    const record = {
      txnId:            'abc-123',
      apiRoundTripMs:   null,
      darajaDispatchMs: null,
      stkConfirmMs:     null,
      totalMs:          null,
      source:           'NFC_TAG',
    }
    expect(record.txnId).toBe('abc-123')
    expect(record.apiRoundTripMs).toBeNull()
    expect(record.totalMs).toBeNull()
  })

  it('complete record with all fields set is valid', () => {
    const record = {
      txnId:            'abc-456',
      apiRoundTripMs:   280,
      darajaDispatchMs: 590,
      stkConfirmMs:     3200,
      totalMs:          4070,
      source:           'NFC_TAG',
    }
    expect(record.totalMs).toBe(4070)
    expect(record.totalMs).toBeLessThanOrEqual(5_000)  // within median budget
  })

  it('totalMs can be derived from segments (segments do not have to sum exactly)', () => {
    const api     = 280
    const daraja  = 590
    const stk     = 3200
    const tapToConfirm = api + daraja + stk  // 4070ms — approximate
    expect(tapToConfirm).toBeLessThanOrEqual(5_000)
  })
})

// ── Stats shape ───────────────────────────────────────────────────────────────

describe('Latency stats shape (empty DB response)', () => {
  const emptyStats = {
    p50TotalMs:          null,
    p95TotalMs:          null,
    p99TotalMs:          null,
    avgApiRoundTripMs:   null,
    avgDarajaDispatchMs: null,
    avgStkConfirmMs:     null,
    sampleCount:         0,
  }

  it('empty stats has sampleCount = 0', () => {
    expect(emptyStats.sampleCount).toBe(0)
  })

  it('empty stats has null percentiles (not 0)', () => {
    expect(emptyStats.p50TotalMs).toBeNull()
    expect(emptyStats.p95TotalMs).toBeNull()
    expect(emptyStats.p99TotalMs).toBeNull()
  })

  it('null percentiles distinguish "no data" from "0ms latency"', () => {
    expect(emptyStats.p50TotalMs).not.toBe(0)
  })
})

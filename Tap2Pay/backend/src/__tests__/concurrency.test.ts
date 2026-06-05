/**
 * Suite 1: Race Condition & Concurrency
 *
 * Payment systems' most dangerous bugs are concurrent requests:
 *   - Two M-Pesa callbacks for the same transaction arriving milliseconds apart
 *   - A merchant double-tapping an NFC sticker before the first STK push fires
 *   - A callback racing with our own step-6 status update (PENDING → STK_SENT)
 *
 * All tests here are pure logic — no real DB or Redis required.
 */

import crypto from 'crypto'

// Fixed timestamp used across all suites in this file
const TS = 1_716_100_000_000

// ─── Idempotency key helpers (mirrors IdempotencyKeyGen.kt and backend logic) ─

function generateKey(merchantId: string, tagId: string, amountCents: number, ts: number): string {
  const minuteTs = Math.floor(ts / 60_000) * 60_000
  const raw = `${merchantId}:${tagId}:${amountCents}:${minuteTs}`
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32)
}

// ─── Callback idempotency guard (mirrors mpesa-callback.ts processCallback) ──

type TxnStatus = 'PENDING' | 'STK_SENT' | 'CONFIRMED' | 'DECLINED' | 'FAILED' | 'EXPIRED'

function isCallbackProcessable(status: TxnStatus): boolean {
  // PENDING  → callback arrived before our step-6 update (race with transaction route)
  // STK_SENT → normal path: STK push was sent, now the callback lands
  return status === 'PENDING' || status === 'STK_SENT'
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Callback idempotency guard', () => {
  it('processes a PENDING transaction (callback arrived before step-6 update)', () => {
    expect(isCallbackProcessable('PENDING')).toBe(true)
  })

  it('processes a STK_SENT transaction (normal flow — prompt is on consumer phone)', () => {
    // CRITICAL: transactions are now STK_SENT by the time the callback arrives.
    // The old guard (status !== PENDING) would silently drop every real callback.
    expect(isCallbackProcessable('STK_SENT')).toBe(true)
  })

  it('rejects a CONFIRMED transaction (duplicate callback — Safaricom retries)', () => {
    expect(isCallbackProcessable('CONFIRMED')).toBe(false)
  })

  it('rejects a DECLINED transaction (duplicate failure callback)', () => {
    expect(isCallbackProcessable('DECLINED')).toBe(false)
  })

  it('rejects a FAILED transaction (already failed — do not re-process)', () => {
    expect(isCallbackProcessable('FAILED')).toBe(false)
  })

  it('rejects an EXPIRED transaction (reconciliation already handled it)', () => {
    expect(isCallbackProcessable('EXPIRED')).toBe(false)
  })
})

describe('Double-tap prevention via idempotency key', () => {
  const MERCHANT = 'merchant-uuid-aaaa'
  const TAG      = 'tag-uuid-bbbb'
  const AMOUNT   = 10000  // KES 100
  const TS       = 1_716_100_000_000

  it('two taps within the same second produce identical keys', () => {
    const key1 = generateKey(MERCHANT, TAG, AMOUNT, TS)
    const key2 = generateKey(MERCHANT, TAG, AMOUNT, TS + 500)  // 500ms later
    expect(key1).toBe(key2)
  })

  it('two taps within the same minute produce identical keys', () => {
    const key1 = generateKey(MERCHANT, TAG, AMOUNT, TS)
    const key2 = generateKey(MERCHANT, TAG, AMOUNT, TS + 10_000)  // 10 seconds later
    expect(key1).toBe(key2)
  })

  it('a tap in the next minute produces a NEW key (consumer walked away and returned)', () => {
    const key1 = generateKey(MERCHANT, TAG, AMOUNT, TS)
    const key2 = generateKey(MERCHANT, TAG, AMOUNT, TS + 60_000)  // 1 minute later
    expect(key1).not.toBe(key2)
  })

  it('different amounts in the same minute produce different keys', () => {
    const key1 = generateKey(MERCHANT, TAG, 10000, TS)
    const key2 = generateKey(MERCHANT, TAG, 20000, TS)
    expect(key1).not.toBe(key2)
  })

  it('keys are 32 hex characters (consistent format for DB unique index)', () => {
    const key = generateKey(MERCHANT, TAG, AMOUNT, TS)
    expect(key).toHaveLength(32)
    expect(key).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('Concurrent STK Push protection', () => {
  it('a cache hit must return the existing pending response, not trigger a new STK push', () => {
    // Simulates the Redis idempotency cache hit path in transactions.ts
    interface CachedResponse { status: string; txnId: string; message: string }
    const cache = new Map<string, CachedResponse>()

    let stkPushCount = 0

    function initiatePayment(idempotencyKey: string, txnId: string): CachedResponse {
      const hit = cache.get(`idempotency:${idempotencyKey}`)
      if (hit) return hit  // ← cache hit: no second STK push

      // Cache miss: fire STK push and store result
      stkPushCount++
      const response = { status: 'STK_SENT', txnId, message: 'M-Pesa prompt sent' }
      cache.set(`idempotency:${idempotencyKey}`, response)
      return response
    }

    const key = generateKey('merchant-1', 'tag-1', 5000, TS)

    // First tap — fires STK push
    const r1 = initiatePayment(key, 'txn-001')
    expect(r1.txnId).toBe('txn-001')
    expect(stkPushCount).toBe(1)

    // Second tap (rapid re-scan) — must NOT fire a second STK push
    const r2 = initiatePayment(key, 'txn-002')  // same key → cache hit
    expect(r2.txnId).toBe('txn-001')  // returns original txnId
    expect(stkPushCount).toBe(1)       // still only 1 push
  })
})

describe('State machine direction (transitions only go forward)', () => {
  const STATES: TxnStatus[] = ['PENDING', 'STK_SENT', 'CONFIRMED', 'DECLINED', 'FAILED', 'EXPIRED']
  const TERMINAL: TxnStatus[] = ['CONFIRMED', 'DECLINED', 'FAILED', 'EXPIRED']

  it('terminal states can never be overwritten by a callback', () => {
    for (const terminal of TERMINAL) {
      expect(isCallbackProcessable(terminal)).toBe(false)
    }
  })

  it('non-terminal states are exactly PENDING and STK_SENT', () => {
    const processable = STATES.filter(isCallbackProcessable)
    expect(processable).toEqual(['PENDING', 'STK_SENT'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Simultaneous callback + reconciliation job race
//
// Scenario: M-Pesa fires the callback at the exact moment the reconciliation
// job is issuing a Daraja STK Query for the same transaction.
//
// Defence: BOTH paths use the same idempotency guard (isCallbackProcessable).
// The database UPDATE uses WHERE status IN ('PENDING','STK_SENT'). Whichever
// path wins the DB row lock, the loser's UPDATE affects 0 rows and is silently
// dropped. No double-CONFIRMED, no double-DECLINED.
//
// These tests verify that the shared guard holds regardless of which path
// "arrives" first — the guard is the authoritative serialisation point.
// ─────────────────────────────────────────────────────────────────────────────

describe('Simultaneous callback + reconciliation race', () => {

  // Simulate the DB row that both paths read before attempting the UPDATE.
  // In Postgres: UPDATE ... WHERE id=$1 AND status IN ('PENDING','STK_SENT')
  // Only one writer gets rowsAffected=1; the other gets rowsAffected=0.
  function applyUpdate(
    currentStatus: TxnStatus,
    incomingStatus: TxnStatus
  ): { applied: boolean; finalStatus: TxnStatus } {
    if (!isCallbackProcessable(currentStatus)) {
      return { applied: false, finalStatus: currentStatus }
    }
    return { applied: true, finalStatus: incomingStatus }
  }

  it('callback wins: reconciliation job sees CONFIRMED and skips gracefully', () => {
    // Callback fires first — row is now CONFIRMED
    const afterCallback = applyUpdate('STK_SENT', 'CONFIRMED')
    expect(afterCallback).toEqual({ applied: true, finalStatus: 'CONFIRMED' })

    // Reconciliation job arrives after — guard sees CONFIRMED, applies nothing
    const afterRecon = applyUpdate(afterCallback.finalStatus, 'CONFIRMED')
    expect(afterRecon).toEqual({ applied: false, finalStatus: 'CONFIRMED' })
  })

  it('reconciliation wins: callback arrives after CONFIRMED and is dropped', () => {
    // Reconciliation fires first — row is now CONFIRMED
    const afterRecon = applyUpdate('STK_SENT', 'CONFIRMED')
    expect(afterRecon.applied).toBe(true)

    // Callback arrives late — guard blocks it
    const afterCallback = applyUpdate(afterRecon.finalStatus, 'CONFIRMED')
    expect(afterCallback.applied).toBe(false)
    expect(afterCallback.finalStatus).toBe('CONFIRMED')  // unchanged
  })

  it('conflicting outcomes are resolved in favour of the first writer', () => {
    // Pathological case: callback says CONFIRMED, reconciliation says DECLINED
    // (Can happen if Daraja returns contradictory results in quick succession)
    const afterCallback = applyUpdate('STK_SENT', 'CONFIRMED')
    expect(afterCallback.applied).toBe(true)

    // Reconciliation tries to write DECLINED — must be blocked
    const afterRecon = applyUpdate(afterCallback.finalStatus, 'DECLINED')
    expect(afterRecon.applied).toBe(false)
    expect(afterRecon.finalStatus).toBe('CONFIRMED')  // the first writer wins, forever
  })

  it('a PENDING row is processable by either path (both race legitimately)', () => {
    // This is the "true" race: the row is still PENDING when both paths read it.
    // Postgres row-level locking ensures only one UPDATE succeeds.
    // We verify both paths CAN legitimately attempt the update on PENDING.
    expect(isCallbackProcessable('PENDING')).toBe(true)
    expect(isCallbackProcessable('STK_SENT')).toBe(true)
    // After one succeeds, the other is blocked — tested in the cases above.
  })

  it('EXPIRED transactions are immune to both callback and reconciliation', () => {
    // After 90 minutes the job marks the transaction EXPIRED.
    // Any late callback arriving after that must not resurrect it.
    const afterExpiry = applyUpdate('EXPIRED', 'CONFIRMED')
    expect(afterExpiry.applied).toBe(false)
    expect(afterExpiry.finalStatus).toBe('EXPIRED')
  })
})

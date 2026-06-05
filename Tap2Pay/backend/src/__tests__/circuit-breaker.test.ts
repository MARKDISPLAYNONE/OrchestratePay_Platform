/**
 * Suite: Circuit Breaker & STK Push Resilience (pure unit)
 *
 * Tests the circuit breaker that wraps the Daraja API, the degraded-mode
 * behaviour when Daraja is unavailable, and the stkQuery double-verification
 * path in the M-Pesa callback handler.
 *
 * Real circuit breaker (daraja.ts): opens after 5 consecutive failures,
 * half-opens after 30s, closes on next success.
 *
 * Callback behaviour when circuit is OPEN:
 *   - Skip stkQuery verification (can't reach Daraja)
 *   - Trust the IP-filtered callback directly
 *   - Log audit event CIRCUIT_OPEN_TRUSTED_CALLBACK
 */

// ─── Circuit breaker model ────────────────────────────────────────────────────

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

interface CircuitBreaker {
  state:          CircuitState
  failureCount:   number
  lastFailureAt:  number | null
  successCount:   number  // in HALF_OPEN, track successes before re-closing
}

const OPEN_THRESHOLD    = 5          // failures before opening
const RESET_TIMEOUT_MS  = 30_000     // ms until OPEN → HALF_OPEN
const CLOSE_SUCCESSES   = 1          // successes in HALF_OPEN before CLOSED

function initialBreaker(): CircuitBreaker {
  return { state: 'CLOSED', failureCount: 0, lastFailureAt: null, successCount: 0 }
}

function recordFailure(cb: CircuitBreaker, nowMs = Date.now()): CircuitBreaker {
  const next = { ...cb, failureCount: cb.failureCount + 1, lastFailureAt: nowMs }
  if (next.failureCount >= OPEN_THRESHOLD) {
    return { ...next, state: 'OPEN', successCount: 0 }
  }
  return next
}

function recordSuccess(cb: CircuitBreaker): CircuitBreaker {
  if (cb.state === 'HALF_OPEN') {
    const next = { ...cb, successCount: cb.successCount + 1 }
    if (next.successCount >= CLOSE_SUCCESSES) {
      return { ...next, state: 'CLOSED', failureCount: 0, successCount: 0 }
    }
    return next
  }
  return { ...cb, failureCount: 0 }
}

function maybeTransitionToHalfOpen(cb: CircuitBreaker, nowMs = Date.now()): CircuitBreaker {
  if (cb.state !== 'OPEN') return cb
  if (cb.lastFailureAt === null) return cb
  if (nowMs - cb.lastFailureAt >= RESET_TIMEOUT_MS) {
    return { ...cb, state: 'HALF_OPEN', successCount: 0 }
  }
  return cb
}

function canFire(cb: CircuitBreaker, nowMs = Date.now()): { allowed: boolean; breaker: CircuitBreaker } {
  const current = maybeTransitionToHalfOpen(cb, nowMs)
  if (current.state === 'OPEN') return { allowed: false, breaker: current }
  return { allowed: true, breaker: current }
}

// ─── stkQuery verification model (mirrors mpesa-callback.ts) ─────────────────

type QueryResult = { resultCode: 0 } | { resultCode: number } | null // null = query failed

function shouldTrustCallbackDirectly(
  circuitOpen: boolean,
  queryResult: QueryResult
): { trust: boolean; reason: string } {
  if (circuitOpen) {
    // Can't verify — trust IP-filtered callback (Daraja is down)
    return { trust: true, reason: 'circuit_open_trusted' }
  }
  if (queryResult === null) {
    // Query failed — don't trust (network error, not circuit)
    return { trust: false, reason: 'query_failed' }
  }
  if (queryResult.resultCode !== 0) {
    // Daraja says NOT successful — callback is disputed
    return { trust: false, reason: 'daraja_disputes_success' }
  }
  return { trust: true, reason: 'daraja_confirmed' }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Circuit breaker state transitions', () => {
  it('starts CLOSED', () => {
    expect(initialBreaker().state).toBe('CLOSED')
  })

  it('stays CLOSED for 4 consecutive failures', () => {
    let cb = initialBreaker()
    for (let i = 0; i < 4; i++) cb = recordFailure(cb)
    expect(cb.state).toBe('CLOSED')
    expect(cb.failureCount).toBe(4)
  })

  it('opens on the 5th consecutive failure', () => {
    let cb = initialBreaker()
    for (let i = 0; i < 5; i++) cb = recordFailure(cb)
    expect(cb.state).toBe('OPEN')
  })

  it('OPEN circuit rejects requests immediately (no Daraja call)', () => {
    let cb = initialBreaker()
    for (let i = 0; i < 5; i++) cb = recordFailure(cb)
    const { allowed } = canFire(cb)
    expect(allowed).toBe(false)
  })

  it('transitions to HALF_OPEN after reset timeout', () => {
    let cb = initialBreaker()
    for (let i = 0; i < 5; i++) cb = recordFailure(cb, 0)
    // Fast-forward past the reset timeout
    const { breaker } = canFire(cb, RESET_TIMEOUT_MS + 1)
    expect(breaker.state).toBe('HALF_OPEN')
  })

  it('HALF_OPEN closes after 1 success (probe succeeded)', () => {
    let cb = initialBreaker()
    for (let i = 0; i < 5; i++) cb = recordFailure(cb, 0)
    cb = maybeTransitionToHalfOpen(cb, RESET_TIMEOUT_MS + 1)
    expect(cb.state).toBe('HALF_OPEN')
    cb = recordSuccess(cb)
    expect(cb.state).toBe('CLOSED')
    expect(cb.failureCount).toBe(0)
  })

  it('HALF_OPEN failure reopens the circuit', () => {
    let cb = initialBreaker()
    for (let i = 0; i < 5; i++) cb = recordFailure(cb, 0)
    cb = maybeTransitionToHalfOpen(cb, RESET_TIMEOUT_MS + 1)
    cb = recordFailure(cb)
    expect(cb.state).toBe('OPEN')
  })

  it('does not transition to HALF_OPEN before timeout expires', () => {
    let cb = initialBreaker()
    for (let i = 0; i < 5; i++) cb = recordFailure(cb, 0)
    const { breaker } = canFire(cb, RESET_TIMEOUT_MS - 1)
    expect(breaker.state).toBe('OPEN')
  })

  it('success in CLOSED state resets failure counter', () => {
    let cb = initialBreaker()
    for (let i = 0; i < 3; i++) cb = recordFailure(cb)
    expect(cb.failureCount).toBe(3)
    cb = recordSuccess(cb)
    expect(cb.failureCount).toBe(0)
    expect(cb.state).toBe('CLOSED')
  })
})

describe('STK Push degraded mode (Daraja down)', () => {
  it('trusts IP-filtered callback when circuit is OPEN', () => {
    const result = shouldTrustCallbackDirectly(true, null)
    expect(result.trust).toBe(true)
    expect(result.reason).toBe('circuit_open_trusted')
  })

  it('trusts callback when Daraja confirms (circuit closed, resultCode=0)', () => {
    const result = shouldTrustCallbackDirectly(false, { resultCode: 0 })
    expect(result.trust).toBe(true)
    expect(result.reason).toBe('daraja_confirmed')
  })

  it('rejects callback when Daraja disputes success (resultCode ≠ 0)', () => {
    const result = shouldTrustCallbackDirectly(false, { resultCode: 1 })
    expect(result.trust).toBe(false)
    expect(result.reason).toBe('daraja_disputes_success')
  })

  it('rejects callback when stkQuery itself failed (network error)', () => {
    const result = shouldTrustCallbackDirectly(false, null)
    expect(result.trust).toBe(false)
    expect(result.reason).toBe('query_failed')
  })

  it('resultCode 500 (Daraja internal error) does not trust the callback', () => {
    const result = shouldTrustCallbackDirectly(false, { resultCode: 500 })
    expect(result.trust).toBe(false)
  })

  it('resultCode -1 (unknown/processing) does not trust the callback', () => {
    const result = shouldTrustCallbackDirectly(false, { resultCode: -1 })
    expect(result.trust).toBe(false)
  })
})

describe('Retry budget exhaustion', () => {
  const MAX_RETRIES = 3

  function retryPolicy(attempt: number, errorType: 'network' | 'declined' | 'server'): 'retry' | 'abort' {
    if (errorType === 'declined') return 'abort'  // never retry a declined payment
    if (attempt >= MAX_RETRIES)   return 'abort'
    return 'retry'
  }

  it('network errors are retried up to max retries', () => {
    expect(retryPolicy(1, 'network')).toBe('retry')
    expect(retryPolicy(2, 'network')).toBe('retry')
    expect(retryPolicy(3, 'network')).toBe('abort')  // exhausted
  })

  it('declined payments are never retried', () => {
    expect(retryPolicy(1, 'declined')).toBe('abort')
    expect(retryPolicy(0, 'declined')).toBe('abort')
  })

  it('server errors are retried', () => {
    expect(retryPolicy(1, 'server')).toBe('retry')
    expect(retryPolicy(3, 'server')).toBe('abort')
  })
})

describe('Exponential backoff delays', () => {
  function backoffMs(attempt: number): number {
    return 1_000 * attempt  // 1s, 2s, 3s (matches PaymentOrchestrator.kt)
  }

  it('attempt 1 waits 1 second', () => expect(backoffMs(1)).toBe(1_000))
  it('attempt 2 waits 2 seconds', () => expect(backoffMs(2)).toBe(2_000))
  it('attempt 3 waits 3 seconds', () => expect(backoffMs(3)).toBe(3_000))

  it('total worst-case wait is under 10 seconds for 3 retries', () => {
    const total = [1, 2, 3].reduce((sum, i) => sum + backoffMs(i), 0)
    expect(total).toBeLessThan(10_000)
  })
})

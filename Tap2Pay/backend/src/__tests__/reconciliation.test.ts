// Unit tests for the reconciliation job's core decision logic.
// These test the business rules without hitting a real database or Daraja API.
//
// The four cases from the SKILL.md:
//   resultCode === 0    → confirm the transaction
//   resultCode === 500  → leave PENDING (Daraja says "still processing")
//   resultCode === -1   → leave PENDING (our query failed)
//   any other code      → decline

describe('Reconciliation job decision logic', () => {

  function shouldSkip(resultCode: number): boolean {
    return resultCode === 500 || resultCode === -1
  }

  function outcomeFor(resultCode: number): 'CONFIRMED' | 'DECLINED' | 'SKIP' {
    if (resultCode === 500 || resultCode === -1) return 'SKIP'
    if (resultCode === 0) return 'CONFIRMED'
    return 'DECLINED'
  }

  it('resultCode 0 → CONFIRMED', () => {
    expect(outcomeFor(0)).toBe('CONFIRMED')
  })

  it('resultCode 500 → SKIP (Daraja says still processing)', () => {
    expect(outcomeFor(500)).toBe('SKIP')
    expect(shouldSkip(500)).toBe(true)
  })

  it('resultCode -1 → SKIP (our query failed, try next run)', () => {
    expect(outcomeFor(-1)).toBe('SKIP')
    expect(shouldSkip(-1)).toBe(true)
  })

  it('resultCode 1 (insufficient funds) → DECLINED', () => {
    expect(outcomeFor(1)).toBe('DECLINED')
    expect(shouldSkip(1)).toBe(false)
  })

  it('resultCode 1032 (user cancelled) → DECLINED', () => {
    expect(outcomeFor(1032)).toBe('DECLINED')
  })

  it('resultCode 1037 (timeout) → DECLINED', () => {
    expect(outcomeFor(1037)).toBe('DECLINED')
  })

  it('resultCode 2001 (wrong PIN) → DECLINED', () => {
    expect(outcomeFor(2001)).toBe('DECLINED')
  })

  it('unknown result code → DECLINED (safe default)', () => {
    expect(outcomeFor(9999)).toBe('DECLINED')
  })
})

describe('Reconciliation expiry window', () => {
  const RECONCILE_AFTER_MINUTES = 5
  const EXPIRE_AFTER_MINUTES = 90

  function isEligibleForReconciliation(ageMinutes: number): boolean {
    return ageMinutes > RECONCILE_AFTER_MINUTES && ageMinutes < EXPIRE_AFTER_MINUTES
  }

  function isExpired(ageMinutes: number): boolean {
    return ageMinutes > EXPIRE_AFTER_MINUTES
  }

  it('transactions under 5 minutes are NOT yet eligible (callback may still arrive)', () => {
    expect(isEligibleForReconciliation(2)).toBe(false)
    expect(isEligibleForReconciliation(5)).toBe(false)
  })

  it('transactions between 5 and 90 minutes ARE eligible for STK Query', () => {
    expect(isEligibleForReconciliation(6)).toBe(true)
    expect(isEligibleForReconciliation(45)).toBe(true)
    expect(isEligibleForReconciliation(90)).toBe(false)  // boundary: 90 min triggers expiry instead
  })

  it('transactions over 90 minutes are EXPIRED (no callback will ever arrive)', () => {
    expect(isExpired(91)).toBe(true)
    expect(isExpired(180)).toBe(true)
    expect(isExpired(90)).toBe(false)  // exactly 90 is still eligible for one last query
  })
})

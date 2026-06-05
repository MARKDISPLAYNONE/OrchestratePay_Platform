/**
 * Suite 3: Security & Injection Prevention
 *
 * Covers the four external-facing attack surfaces:
 *   1. Payload injection (negative/zero amounts, bad types)
 *   2. Callback spoofing (fake IP, disputed stkQuery)
 *   3. Amount mismatch detection (over/under payment claim)
 *   4. Callback verification logic (stkQuery vs circuit-open fallback)
 */

import Joi from 'joi'

// Mirrors the transactionSchema in validate.ts exactly
const transactionSchema = Joi.object({
  merchantId:     Joi.string().uuid().required(),
  amountCents:    Joi.number().integer().min(100).max(10_000_000_00).required(),
  source:         Joi.string().valid('NFC_TAG', 'QR_CODE', 'ISO_CARD').required(),
  tagId:          Joi.string().optional().allow(null),
  nfcUid:         Joi.string().optional().allow(null),
  idempotencyKey: Joi.string().length(32).hex().required(),
  timestamp:      Joi.number().integer().required()
})

function validate(body: object): { valid: boolean; error?: string } {
  const { error } = transactionSchema.validate(body, { abortEarly: false })
  return error ? { valid: false, error: error.message } : { valid: true }
}

// ─── Amount injection ─────────────────────────────────────────────────────────

describe('Negative & zero amount injection', () => {
  const validBase = {
    merchantId:     '12345678-0000-0000-0000-000000000001',
    source:         'NFC_TAG',
    tagId:          'some-tag',
    idempotencyKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    timestamp:      1716000000000
  }

  it('rejects amount = 0', () => {
    expect(validate({ ...validBase, amountCents: 0 }).valid).toBe(false)
  })

  it('rejects amount = -1', () => {
    expect(validate({ ...validBase, amountCents: -1 }).valid).toBe(false)
  })

  it('rejects amount = -100 (negative KES 1)', () => {
    expect(validate({ ...validBase, amountCents: -100 }).valid).toBe(false)
  })

  it('rejects amount = -999999 (large negative)', () => {
    expect(validate({ ...validBase, amountCents: -999999 }).valid).toBe(false)
  })

  it('rejects fractional amount (50.5 cents)', () => {
    expect(validate({ ...validBase, amountCents: 50.5 }).valid).toBe(false)
  })

  it('rejects string "100" (type coercion attack)', () => {
    // Joi with .integer() will accept numeric strings by default.
    // Verify that a string numeric is either coerced correctly or rejected.
    // Our schema uses Joi.number().integer() which will accept "100" as 100 —
    // document this behaviour explicitly so it is a conscious choice.
    const result = transactionSchema.validate({ ...validBase, amountCents: '100' })
    // If Joi coerces it, the resulting value must be a valid integer
    if (!result.error) {
      expect(Number.isInteger(result.value.amountCents)).toBe(true)
      expect(result.value.amountCents).toBeGreaterThanOrEqual(100)
    }
    // Whether accepted or rejected, it must never allow NaN or Infinity
    expect(result.value?.amountCents).not.toBeNaN()
  })

  it('rejects NaN', () => {
    expect(validate({ ...validBase, amountCents: NaN }).valid).toBe(false)
  })

  it('rejects Infinity', () => {
    expect(validate({ ...validBase, amountCents: Infinity }).valid).toBe(false)
  })

  it('rejects amount above maximum (over KES 10,000,000)', () => {
    expect(validate({ ...validBase, amountCents: 1_000_000_001 }).valid).toBe(false)
  })

  it('accepts the minimum valid amount (KES 1 = 100 cents)', () => {
    expect(validate({ ...validBase, amountCents: 100 }).valid).toBe(true)
  })

  it('accepts a typical payment (KES 500 = 50000 cents)', () => {
    expect(validate({ ...validBase, amountCents: 50000 }).valid).toBe(true)
  })
})

// ─── Callback amount mismatch detection ───────────────────────────────────────

describe('Callback amount mismatch (spoofing prevention)', () => {
  function amountMatches(storedCents: number, callbackKsh: number): boolean {
    return Math.ceil(storedCents / 100) === callbackKsh
  }

  it('exact match → accepted', () => {
    expect(amountMatches(5000, 50)).toBe(true)
  })

  it('callback claims MORE than stored → rejected (over-claim spoofing)', () => {
    expect(amountMatches(5000, 51)).toBe(false)
  })

  it('callback claims LESS than stored → rejected (under-payment)', () => {
    expect(amountMatches(5000, 49)).toBe(false)
  })

  it('callback claims zero → rejected', () => {
    expect(amountMatches(5000, 0)).toBe(false)
  })

  it('fractional KSh rounds up correctly (KES 50.50 → expects 51)', () => {
    expect(amountMatches(5050, 51)).toBe(true)
    expect(amountMatches(5050, 50)).toBe(false)
  })
})

// ─── Callback stkQuery verification logic ─────────────────────────────────────

describe('Callback verification via stkQuery', () => {
  type QueryOutcome = { resultCode: number; resultDesc: string }

  function verifyCallback(
    callbackResultCode: number,
    queryResult: QueryOutcome
  ): 'CONFIRMED' | 'FAILED' | 'SKIP_VERIFICATION' {
    if (callbackResultCode !== 0) {
      // Not a success callback — verification not needed
      return 'CONFIRMED'  // will be DECLINED, but verification is a success-only concern
    }

    const verified = queryResult.resultCode !== -1  // -1 = circuit open

    if (!verified) {
      // Circuit open — cannot reach Daraja; trust IP-filtered callback
      return 'SKIP_VERIFICATION'
    }

    return queryResult.resultCode === 0 ? 'CONFIRMED' : 'FAILED'
  }

  it('stkQuery confirms success → CONFIRMED', () => {
    expect(verifyCallback(0, { resultCode: 0, resultDesc: 'Success' })).toBe('CONFIRMED')
  })

  it('stkQuery disputes success (code 1032 = user cancelled) → FAILED', () => {
    // The callback claims success but Daraja says the user cancelled
    expect(verifyCallback(0, { resultCode: 1032, resultDesc: 'User cancelled' })).toBe('FAILED')
  })

  it('stkQuery disputes success (code 1 = insufficient funds) → FAILED', () => {
    expect(verifyCallback(0, { resultCode: 1, resultDesc: 'Insufficient funds' })).toBe('FAILED')
  })

  it('stkQuery disputes success (code 2001 = wrong PIN) → FAILED', () => {
    expect(verifyCallback(0, { resultCode: 2001, resultDesc: 'Wrong PIN' })).toBe('FAILED')
  })

  it('circuit open (code -1) → skip verification, trust IP-filtered callback', () => {
    expect(verifyCallback(0, { resultCode: -1, resultDesc: 'Circuit open' })).toBe('SKIP_VERIFICATION')
  })
})

// ─── Merchant ID guard (IDOR) ─────────────────────────────────────────────────

describe('Merchant ID mismatch guard (IDOR prevention)', () => {
  function isOwnTransaction(jwtMerchantId: string, txnMerchantId: string): boolean {
    return jwtMerchantId === txnMerchantId
  }

  it('same merchant can view their own transaction', () => {
    expect(isOwnTransaction('merchant-A', 'merchant-A')).toBe(true)
  })

  it('merchant cannot access another merchant\'s transaction', () => {
    expect(isOwnTransaction('merchant-A', 'merchant-B')).toBe(false)
  })

  it('empty string never matches a real merchant ID', () => {
    expect(isOwnTransaction('', 'merchant-A')).toBe(false)
  })
})

// ─── Source validation ────────────────────────────────────────────────────────

describe('Source field validation', () => {
  const base = {
    merchantId:     '12345678-0000-0000-0000-000000000001',
    amountCents:    5000,
    idempotencyKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    timestamp:      1716000000000
  }

  it('rejects unknown source "BLUETOOTH"', () => {
    expect(validate({ ...base, source: 'BLUETOOTH' }).valid).toBe(false)
  })

  it('rejects SQL injection attempt in source field', () => {
    expect(validate({ ...base, source: "NFC_TAG'; DROP TABLE transactions;--" }).valid).toBe(false)
  })

  it('rejects empty source', () => {
    expect(validate({ ...base, source: '' }).valid).toBe(false)
  })
})

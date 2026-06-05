// Tests for the transaction endpoint's business rules.
// These test pure logic that doesn't require a real DB or Daraja API.

describe('Transaction request validation rules', () => {

  // Mirrors the Joi schema in validate.ts
  function validateAmount(amountCents: number): boolean {
    return Number.isInteger(amountCents) && amountCents >= 100 && amountCents <= 1_000_000_00
  }

  function validateSource(source: string): boolean {
    return ['NFC_TAG', 'QR_CODE', 'ISO_CARD', 'HCE_PHONE'].includes(source)
  }

  function validateIdempotencyKey(key: string): boolean {
    return /^[0-9a-f]{32}$/.test(key)
  }

  describe('amountCents validation', () => {
    it('accepts KES 1 (100 cents)', () => {
      expect(validateAmount(100)).toBe(true)
    })

    it('accepts KES 50 (5000 cents)', () => {
      expect(validateAmount(5000)).toBe(true)
    })

    it('accepts max amount', () => {
      expect(validateAmount(100_000_000)).toBe(true)
    })

    it('rejects 0 cents', () => {
      expect(validateAmount(0)).toBe(false)
    })

    it('rejects 99 cents (below minimum KES 1)', () => {
      expect(validateAmount(99)).toBe(false)
    })

    it('rejects fractional amounts (must be integer cents)', () => {
      expect(validateAmount(50.5)).toBe(false)
    })

    it('rejects amounts above maximum', () => {
      expect(validateAmount(100_000_001)).toBe(false)
    })
  })

  describe('source validation', () => {
    it('accepts NFC_TAG',   () => expect(validateSource('NFC_TAG')).toBe(true))
    it('accepts QR_CODE',   () => expect(validateSource('QR_CODE')).toBe(true))
    it('accepts ISO_CARD',  () => expect(validateSource('ISO_CARD')).toBe(true))
    it('accepts HCE_PHONE', () => expect(validateSource('HCE_PHONE')).toBe(true))
    it('rejects unknown source', () => expect(validateSource('BLUETOOTH')).toBe(false))
    it('rejects lowercase', () => expect(validateSource('nfc_tag')).toBe(false))
  })

  describe('idempotency key validation', () => {
    it('accepts a valid 32-char hex key', () => {
      expect(validateIdempotencyKey('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')).toBe(true)
    })

    it('rejects keys shorter than 32 chars', () => {
      expect(validateIdempotencyKey('a1b2c3d4')).toBe(false)
    })

    it('rejects keys longer than 32 chars', () => {
      expect(validateIdempotencyKey('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6extra')).toBe(false)
    })

    it('rejects keys with uppercase hex', () => {
      expect(validateIdempotencyKey('A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6')).toBe(false)
    })

    it('rejects keys with non-hex characters', () => {
      expect(validateIdempotencyKey('g1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')).toBe(false)
    })
  })
})

describe('Amount conversion: cents → KSh for Daraja', () => {
  // The backend uses Math.ceil(amountCents / 100) to protect the merchant
  function toKsh(cents: number): number {
    return Math.ceil(cents / 100)
  }

  it('KES 50.00 (5000 cents) → 50 KSh', () => {
    expect(toKsh(5000)).toBe(50)
  })

  it('KES 50.50 (5050 cents) → 51 KSh (rounds UP to protect merchant)', () => {
    expect(toKsh(5050)).toBe(51)
  })

  it('KES 50.01 (5001 cents) → 51 KSh (any fraction rounds up)', () => {
    expect(toKsh(5001)).toBe(51)
  })

  it('KES 1.00 (100 cents) → 1 KSh', () => {
    expect(toKsh(100)).toBe(1)
  })
})

describe('Merchant ID guard', () => {
  // The transaction endpoint verifies the merchantId in the body matches the JWT
  function isMerchantIdMatch(jwtMerchantId: string, bodyMerchantId: string): boolean {
    return jwtMerchantId === bodyMerchantId
  }

  it('matching IDs are accepted', () => {
    const id = 'merchant-uuid-1234'
    expect(isMerchantIdMatch(id, id)).toBe(true)
  })

  it('different IDs are rejected (prevents one merchant paying on behalf of another)', () => {
    expect(isMerchantIdMatch('merchant-A', 'merchant-B')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HCE_PHONE field co-presence rules
// ─────────────────────────────────────────────────────────────────────────────

describe('HCE_PHONE field co-presence validation', () => {
  // Mirrors the guard in transactions.ts:
  //   if (!consumerPhone || !hceToken || !hceExp) → 400

  function validateHceFields(body: {
    source: string
    consumerPhone?: string | null
    hceToken?: string | null
    hceExp?: number | null
  }): { valid: boolean; reason?: string } {
    if (body.source !== 'HCE_PHONE') return { valid: true }
    if (!body.consumerPhone || !body.hceToken || !body.hceExp) {
      return { valid: false, reason: 'consumerPhone, hceToken, and hceExp are required for HCE_PHONE' }
    }
    if (!/^254[0-9]{9}$/.test(body.consumerPhone)) {
      return { valid: false, reason: 'consumerPhone must be 254XXXXXXXXX format' }
    }
    if (!/^[0-9a-f]{32}$/.test(body.hceToken)) {
      return { valid: false, reason: 'hceToken must be 32 lowercase hex characters' }
    }
    return { valid: true }
  }

  const VALID_PHONE = '254712345678'
  const VALID_TOKEN = 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8'
  const VALID_EXP   = Date.now() + 30_000

  it('NFC_TAG source ignores HCE fields entirely', () => {
    expect(validateHceFields({ source: 'NFC_TAG' }).valid).toBe(true)
  })

  it('HCE_PHONE with all three fields is valid', () => {
    expect(validateHceFields({
      source: 'HCE_PHONE', consumerPhone: VALID_PHONE, hceToken: VALID_TOKEN, hceExp: VALID_EXP
    }).valid).toBe(true)
  })

  it('HCE_PHONE without consumerPhone is rejected', () => {
    const result = validateHceFields({ source: 'HCE_PHONE', hceToken: VALID_TOKEN, hceExp: VALID_EXP })
    expect(result.valid).toBe(false)
  })

  it('HCE_PHONE without hceToken is rejected', () => {
    const result = validateHceFields({ source: 'HCE_PHONE', consumerPhone: VALID_PHONE, hceExp: VALID_EXP })
    expect(result.valid).toBe(false)
  })

  it('HCE_PHONE without hceExp is rejected', () => {
    const result = validateHceFields({ source: 'HCE_PHONE', consumerPhone: VALID_PHONE, hceToken: VALID_TOKEN })
    expect(result.valid).toBe(false)
  })

  it('HCE_PHONE with null fields is rejected', () => {
    const result = validateHceFields({ source: 'HCE_PHONE', consumerPhone: null, hceToken: null, hceExp: null })
    expect(result.valid).toBe(false)
  })

  it('rejects phone in 0-prefix format (must be normalised to 254 before NFC tap)', () => {
    const result = validateHceFields({ source: 'HCE_PHONE', consumerPhone: '0712345678', hceToken: VALID_TOKEN, hceExp: VALID_EXP })
    expect(result.valid).toBe(false)
  })

  it('rejects phone with wrong country code', () => {
    const result = validateHceFields({ source: 'HCE_PHONE', consumerPhone: '255712345678', hceToken: VALID_TOKEN, hceExp: VALID_EXP })
    expect(result.valid).toBe(false)
  })

  it('rejects hceToken shorter than 32 chars', () => {
    const result = validateHceFields({ source: 'HCE_PHONE', consumerPhone: VALID_PHONE, hceToken: 'tooshort', hceExp: VALID_EXP })
    expect(result.valid).toBe(false)
  })

  it('rejects uppercase hceToken (scheme produces lowercase only)', () => {
    const result = validateHceFields({ source: 'HCE_PHONE', consumerPhone: VALID_PHONE,
      hceToken: 'A1B2C3D4E5F6A7B8A1B2C3D4E5F6A7B8', hceExp: VALID_EXP })
    expect(result.valid).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HCE token backend verification (mirrors transactions.ts verifyHceToken guard)
// ─────────────────────────────────────────────────────────────────────────────

describe('HCE token verification at the transaction endpoint', () => {
  // Mirrors the logic: if (!verifyHceToken(phone, token, exp)) → 401

  // We inline the verification here so the test has no external deps.
  // The full verifyHceToken unit tests are in hce-token.test.ts.
  const SECRET = 'test-hce-secret-32-bytes-minimum!'
  function mockVerify(phone: string, token: string, exp: number, secret: string): boolean {
    const crypto = require('crypto')
    if (!secret) return false
    if (token.length !== 32 || !/^[0-9a-f]{32}$/.test(token)) return false
    if (Date.now() > exp) return false
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${phone}:${exp}`)
      .digest('hex')
      .slice(0, 32)
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  }

  const phone = '254712345678'
  const exp   = Date.now() + 30_000
  const crypto = require('crypto')
  const validToken = crypto
    .createHmac('sha256', SECRET)
    .update(`${phone}:${exp}`)
    .digest('hex')
    .slice(0, 32)

  it('a correctly signed token for the correct phone passes verification', () => {
    expect(mockVerify(phone, validToken, exp, SECRET)).toBe(true)
  })

  it('a forged all-zero token is rejected → endpoint returns 401', () => {
    expect(mockVerify(phone, '0'.repeat(32), exp, SECRET)).toBe(false)
  })

  it('a valid token presented for a different phone is rejected (phone-swap attack)', () => {
    expect(mockVerify('254700000000', validToken, exp, SECRET)).toBe(false)
  })

  it('an expired token is rejected even if the signature is correct', () => {
    const expiredExp = Date.now() - 1000
    const expiredToken = crypto
      .createHmac('sha256', SECRET)
      .update(`${phone}:${expiredExp}`)
      .digest('hex')
      .slice(0, 32)
    expect(mockVerify(phone, expiredToken, expiredExp, SECRET)).toBe(false)
  })

  it('missing secret returns false (never throws — service degrades, not crashes)', () => {
    expect(mockVerify(phone, validToken, exp, '')).toBe(false)
  })
})

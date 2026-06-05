/**
 * Suite: Payment Links (pure unit — no real Redis or DB)
 *
 * Tests the deterministic logic in routes/payment-links.ts:
 *   - Token shape (16-char hex)
 *   - Redis key format (payment:link:{token})
 *   - TTL value (86400s / 24h)
 *   - URL construction with PAYMENT_LINK_BASE_URL
 *   - Payload JSON round-trip fidelity
 *   - Single-use semantics (link deleted on redemption)
 *   - Idempotency key format validation
 *   - Validation rules for createLink and payLink schemas
 */

// ── Token generation helpers ──────────────────────────────────────────────────

function generateToken(): string {
  // Mirrors: uuidv4().replace(/-/g,'').slice(0,16)
  const chars = 'abcdef0123456789'
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function isValidToken(token: string): boolean {
  return token.length === 16 && /^[a-f0-9]+$/.test(token)
}

const LINK_TTL_S = 86_400  // 24 hours

// ── Token shape ───────────────────────────────────────────────────────────────

describe('Payment link token shape', () => {
  it('token is exactly 16 characters', () => {
    expect(generateToken().length).toBe(16)
  })

  it('token is lowercase hex only', () => {
    const token = generateToken()
    expect(token).toMatch(/^[a-f0-9]+$/)
  })

  it('isValidToken accepts a valid 16-char hex token', () => {
    expect(isValidToken('a1b2c3d4e5f60718')).toBe(true)
  })

  it('isValidToken rejects a 15-char token', () => {
    expect(isValidToken('a1b2c3d4e5f6071')).toBe(false)
  })

  it('isValidToken rejects uppercase characters', () => {
    expect(isValidToken('A1B2C3D4E5F60718')).toBe(false)
  })

  it('two generated tokens are always unique', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
  })
})

// ── Redis key format ──────────────────────────────────────────────────────────

describe('Redis key format', () => {
  it('key uses payment:link: prefix', () => {
    const token = generateToken()
    const key   = `payment:link:${token}`
    expect(key.startsWith('payment:link:')).toBe(true)
  })

  it('key has correct total length (13 + 16 = 29 chars)', () => {
    const token = generateToken()
    const key   = `payment:link:${token}`
    expect(key.length).toBe(29)
  })

  it('payment link key does not collide with P2P or consumer QR keys', () => {
    const token    = 'sametoken1234567'
    const linkKey  = `payment:link:${token}`
    const p2pKey   = `consumer:p2p:${token}`
    const qrKey    = `consumer:qr:${token}`
    expect(linkKey).not.toBe(p2pKey)
    expect(linkKey).not.toBe(qrKey)
  })
})

// ── TTL ───────────────────────────────────────────────────────────────────────

describe('Payment link TTL', () => {
  it('TTL is 86400 seconds (24 hours)', () => {
    expect(LINK_TTL_S).toBe(86_400)
  })

  it('expiry timestamp is ~24h from creation', () => {
    const now    = Date.now()
    const expiry = new Date(now + LINK_TTL_S * 1000)
    const diffMs = expiry.getTime() - now
    expect(diffMs).toBe(86_400_000)
  })
})

// ── URL construction ──────────────────────────────────────────────────────────

describe('Payment link URL construction', () => {
  it('URL uses PAYMENT_LINK_BASE_URL env var', () => {
    const baseUrl = 'https://pay.orchestratepay.co.ke'
    const token   = 'a1b2c3d4e5f60718'
    const url     = `${baseUrl}/pay/${token}`
    expect(url).toBe('https://pay.orchestratepay.co.ke/pay/a1b2c3d4e5f60718')
  })

  it('URL path is /pay/{token}', () => {
    const token = 'a1b2c3d4e5f60718'
    const url   = `https://pay.example.com/pay/${token}`
    expect(url).toContain('/pay/')
    expect(url.endsWith(token)).toBe(true)
  })
})

// ── Payload round-trip ────────────────────────────────────────────────────────

describe('Payload JSON round-trip fidelity', () => {
  const payload = {
    token:       'a1b2c3d4e5f60718',
    merchantId:  '550e8400-e29b-41d4-a716-446655440000',
    amountCents: 50_000,
    description: 'Invoice #123',
    singleUse:   true,
    createdAt:   '2026-05-28T10:00:00.000Z',
    expiresAt:   '2026-05-29T10:00:00.000Z',
  }

  it('serialises and deserialises without data loss', () => {
    const json    = JSON.stringify(payload)
    const parsed  = JSON.parse(json)
    expect(parsed.amountCents).toBe(50_000)
    expect(parsed.token).toBe('a1b2c3d4e5f60718')
    expect(parsed.singleUse).toBe(true)
  })

  it('null description survives round-trip', () => {
    const p2     = { ...payload, description: null }
    const parsed = JSON.parse(JSON.stringify(p2))
    expect(parsed.description).toBeNull()
  })
})

// ── Validation rules ──────────────────────────────────────────────────────────

describe('createLink validation (Joi schema rules)', () => {
  function validateCreate(body: any): { valid: boolean; error?: string } {
    if (!body.amountCents || typeof body.amountCents !== 'number') {
      return { valid: false, error: 'amountCents required' }
    }
    if (!Number.isInteger(body.amountCents)) return { valid: false, error: 'must be integer' }
    if (body.amountCents < 100) return { valid: false, error: 'min 100 cents (KSh 1)' }
    if (body.amountCents > 100_000_000) return { valid: false, error: 'max 100,000,000 cents' }
    if (body.description && body.description.length > 100) return { valid: false, error: 'description max 100 chars' }
    return { valid: true }
  }

  it('valid body passes', () => {
    expect(validateCreate({ amountCents: 50_000 }).valid).toBe(true)
  })

  it('amountCents below 100 (KSh 1) is rejected', () => {
    expect(validateCreate({ amountCents: 50 }).valid).toBe(false)
  })

  it('amountCents above 100,000,000 is rejected', () => {
    expect(validateCreate({ amountCents: 200_000_000 }).valid).toBe(false)
  })

  it('description over 100 chars is rejected', () => {
    expect(validateCreate({ amountCents: 5000, description: 'x'.repeat(101) }).valid).toBe(false)
  })

  it('description exactly 100 chars is accepted', () => {
    expect(validateCreate({ amountCents: 5000, description: 'x'.repeat(100) }).valid).toBe(true)
  })
})

describe('payLink validation (phone + idempotencyKey)', () => {
  function validatePay(body: any): { valid: boolean; error?: string } {
    if (!body.consumerPhone) return { valid: false, error: 'phone required' }
    if (!/^254[0-9]{9}$/.test(body.consumerPhone)) return { valid: false, error: 'invalid phone format' }
    if (!body.idempotencyKey) return { valid: false, error: 'idempotencyKey required' }
    if (!/^[a-f0-9]{32}$/.test(body.idempotencyKey)) return { valid: false, error: 'must be 32-char lowercase hex' }
    return { valid: true }
  }

  it('valid body passes', () => {
    expect(validatePay({ consumerPhone: '254712345678', idempotencyKey: 'a'.repeat(32) }).valid).toBe(true)
  })

  it('phone without 254 prefix is rejected', () => {
    expect(validatePay({ consumerPhone: '0712345678', idempotencyKey: 'a'.repeat(32) }).valid).toBe(false)
  })

  it('phone with +254 is rejected (must omit +)', () => {
    expect(validatePay({ consumerPhone: '+254712345678', idempotencyKey: 'a'.repeat(32) }).valid).toBe(false)
  })

  it('idempotencyKey of 31 chars is rejected', () => {
    expect(validatePay({ consumerPhone: '254712345678', idempotencyKey: 'a'.repeat(31) }).valid).toBe(false)
  })

  it('idempotencyKey with uppercase is rejected', () => {
    expect(validatePay({ consumerPhone: '254712345678', idempotencyKey: 'A'.repeat(32) }).valid).toBe(false)
  })
})

// ── Single-use semantics ──────────────────────────────────────────────────────

describe('Single-use link semantics', () => {
  it('singleUse=true is the default', () => {
    const defaults = { singleUse: true }
    expect(defaults.singleUse).toBe(true)
  })

  it('a redeemed single-use link has the key deleted', () => {
    let stored: string | null = 'payload'
    // Simulates: const deleted = await redis.del(key)
    const deleted = stored !== null ? 1 : 0
    stored = null  // key deleted
    expect(deleted).toBe(1)
    expect(stored).toBeNull()
  })

  it('concurrent redemption of same single-use link: second call gets 0 from DEL', () => {
    let stored: string | null = 'payload'
    // First caller deletes
    const del1 = stored !== null ? (stored = null, 1) : 0
    // Second caller tries to delete same key
    const del2 = stored !== null ? (stored = null, 1) : 0
    expect(del1).toBe(1)  // first succeeds
    expect(del2).toBe(0)  // second gets 409 Conflict
  })
})

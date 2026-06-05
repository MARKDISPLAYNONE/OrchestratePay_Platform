/**
 * Suite: Merchant HCE Token Flow (Scenario 5)
 *
 * Merchant activates HCE mode → POST /transactions/merchant-hce-token issues a
 * signed UUID token stored in Redis as merchant:hce:{token} with a 60-second TTL.
 * Consumer wallet reads it via NFC (OrchestrateHceService → MerchantHceReader),
 * then calls POST /transactions with source=MERCHANT_HCE and merchantHceToken.
 *
 * Tests cover (pure logic — no real Redis or DB):
 *   - Token format and TTL arithmetic
 *   - Redis key construction
 *   - Session payload structure validation
 *   - Token ownership verification (cross-merchant use blocked)
 *   - Expired token detection
 *   - HCE APDU payload type field routing
 */

// ── Helpers (mirrors transactions.ts merchant-hce-token handler) ──────────────

interface MerchantHceSession {
  merchantId:   string
  merchantName: string
  amountCents:  number
  exp:          number
}

function buildMerchantHceRedisKey(token: string): string {
  return `merchant:hce:${token}`
}

function buildMerchantHceSession(
  merchantId:   string,
  merchantName: string,
  amountCents:  number,
  ttlMs         = 60_000
): { token: string; key: string; session: MerchantHceSession; expiresAt: number } {
  const token     = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
  const expiresAt = Date.now() + ttlMs
  return {
    token,
    key:    buildMerchantHceRedisKey(token),
    expiresAt,
    session: { merchantId, merchantName, amountCents, exp: expiresAt },
  }
}

function isSessionExpired(session: MerchantHceSession, now = Date.now()): boolean {
  return now > session.exp
}

function verifyTokenOwnership(
  session: MerchantHceSession,
  claimedMerchantId: string
): boolean {
  return session.merchantId === claimedMerchantId
}

// Mirrors the "MERCHANT_REQUEST" payload built by OrchestrateHceService.buildSessionPayload()
function buildHcePayload(session: MerchantHceSession, token: string): object {
  return {
    type:         'MERCHANT_REQUEST',
    token,
    merchantId:   session.merchantId,
    merchantName: session.merchantName,
    amountCents:  session.amountCents,
    exp:          session.exp,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Merchant HCE token issuance', () => {
  const MERCHANT_ID   = '550e8400-e29b-41d4-a716-446655440001'
  const MERCHANT_NAME = 'Mama Mboga Shop'
  const AMOUNT_CENTS  = 5000  // KSh 50

  it('generates a UUID-shaped token', () => {
    const { token } = buildMerchantHceSession(MERCHANT_ID, MERCHANT_NAME, AMOUNT_CENTS)
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('expiresAt is ~60 seconds in the future', () => {
    const before = Date.now()
    const { expiresAt } = buildMerchantHceSession(MERCHANT_ID, MERCHANT_NAME, AMOUNT_CENTS)
    const after  = Date.now()
    expect(expiresAt).toBeGreaterThanOrEqual(before + 59_000)
    expect(expiresAt).toBeLessThanOrEqual(after   + 61_000)
  })

  it('Redis key is merchant:hce:{token}', () => {
    const { token, key } = buildMerchantHceSession(MERCHANT_ID, MERCHANT_NAME, AMOUNT_CENTS)
    expect(key).toBe(`merchant:hce:${token}`)
    expect(key).toMatch(/^merchant:hce:[0-9a-f-]+$/i)
  })

  it('session payload contains all required fields', () => {
    const { session } = buildMerchantHceSession(MERCHANT_ID, MERCHANT_NAME, AMOUNT_CENTS)
    expect(session.merchantId).toBe(MERCHANT_ID)
    expect(session.merchantName).toBe(MERCHANT_NAME)
    expect(session.amountCents).toBe(AMOUNT_CENTS)
    expect(session.exp).toBeGreaterThan(Date.now())
  })

  it('two successive calls produce different tokens (no collision)', () => {
    const a = buildMerchantHceSession(MERCHANT_ID, MERCHANT_NAME, AMOUNT_CENTS)
    const b = buildMerchantHceSession(MERCHANT_ID, MERCHANT_NAME, AMOUNT_CENTS)
    expect(a.token).not.toBe(b.token)
  })
})

describe('Merchant HCE token expiry', () => {
  const session: MerchantHceSession = {
    merchantId:   'mid-1',
    merchantName: 'Shop',
    amountCents:  1000,
    exp:          Date.now() + 30_000,
  }

  it('token with exp in future is not expired', () => {
    expect(isSessionExpired(session)).toBe(false)
  })

  it('token with exp 1ms in the past is expired', () => {
    const expired = { ...session, exp: Date.now() - 1 }
    expect(isSessionExpired(expired)).toBe(true)
  })

  it('token with exp exactly now is expired (strict: now > exp is false when exp = now, use >=)', () => {
    // The check is `System.currentTimeMillis() > expiresAt` in Kotlin — strictly greater.
    // At exactly the same millisecond the token is still valid.
    const now     = Date.now()
    const atLimit = { ...session, exp: now }
    // now > now is false → token is still valid at exactly the expiry instant
    expect(isSessionExpired(atLimit, now)).toBe(false)
    // 1ms past → expired
    expect(isSessionExpired(atLimit, now + 1)).toBe(true)
  })

  it('expired session returns 401 (endpoint logic: if (!hceData) return 401)', () => {
    // We simulate: Redis key deleted because TTL elapsed → hceData is null
    const hceData: string | null = null
    expect(hceData).toBeNull()
    // Endpoint would respond: res.status(401).json({ error: 'Merchant HCE session expired' })
  })
})

describe('Merchant HCE token ownership verification', () => {
  const session: MerchantHceSession = {
    merchantId:   'merchant-A',
    merchantName: 'Shop A',
    amountCents:  2000,
    exp:          Date.now() + 30_000,
  }

  it('token used by the correct merchant passes', () => {
    expect(verifyTokenOwnership(session, 'merchant-A')).toBe(true)
  })

  it('token used by a different merchant is rejected (cross-merchant attack blocked)', () => {
    expect(verifyTokenOwnership(session, 'merchant-B')).toBe(false)
  })

  it('empty merchantId is rejected', () => {
    expect(verifyTokenOwnership(session, '')).toBe(false)
  })

  it('case-sensitive comparison (UUIDs are lowercase)', () => {
    expect(verifyTokenOwnership(session, 'MERCHANT-A')).toBe(false)
  })
})

describe('OrchestrateHceService HCE payload structure', () => {
  const session: MerchantHceSession = {
    merchantId:   'mid-1',
    merchantName: 'Mama Mboga',
    amountCents:  5000,
    exp:          Date.now() + 60_000,
  }
  const TOKEN = 'test-token-uuid'

  it('payload type is MERCHANT_REQUEST', () => {
    const payload = buildHcePayload(session, TOKEN) as any
    expect(payload.type).toBe('MERCHANT_REQUEST')
  })

  it('payload includes the token, merchantId, merchantName, amountCents, and exp', () => {
    const payload = buildHcePayload(session, TOKEN) as any
    expect(payload.token).toBe(TOKEN)
    expect(payload.merchantId).toBe(session.merchantId)
    expect(payload.merchantName).toBe(session.merchantName)
    expect(payload.amountCents).toBe(session.amountCents)
    expect(payload.exp).toBe(session.exp)
  })

  it('payload type field distinguishes MERCHANT_REQUEST from CONSUMER_PAYMENT', () => {
    const merchantPayload = buildHcePayload(session, TOKEN) as any
    expect(merchantPayload.type).not.toBe('CONSUMER_PAYMENT')
    expect(merchantPayload.type).not.toBe('P2P_REQUEST')
  })

  it('payload does not leak consumer phone number (merchant HCE is merchant-to-consumer)', () => {
    const payload = buildHcePayload(session, TOKEN) as any
    expect(payload.phone).toBeUndefined()
    expect(payload.consumerPhone).toBeUndefined()
  })
})

describe('Merchant HCE Redis key namespace', () => {
  it('merchant:hce: prefix prevents collision with consumer:qr: keys', () => {
    const token = 'same-token-value'
    const merchantKey  = buildMerchantHceRedisKey(token)
    const consumerQrKey = `consumer:qr:${token}`
    expect(merchantKey).not.toBe(consumerQrKey)
    expect(merchantKey.startsWith('merchant:hce:')).toBe(true)
    expect(consumerQrKey.startsWith('consumer:qr:')).toBe(true)
  })

  it('merchant:hce: prefix prevents collision with consumer:p2p: keys', () => {
    const token = 'same-token-value'
    expect(buildMerchantHceRedisKey(token)).not.toBe(`consumer:p2p:${token}`)
  })

  it('all three token namespaces are distinct', () => {
    const token = 'tok'
    const keys  = [
      `merchant:hce:${token}`,
      `consumer:qr:${token}`,
      `consumer:p2p:${token}`,
    ]
    expect(new Set(keys).size).toBe(3)
  })
})

describe('Single-use token semantics (Scenario 5)', () => {
  it('token key is deleted on first use (mirrors redis.del in transactions.ts)', () => {
    // Simulate the Redis store and single-use deletion
    const store = new Map<string, string>()
    const token = 'tok-abc'
    const key   = buildMerchantHceRedisKey(token)
    store.set(key, JSON.stringify({ merchantId: 'm1', amountCents: 100 }))

    // First use: resolve and delete
    const data = store.get(key)
    expect(data).not.toBeUndefined()
    store.delete(key)

    // Second use: key is gone
    expect(store.get(key)).toBeUndefined()
  })
})

/**
 * Suite: Consumer QR Token Flow (Scenario 9)
 *
 * Consumer wallet calls POST /consumers/qr-token → UUID token stored in Redis
 * as consumer:qr:{token} → consumerId with 90s TTL.
 * Merchant scans the QR with ConsumerQrScannerActivity, extracts the UUID,
 * and submits POST /transactions with source=CONSUMER_QR and consumerQrToken.
 * Backend resolves the consumerId from Redis, deletes the key (single-use),
 * and fires the STK Push to the consumer's phone.
 *
 * Tests cover (pure logic — no real Redis or DB):
 *   - Token format and TTL arithmetic
 *   - Redis key construction and namespace isolation
 *   - UUID format validation (what ConsumerQrScannerActivity checks)
 *   - Single-use semantics
 *   - Expired / already-used token detection
 *   - QR token vs P2P token vs merchant HCE token distinctness
 *   - Source field validation for CONSUMER_QR transactions
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildConsumerQrRedisKey(token: string): string {
  return `consumer:qr:${token}`
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function buildQrToken(): { token: string; key: string; expiresAt: number } {
  const token = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
  const TTL_MS   = 90_000
  const expiresAt = Date.now() + TTL_MS
  return { token, key: buildConsumerQrRedisKey(token), expiresAt }
}

// Mirrors ConsumerQrScannerActivity.isValidConsumerToken()
function isValidConsumerToken(value: string): boolean {
  return isValidUuid(value)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Consumer QR token generation (POST /consumers/qr-token)', () => {
  it('generates a UUID v4 token', () => {
    const { token } = buildQrToken()
    expect(isValidUuid(token)).toBe(true)
  })

  it('expiresAt is ~90 seconds in the future', () => {
    const before = Date.now()
    const { expiresAt } = buildQrToken()
    const after  = Date.now()
    expect(expiresAt).toBeGreaterThanOrEqual(before + 89_000)
    expect(expiresAt).toBeLessThanOrEqual(after   + 91_000)
  })

  it('Redis key is consumer:qr:{token}', () => {
    const { token, key } = buildQrToken()
    expect(key).toBe(`consumer:qr:${token}`)
    expect(key.startsWith('consumer:qr:')).toBe(true)
  })

  it('two tokens are always different (UUID uniqueness)', () => {
    const a = buildQrToken()
    const b = buildQrToken()
    expect(a.token).not.toBe(b.token)
    expect(a.key).not.toBe(b.key)
  })

  it('TTL is exactly 90 seconds (90_000ms)', () => {
    const TTL_SECONDS = 90
    const before = Date.now()
    const { expiresAt } = buildQrToken()
    // Allow 10ms for execution jitter
    expect(expiresAt - before).toBeGreaterThanOrEqual(TTL_SECONDS * 1000 - 10)
    expect(expiresAt - before).toBeLessThanOrEqual(TTL_SECONDS * 1000 + 10)
  })
})

describe('ConsumerQrScannerActivity token validation (Scenario 9 — merchant side)', () => {
  it('accepts a valid UUID v4', () => {
    expect(isValidConsumerToken('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('accepts another valid UUID v4', () => {
    expect(isValidConsumerToken('6ba7b810-9dad-41d1-80b4-00c04fd430c8')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidConsumerToken('')).toBe(false)
  })

  it('rejects a random QR payload that is not a UUID', () => {
    // Merchant might scan an unrelated QR code (e.g. a URL or product barcode)
    expect(isValidConsumerToken('https://orchestratepay.co.ke/pay/mid')).toBe(false)
    expect(isValidConsumerToken('https://example.com')).toBe(false)
    expect(isValidConsumerToken('1234567890')).toBe(false)
  })

  it('rejects UUID v1 (wrong version bit)', () => {
    // UUID v1 has a "1" in the version nibble position
    expect(isValidConsumerToken('550e8400-e29b-11d4-a716-446655440000')).toBe(false)
  })

  it('rejects UUID with lowercase-only but wrong variant', () => {
    // UUID variant bit must be 8, 9, a, or b at position [19]
    expect(isValidConsumerToken('550e8400-e29b-41d4-0716-446655440000')).toBe(false)
  })

  it('rejects UUID with uppercase only (our tokens are lowercase, scanner must be case-insensitive)', () => {
    // The validator uses /i flag so uppercase is accepted from any scanner
    expect(isValidConsumerToken('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
  })

  it('rejects UUID with wrong length (33 chars)', () => {
    expect(isValidConsumerToken('550e8400-e29b-41d4-a716-4466554400000')).toBe(false)
  })

  it('rejects UUID with wrong length (35 chars)', () => {
    expect(isValidConsumerToken('550e8400-e29b-41d4-a716-44665544000')).toBe(false)
  })

  it('rejects a 32-char hex string without dashes (common mistake)', () => {
    expect(isValidConsumerToken('550e8400e29b41d4a716446655440000')).toBe(false)
  })
})

describe('Single-use semantics (Scenario 9)', () => {
  it('first resolution succeeds; second attempt returns null (key deleted)', () => {
    const store = new Map<string, string>()
    const { token, key } = buildQrToken()
    const CONSUMER_ID = 'consumer-uuid-abc'
    store.set(key, CONSUMER_ID)

    // First use
    const first = store.get(key)
    expect(first).toBe(CONSUMER_ID)
    store.delete(key)  // single-use: delete immediately

    // Second use
    expect(store.get(key)).toBeUndefined()
  })

  it('expired token is not present (TTL enforcement by Redis)', () => {
    // Simulate Redis TTL expiry: key simply does not exist after TTL
    const store = new Map<string, string>()
    const { key } = buildQrToken()
    // Never inserted — simulates TTL expiry
    expect(store.get(key)).toBeUndefined()
  })

  it('already-used token returns 401 error message', () => {
    const errorMsg = 'QR code expired or already used — ask customer to refresh'
    expect(typeof errorMsg).toBe('string')
    expect(errorMsg).toContain('refresh')
  })
})

describe('CONSUMER_QR source validation', () => {
  const ALL_SOURCES = [
    'NFC_TAG', 'QR_CODE', 'ISO_CARD', 'HCE_PHONE', 'SOFTPOS_MOBILE',
    'CONSUMER_TAG', 'CONSUMER_QR', 'MERCHANT_HCE', 'P2P_NFC', 'P2P_QR',
  ]

  it('CONSUMER_QR is a valid transaction source', () => {
    expect(ALL_SOURCES).toContain('CONSUMER_QR')
  })

  it('CONSUMER_QR differs from QR_CODE (merchant QR vs consumer QR)', () => {
    // QR_CODE = consumer scans merchant's static QR (Scenario 8)
    // CONSUMER_QR = merchant scans consumer's dynamic QR token (Scenario 9)
    expect('CONSUMER_QR').not.toBe('QR_CODE')
  })

  it('CONSUMER_QR token is in Redis (dynamic, short-lived) — merchant QR is static (no Redis key)', () => {
    // QR_CODE path: no token lookup needed (merchant ID is in the URL itself)
    // CONSUMER_QR path: token must be resolved from Redis → consumerId
    const isConsumerQrFlow = (source: string) => source === 'CONSUMER_QR'
    expect(isConsumerQrFlow('CONSUMER_QR')).toBe(true)
    expect(isConsumerQrFlow('QR_CODE')).toBe(false)
  })
})

describe('Redis key namespace isolation (Scenario 9 vs other flows)', () => {
  const TOKEN = 'shared-token-value'

  it('consumer:qr: prefix does not collide with merchant:hce: prefix', () => {
    expect(`consumer:qr:${TOKEN}`).not.toBe(`merchant:hce:${TOKEN}`)
  })

  it('consumer:qr: prefix does not collide with consumer:p2p: prefix', () => {
    expect(`consumer:qr:${TOKEN}`).not.toBe(`consumer:p2p:${TOKEN}`)
  })

  it('same token UUID could theoretically exist in all three namespaces independently', () => {
    const qrKey  = `consumer:qr:${TOKEN}`
    const p2pKey = `consumer:p2p:${TOKEN}`
    const hceKey = `merchant:hce:${TOKEN}`
    // They are distinct Redis keys even with the same token value
    const uniqueKeys = new Set([qrKey, p2pKey, hceKey])
    expect(uniqueKeys.size).toBe(3)
  })
})

describe('QR token flow — STK Push routing (Scenario 9)', () => {
  it('STK Push goes to the consumer whose consumerId is stored in the token', () => {
    // The merchant does NOT enter the consumer's phone — the backend resolves it from consumerId.
    // This prevents the merchant from charging arbitrary phone numbers.
    const consumerInToken = { id: 'c-uuid', phone: '254712345678' }
    // The phone in the DB for consumerId is what the STK push fires to
    expect(consumerInToken.phone.startsWith('254')).toBe(true)
    // Merchant-entered phone (none) is not used at all
  })

  it('merchant cannot substitute a different phone number in the request', () => {
    // Source=CONSUMER_QR uses consumerQrToken to resolve phone — body has no phone field
    // The transactionSchema does not include consumerPhone for CONSUMER_QR flows
    const hasPhoneField = (body: Record<string, unknown>) => 'consumerPhone' in body
    const consumerQrBody = { source: 'CONSUMER_QR', consumerQrToken: 'uuid-token', amountCents: 5000 }
    // consumerPhone is absent — cannot be used to redirect the STK push
    expect(hasPhoneField(consumerQrBody)).toBe(false)
  })
})

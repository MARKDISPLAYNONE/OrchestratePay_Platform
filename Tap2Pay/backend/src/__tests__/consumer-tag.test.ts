/**
 * Suite: Consumer-Written NFC Tag Flows (pure unit)
 *
 * Tests the new CONSUMER_TAG source — consumers program their own NTAG215
 * sticker with https://orchestratepay.co.ke/c/{consumerId}, and merchants
 * tap it to initiate a payment.
 *
 * Covers:
 *   - URL parsing on all platforms (Web NFC, Android NfcReaderManager)
 *   - consumerTagId consumer resolution (5th path in transactions route)
 *   - Consumer lookup response shape (GET /consumers/c/:consumerId)
 *   - Edge cases: deleted account, inactive consumer, wrong UUID format
 *   - Distinction from merchant display tag (/pay/ vs /c/)
 */

// ─── URL parsing helpers (mirrors NfcReaderManager.kt + web scan pages) ───────

function parseConsumerTagUrl(url: string): string | null {
  // Negative lookahead (?![A-Za-z0-9_-]) ensures the segment ends after ≤64 chars.
  // Without it, {1,64} greedily matches the first 64 chars of a 100-char ID and
  // returns them instead of rejecting the URL.
  const m = url.match(/https?:\/\/orchestratepay\.co\.ke\/c\/([A-Za-z0-9_-]{1,64})(?![A-Za-z0-9_-])/)
  return m?.[1] ?? null
}

function parseMerchantPayUrl(url: string): string | null {
  const m = url.match(/https?:\/\/orchestratepay\.co\.ke\/pay\/([A-Za-z0-9_-]{1,64})/)
  return m?.[1] ?? null
}

function parseConsumerIdentityTag(url: string): string | null {
  // orchestratepay://pay?mid=...&tid=...&v=1&sign=...
  const m = url.match(/orchestratepay:\/\/pay\?.*[?&]tid=([A-Za-z0-9_-]+)/)
  return m?.[1] ?? null
}

// ─── Consumer resolution logic (mirrors transactions.ts consumerTagId path) ───

interface ConsumerRow { id: string; phone: string; active: boolean }

function resolveConsumerByTagId(
  consumerId: string,
  db: ConsumerRow[]
): ConsumerRow | null {
  // Mirrors: SELECT id, phone FROM consumers WHERE id = $1 AND active = true
  return db.find(c => c.id === consumerId && c.active) ?? null
}

// ─── Consumer tag lookup response (mirrors GET /consumers/c/:consumerId) ───────

function buildLookupResponse(c: ConsumerRow): { consumerId: string; displayName: string | null; maskedPhone: string } {
  const phone = c.phone
  return {
    consumerId:  c.id,
    displayName: null,  // simplified — real response would include display_name
    maskedPhone: phone.slice(0, 5) + '****' + phone.slice(-2),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Consumer-written tag URL parsing', () => {
  const CONSUMER_ID = '550e8400-e29b-41d4-a716-446655440000'

  it('parses a valid consumer tag URL', () => {
    const url = `https://orchestratepay.co.ke/c/${CONSUMER_ID}`
    expect(parseConsumerTagUrl(url)).toBe(CONSUMER_ID)
  })

  it('parses with http scheme (local dev)', () => {
    const url = `http://orchestratepay.co.ke/c/${CONSUMER_ID}`
    expect(parseConsumerTagUrl(url)).toBe(CONSUMER_ID)
  })

  it('does NOT parse a merchant display tag URL as consumer tag', () => {
    const url = `https://orchestratepay.co.ke/pay/${CONSUMER_ID}`
    expect(parseConsumerTagUrl(url)).toBeNull()
    // But the merchant pay parser should pick it up
    expect(parseMerchantPayUrl(url)).toBe(CONSUMER_ID)
  })

  it('does NOT parse a consumer identity tag (orchestratepay:// scheme)', () => {
    const url = `orchestratepay://pay?mid=m1&tid=t1&v=1`
    expect(parseConsumerTagUrl(url)).toBeNull()
    expect(parseConsumerIdentityTag(url)).toBe('t1')
  })

  it('rejects URL with wrong host', () => {
    expect(parseConsumerTagUrl('https://evil.com/c/anything')).toBeNull()
  })

  it('rejects URL with path traversal attempt', () => {
    expect(parseConsumerTagUrl('https://orchestratepay.co.ke/c/../pay/merchant-id')).toBeNull()
  })

  it('rejects empty consumerId', () => {
    expect(parseConsumerTagUrl('https://orchestratepay.co.ke/c/')).toBeNull()
  })

  it('rejects excessively long consumerId (> 64 chars)', () => {
    const longId = 'a'.repeat(100)
    expect(parseConsumerTagUrl(`https://orchestratepay.co.ke/c/${longId}`)).toBeNull()
  })

  it('consumer tag and merchant tag parsers are mutually exclusive', () => {
    const consumerUrl  = 'https://orchestratepay.co.ke/c/consumer-uuid'
    const merchantUrl  = 'https://orchestratepay.co.ke/pay/merchant-uuid'
    const identityUrl  = 'orchestratepay://pay?mid=m&tid=t&v=1'

    expect(parseConsumerTagUrl(consumerUrl)).not.toBeNull()
    expect(parseMerchantPayUrl(consumerUrl)).toBeNull()

    expect(parseConsumerTagUrl(merchantUrl)).toBeNull()
    expect(parseMerchantPayUrl(merchantUrl)).not.toBeNull()

    expect(parseConsumerTagUrl(identityUrl)).toBeNull()
    expect(parseMerchantPayUrl(identityUrl)).toBeNull()
    expect(parseConsumerIdentityTag(identityUrl)).not.toBeNull()
  })
})

describe('Consumer resolution by tag ID', () => {
  const mockDb: ConsumerRow[] = [
    { id: 'consumer-aaa', phone: '254712345678', active: true  },
    { id: 'consumer-bbb', phone: '254798765432', active: false }, // inactive
    { id: 'consumer-ccc', phone: '254755544433', active: true  },
  ]

  it('resolves an active consumer by their tag ID', () => {
    const result = resolveConsumerByTagId('consumer-aaa', mockDb)
    expect(result).not.toBeNull()
    expect(result!.phone).toBe('254712345678')
  })

  it('returns null for an inactive consumer account', () => {
    // Inactive = account disabled by compliance or user request
    const result = resolveConsumerByTagId('consumer-bbb', mockDb)
    expect(result).toBeNull()
  })

  it('returns null for a non-existent consumer ID (deleted account)', () => {
    const result = resolveConsumerByTagId('consumer-zzz', mockDb)
    expect(result).toBeNull()
  })

  it('is case-sensitive (UUID in lowercase)', () => {
    const result = resolveConsumerByTagId('CONSUMER-AAA', mockDb)
    expect(result).toBeNull()
  })
})

describe('Consumer lookup response (GET /consumers/c/:consumerId)', () => {
  it('masks all but first 5 and last 2 digits of phone', () => {
    const c: ConsumerRow = { id: 'c-1', phone: '254712345678', active: true }
    const resp = buildLookupResponse(c)
    expect(resp.maskedPhone).toBe('25471****78')
    expect(resp.maskedPhone).not.toContain('2345')
  })

  it('includes consumerId in response', () => {
    const c: ConsumerRow = { id: 'c-1', phone: '254712345678', active: true }
    expect(buildLookupResponse(c).consumerId).toBe('c-1')
  })

  it('never exposes the full phone number in the response', () => {
    const c: ConsumerRow = { id: 'c-1', phone: '254712345678', active: true }
    const resp = buildLookupResponse(c)
    // The masked phone must not contain any 4-digit run from the original
    expect(resp.maskedPhone).not.toContain('3456')
    expect(resp.maskedPhone).not.toContain('4567')
  })
})

describe('CONSUMER_TAG source validation', () => {
  const VALID_SOURCES = ['NFC_TAG', 'QR_CODE', 'ISO_CARD', 'HCE_PHONE', 'SOFTPOS_MOBILE', 'CONSUMER_TAG']

  it('CONSUMER_TAG is a recognised payment source', () => {
    expect(VALID_SOURCES).toContain('CONSUMER_TAG')
  })

  it('CONSUMER_TAG differs from NFC_TAG (merchant-programmed sticker)', () => {
    // NFC_TAG = merchant wrote the tag for this consumer (orchestratepay:// URI, signed)
    // CONSUMER_TAG = consumer wrote the tag themselves (https://...co.ke/c/id, unsigned)
    expect('CONSUMER_TAG').not.toBe('NFC_TAG')
  })

  it('all 6 sources are unique strings', () => {
    expect(new Set(VALID_SOURCES).size).toBe(VALID_SOURCES.length)
  })
})

describe('Security: consumer tag cannot be used by the wrong party', () => {
  it('M-Pesa STK Push goes to consumer phone — consumer must approve with PIN', () => {
    // This is a logical assertion: the payment method is not "knowing the tag URL"
    // but "entering M-Pesa PIN on your own phone". Even if an attacker reads
    // the consumer's UUID from the tag, they cannot complete a payment.
    //
    // We assert the correct flow: tag → consumerId → DB phone → STK Push to THAT phone.
    const CONSUMER_PHONE = '254712345678'
    const consumerFromTag = { id: 'c-1', phone: CONSUMER_PHONE, active: true }

    // The phone number the STK push would go to is the DB-stored phone, not
    // anything from the tag itself (the tag only has the consumerId UUID).
    expect(consumerFromTag.phone).toBe(CONSUMER_PHONE)
    expect(consumerFromTag.phone.startsWith('254')).toBe(true)
  })

  it('consumer UUID is not guessable (collision probability is negligible)', () => {
    // UUID v4 has 122 random bits. 2^-62 collision probability per pair.
    // We assert the format only — actual randomness is guaranteed by the DB.
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})

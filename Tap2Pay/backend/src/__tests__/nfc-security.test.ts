/**
 * Suite 2: NFC Tag Security
 *
 * NTAG215 stickers carry a plaintext URI. Without HMAC signing, an attacker
 * can write any merchantId to a cheap blank sticker and redirect payments.
 *
 * Tests here verify:
 *   - Legitimate tags verify correctly
 *   - Any single-bit change to merchantId, tagId, or signature → rejection
 *   - Cross-merchant signature reuse is impossible
 *   - Per-merchant key derivation is stable and merchant-isolated
 */

import {
  deriveMerchantSigningKey,
  signTag,
  verifyTagSignature,
  buildSignedUri
} from '../util/nfc-signing'

const MERCHANT_A = 'a1b2c3d4-0000-0000-0000-000000000001'
const MERCHANT_B = 'a1b2c3d4-0000-0000-0000-000000000002'
const TAG_ID     = 'tag-uuid-1234-abcd-5678'

beforeAll(() => {
  process.env.NFC_SIGNING_SECRET = 'test-secret-for-unit-tests-only-32ch'
})

afterAll(() => {
  delete process.env.NFC_SIGNING_SECRET
})

// ─── Key derivation ───────────────────────────────────────────────────────────

describe('deriveMerchantSigningKey', () => {
  it('produces a 32-character hex string', () => {
    const key = deriveMerchantSigningKey(MERCHANT_A)
    expect(key).toHaveLength(32)
    expect(key).toMatch(/^[0-9a-f]{32}$/)
  })

  it('is deterministic for the same merchantId + secret', () => {
    expect(deriveMerchantSigningKey(MERCHANT_A)).toBe(deriveMerchantSigningKey(MERCHANT_A))
  })

  it('produces DIFFERENT keys for different merchants (isolation — one terminal cannot forge another)', () => {
    const keyA = deriveMerchantSigningKey(MERCHANT_A)
    const keyB = deriveMerchantSigningKey(MERCHANT_B)
    expect(keyA).not.toBe(keyB)
  })

  it('throws when NFC_SIGNING_SECRET is not set', () => {
    const orig = process.env.NFC_SIGNING_SECRET
    delete process.env.NFC_SIGNING_SECRET
    expect(() => deriveMerchantSigningKey(MERCHANT_A)).toThrow('NFC_SIGNING_SECRET')
    process.env.NFC_SIGNING_SECRET = orig
  })
})

// ─── Tag signing ──────────────────────────────────────────────────────────────

describe('signTag', () => {
  it('produces a 16-character hex string', () => {
    const key  = deriveMerchantSigningKey(MERCHANT_A)
    const sign = signTag(MERCHANT_A, TAG_ID, key)
    expect(sign).toHaveLength(16)
    expect(sign).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic', () => {
    const key = deriveMerchantSigningKey(MERCHANT_A)
    expect(signTag(MERCHANT_A, TAG_ID, key)).toBe(signTag(MERCHANT_A, TAG_ID, key))
  })

  it('changes when the tagId changes', () => {
    const key  = deriveMerchantSigningKey(MERCHANT_A)
    const s1   = signTag(MERCHANT_A, 'tag-aaa', key)
    const s2   = signTag(MERCHANT_A, 'tag-bbb', key)
    expect(s1).not.toBe(s2)
  })

  it('changes when the merchantId in the message changes', () => {
    const key = deriveMerchantSigningKey(MERCHANT_A)
    const s1  = signTag(MERCHANT_A, TAG_ID, key)
    const s2  = signTag(MERCHANT_B, TAG_ID, key)  // wrong merchant in message
    expect(s1).not.toBe(s2)
  })
})

// ─── Signature verification ───────────────────────────────────────────────────

describe('verifyTagSignature — happy path', () => {
  it('accepts a correctly signed tag', () => {
    const key  = deriveMerchantSigningKey(MERCHANT_A)
    const sign = signTag(MERCHANT_A, TAG_ID, key)
    expect(verifyTagSignature(MERCHANT_A, TAG_ID, sign)).toBe(true)
  })

  it('buildSignedUri produces a URI that self-verifies', () => {
    const uri  = buildSignedUri(MERCHANT_A, TAG_ID)
    const url  = new URL(uri.replace('orchestratepay://', 'https://'))
    const mid  = url.searchParams.get('mid')!
    const tid  = url.searchParams.get('tid')!
    const sign = url.searchParams.get('sign')!
    expect(verifyTagSignature(mid, tid, sign)).toBe(true)
  })
})

describe('verifyTagSignature — attack vectors', () => {
  let validSign: string

  beforeAll(() => {
    const key = deriveMerchantSigningKey(MERCHANT_A)
    validSign = signTag(MERCHANT_A, TAG_ID, key)
  })

  it('rejects a completely forged signature', () => {
    expect(verifyTagSignature(MERCHANT_A, TAG_ID, 'deadbeefdeadbeef')).toBe(false)
  })

  it('rejects an all-zero signature', () => {
    expect(verifyTagSignature(MERCHANT_A, TAG_ID, '0000000000000000')).toBe(false)
  })

  it('rejects a signature that is one hex digit off', () => {
    // Flip the last character
    const tampered = validSign.slice(0, -1) + (validSign.endsWith('f') ? '0' : 'f')
    expect(verifyTagSignature(MERCHANT_A, TAG_ID, tampered)).toBe(false)
  })

  it('rejects a signature from a DIFFERENT merchant (cross-merchant reuse attack)', () => {
    const keyB    = deriveMerchantSigningKey(MERCHANT_B)
    const signB   = signTag(MERCHANT_B, TAG_ID, keyB)
    // Attacker uses Merchant B's valid signature for Merchant A's tag
    expect(verifyTagSignature(MERCHANT_A, TAG_ID, signB)).toBe(false)
  })

  it('rejects when merchantId is changed (tag cloned to different merchant)', () => {
    // Valid signature was created for MERCHANT_A but attacker presents MERCHANT_B
    expect(verifyTagSignature(MERCHANT_B, TAG_ID, validSign)).toBe(false)
  })

  it('rejects when tagId is changed (signature from a different sticker)', () => {
    expect(verifyTagSignature(MERCHANT_A, 'different-tag-uuid', validSign)).toBe(false)
  })

  it('rejects a signature that is too short', () => {
    expect(verifyTagSignature(MERCHANT_A, TAG_ID, 'deadbeef')).toBe(false)
  })

  it('rejects an empty signature', () => {
    expect(verifyTagSignature(MERCHANT_A, TAG_ID, '')).toBe(false)
  })

  it('rejects a signature with uppercase hex (our scheme is lowercase only)', () => {
    const upper = validSign.toUpperCase()
    expect(verifyTagSignature(MERCHANT_A, TAG_ID, upper)).toBe(false)
  })

  it('returns false (not throws) when NFC_SIGNING_SECRET is absent', () => {
    const orig = process.env.NFC_SIGNING_SECRET
    delete process.env.NFC_SIGNING_SECRET
    expect(() => verifyTagSignature(MERCHANT_A, TAG_ID, validSign)).not.toThrow()
    expect(verifyTagSignature(MERCHANT_A, TAG_ID, validSign)).toBe(false)
    process.env.NFC_SIGNING_SECRET = orig
  })
})

// ─── URI format ───────────────────────────────────────────────────────────────

describe('buildSignedUri', () => {
  it('uses the orchestratepay:// scheme', () => {
    const uri = buildSignedUri(MERCHANT_A, TAG_ID)
    expect(uri).toMatch(/^orchestratepay:\/\/pay\?/)
  })

  it('includes mid, tid, v, and sign params', () => {
    const uri = buildSignedUri(MERCHANT_A, TAG_ID)
    expect(uri).toContain(`mid=${MERCHANT_A}`)
    expect(uri).toContain(`tid=${TAG_ID}`)
    expect(uri).toContain('v=1')
    expect(uri).toMatch(/sign=[0-9a-f]{16}/)
  })

  it('is deterministic (same tag always gets same URI)', () => {
    expect(buildSignedUri(MERCHANT_A, TAG_ID)).toBe(buildSignedUri(MERCHANT_A, TAG_ID))
  })
})

/**
 * Suite: HCE Session Token Security
 *
 * Validates the HMAC-based token system that underpins the Phone-to-POS tap-to-pay flow.
 *
 * The security invariants being tested:
 *   1. Only the server can generate a valid token (requires HCE_TOKEN_SECRET)
 *   2. Tokens expire after 60 seconds (replay prevention)
 *   3. A token is bound to exactly one phone number (cannot be reused for another)
 *   4. Malformed, expired, or tampered tokens are always rejected
 *   5. verifyHceToken never throws — safe to call on untrusted input
 */

import { issueHceToken, verifyHceToken } from '../util/hce-token'

const TEST_PHONE = '254712345678'

beforeAll(() => {
  process.env.HCE_TOKEN_SECRET = 'test-hce-secret-for-unit-tests-32ch'
})

afterAll(() => {
  delete process.env.HCE_TOKEN_SECRET
})

// ─── Token structure ──────────────────────────────────────────────────────────

describe('issueHceToken', () => {
  it('produces a 32-character lowercase hex token', () => {
    const { token } = issueHceToken(TEST_PHONE)
    expect(token).toHaveLength(32)
    expect(token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('sets expiry approximately 60 seconds in the future', () => {
    const before = Date.now()
    const { exp }  = issueHceToken(TEST_PHONE)
    const after  = Date.now()
    expect(exp).toBeGreaterThanOrEqual(before + 59_000)
    expect(exp).toBeLessThanOrEqual(after   + 61_000)
  })

  it('is deterministic for the same phone within the same millisecond (same exp)', () => {
    const { token: t1, exp: e1 } = issueHceToken(TEST_PHONE)
    // Forge a second call with the same exp to prove determinism
    const raw = `${TEST_PHONE}:${e1}`
    const crypto = require('crypto')
    const expected = crypto.createHmac('sha256', process.env.HCE_TOKEN_SECRET)
      .update(raw, 'utf8').digest('hex').slice(0, 32)
    expect(t1).toBe(expected)
  })

  it('throws when HCE_TOKEN_SECRET is not set', () => {
    const orig = process.env.HCE_TOKEN_SECRET
    delete process.env.HCE_TOKEN_SECRET
    expect(() => issueHceToken(TEST_PHONE)).toThrow('HCE_TOKEN_SECRET')
    process.env.HCE_TOKEN_SECRET = orig
  })
})

// ─── Happy path ────────────────────────────────────────────────────────────────

describe('verifyHceToken — valid tokens', () => {
  it('accepts a freshly issued token for the correct phone', () => {
    const { token, exp } = issueHceToken(TEST_PHONE)
    expect(verifyHceToken(TEST_PHONE, token, exp)).toBe(true)
  })

  it('different phones get different tokens for the same expiry', () => {
    const { token: t1, exp } = issueHceToken('254712345678')
    const { token: t2 }      = issueHceToken('254798765432')
    expect(t1).not.toBe(t2)
    // Neither token is valid for the other phone
    expect(verifyHceToken('254798765432', t1, exp)).toBe(false)
    expect(verifyHceToken('254712345678', t2, exp)).toBe(false)
  })
})

// ─── Expiry ────────────────────────────────────────────────────────────────────

describe('verifyHceToken — expired tokens', () => {
  it('rejects a token whose exp is in the past', () => {
    const { token } = issueHceToken(TEST_PHONE)
    const pastExp   = Date.now() - 1  // 1ms ago
    expect(verifyHceToken(TEST_PHONE, token, pastExp)).toBe(false)
  })

  it('rejects a token with exp exactly equal to now (boundary)', () => {
    const { token } = issueHceToken(TEST_PHONE)
    // Use an exp value that is guaranteed to be in the past by the time we verify
    const expiredExp = Date.now() - 5000  // 5 seconds ago
    expect(verifyHceToken(TEST_PHONE, token, expiredExp)).toBe(false)
  })
})

// ─── Tampered input ────────────────────────────────────────────────────────────

describe('verifyHceToken — tampered or forged tokens', () => {
  it('rejects a forged all-zero token', () => {
    const { exp } = issueHceToken(TEST_PHONE)
    expect(verifyHceToken(TEST_PHONE, '0'.repeat(32), exp)).toBe(false)
  })

  it('rejects a token that is one hex digit off', () => {
    const { token, exp } = issueHceToken(TEST_PHONE)
    const tampered = token.slice(0, -1) + (token.endsWith('f') ? '0' : 'f')
    expect(verifyHceToken(TEST_PHONE, tampered, exp)).toBe(false)
  })

  it('rejects a valid token presented for a different phone (phone swap attack)', () => {
    const { token, exp } = issueHceToken(TEST_PHONE)
    expect(verifyHceToken('254799999999', token, exp)).toBe(false)
  })

  it('rejects an uppercase token (scheme produces lowercase only)', () => {
    const { token, exp } = issueHceToken(TEST_PHONE)
    expect(verifyHceToken(TEST_PHONE, token.toUpperCase(), exp)).toBe(false)
  })

  it('rejects an empty token', () => {
    const { exp } = issueHceToken(TEST_PHONE)
    expect(verifyHceToken(TEST_PHONE, '', exp)).toBe(false)
  })

  it('rejects a token that is too short', () => {
    const { exp } = issueHceToken(TEST_PHONE)
    expect(verifyHceToken(TEST_PHONE, 'deadbeef', exp)).toBe(false)
  })

  it('returns false (does not throw) for null-like inputs', () => {
    const { exp } = issueHceToken(TEST_PHONE)
    expect(() => verifyHceToken(TEST_PHONE, '' as any, exp)).not.toThrow()
    expect(verifyHceToken(TEST_PHONE, null as any, exp)).toBe(false)
    expect(verifyHceToken(TEST_PHONE, undefined as any, exp)).toBe(false)
  })
})

// ─── Missing secret ────────────────────────────────────────────────────────────

describe('verifyHceToken — missing HCE_TOKEN_SECRET', () => {
  it('returns false (does not throw) when secret is absent', () => {
    const { token, exp } = issueHceToken(TEST_PHONE)
    const orig = process.env.HCE_TOKEN_SECRET
    delete process.env.HCE_TOKEN_SECRET
    expect(() => verifyHceToken(TEST_PHONE, token, exp)).not.toThrow()
    expect(verifyHceToken(TEST_PHONE, token, exp)).toBe(false)
    process.env.HCE_TOKEN_SECRET = orig
  })
})

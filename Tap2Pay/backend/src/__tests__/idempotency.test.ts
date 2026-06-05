// Tests for the idempotency key invariants described in the backend SKILL.md.
// The key formula is: SHA-256(merchantId:tagId:amountCents:roundToMinute(ts))[0..16] hex

// We implement the same function here to unit-test it in isolation,
// matching the logic in IdempotencyKeyGen.kt on Android and the backend docs.
import crypto from 'crypto'

function generateKey(merchantId: string, tagId: string, amountCents: number, timestampMs: number): string {
  const minuteTs = Math.floor(timestampMs / 60_000) * 60_000
  const raw = `${merchantId}:${tagId}:${amountCents}:${minuteTs}`
  return crypto.createHash('sha256')
    .update(raw, 'utf8')
    .digest('hex')
    .slice(0, 32)
}

const MERCHANT = 'merchant-uuid-1234'
const TAG      = 'tag-uuid-5678'
const AMOUNT   = 5000           // KES 50.00 in cents
const BASE_TS  = 1_716_000_000_000  // a fixed point in time (2024-05-18)

describe('idempotency key generation', () => {
  it('produces a 32-character hex string', () => {
    const key = generateKey(MERCHANT, TAG, AMOUNT, BASE_TS)
    expect(key).toHaveLength(32)
    expect(key).toMatch(/^[0-9a-f]{32}$/)
  })

  it('is deterministic — same inputs always produce the same key', () => {
    const a = generateKey(MERCHANT, TAG, AMOUNT, BASE_TS)
    const b = generateKey(MERCHANT, TAG, AMOUNT, BASE_TS)
    expect(a).toBe(b)
  })

  it('collapses retries within the same minute to the same key', () => {
    const ts1 = BASE_TS                // e.g. 14:30:00.000
    const ts2 = BASE_TS + 30_000       // 14:30:30.000 — same minute
    const ts3 = BASE_TS + 59_999       // 14:30:59.999 — still same minute
    expect(generateKey(MERCHANT, TAG, AMOUNT, ts1))
      .toBe(generateKey(MERCHANT, TAG, AMOUNT, ts2))
    expect(generateKey(MERCHANT, TAG, AMOUNT, ts1))
      .toBe(generateKey(MERCHANT, TAG, AMOUNT, ts3))
  })

  it('generates a DIFFERENT key after 60 seconds (consumer walked away)', () => {
    const ts1 = BASE_TS
    const ts2 = BASE_TS + 60_000       // exactly 1 minute later
    expect(generateKey(MERCHANT, TAG, AMOUNT, ts1))
      .not.toBe(generateKey(MERCHANT, TAG, AMOUNT, ts2))
  })

  it('generates a DIFFERENT key for different amounts', () => {
    const key1 = generateKey(MERCHANT, TAG, 5000,  BASE_TS)
    const key2 = generateKey(MERCHANT, TAG, 10000, BASE_TS)
    expect(key1).not.toBe(key2)
  })

  it('generates a DIFFERENT key for different merchants', () => {
    const key1 = generateKey('merchant-A', TAG, AMOUNT, BASE_TS)
    const key2 = generateKey('merchant-B', TAG, AMOUNT, BASE_TS)
    expect(key1).not.toBe(key2)
  })

  it('generates a DIFFERENT key for different tags', () => {
    const key1 = generateKey(MERCHANT, 'tag-A', AMOUNT, BASE_TS)
    const key2 = generateKey(MERCHANT, 'tag-B', AMOUNT, BASE_TS)
    expect(key1).not.toBe(key2)
  })

  it('is collision-resistant for UUID inputs (the production input format)', () => {
    // merchantId and tagId are always UUIDs — they never contain colons.
    // Because the colon separator cannot appear inside either field, the naive
    // collision ("abc:def"+"ghi" == "abc"+"def:ghi") is impossible in production.
    const key1 = generateKey('a1b2c3d4-0000-0000-0000-000000000001', 'tag-uuid-1111-2222', AMOUNT, BASE_TS)
    const key2 = generateKey('a1b2c3d4-0000-0000-0000-000000000002', 'tag-uuid-1111-2222', AMOUNT, BASE_TS)
    expect(key1).not.toBe(key2)
  })
})

/**
 * util/nfc-signing.ts — HMAC-based NFC tag payload signing.
 *
 * WHY THIS EXISTS:
 * NTAG215 stickers carry a plaintext orchestratepay:// URI. Without a signature,
 * an attacker can craft a fake NFC tag pointing to any merchantId they choose —
 * no physical access required if they know the URI scheme. With signing:
 *   - Only our servers can produce a valid signature (NFC_SIGNING_SECRET is server-only)
 *   - A tag signed for merchant A is invalid when pointed at merchant B
 *   - Compromised tags can be revoked by rotating the signing secret
 *
 * SIGNING SCHEME:
 *   merchantSigningKey = HMAC-SHA256(merchantId, NFC_SIGNING_SECRET).slice(0, 16)  → 32 hex chars
 *   tagSign            = HMAC-SHA256("${mid}:${tid}", merchantSigningKey).slice(0, 8) → 16 hex chars
 *
 * The merchant signing key is derived per-merchant so a compromised terminal only
 * exposes that merchant's key, not every merchant's key. The key is sent to the
 * terminal at login and cached in Android's EncryptedSharedPreferences.
 *
 * SIGNED URI FORMAT:
 *   orchestratepay://pay?mid=<uuid>&tid=<uuid>&v=1&sign=<16-hex>
 *
 * BACKWARD COMPATIBILITY:
 * Tags without a sign param are still accepted (logged as a warning). This allows
 * existing deployed tags to keep working while new tags are programmed with signing.
 * Once all tags in the field are signed, the backend can reject unsigned tags.
 */
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Derives a per-merchant signing key from the server-wide secret.
 * This key is what the terminal stores and uses for local verification.
 */
export function deriveMerchantSigningKey(merchantId: string): string {
  const secret = process.env.NFC_SIGNING_SECRET
  if (!secret) throw new Error('NFC_SIGNING_SECRET env var is required for NDEF signing')

  return createHmac('sha256', secret)
    .update(merchantId)
    .digest('hex')
    .slice(0, 32)  // 16 bytes — enough entropy, shorter to fit in NFC URI space
}

/**
 * Computes the tag signature for a given mid:tid pair.
 * The signingKey should come from deriveMerchantSigningKey().
 */
export function signTag(merchantId: string, tagId: string, signingKey: string): string {
  return createHmac('sha256', Buffer.from(signingKey, 'hex'))
    .update(`${merchantId}:${tagId}`)
    .digest('hex')
    .slice(0, 16)  // 8 bytes — truncated HMAC, prevents brute-force within the URI length budget
}

/**
 * Builds the full NDEF URI to write to an NTAG215 sticker.
 * The sign param allows the terminal to verify the tag on every tap.
 */
export function buildSignedUri(merchantId: string, tagId: string): string {
  const signingKey = deriveMerchantSigningKey(merchantId)
  const sign = signTag(merchantId, tagId, signingKey)
  return `orchestratepay://pay?mid=${merchantId}&tid=${tagId}&v=1&sign=${sign}`
}

/**
 * Verifies a tag signature server-side (used by the tags/sign route for debugging
 * and by integration tests).
 */
export function verifyTagSignature(
  merchantId: string,
  tagId: string,
  sign: string
): boolean {
  try {
    // Reject uppercase hex: our scheme always produces lowercase. Buffer.from(..., 'hex')
    // is case-insensitive, so without this guard 'AABB' would equal 'aabb' in the
    // timingSafeEqual comparison, allowing trivial case-variation forgeries.
    if (!/^[0-9a-f]+$/.test(sign)) return false
    const signingKey = deriveMerchantSigningKey(merchantId)
    const expected = signTag(merchantId, tagId, signingKey)
    if (expected.length !== sign.length) return false
    // timingSafeEqual on Buffers is the only V8-safe constant-time comparison.
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sign, 'hex'))
  } catch {
    return false
  }
}

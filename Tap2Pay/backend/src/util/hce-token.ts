/**
 * hce-token.ts — HMAC-signed session tokens for HCE tap-to-pay.
 *
 * When a customer opens the OrchestratePay Wallet app and taps "Ready to Pay",
 * the app calls POST /api/v1/wallet/session. The server responds with a
 * 60-second token. That token is embedded in the NFC APDU payload so the
 * Sunmi POS can verify it without trusting raw phone numbers from the air.
 *
 * TOKEN FORMAT
 *   HMAC-SHA256( "<phone>:<exp>", HCE_TOKEN_SECRET )[0..32] as hex
 *
 * SECURITY PROPERTIES
 *   1. Only this server can generate a valid token — requires HCE_TOKEN_SECRET
 *   2. Token expires after 60 seconds — prevents replay attacks on sniffed NFC
 *   3. Token is bound to the phone number — changing the phone invalidates it
 *   4. Constant-time comparison — prevents timing oracle on verify
 *   5. Single-use on the Android side — CONFIRM APDU clears the session
 */
import crypto from 'crypto'

const TTL_MS = 60_000  // 60-second window — long enough for a tap, short enough to be useless if replayed

function secret(): string {
  const s = process.env.HCE_TOKEN_SECRET
  if (!s) throw new Error('HCE_TOKEN_SECRET not set — cannot issue or verify HCE tokens')
  return s
}

/**
 * Issues a new 60-second HCE session token for the given phone number.
 * Call this when the customer taps "Ready to Pay" in the wallet app.
 */
export function issueHceToken(phone: string): { token: string; exp: number } {
  const exp = Date.now() + TTL_MS
  const raw = `${phone}:${exp}`
  const token = crypto.createHmac('sha256', secret())
    .update(raw, 'utf8')
    .digest('hex')
    .slice(0, 32)
  return { token, exp }
}

/**
 * Verifies that a token+exp pair is valid for the given phone number.
 * Returns false on any failure — never throws.
 *
 * Called by POST /api/v1/transactions when source=HCE_PHONE to confirm
 * the NFC tap originated from a legitimate OrchestratePay Wallet session.
 */
export function verifyHceToken(phone: string, token: string, exp: number): boolean {
  try {
    // Structural checks — these reveal nothing about the secret
    if (!token || token.length !== 32) return false
    if (!/^[0-9a-f]{32}$/.test(token)) return false

    // ALWAYS compute the HMAC before checking expiry.
    // Checking expiry first creates a timing side-channel: expired tokens return
    // faster than wrong-HMAC tokens, letting an attacker probe which phone numbers
    // have active (unexpired) sessions by measuring response time differences.
    const expected = crypto.createHmac('sha256', secret())
      .update(`${phone}:${exp}`, 'utf8')
      .digest('hex')
      .slice(0, 32)

    const hmacValid = crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(token,    'utf8')
    )

    // Expiry check happens AFTER the constant-time comparison so the total
    // execution time is the same regardless of whether the token is expired.
    if (Date.now() > exp) return false

    return hmacValid
  } catch {
    return false
  }
}

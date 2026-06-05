package com.orchestratepay.payment

import java.security.MessageDigest

/**
 * IdempotencyKeyGen — generates deterministic keys to prevent double-charging.
 *
 * THE PROBLEM: NFC payments are network calls. Networks fail. If the app sends
 * a payment request, the network drops, and the app retries — did Safaricom
 * receive 1 or 2 STK Pushes? Without idempotency, the consumer gets charged twice.
 *
 * THE SOLUTION: For any given (merchant + tag + amount + minute), always generate
 * the SAME key. The backend uses this key to detect duplicate requests and return
 * the cached result instead of creating a new transaction.
 *
 * WHY SHA-256: We can't use a random UUID because it would be different on each
 * retry. We can't use raw concatenation because we don't want keys to be guessable
 * or forgeable. SHA-256 is deterministic, collision-resistant, and fast.
 *
 * WHY ROUND TO MINUTE: If we included the exact millisecond, two retries 200ms
 * apart would generate different keys (defeating the purpose). Rounding to the
 * nearest minute means any retry within 60 seconds of the original tap is treated
 * as the same request. After 60 seconds, a new tap generates a new key — correct
 * behaviour since the consumer walked away and came back.
 */
object IdempotencyKeyGen {

    /**
     * Generates a deterministic 32-character hex key for a payment attempt.
     *
     * Input components:
     *   - merchantId: who the payment is going to
     *   - tagId or rawUid: which tag/consumer initiated it
     *   - amountCents: how much (different amounts = different keys, as expected)
     *   - minute timestamp: collapses all retries within 60s to the same key
     *
     * Output: first 16 bytes of SHA-256 = 32 hex characters
     * (Full SHA-256 is 32 bytes = 64 hex chars; 16 bytes is plenty for uniqueness)
     */
    fun generate(intent: PaymentIntent, amountCents: Long): String {
        // Use tagId if present (preferred), fall back to raw NFC UID
        val tagIdentifier = intent.tagId ?: intent.rawUid ?: "unknown"

        // Round to nearest minute to collapse retries
        val minuteTimestamp = roundToMinute(intent.timestamp)

        // Build the canonical string to hash.
        // Using ':' as separator to avoid accidental collisions like
        // merchantId="abc:def", tagId="ghi" vs merchantId="abc", tagId="def:ghi"
        val raw = "${intent.merchantId}:${tagIdentifier}:${amountCents}:${minuteTimestamp}"

        // SHA-256 hash → take first 16 bytes → format as hex
        return MessageDigest.getInstance("SHA-256")
            .digest(raw.toByteArray(Charsets.UTF_8))
            .take(16)
            .joinToString("") { "%02x".format(it) }
    }

    /** Truncates a millisecond timestamp to the start of its minute */
    private fun roundToMinute(timestampMs: Long): Long = (timestampMs / 60_000L) * 60_000L
}

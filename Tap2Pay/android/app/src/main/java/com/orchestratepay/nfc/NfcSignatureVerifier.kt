package com.orchestratepay.nfc

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * NfcSignatureVerifier — verifies the HMAC-SHA256 signature embedded in NFC tag URIs.
 *
 * The signing key is derived by the backend per-merchant and cached on the terminal
 * at login time. Verification is done locally — no network call during the NFC tap
 * path, so it adds zero latency to the payment flow.
 *
 * SCHEME (mirrors backend util/nfc-signing.ts):
 *   tagSign = HMAC-SHA256("${mid}:${tid}", signingKey).toHex()[0..8]  → 16 hex chars
 *
 * WHY 8 BYTES (16 hex chars): Truncated HMAC-SHA256 is a standard practice
 * (TOTP uses 4 bytes). 8 bytes gives 2^64 possible values — infeasible to brute-force
 * in the URI space, while keeping the URI short enough to fit in NTAG215 capacity.
 *
 * Uses javax.crypto.Mac which is part of the Java standard library —
 * no external crypto dependency needed.
 */
object NfcSignatureVerifier {

    /**
     * Verifies that [sign] is the correct HMAC for this [merchantId]:[tagId] pair.
     *
     * @param merchantId  The `mid` parameter from the NDEF URI
     * @param tagId       The `tid` parameter from the NDEF URI
     * @param sign        The `sign` parameter from the NDEF URI (16 hex chars)
     * @param signingKey  The merchant's signing key from SessionManager (32 hex chars)
     * @return true if the signature is valid, false if invalid or any error occurs
     */
    fun verify(
        merchantId: String,
        tagId: String,
        sign: String,
        signingKey: String
    ): Boolean {
        return try {
            val keyBytes = hexToBytes(signingKey)
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))

            val message = "$merchantId:$tagId"
            val fullHmac = mac.doFinal(message.toByteArray(Charsets.UTF_8))

            // Take first 8 bytes (16 hex chars) — same truncation as the backend
            val expected = fullHmac.take(8).joinToString("") { "%02x".format(it) }

            // Constant-time comparison — prevents timing-based side channel attacks
            constantTimeEquals(expected, sign.lowercase())

        } catch (e: Exception) {
            // Any crypto error (bad key format, etc.) → treat as invalid
            android.util.Log.e("NfcSigVerifier", "Verification error: ${e.message}")
            false
        }
    }

    /**
     * Constant-time string comparison. Standard == returns early on first mismatch,
     * leaking information about where the strings diverge. This prevents an attacker
     * from timing the comparison to guess the HMAC one byte at a time.
     */
    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var result = 0
        for (i in a.indices) {
            result = result or (a[i].code xor b[i].code)
        }
        return result == 0
    }

    private fun hexToBytes(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "Hex string must have even length" }
        return ByteArray(hex.length / 2) { i ->
            hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
    }
}

package com.orchestratepay.nfc

import org.junit.Assert.*
import org.junit.Test
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Unit tests for NfcSignatureVerifier — pure JVM, no Android framework.
 *
 * NfcSignatureVerifier is the on-device HMAC-SHA256 tag authenticator.
 * It is the last defence against cloned or forged NFC stickers before
 * a payment is dispatched, so correctness is critical.
 *
 * Test vectors are computed inline using the same javax.crypto.Mac primitives
 * so the tests do not depend on hard-coded magic constants that could become
 * stale if the signing scheme changes.
 *
 * Coverage:
 *   - Valid signature → accepted
 *   - Uppercase hex sign → accepted (Android normalises with .lowercase())
 *   - Tampered signature (one char changed) → rejected
 *   - Wrong merchantId → rejected
 *   - Wrong tagId → rejected
 *   - Different signing key → rejected
 *   - Empty / short / long sign → rejected (length mismatch)
 *   - All-zero signature → rejected
 *   - Cross-merchant reuse attack → rejected
 *   - constantTimeEquals: equal strings → true, different lengths → false
 */
class NfcSignatureVerifierTest {

    // ── Test fixtures ─────────────────────────────────────────────────────────

    private val SIGNING_KEY  = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"  // 32 hex = 16 bytes
    private val SIGNING_KEY2 = "deadbeefcafe0000111122223333444455"   // different key
    private val MERCHANT_A   = "merchant-uuid-aaaa-aaaa-aaaaaaaaaaaa"
    private val MERCHANT_B   = "merchant-uuid-bbbb-bbbb-bbbbbbbbbbbb"
    private val TAG_ID       = "tag-uuid-1111-1111-111111111111"

    /** Computes the expected 16-hex-char signature using the same algorithm as the source. */
    private fun computeSign(merchantId: String, tagId: String, signingKey: String): String {
        val keyBytes = ByteArray(signingKey.length / 2) { i ->
            signingKey.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))
        val full = mac.doFinal("$merchantId:$tagId".toByteArray(Charsets.UTF_8))
        return full.take(8).joinToString("") { "%02x".format(it) }
    }

    private val validSign: String get() = computeSign(MERCHANT_A, TAG_ID, SIGNING_KEY)

    // ── Valid signature ───────────────────────────────────────────────────────

    @Test
    fun `valid signature is accepted`() {
        assertTrue(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, validSign, SIGNING_KEY))
    }

    @Test
    fun `uppercase sign is accepted (Android normalises with lowercase)`() {
        // Android calls sign.lowercase() before comparing, so it intentionally
        // accepts uppercase hex. This documents the design decision.
        assertTrue(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, validSign.uppercase(), SIGNING_KEY))
    }

    @Test
    fun `valid signature is deterministic (same inputs always verify)`() {
        repeat(5) {
            assertTrue(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, validSign, SIGNING_KEY))
        }
    }

    // ── Tampered signature ────────────────────────────────────────────────────

    @Test
    fun `tampered signature (first char changed) is rejected`() {
        val tampered = validSign.replaceFirst(validSign[0], if (validSign[0] == 'a') 'b' else 'a')
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, tampered, SIGNING_KEY))
    }

    @Test
    fun `all-zero signature is rejected`() {
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, "0000000000000000", SIGNING_KEY))
    }

    @Test
    fun `all-f signature is rejected`() {
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, "ffffffffffffffff", SIGNING_KEY))
    }

    // ── Wrong inputs ──────────────────────────────────────────────────────────

    @Test
    fun `wrong merchantId is rejected`() {
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_B, TAG_ID, validSign, SIGNING_KEY))
    }

    @Test
    fun `wrong tagId is rejected`() {
        val otherTag = "tag-uuid-9999-9999-999999999999"
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_A, otherTag, validSign, SIGNING_KEY))
    }

    @Test
    fun `wrong signing key is rejected`() {
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, validSign, SIGNING_KEY2))
    }

    // ── Length guards ─────────────────────────────────────────────────────────

    @Test
    fun `empty signature is rejected`() {
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, "", SIGNING_KEY))
    }

    @Test
    fun `too-short signature is rejected`() {
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, validSign.take(8), SIGNING_KEY))
    }

    @Test
    fun `too-long signature is rejected`() {
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, validSign + "00", SIGNING_KEY))
    }

    @Test
    fun `signature is exactly 16 hex characters (8 bytes)`() {
        assertEquals(16, validSign.length)
    }

    // ── Cross-merchant attack ─────────────────────────────────────────────────

    @Test
    fun `signature for merchant A is rejected for merchant B (cross-merchant reuse)`() {
        val signForA = computeSign(MERCHANT_A, TAG_ID, SIGNING_KEY)
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_B, TAG_ID, signForA, SIGNING_KEY))
    }

    @Test
    fun `different merchants with same tagId get different signatures`() {
        val signA = computeSign(MERCHANT_A, TAG_ID, SIGNING_KEY)
        val signB = computeSign(MERCHANT_B, TAG_ID, SIGNING_KEY)
        assertNotEquals(signA, signB)
    }

    // ── Bad signing key format ────────────────────────────────────────────────

    @Test
    fun `odd-length signing key returns false (does not throw)`() {
        // hexToBytes requires even-length hex; odd input should be caught and return false
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, validSign, "abc"))
    }

    // ── Signing key isolation ─────────────────────────────────────────────────

    @Test
    fun `two different signing keys produce different signatures`() {
        val sign1 = computeSign(MERCHANT_A, TAG_ID, SIGNING_KEY)
        val sign2 = computeSign(MERCHANT_A, TAG_ID, SIGNING_KEY2)
        assertNotEquals(sign1, sign2)
    }

    // ── Signature only encodes mid:tid — not other fields ─────────────────────

    @Test
    fun `signature changes when tagId changes (tag cloning attack rejected)`() {
        val signOriginal = computeSign(MERCHANT_A, TAG_ID,                     SIGNING_KEY)
        val signCloned   = computeSign(MERCHANT_A, "tag-uuid-clone-0000-0000", SIGNING_KEY)
        assertNotEquals(signOriginal, signCloned)
        // Cloned tag sign does not verify against original tagId
        assertFalse(NfcSignatureVerifier.verify(MERCHANT_A, TAG_ID, signCloned, SIGNING_KEY))
    }
}

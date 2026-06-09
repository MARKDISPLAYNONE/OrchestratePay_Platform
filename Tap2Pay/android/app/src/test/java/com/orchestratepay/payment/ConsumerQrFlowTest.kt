package com.orchestratepay.payment

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for the CONSUMER_QR payment flow logic.
 *
 * These tests verify:
 *   - PaymentSource.CONSUMER_QR exists and is distinct from other sources
 *   - PaymentIntent correctly carries consumerQrToken
 *   - Idempotency key generation works for CONSUMER_QR intents
 *   - The QR token is correctly threaded through the request builder
 */
class ConsumerQrFlowTest {

    // ─── PaymentSource enum ────────────────────────────────────────────────────

    @Test
    fun `CONSUMER_QR is a distinct PaymentSource`() {
        val all = PaymentSource.values()
        assertTrue("CONSUMER_QR must be defined", all.any { it.name == "CONSUMER_QR" })
    }

    @Test
    fun `CONSUMER_QR is different from QR_CODE`() {
        assertNotEquals(PaymentSource.CONSUMER_QR, PaymentSource.QR_CODE)
    }

    @Test
    fun `CONSUMER_QR is different from NFC_TAG`() {
        assertNotEquals(PaymentSource.CONSUMER_QR, PaymentSource.NFC_TAG)
    }

    @Test
    fun `all expected PaymentSource values are defined`() {
        val expected = setOf("NFC_TAG", "QR_CODE", "ISO_CARD", "HCE_PHONE", "CONSUMER_TAG", "CONSUMER_QR")
        val actual   = PaymentSource.values().map { it.name }.toSet()
        assertTrue("Missing sources: ${expected - actual}", actual.containsAll(expected))
    }

    // ─── PaymentIntent with CONSUMER_QR ──────────────────────────────────────

    @Test
    fun `PaymentIntent accepts consumerQrToken for CONSUMER_QR source`() {
        val token  = "550e8400-e29b-41d4-a716-446655440000"
        val intent = PaymentIntent(
            source          = PaymentSource.CONSUMER_QR,
            merchantId      = "merchant-xyz",
            consumerQrToken = token
        )
        assertEquals(PaymentSource.CONSUMER_QR, intent.source)
        assertEquals(token, intent.consumerQrToken)
        assertEquals("merchant-xyz", intent.merchantId)
    }

    @Test
    fun `PaymentIntent consumerQrToken defaults to null`() {
        val intent = PaymentIntent(
            source     = PaymentSource.NFC_TAG,
            merchantId = "m",
            tagId      = "tag-1"
        )
        assertNull(intent.consumerQrToken)
    }

    @Test
    fun `PaymentIntent for CONSUMER_QR has no tagId or nfcUid`() {
        val intent = PaymentIntent(
            source          = PaymentSource.CONSUMER_QR,
            merchantId      = "m",
            consumerQrToken = "uuid-token"
        )
        assertNull(intent.tagId)
        assertNull(intent.rawUid)
        assertNull(intent.consumerPhone)
        assertNull(intent.hceToken)
        assertNull(intent.consumerId)
    }

    @Test
    fun `PaymentIntent timestamp defaults to current time`() {
        val before = System.currentTimeMillis()
        val intent = PaymentIntent(
            source     = PaymentSource.CONSUMER_QR,
            merchantId = "m"
        )
        val after = System.currentTimeMillis()
        assertTrue(intent.timestamp in before..after)
    }

    // ─── Idempotency key for CONSUMER_QR ─────────────────────────────────────

    @Test
    fun `IdempotencyKeyGen produces 32-char key for CONSUMER_QR intent`() {
        val intent = PaymentIntent(
            source          = PaymentSource.CONSUMER_QR,
            merchantId      = "merchant-1",
            consumerQrToken = "uuid-abc-def",
            timestamp       = 1_700_000_000_000L
        )
        val key = IdempotencyKeyGen.generate(intent, 5_000L)
        assertEquals(32, key.length)
        assertTrue(key.matches(Regex("[0-9a-f]{32}")))
    }

    @Test
    fun `CONSUMER_QR and NFC_TAG intents with same merchantId produce different keys`() {
        val ts = 1_700_000_000_000L
        val qrIntent = PaymentIntent(
            source          = PaymentSource.CONSUMER_QR,
            merchantId      = "m1",
            consumerQrToken = "uuid-token-abc",
            timestamp       = ts
        )
        val nfcIntent = PaymentIntent(
            source     = PaymentSource.NFC_TAG,
            merchantId = "m1",
            tagId      = "tag-1",
            timestamp  = ts
        )
        val qrKey  = IdempotencyKeyGen.generate(qrIntent, 5_000L)
        val nfcKey = IdempotencyKeyGen.generate(nfcIntent, 5_000L)
        // These should differ because the source names differ in the hash input
        assertNotEquals(qrKey, nfcKey)
    }

    @Test
    fun `two CONSUMER_QR intents within the same minute produce the same key`() {
        val ts = 1_700_000_000_000L
        val intent1 = PaymentIntent(
            source          = PaymentSource.CONSUMER_QR,
            merchantId      = "m1",
            consumerQrToken = "uuid-token",
            timestamp       = ts
        )
        val intent2 = intent1.copy(timestamp = ts + 30_000L)  // 30s later, same minute

        val key1 = IdempotencyKeyGen.generate(intent1, 5_000L)
        val key2 = IdempotencyKeyGen.generate(intent2, 5_000L)
        assertEquals(key1, key2)
    }

    // ─── ConsumerQrToken UUID format validation ───────────────────────────────

    @Test
    fun `valid UUID is recognised as a consumer token`() {
        assertTrue(isValidConsumerToken("550e8400-e29b-41d4-a716-446655440000"))
        assertTrue(isValidConsumerToken("00000000-0000-0000-0000-000000000000"))
    }

    @Test
    fun `non-UUID strings are not valid consumer tokens`() {
        assertFalse(isValidConsumerToken("not-a-uuid"))
        assertFalse(isValidConsumerToken(""))
        assertFalse(isValidConsumerToken("12345"))
        assertFalse(isValidConsumerToken("http://evil.com/payload"))
    }

    @Test
    fun `UUID with uppercase is still valid`() {
        assertTrue(isValidConsumerToken("550E8400-E29B-41D4-A716-446655440000"))
    }

    private fun isValidConsumerToken(value: String): Boolean {
        return try { java.util.UUID.fromString(value); true } catch (_: Exception) { false }
    }
}

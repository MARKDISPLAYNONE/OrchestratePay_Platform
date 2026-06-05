package com.orchestratepay.payment

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for IdempotencyKeyGen.
 *
 * This is a pure Kotlin function (no Android dependencies), so it runs
 * on the JVM with no device or emulator needed: ./gradlew test
 */
class IdempotencyKeyGenTest {

    private val merchantId = "merchant-uuid-1234-5678-abcd"
    private val tagId      = "tag-uuid-aaaa-bbbb-cccc"
    private val amount     = 5000L      // KES 50.00 in cents
    private val baseTs     = 1_716_000_000_000L  // fixed point in time

    private fun intent(
        mId: String = merchantId,
        tId: String = tagId,
        ts: Long = baseTs
    ) = PaymentIntent(
        source     = PaymentSource.NFC_TAG,
        merchantId = mId,
        tagId      = tId,
        timestamp  = ts
    )

    @Test
    fun `key is 32 hex characters`() {
        val key = IdempotencyKeyGen.generate(intent(), amount)
        assertEquals(32, key.length)
        assertTrue("Key must be hex", key.matches(Regex("[0-9a-f]{32}")))
    }

    @Test
    fun `same inputs always produce the same key`() {
        val a = IdempotencyKeyGen.generate(intent(), amount)
        val b = IdempotencyKeyGen.generate(intent(), amount)
        assertEquals(a, b)
    }

    @Test
    fun `retries within the same minute produce the same key`() {
        val key1 = IdempotencyKeyGen.generate(intent(ts = baseTs),                amount)
        val key2 = IdempotencyKeyGen.generate(intent(ts = baseTs + 30_000L),      amount)  // +30s
        val key3 = IdempotencyKeyGen.generate(intent(ts = baseTs + 59_999L),      amount)  // +59s
        assertEquals("Retry at 30s must match original", key1, key2)
        assertEquals("Retry at 59s must match original", key1, key3)
    }

    @Test
    fun `new tap after 60 seconds produces a different key`() {
        val key1 = IdempotencyKeyGen.generate(intent(ts = baseTs),           amount)
        val key2 = IdempotencyKeyGen.generate(intent(ts = baseTs + 60_000L), amount)  // +1 min
        assertNotEquals("New minute must be a new key", key1, key2)
    }

    @Test
    fun `different amounts produce different keys`() {
        val key1 = IdempotencyKeyGen.generate(intent(), 5000L)
        val key2 = IdempotencyKeyGen.generate(intent(), 10000L)
        assertNotEquals(key1, key2)
    }

    @Test
    fun `different merchants produce different keys`() {
        val key1 = IdempotencyKeyGen.generate(intent(mId = "merchant-A"), amount)
        val key2 = IdempotencyKeyGen.generate(intent(mId = "merchant-B"), amount)
        assertNotEquals(key1, key2)
    }

    @Test
    fun `different tags produce different keys`() {
        val key1 = IdempotencyKeyGen.generate(intent(tId = "tag-A"), amount)
        val key2 = IdempotencyKeyGen.generate(intent(tId = "tag-B"), amount)
        assertNotEquals(key1, key2)
    }

    @Test
    fun `falls back to rawUid when tagId is null`() {
        val withTagId = PaymentIntent(
            source = PaymentSource.NFC_TAG,
            merchantId = merchantId,
            tagId = "explicit-tag-id",
            rawUid = null,
            timestamp = baseTs
        )
        val withUidOnly = PaymentIntent(
            source = PaymentSource.NFC_TAG,
            merchantId = merchantId,
            tagId = null,
            rawUid = "04ab12cd34ef01",
            timestamp = baseTs
        )
        val key1 = IdempotencyKeyGen.generate(withTagId, amount)
        val key2 = IdempotencyKeyGen.generate(withUidOnly, amount)
        // They use different identifiers, so keys must differ
        assertNotEquals(key1, key2)
        // But the uid-only key must still be 32 hex chars
        assertEquals(32, key2.length)
    }
}

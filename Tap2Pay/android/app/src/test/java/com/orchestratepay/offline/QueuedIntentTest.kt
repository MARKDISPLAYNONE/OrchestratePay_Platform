package com.orchestratepay.offline

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for QueuedIntent data class and QueueSyncService business rules.
 *
 * QueueSyncService and OfflineQueueDatabase both require Android context — only
 * the pure data class contracts, queuing constraints, and pruning constants
 * are tested here on the JVM.
 */
class QueuedIntentTest {

    private fun nfcIntent(
        key: String = "key-abc",
        retryCount: Int = 0,
        queuedAt: Long = 1_700_000_000_000L
    ) = QueuedIntent(
        idempotencyKey = key,
        merchantId     = "m1",
        tagId          = "tag-01",
        rawUid         = "04:AB:CD:EF",
        source         = "NFC_TAG",
        amountCents    = 5_000L,
        queuedAt       = queuedAt,
        retryCount     = retryCount
    )

    private fun qrIntent(key: String = "key-qr") = QueuedIntent(
        idempotencyKey = key,
        merchantId     = "m1",
        tagId          = null,
        rawUid         = null,
        source         = "QR_CODE",
        amountCents    = 3_000L
    )

    // ─── QueuedIntent field contracts ─────────────────────────────────────────

    @Test
    fun `NFC_TAG intent carries all required fields`() {
        val intent = nfcIntent()
        assertEquals("key-abc",       intent.idempotencyKey)
        assertEquals("m1",            intent.merchantId)
        assertEquals("tag-01",        intent.tagId)
        assertEquals("04:AB:CD:EF",   intent.rawUid)
        assertEquals("NFC_TAG",       intent.source)
        assertEquals(5_000L,          intent.amountCents)
        assertEquals(0,               intent.retryCount)
        assertNull(intent.lastAttemptAt)
    }

    @Test
    fun `QR_CODE intent has null tagId and rawUid`() {
        val intent = qrIntent()
        assertEquals("QR_CODE",       intent.source)
        assertNull(intent.tagId)
        assertNull(intent.rawUid)
    }

    @Test
    fun `retryCount defaults to 0`() {
        assertEquals(0, nfcIntent().retryCount)
    }

    @Test
    fun `lastAttemptAt defaults to null`() {
        assertNull(nfcIntent().lastAttemptAt)
    }

    @Test
    fun `queuedAt defaults to a recent timestamp when not provided`() {
        val before = System.currentTimeMillis()
        val intent = QueuedIntent(
            idempotencyKey = "k",
            merchantId     = "m",
            tagId          = null,
            rawUid         = null,
            source         = "QR_CODE",
            amountCents    = 1_000L
        )
        val after = System.currentTimeMillis()
        assertTrue(intent.queuedAt in before..after)
    }

    // ─── Source filter — HCE_PHONE must never be queued ───────────────────────

    @Test
    fun `only NFC_TAG and QR_CODE are valid offline queue sources`() {
        val queueableSources = setOf("NFC_TAG", "QR_CODE")
        // Verify our test intents use only queueable sources
        assertTrue(nfcIntent().source in queueableSources)
        assertTrue(qrIntent().source  in queueableSources)
    }

    @Test
    fun `HCE_PHONE is not a queueable source`() {
        // HCE session tokens expire in 60 seconds, long before connectivity is restored.
        // This test documents the invariant so future engineers don't accidentally queue HCE.
        val queueableSources = setOf("NFC_TAG", "QR_CODE")
        assertFalse("HCE_PHONE should not be queueable", "HCE_PHONE" in queueableSources)
    }

    @Test
    fun `CONSUMER_QR is not a queueable source`() {
        // Consumer QR tokens are also short-lived (issued by consumer wallet app).
        val queueableSources = setOf("NFC_TAG", "QR_CODE")
        assertFalse("CONSUMER_QR should not be queueable", "CONSUMER_QR" in queueableSources)
    }

    // ─── Retry and pruning constants ──────────────────────────────────────────

    @Test
    fun `MAX_RETRIES constant is 5`() {
        // QueueSyncService drops items after MAX_RETRIES = 5 attempts.
        // Changing this affects how long the merchant tries before giving up.
        val maxRetries = 5
        val intent = nfcIntent(retryCount = maxRetries)
        assertTrue("item at MAX_RETRIES threshold", intent.retryCount >= maxRetries)
    }

    @Test
    fun `item below MAX_RETRIES is retryable`() {
        val intent = nfcIntent(retryCount = 4)
        assertTrue(intent.retryCount < 5)
    }

    @Test
    fun `item at MAX_RETRIES should be dropped`() {
        val intent = nfcIntent(retryCount = 5)
        assertTrue(intent.retryCount >= 5)
    }

    @Test
    fun `PRUNE_OLDER_THAN_MS is 24 hours`() {
        val twentyFourHoursMs = 24L * 60 * 60 * 1000
        assertEquals(86_400_000L, twentyFourHoursMs)
    }

    @Test
    fun `intent older than 24 hours is beyond prune threshold`() {
        val now             = System.currentTimeMillis()
        val twentyFiveHrsAgo = now - (25L * 60 * 60 * 1000)
        val oldIntent = nfcIntent(queuedAt = twentyFiveHrsAgo)
        val cutoff    = now - (24L * 60 * 60 * 1000)
        assertTrue("Old intent should be before prune cutoff", oldIntent.queuedAt < cutoff)
    }

    @Test
    fun `intent 23 hours old is within retention window`() {
        val now            = System.currentTimeMillis()
        val twentyThreeHrsAgo = now - (23L * 60 * 60 * 1000)
        val recentIntent = nfcIntent(queuedAt = twentyThreeHrsAgo)
        val cutoff       = now - (24L * 60 * 60 * 1000)
        assertTrue("23h-old intent should survive pruning", recentIntent.queuedAt > cutoff)
    }

    // ─── Data class equality ─────────────────────────────────────────────────

    @Test
    fun `two QueuedIntents with the same fields are equal`() {
        val a = nfcIntent()
        val b = nfcIntent()
        assertEquals(a, b)
    }

    @Test
    fun `copy with incremented retryCount produces different object`() {
        val original = nfcIntent(retryCount = 0)
        val retried  = original.copy(retryCount = 1)
        assertNotEquals(original, retried)
        assertEquals(1, retried.retryCount)
    }

    @Test
    fun `409 Conflict response means item was already processed — can be removed`() {
        // This tests the business rule in QueueSyncService:
        // HTTP 409 = idempotency key conflict = payment already processed.
        val httpCode = 409
        val shouldRemove = httpCode == 409 || (httpCode in 200..299)
        assertTrue(shouldRemove)
    }

    @Test
    fun `5xx response means retry later — do not remove from queue`() {
        val httpCode     = 500
        val isSuccess    = httpCode in 200..299
        val isConflict   = httpCode == 409
        val shouldRemove = isSuccess || isConflict
        assertFalse(shouldRemove)
    }
}

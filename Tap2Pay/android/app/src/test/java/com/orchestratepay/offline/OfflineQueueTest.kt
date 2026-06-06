package com.orchestratepay.offline

import org.junit.Assert.*
import org.junit.Test
import org.junit.Before

/**
 * Unit tests for offline payment queue logic.
 * Tests the pure business rules: queue ordering, deduplication,
 * capacity limits, and retry budget.
 */
class OfflineQueueTest {

    // ─── Queue model ──────────────────────────────────────────────────────────
    data class QueuedPayment(
        val idempotencyKey: String,
        val amountCents:    Long,
        val source:         String,
        val enqueuedAt:     Long,
        val attemptCount:   Int = 0,
    )

    private val MAX_QUEUE_SIZE    = 100
    private val MAX_RETRY_BUDGET  = 3
    private val QUEUE_TTL_MS      = 24 * 60 * 60 * 1000L  // 24h

    private val queue = mutableListOf<QueuedPayment>()

    @Before
    fun setUp() { queue.clear() }

    private fun enqueue(payment: QueuedPayment): Boolean {
        if (queue.size >= MAX_QUEUE_SIZE) return false
        if (queue.any { it.idempotencyKey == payment.idempotencyKey }) return false
        queue.add(payment)
        return true
    }

    private fun dequeue(): QueuedPayment? = queue.removeFirstOrNull()

    private fun pruneExpired(nowMs: Long): Int {
        val before = queue.size
        queue.removeAll { (nowMs - it.enqueuedAt) > QUEUE_TTL_MS }
        return before - queue.size
    }

    private fun shouldRetry(payment: QueuedPayment): Boolean =
        payment.attemptCount < MAX_RETRY_BUDGET

    // ─── Tests ────────────────────────────────────────────────────────────────

    @Test
    fun `new payment is enqueued successfully`() {
        val p = QueuedPayment("key1", 5000L, "NFC_TAG", System.currentTimeMillis())
        assertTrue(enqueue(p))
        assertEquals(1, queue.size)
    }

    @Test
    fun `duplicate idempotency key is rejected`() {
        val p = QueuedPayment("key1", 5000L, "NFC_TAG", System.currentTimeMillis())
        enqueue(p)
        assertFalse("Duplicate key must be rejected", enqueue(p.copy(amountCents = 9999L)))
        assertEquals(1, queue.size)
    }

    @Test
    fun `queue rejects when at capacity`() {
        repeat(MAX_QUEUE_SIZE) { i ->
            enqueue(QueuedPayment("key$i", 100L, "NFC_TAG", System.currentTimeMillis()))
        }
        assertFalse("Full queue must reject new items",
            enqueue(QueuedPayment("overflow", 100L, "NFC_TAG", System.currentTimeMillis())))
        assertEquals(MAX_QUEUE_SIZE, queue.size)
    }

    @Test
    fun `dequeue returns items in FIFO order`() {
        val p1 = QueuedPayment("first",  100L, "NFC_TAG", 1000L)
        val p2 = QueuedPayment("second", 200L, "NFC_TAG", 2000L)
        enqueue(p1)
        enqueue(p2)
        assertEquals("first",  dequeue()?.idempotencyKey)
        assertEquals("second", dequeue()?.idempotencyKey)
        assertNull(dequeue())
    }

    @Test
    fun `pruneExpired removes payments older than 24 hours`() {
        val longAgo   = System.currentTimeMillis() - QUEUE_TTL_MS - 1000L
        val recent    = System.currentTimeMillis() - 1000L
        enqueue(QueuedPayment("old",    100L, "NFC_TAG", longAgo))
        enqueue(QueuedPayment("recent", 200L, "NFC_TAG", recent))

        val removed = pruneExpired(System.currentTimeMillis())
        assertEquals(1, removed)
        assertEquals(1, queue.size)
        assertEquals("recent", queue[0].idempotencyKey)
    }

    @Test
    fun `payment within TTL is not pruned`() {
        val tenMinutesAgo = System.currentTimeMillis() - 10 * 60 * 1000L
        enqueue(QueuedPayment("fresh", 100L, "NFC_TAG", tenMinutesAgo))

        val removed = pruneExpired(System.currentTimeMillis())
        assertEquals(0, removed)
        assertEquals(1, queue.size)
    }

    @Test
    fun `shouldRetry returns true for first attempt`() {
        val p = QueuedPayment("key1", 5000L, "NFC_TAG", System.currentTimeMillis(), attemptCount = 0)
        assertTrue(shouldRetry(p))
    }

    @Test
    fun `shouldRetry returns false when budget exhausted`() {
        val p = QueuedPayment("key1", 5000L, "NFC_TAG", System.currentTimeMillis(), attemptCount = MAX_RETRY_BUDGET)
        assertFalse(shouldRetry(p))
    }

    @Test
    fun `shouldRetry returns true for attempts below budget`() {
        for (attempt in 0 until MAX_RETRY_BUDGET) {
            val p = QueuedPayment("key1", 5000L, "NFC_TAG", System.currentTimeMillis(), attemptCount = attempt)
            assertTrue("Attempt $attempt should allow retry", shouldRetry(p))
        }
    }

    @Test
    fun `queue accepts all payment sources`() {
        val sources = listOf("NFC_TAG", "QR_CODE", "HCE_PHONE", "CONSUMER_TAG", "CONSUMER_QR")
        sources.forEachIndexed { i, source ->
            val added = enqueue(QueuedPayment("key$i", 1000L, source, System.currentTimeMillis()))
            assertTrue("Source $source should be accepted", added)
        }
        assertEquals(sources.size, queue.size)
    }
}

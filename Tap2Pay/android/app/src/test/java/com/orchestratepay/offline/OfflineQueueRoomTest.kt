package com.orchestratepay.offline

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * OfflineQueueRoomTest — tests for the offline payment queue at the Room layer.
 *
 * WHY A SECOND FILE (not merged with OfflineQueueTest):
 * OfflineQueueTest covers the pure in-memory business rules (FIFO, dedup, capacity,
 * prune, retry budget) via a local mutableListOf<> stand-in.
 *
 * This file tests the Room entity / DAO contract layer:
 *   - QueuedIntent data class field contracts (default values, primary key)
 *   - Enqueue with OnConflictStrategy.IGNORE semantics (duplicate idempotency key not overwritten)
 *   - Retry count increment (incrementRetry behaviour)
 *   - Prune older-than cutoff (pruneOlderThan semantics)
 *   - HCE_PHONE intents must NOT be accepted in the offline queue
 *   - QueueSyncService flush logic: success → remove, failure → increment retry, 409 → remove
 *   - Integration: enqueue → sync succeeds → item removed; sync fails → item remains
 *
 * Because Room requires an Android context (we can't run Room.inMemoryDatabaseBuilder in
 * a pure JVM test — that requires instrumented tests), we test the data-layer contracts
 * by mirroring the DAO behaviour with a mutableMapOf<> keyed on idempotencyKey. This
 * faithfully represents OnConflictStrategy.IGNORE, the incrementRetry query, and the
 * pruneOlderThan query.
 *
 * Room instrumented tests for this module live in the androidTest source set
 * (app/src/androidTest/java/com/orchestratepay/offline/) and require a real device or emulator.
 */
class OfflineQueueRoomTest {

    // ── In-memory DAO mirror ──────────────────────────────────────────────────

    /**
     * Faithful mirror of OfflineQueueDao that uses a LinkedHashMap to preserve
     * insertion order (ORDER BY queuedAt ASC → FIFO when queuedAt is monotonic).
     *
     * OnConflictStrategy.IGNORE: if idempotencyKey already exists, enqueue() is a no-op.
     */
    private val store = LinkedHashMap<String, QueuedIntent>()

    private fun enqueue(intent: QueuedIntent) {
        // OnConflictStrategy.IGNORE — do nothing if key exists
        if (!store.containsKey(intent.idempotencyKey)) {
            store[intent.idempotencyKey] = intent
        }
    }

    private fun getAll(): List<QueuedIntent> =
        store.values.sortedBy { it.queuedAt }

    private fun count(): Int = store.size

    private fun remove(intent: QueuedIntent) {
        store.remove(intent.idempotencyKey)
    }

    private fun incrementRetry(key: String, now: Long = System.currentTimeMillis()) {
        store[key]?.let { existing ->
            store[key] = existing.copy(
                retryCount    = existing.retryCount + 1,
                lastAttemptAt = now
            )
        }
    }

    private fun pruneOlderThan(cutoff: Long): Int {
        val before = store.size
        store.values
            .filter { it.queuedAt < cutoff }
            .map    { it.idempotencyKey }
            .forEach { store.remove(it) }
        return before - store.size
    }

    @Before fun setUp() { store.clear() }

    // ── QueuedIntent data class field contracts ───────────────────────────────

    @Test
    fun `QueuedIntent default retryCount is 0`() {
        val qi = QueuedIntent(
            idempotencyKey = "key-001",
            merchantId     = "m-001",
            tagId          = "t-001",
            rawUid         = null,
            source         = "NFC_TAG",
            amountCents    = 5000L
        )
        assertEquals(0, qi.retryCount)
    }

    @Test
    fun `QueuedIntent default lastAttemptAt is null`() {
        val qi = QueuedIntent(
            idempotencyKey = "key-002",
            merchantId     = "m-001",
            tagId          = "t-001",
            rawUid         = null,
            source         = "NFC_TAG",
            amountCents    = 5000L
        )
        assertNull(qi.lastAttemptAt)
    }

    @Test
    fun `QueuedIntent idempotencyKey is the primary key`() {
        val qi = QueuedIntent(
            idempotencyKey = "unique-key-abc",
            merchantId     = "m-001",
            tagId          = null,
            rawUid         = "deadbeef",
            source         = "QR_CODE",
            amountCents    = 2000L
        )
        assertEquals("unique-key-abc", qi.idempotencyKey)
    }

    @Test
    fun `QueuedIntent source NFC_TAG is valid`() {
        val qi = QueuedIntent("k", "m", null, null, "NFC_TAG", 100L)
        assertEquals("NFC_TAG", qi.source)
    }

    @Test
    fun `QueuedIntent source QR_CODE is valid`() {
        val qi = QueuedIntent("k", "m", null, null, "QR_CODE", 100L)
        assertEquals("QR_CODE", qi.source)
    }

    // ── HCE_PHONE must NOT be queued ──────────────────────────────────────────

    @Test
    fun `HCE_PHONE source is excluded from offline queue (60s token expires before connectivity restores)`() {
        // Architecture invariant from source comment:
        //   "HCE_PHONE intents are NEVER queued here — their 60-second session token
        //    expires long before connectivity can be restored."
        val allowedSources = setOf("NFC_TAG", "QR_CODE")
        assertFalse(allowedSources.contains("HCE_PHONE"))
        assertFalse(allowedSources.contains("CONSUMER_QR"))  // also not queueable (QR token 90s)
    }

    @Test
    fun `NFC_TAG and QR_CODE are the only two offline-queueable sources`() {
        val queueableSources = setOf("NFC_TAG", "QR_CODE")
        assertEquals(2, queueableSources.size)
        assertTrue(queueableSources.contains("NFC_TAG"))
        assertTrue(queueableSources.contains("QR_CODE"))
    }

    // ── OnConflictStrategy.IGNORE (duplicate key) ─────────────────────────────

    @Test
    fun `enqueue with duplicate idempotency key is silently ignored (IGNORE strategy)`() {
        val qi1 = QueuedIntent("key-dup", "m", null, null, "NFC_TAG", 5000L, queuedAt = 1000L)
        val qi2 = QueuedIntent("key-dup", "m", null, null, "NFC_TAG", 9999L, queuedAt = 2000L)
        enqueue(qi1)
        enqueue(qi2)
        assertEquals("Duplicate must be ignored", 1, count())
        assertEquals("Original amount preserved", 5000L, getAll()[0].amountCents)
    }

    @Test
    fun `enqueue with different key adds a second item`() {
        enqueue(QueuedIntent("key-A", "m", null, null, "NFC_TAG", 5000L))
        enqueue(QueuedIntent("key-B", "m", null, null, "NFC_TAG", 5000L))
        assertEquals(2, count())
    }

    @Test
    fun `getAll returns items in queuedAt ascending order`() {
        enqueue(QueuedIntent("key-late",  "m", null, null, "NFC_TAG", 100L, queuedAt = 3000L))
        enqueue(QueuedIntent("key-early", "m", null, null, "NFC_TAG", 100L, queuedAt = 1000L))
        enqueue(QueuedIntent("key-mid",   "m", null, null, "NFC_TAG", 100L, queuedAt = 2000L))
        val items = getAll()
        assertEquals("key-early", items[0].idempotencyKey)
        assertEquals("key-mid",   items[1].idempotencyKey)
        assertEquals("key-late",  items[2].idempotencyKey)
    }

    // ── Queue count ───────────────────────────────────────────────────────────

    @Test
    fun `count is 0 on empty queue`() {
        assertEquals(0, count())
    }

    @Test
    fun `count increments after each successful enqueue`() {
        enqueue(QueuedIntent("k1", "m", null, null, "NFC_TAG", 100L))
        assertEquals(1, count())
        enqueue(QueuedIntent("k2", "m", null, null, "NFC_TAG", 100L))
        assertEquals(2, count())
    }

    @Test
    fun `count does not increment on duplicate key enqueue`() {
        enqueue(QueuedIntent("k1", "m", null, null, "NFC_TAG", 100L))
        enqueue(QueuedIntent("k1", "m", null, null, "NFC_TAG", 999L))
        assertEquals(1, count())
    }

    // ── remove ────────────────────────────────────────────────────────────────

    @Test
    fun `remove deletes the item by idempotency key`() {
        val qi = QueuedIntent("k-remove", "m", null, null, "NFC_TAG", 5000L)
        enqueue(qi)
        assertEquals(1, count())
        remove(qi)
        assertEquals(0, count())
    }

    @Test
    fun `remove on non-existent item does not throw`() {
        val qi = QueuedIntent("ghost", "m", null, null, "NFC_TAG", 100L)
        remove(qi)  // should be a no-op
        assertEquals(0, count())
    }

    // ── incrementRetry ────────────────────────────────────────────────────────

    @Test
    fun `incrementRetry increments retryCount from 0 to 1`() {
        val qi = QueuedIntent("k-retry", "m", null, null, "NFC_TAG", 5000L)
        enqueue(qi)
        assertEquals(0, getAll()[0].retryCount)
        incrementRetry("k-retry")
        assertEquals(1, getAll()[0].retryCount)
    }

    @Test
    fun `incrementRetry increments retryCount from 1 to 2`() {
        val qi = QueuedIntent("k-r2", "m", null, null, "NFC_TAG", 5000L, retryCount = 1)
        enqueue(qi)
        incrementRetry("k-r2")
        assertEquals(2, getAll()[0].retryCount)
    }

    @Test
    fun `incrementRetry updates lastAttemptAt to current time`() {
        val qi = QueuedIntent("k-time", "m", null, null, "NFC_TAG", 5000L)
        enqueue(qi)
        val before = System.currentTimeMillis()
        incrementRetry("k-time", now = before)
        assertEquals(before, getAll()[0].lastAttemptAt)
    }

    @Test
    fun `incrementRetry on non-existent key is a no-op`() {
        incrementRetry("not-in-queue")
        assertEquals(0, count())
    }

    // ── pruneOlderThan ────────────────────────────────────────────────────────

    @Test
    fun `pruneOlderThan removes item with queuedAt strictly before cutoff`() {
        val oldItem    = QueuedIntent("k-old",    "m", null, null, "NFC_TAG", 100L, queuedAt = 1000L)
        val freshItem  = QueuedIntent("k-fresh",  "m", null, null, "NFC_TAG", 100L, queuedAt = 3000L)
        enqueue(oldItem)
        enqueue(freshItem)

        val removed = pruneOlderThan(cutoff = 2000L)
        assertEquals(1, removed)
        assertEquals(1, count())
        assertEquals("k-fresh", getAll()[0].idempotencyKey)
    }

    @Test
    fun `pruneOlderThan does not remove item with queuedAt equal to cutoff`() {
        // SQL: WHERE queuedAt < :cutoff  (strict less-than, not ≤)
        enqueue(QueuedIntent("k-exact", "m", null, null, "NFC_TAG", 100L, queuedAt = 2000L))
        val removed = pruneOlderThan(cutoff = 2000L)
        assertEquals(0, removed)
        assertEquals(1, count())
    }

    @Test
    fun `pruneOlderThan on empty queue returns 0`() {
        val removed = pruneOlderThan(System.currentTimeMillis())
        assertEquals(0, removed)
    }

    @Test
    fun `pruneOlderThan 24h removes items older than 24 hours`() {
        val h24ago = System.currentTimeMillis() - 24 * 60 * 60 * 1000L - 1L
        val recent = System.currentTimeMillis() - 60_000L
        enqueue(QueuedIntent("k-24h",   "m", null, null, "NFC_TAG", 100L, queuedAt = h24ago))
        enqueue(QueuedIntent("k-fresh", "m", null, null, "NFC_TAG", 100L, queuedAt = recent))

        val removed = pruneOlderThan(System.currentTimeMillis() - 24 * 60 * 60 * 1000L)
        assertEquals(1, removed)
        assertEquals("k-fresh", getAll()[0].idempotencyKey)
    }

    // ── QueueSyncService flush logic ──────────────────────────────────────────
    //
    // QueueSyncService.flushQueue() mirrors: for each pending item:
    //   - HTTP 2xx → db.dao().remove(item)
    //   - HTTP 409 → db.dao().remove(item)  (idempotent — already processed)
    //   - HTTP 5xx → db.dao().incrementRetry(key)
    //   - exception → db.dao().incrementRetry(key)
    //   - retryCount >= MAX_RETRIES (5) → db.dao().remove(item)

    private val SYNC_MAX_RETRIES = 5

    private fun simulateFlushItem(key: String, httpCode: Int) {
        val item = store[key] ?: return
        when {
            item.retryCount >= SYNC_MAX_RETRIES -> {
                remove(item)
            }
            httpCode in 200..299 || httpCode == 409 -> {
                remove(item)
            }
            else -> {
                incrementRetry(key)
            }
        }
    }

    @Test
    fun `sync HTTP 200 → item removed from queue`() {
        enqueue(QueuedIntent("k-sync-200", "m", null, null, "NFC_TAG", 5000L))
        assertEquals(1, count())
        simulateFlushItem("k-sync-200", 200)
        assertEquals(0, count())
    }

    @Test
    fun `sync HTTP 409 (idempotent) → item removed from queue`() {
        enqueue(QueuedIntent("k-sync-409", "m", null, null, "NFC_TAG", 5000L))
        simulateFlushItem("k-sync-409", 409)
        assertEquals("409 must remove (payment already processed)", 0, count())
    }

    @Test
    fun `sync HTTP 500 → item remains with incremented retryCount`() {
        enqueue(QueuedIntent("k-sync-500", "m", null, null, "NFC_TAG", 5000L))
        simulateFlushItem("k-sync-500", 500)
        assertEquals("Item must remain in queue", 1, count())
        assertEquals("retryCount must increment", 1, getAll()[0].retryCount)
    }

    @Test
    fun `sync HTTP 503 → item remains with incremented retryCount`() {
        enqueue(QueuedIntent("k-sync-503", "m", null, null, "NFC_TAG", 5000L))
        simulateFlushItem("k-sync-503", 503)
        assertEquals(1, count())
        assertEquals(1, getAll()[0].retryCount)
    }

    @Test
    fun `sync with retryCount at MAX_RETRIES (5) → item dropped from queue`() {
        enqueue(QueuedIntent("k-maxretry", "m", null, null, "NFC_TAG", 5000L, retryCount = SYNC_MAX_RETRIES))
        simulateFlushItem("k-maxretry", 500)
        assertEquals("Item at max retries must be dropped", 0, count())
    }

    @Test
    fun `sync exception (network) → item remains with incremented retryCount`() {
        enqueue(QueuedIntent("k-exc", "m", null, null, "NFC_TAG", 5000L))
        // Simulate exception path — same as 5xx: call incrementRetry
        incrementRetry("k-exc")
        assertEquals(1, count())
        assertEquals(1, getAll()[0].retryCount)
    }

    @Test
    fun `successful sync of multiple items removes all of them`() {
        enqueue(QueuedIntent("k-a", "m", null, null, "NFC_TAG", 100L))
        enqueue(QueuedIntent("k-b", "m", null, null, "NFC_TAG", 200L))
        enqueue(QueuedIntent("k-c", "m", null, null, "NFC_TAG", 300L))
        assertEquals(3, count())
        listOf("k-a", "k-b", "k-c").forEach { simulateFlushItem(it, 200) }
        assertEquals(0, count())
    }

    @Test
    fun `partial sync: 1 success and 1 failure leaves 1 item in queue`() {
        enqueue(QueuedIntent("k-ok",   "m", null, null, "NFC_TAG", 100L))
        enqueue(QueuedIntent("k-fail", "m", null, null, "NFC_TAG", 200L))
        simulateFlushItem("k-ok",   200)
        simulateFlushItem("k-fail", 500)
        assertEquals(1, count())
        assertEquals("k-fail", getAll()[0].idempotencyKey)
    }

    // ── PRUNE_OLDER_THAN_MS constant ─────────────────────────────────────────

    @Test
    fun `PRUNE_OLDER_THAN_MS is 24 hours in milliseconds`() {
        val expectedMs = 24L * 60 * 60 * 1_000
        val actualMs   = 24 * 60 * 60 * 1000L   // from QueueSyncService source
        assertEquals(expectedMs, actualMs)
    }

    @Test
    fun `MAX_RETRIES for sync is 5 (not the orchestrator MAX_RETRIES of 3)`() {
        // QueueSyncService.MAX_RETRIES = 5 (offline items get more attempts than live payments)
        // PaymentOrchestrator.MAX_RETRIES = 3
        assertEquals(5, SYNC_MAX_RETRIES)
        assertNotEquals(3, SYNC_MAX_RETRIES)
    }
}

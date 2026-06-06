package com.orchestratepay.telemetry

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for device telemetry payload construction.
 * Validates PII scrubbing, field presence, and flush-window logic.
 */
class TelemetryWorkerTest {

    // ─── Model ────────────────────────────────────────────────────────────────
    data class TelemetryEvent(
        val type:       String,
        val deviceId:   String,
        val timestampMs: Long,
        val payload:    Map<String, Any?>,
    )

    data class FlushWindow(
        val events:      List<TelemetryEvent>,
        val windowStart: Long,
        val windowEnd:   Long,
    )

    private val FLUSH_INTERVAL_MS = 60_000L   // 1-minute window
    private val MAX_BATCH_SIZE    = 200
    private val PII_KEYS          = setOf("phone", "email", "name", "mpesaRef")

    private val buffer = mutableListOf<TelemetryEvent>()

    @Before
    fun setUp() { buffer.clear() }

    private fun scrubPii(payload: Map<String, Any?>): Map<String, Any?> =
        payload.mapValues { (k, v) ->
            if (k in PII_KEYS) "[REDACTED]" else v
        }

    private fun recordEvent(type: String, payload: Map<String, Any?>) {
        val scrubbed = scrubPii(payload)
        buffer.add(TelemetryEvent(type, "device-001", System.currentTimeMillis(), scrubbed))
    }

    private fun buildFlushWindow(nowMs: Long): FlushWindow {
        val windowStart = nowMs - FLUSH_INTERVAL_MS
        val batch       = buffer.filter { it.timestampMs >= windowStart }.take(MAX_BATCH_SIZE)
        return FlushWindow(batch, windowStart, nowMs)
    }

    // ─── Tests ────────────────────────────────────────────────────────────────

    @Test
    fun `nfc_tap event is recorded with required fields`() {
        recordEvent("nfc_tap", mapOf("tagTech" to "IsoDep", "amountCents" to 5000))
        assertEquals(1, buffer.size)
        val e = buffer[0]
        assertEquals("nfc_tap", e.type)
        assertEquals("device-001", e.deviceId)
        assertNotNull(e.timestampMs)
    }

    @Test
    fun `PII keys are scrubbed from payload`() {
        recordEvent("payment_init", mapOf(
            "phone" to "254712345678",
            "amountCents" to 5000,
            "mpesaRef" to "QBC12XY789",
        ))
        val event = buffer[0]
        assertEquals("[REDACTED]", event.payload["phone"])
        assertEquals("[REDACTED]", event.payload["mpesaRef"])
        assertEquals(5000, event.payload["amountCents"])
    }

    @Test
    fun `non-PII fields are preserved`() {
        recordEvent("auth_attempt", mapOf("method" to "biometric", "success" to true))
        val event = buffer[0]
        assertEquals("biometric", event.payload["method"])
        assertEquals(true, event.payload["success"])
    }

    @Test
    fun `empty PII fields are also scrubbed`() {
        recordEvent("register", mapOf("email" to "", "deviceModel" to "Samsung A54"))
        val event = buffer[0]
        assertEquals("[REDACTED]", event.payload["email"])
        assertEquals("Samsung A54", event.payload["deviceModel"])
    }

    @Test
    fun `flush window includes events within the last interval`() {
        val now      = 1_000_000L
        val recent   = now - 30_000L   // 30s ago — within window
        val old      = now - 90_000L   // 90s ago — outside window

        buffer.add(TelemetryEvent("old_event",    "device-001", old,    emptyMap()))
        buffer.add(TelemetryEvent("recent_event", "device-001", recent, emptyMap()))

        val window = buildFlushWindow(now)
        assertEquals(1, window.events.size)
        assertEquals("recent_event", window.events[0].type)
    }

    @Test
    fun `flush window caps batch at MAX_BATCH_SIZE`() {
        val now = System.currentTimeMillis()
        repeat(MAX_BATCH_SIZE + 50) { i ->
            buffer.add(TelemetryEvent("event_$i", "device-001", now - 1_000L, emptyMap()))
        }
        val window = buildFlushWindow(now)
        assertEquals(MAX_BATCH_SIZE, window.events.size)
    }

    @Test
    fun `empty buffer produces empty flush window`() {
        val window = buildFlushWindow(System.currentTimeMillis())
        assertTrue(window.events.isEmpty())
    }

    @Test
    fun `scrubPii handles null values without crashing`() {
        recordEvent("test", mapOf("phone" to null, "amount" to null))
        val event = buffer[0]
        // phone is PII so it should be redacted
        assertEquals("[REDACTED]", event.payload["phone"])
        // amount is not PII so null is preserved
        assertNull(event.payload["amount"])
    }

    @Test
    fun `multiple event types can be buffered independently`() {
        val types = listOf("nfc_tap", "qr_scan", "auth_attempt", "payment_init", "payment_confirmed")
        types.forEach { recordEvent(it, mapOf("dummy" to it)) }
        assertEquals(types.size, buffer.size)
        types.forEachIndexed { i, type -> assertEquals(type, buffer[i].type) }
    }
}

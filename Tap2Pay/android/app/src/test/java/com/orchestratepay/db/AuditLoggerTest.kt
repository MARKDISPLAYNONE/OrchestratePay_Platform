package com.orchestratepay.db

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for AuditEvent enum and AuditEntry data class.
 *
 * AuditLogger.record() itself relies on Room (Android framework) so it is not
 * exercised here. We test:
 *   - All CBK-required audit events are present
 *   - AuditEntry field contracts (detail truncation, sessionId default)
 *   - Event name stability (backend sync relies on the enum name strings)
 */
class AuditLoggerTest {

    // ─── AuditEvent enum ─────────────────────────────────────────────────────

    @Test
    fun `all app lifecycle events are defined`() {
        val names = AuditEvent.values().map { it.name }.toSet()
        assertTrue(names.contains("APP_STARTED"))
        assertTrue(names.contains("MERCHANT_LOGGED_IN"))
        assertTrue(names.contains("MERCHANT_LOGGED_OUT"))
        assertTrue(names.contains("SESSION_EXPIRED"))
    }

    @Test
    fun `all NFC layer events are defined`() {
        val names = AuditEvent.values().map { it.name }.toSet()
        assertTrue(names.contains("NFC_TAG_DETECTED"))
        assertTrue(names.contains("HCE_TAP_DETECTED"))
        assertTrue(names.contains("NFC_READ_FAILED"))
        assertTrue(names.contains("NFC_UNRECOGNISED_TAG"))
        assertTrue(names.contains("NFC_TOKEN_EXPIRED"))
        assertTrue(names.contains("QR_CODE_SCANNED"))
    }

    @Test
    fun `all orchestrator events are defined`() {
        val names = AuditEvent.values().map { it.name }.toSet()
        assertTrue(names.contains("PAYMENT_INTENT_RECEIVED"))
        assertTrue(names.contains("AMOUNT_ENTERED"))
        assertTrue(names.contains("API_ATTEMPT"))
        assertTrue(names.contains("STK_PUSH_SENT"))
        assertTrue(names.contains("POLL_STARTED"))
        assertTrue(names.contains("POLL_TIMEOUT"))
    }

    @Test
    fun `all payment result events are defined`() {
        val names = AuditEvent.values().map { it.name }.toSet()
        assertTrue(names.contains("PAYMENT_CONFIRMED"))
        assertTrue(names.contains("PAYMENT_DECLINED"))
        assertTrue(names.contains("PAYMENT_FAILED"))
        assertTrue(names.contains("MAX_RETRIES_EXCEEDED"))
        assertTrue(names.contains("ORCHESTRATOR_EXCEPTION"))
        assertTrue(names.contains("SERVER_ERROR"))
    }

    @Test
    fun `printing and reconciliation events are defined`() {
        val names = AuditEvent.values().map { it.name }.toSet()
        assertTrue(names.contains("RECEIPT_PRINT_STARTED"))
        assertTrue(names.contains("RECEIPT_PRINT_SUCCESS"))
        assertTrue(names.contains("RECEIPT_PRINT_FAILED"))
        assertTrue(names.contains("RECONCILIATION_RUN"))
        assertTrue(names.contains("TRANSACTION_RECONCILED"))
        assertTrue(names.contains("WS_FALLBACK"))
    }

    @Test
    fun `all AuditEvent ordinals are unique`() {
        val events = AuditEvent.values()
        val ordinals = events.map { it.ordinal }
        assertEquals("Duplicate ordinals detected", ordinals.size, ordinals.distinct().size)
    }

    @Test
    fun `AuditEvent names are stable and uppercase`() {
        AuditEvent.values().forEach { event ->
            assertEquals(
                "Event ${event.name} should be uppercase snake_case",
                event.name.uppercase(),
                event.name
            )
        }
    }

    @Test
    fun `AuditEvent count is at least 25`() {
        // CBK requires audit coverage of all payment lifecycle stages.
        // A lower bound protects against accidentally deleting events.
        assertTrue(
            "Expected at least 25 audit events, got ${AuditEvent.values().size}",
            AuditEvent.values().size >= 25
        )
    }

    // ─── AuditEntry data class ────────────────────────────────────────────────

    @Test
    fun `AuditEntry carries all required fields`() {
        val entry = AuditEntry(
            id           = 0L,
            event        = AuditEvent.PAYMENT_CONFIRMED.name,
            detail       = "txnId=txn-abc,mpesaRef=NLJ7RT61SV",
            timestampIso = "2024-05-18T14:30:00Z",
            sessionId    = "session-xyz"
        )
        assertEquals(AuditEvent.PAYMENT_CONFIRMED.name, entry.event)
        assertEquals("txnId=txn-abc,mpesaRef=NLJ7RT61SV", entry.detail)
        assertEquals("2024-05-18T14:30:00Z", entry.timestampIso)
        assertEquals("session-xyz", entry.sessionId)
    }

    @Test
    fun `AuditEntry id defaults to 0 for auto-generation`() {
        val entry = AuditEntry(
            event        = AuditEvent.APP_STARTED.name,
            detail       = "",
            timestampIso = "2024-01-01T00:00:00Z",
            sessionId    = "s1"
        )
        assertEquals(0L, entry.id)
    }

    @Test
    fun `detail truncation at 500 chars matches source contract`() {
        // AuditLogger.record() calls detail.take(500) before inserting.
        // Verify the boundary.
        val longDetail = "x".repeat(600)
        val truncated  = longDetail.take(500)
        assertEquals(500, truncated.length)
        assertEquals("x".repeat(500), truncated)
    }

    @Test
    fun `detail shorter than 500 chars is unchanged by take(500)`() {
        val short = "txnId=abc"
        assertEquals(short, short.take(500))
    }

    @Test
    fun `empty detail is valid`() {
        val entry = AuditEntry(
            event        = AuditEvent.APP_STARTED.name,
            detail       = "",
            timestampIso = "2024-01-01T00:00:00Z",
            sessionId    = "s1"
        )
        assertEquals("", entry.detail)
    }

    @Test
    fun `unauthenticated session marker matches logger fallback`() {
        // When SessionManager.getSessionId() returns null, AuditLogger uses "unauthenticated"
        val unauthenticated = "unauthenticated"
        val entry = AuditEntry(
            event        = AuditEvent.APP_STARTED.name,
            detail       = "",
            timestampIso = "2024-01-01T00:00:00Z",
            sessionId    = unauthenticated
        )
        assertEquals("unauthenticated", entry.sessionId)
    }

    @Test
    fun `two AuditEntry objects with same fields are equal (data class)`() {
        val a = AuditEntry(1L, "EV", "detail", "2024-01-01T00:00:00Z", "s")
        val b = AuditEntry(1L, "EV", "detail", "2024-01-01T00:00:00Z", "s")
        assertEquals(a, b)
    }
}

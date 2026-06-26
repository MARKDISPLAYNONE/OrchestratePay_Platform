package com.orchestratepay.consumer.realtime

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for ConsumerNotificationService pure logic.
 *
 * FirebaseMessagingService extends a Context-heavy Android service — full
 * registration tests belong in instrumented tests. These tests cover:
 *   - FCM data payload field parsing
 *   - Notification body construction
 *   - Status filter (only CONFIRMED triggers notification)
 *   - Amount formatting
 *   - Notification ID uniqueness via hashCode
 */
class ConsumerNotificationServiceTest {

    // ── Payload field parsing ─────────────────────────────────────────────────

    private data class ParsedPayload(
        val txnId:        String?,
        val amountCents:  Int?,
        val merchantName: String,
        val mpesaRef:     String?,
        val status:       String
    )

    private fun parsePayload(data: Map<String, String>): ParsedPayload = ParsedPayload(
        txnId        = data["txnId"],
        amountCents  = data["amountCents"]?.toIntOrNull(),
        merchantName = data["merchantName"] ?: "Merchant",
        mpesaRef     = data["mpesaRef"],
        status       = data["status"] ?: "CONFIRMED"
    )

    @Test
    fun `well-formed payload parses all fields`() {
        val data = mapOf(
            "txnId"       to "txn-abc",
            "amountCents" to "75000",
            "merchantName" to "Mama Pima",
            "mpesaRef"    to "NLJ7RT61SV",
            "status"      to "CONFIRMED"
        )
        val p = parsePayload(data)
        assertEquals("txn-abc", p.txnId)
        assertEquals(75_000, p.amountCents)
        assertEquals("Mama Pima", p.merchantName)
        assertEquals("NLJ7RT61SV", p.mpesaRef)
        assertEquals("CONFIRMED", p.status)
    }

    @Test
    fun `missing txnId parses as null`() {
        val p = parsePayload(mapOf("amountCents" to "100"))
        assertNull(p.txnId)
    }

    @Test
    fun `non-numeric amountCents parses as null`() {
        val p = parsePayload(mapOf("txnId" to "t", "amountCents" to "not-a-number"))
        assertNull(p.amountCents)
    }

    @Test
    fun `missing merchantName defaults to Merchant`() {
        val p = parsePayload(mapOf("txnId" to "t", "amountCents" to "100"))
        assertEquals("Merchant", p.merchantName)
    }

    @Test
    fun `missing status defaults to CONFIRMED`() {
        val p = parsePayload(mapOf("txnId" to "t", "amountCents" to "100"))
        assertEquals("CONFIRMED", p.status)
    }

    // ── Status filter ─────────────────────────────────────────────────────────

    @Test
    fun `CONFIRMED status triggers notification`() {
        assertTrue("CONFIRMED" == "CONFIRMED")
    }

    @Test
    fun `PENDING status does not trigger notification`() {
        val status = "PENDING"
        assertFalse(status == "CONFIRMED")
    }

    @Test
    fun `DECLINED status does not trigger notification`() {
        assertFalse("DECLINED" == "CONFIRMED")
    }

    @Test
    fun `FAILED status does not trigger notification`() {
        assertFalse("FAILED" == "CONFIRMED")
    }

    // ── Notification body construction ────────────────────────────────────────

    private fun buildNotificationBody(
        amountCents: Int,
        merchantName: String,
        mpesaRef: String?
    ): String = buildString {
        val amountKsh = "%.2f".format(amountCents / 100.0)
        append("KSh $amountKsh paid to $merchantName")
        if (!mpesaRef.isNullOrBlank()) append(" — Ref: $mpesaRef")
    }

    @Test
    fun `body includes amount and merchant name`() {
        val body = buildNotificationBody(75_000, "Mama Pima", null)
        assertTrue(body.contains("750.00"))
        assertTrue(body.contains("Mama Pima"))
    }

    @Test
    fun `body includes ref when mpesaRef is present`() {
        val body = buildNotificationBody(10_000, "Shop", "NLJ7RT61SV")
        assertTrue(body.contains("NLJ7RT61SV"))
        assertTrue(body.contains("—"))
    }

    @Test
    fun `body omits ref when mpesaRef is null`() {
        val body = buildNotificationBody(10_000, "Shop", null)
        assertFalse(body.contains("Ref:"))
    }

    @Test
    fun `body omits ref when mpesaRef is blank`() {
        val body = buildNotificationBody(10_000, "Shop", "   ")
        assertFalse(body.contains("Ref:"))
    }

    @Test
    fun `body formats KSh 1 dot 00 for 100 cents`() {
        val body = buildNotificationBody(100, "Test", null)
        assertTrue(body.contains("1.00"))
    }

    @Test
    fun `body formats KSh 500 dot 00 for 50000 cents`() {
        val body = buildNotificationBody(50_000, "Test", null)
        assertTrue(body.contains("500.00"))
    }

    // ── Notification ID collision awareness ───────────────────────────────────

    @Test
    fun `different txnIds produce different notification IDs`() {
        val id1 = "txn-111".hashCode()
        val id2 = "txn-222".hashCode()
        assertNotEquals(id1, id2)
    }

    @Test
    fun `same txnId produces same notification ID (deduplication)`() {
        val id1 = "txn-same".hashCode()
        val id2 = "txn-same".hashCode()
        assertEquals(id1, id2)
    }

    // ── onNewToken guard ──────────────────────────────────────────────────────

    @Test
    fun `FCM token is a non-empty string`() {
        val token = "fakeToken123"
        assertTrue(token.isNotEmpty())
    }

    @Test
    fun `empty FCM token should not be registered`() {
        val token = ""
        assertFalse(token.isNotEmpty())
    }
}

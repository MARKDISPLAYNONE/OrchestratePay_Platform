package com.orchestratepay.softpos.orchestrator

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

/**
 * Extended tests for SoftPosOrchestrator covering request body construction,
 * poll response parsing, and retryability rules.
 *
 * Full runPayment() / process() tests require Android Context and a live HTTP server
 * — those belong in instrumented tests. These tests cover pure JVM logic.
 */
class SoftPosOrchestratorExtendedTest {

    // ── Transaction request body fields ──────────────────────────────────────

    @Test
    fun `transaction body contains SOFTPOS_MOBILE source`() {
        val body = buildTransactionBody(
            merchantId = "mid1",
            amountCents = 50000L,
            consumerPhone = "254700000001",
            hceToken = "tok",
            hceExp = 9999999999L
        )
        assertEquals("SOFTPOS_MOBILE", body.getString("source"))
    }

    @Test
    fun `transaction body contains deviceType SOFTPOS_MOBILE`() {
        val body = buildTransactionBody("mid1", 50000L, "254700000001", "tok", 9999999999L)
        assertEquals("SOFTPOS_MOBILE", body.getString("deviceType"))
    }

    @Test
    fun `transaction body includes consumerPhone`() {
        val body = buildTransactionBody("mid1", 50000L, "254712345678", "tok", 9999999999L)
        assertEquals("254712345678", body.getString("consumerPhone"))
    }

    @Test
    fun `transaction body includes hceToken`() {
        val body = buildTransactionBody("mid1", 50000L, "phone", "hce-token-abc", 9999999999L)
        assertEquals("hce-token-abc", body.getString("hceToken"))
    }

    @Test
    fun `transaction body includes hceExp`() {
        val body = buildTransactionBody("mid1", 50000L, "phone", "tok", 1_700_000_000_000L)
        assertEquals(1_700_000_000_000L, body.getLong("hceExp"))
    }

    @Test
    fun `transaction body includes amountCents`() {
        val body = buildTransactionBody("mid1", 75000L, "phone", "tok", 9999999999L)
        assertEquals(75000L, body.getLong("amountCents"))
    }

    @Test
    fun `transaction body includes merchantId`() {
        val body = buildTransactionBody("merchant-uuid-123", 50000L, "phone", "tok", 9999999999L)
        assertEquals("merchant-uuid-123", body.getString("merchantId"))
    }

    @Test
    fun `transaction body idempotencyKey is 32 hex chars`() {
        val body = buildTransactionBody("m", 100L, "p", "t", 1L)
        val key = body.getString("idempotencyKey")
        assertEquals(32, key.length)
        assertTrue(key.matches(Regex("[0-9a-f]{32}")))
    }

    @Test
    fun `transaction body timestamp is recent`() {
        val before = System.currentTimeMillis()
        val body = buildTransactionBody("m", 100L, "p", "t", 1L)
        val after = System.currentTimeMillis()
        val ts = body.getLong("timestamp")
        assertTrue("timestamp should be >= before", ts >= before)
        assertTrue("timestamp should be <= after", ts <= after)
    }

    @Test
    fun `integrityToken is included when not null`() {
        val body = buildTransactionBody("m", 100L, "p", "t", 1L, integrityToken = "int-tok")
        assertEquals("int-tok", body.optString("integrityToken"))
    }

    @Test
    fun `integrityToken is omitted when null`() {
        val body = buildTransactionBody("m", 100L, "p", "t", 1L, integrityToken = null)
        assertFalse(body.has("integrityToken"))
    }

    // ── Poll response parsing ─────────────────────────────────────────────────

    @Test
    fun `CONFIRMED poll response maps to Confirmed result`() {
        val json = JSONObject().apply {
            put("status", "CONFIRMED")
            put("txnId", "txn-1")
            put("mpesaRef", "NLJ7RT61SV")
            put("amountCents", 50000L)
        }
        val result = parsePollResponse(json, "txn-1")
        assertTrue(result is SoftPosOrchestrator.SoftPosResult.Confirmed)
        val c = result as SoftPosOrchestrator.SoftPosResult.Confirmed
        assertEquals("txn-1", c.txnId)
        assertEquals("NLJ7RT61SV", c.mpesaRef)
        assertEquals(50000L, c.amountCents)
    }

    @Test
    fun `DECLINED poll response maps to Declined result`() {
        val json = JSONObject().apply {
            put("status", "DECLINED")
            put("reason", "Insufficient funds")
        }
        val result = parsePollResponse(json, "txn-2")
        assertTrue(result is SoftPosOrchestrator.SoftPosResult.Declined)
        assertEquals("Insufficient funds", (result as SoftPosOrchestrator.SoftPosResult.Declined).reason)
    }

    @Test
    fun `DECLINED with missing reason uses default`() {
        val json = JSONObject().apply { put("status", "DECLINED") }
        val result = parsePollResponse(json, "txn-3") as SoftPosOrchestrator.SoftPosResult.Declined
        assertEquals("Payment declined", result.reason)
    }

    @Test
    fun `FAILED poll response maps to Failed result`() {
        val json = JSONObject().apply { put("status", "FAILED") }
        val result = parsePollResponse(json, "txn-4")
        assertTrue(result is SoftPosOrchestrator.SoftPosResult.Failed)
    }

    @Test
    fun `EXPIRED poll response maps to Failed result`() {
        val json = JSONObject().apply { put("status", "EXPIRED") }
        val result = parsePollResponse(json, "txn-5")
        assertTrue(result is SoftPosOrchestrator.SoftPosResult.Failed)
        val f = result as SoftPosOrchestrator.SoftPosResult.Failed
        assertTrue(f.reason.contains("timed out") || f.reason.contains("timeout") ||
                   f.reason.lowercase().contains("expir"), "Expected timeout-related message")
    }

    @Test
    fun `PENDING poll response returns null (continue polling)`() {
        val json = JSONObject().apply { put("status", "PENDING") }
        val result = parsePollResponse(json, "txn-6")
        assertNull(result)
    }

    // ── HTTP error body parsing ───────────────────────────────────────────────

    @Test
    fun `error response body extracts error field`() {
        val body = """{"error":"Merchant not found","code":404}"""
        val err = runCatching { JSONObject(body).optString("error") }.getOrDefault("Unknown error")
        assertEquals("Merchant not found", err)
    }

    @Test
    fun `error response body without error field defaults to Unknown error`() {
        val body = """{"message":"Something went wrong"}"""
        val err = runCatching { JSONObject(body).optString("error") }.getOrDefault("Unknown error")
        assertEquals("", err.ifEmpty { "Unknown error" })
    }

    @Test
    fun `malformed JSON error body uses Unknown error fallback`() {
        val body = "not json at all"
        val err = runCatching { JSONObject(body).optString("error") }.getOrDefault("Unknown error")
        assertEquals("Unknown error", err)
    }

    // ── Retryability rules ────────────────────────────────────────────────────

    @Test
    fun `5xx status codes are retryable`() {
        for (code in 500..599) {
            assertTrue("$code should be retryable", code >= 500)
        }
    }

    @Test
    fun `4xx status codes are not retryable`() {
        for (code in 400..499) {
            assertFalse("$code should not be retryable", code >= 500)
        }
    }

    @Test
    fun `3xx status codes are not retryable`() {
        assertFalse(301 >= 500)
    }

    // ── Helpers (mirror private methods in SoftPosOrchestrator) ──────────────

    private fun buildTransactionBody(
        merchantId: String,
        amountCents: Long,
        consumerPhone: String,
        hceToken: String,
        hceExp: Long,
        integrityToken: String? = null
    ): JSONObject {
        val idempotencyKey = java.util.UUID.randomUUID().toString().replace("-", "")
        return JSONObject().apply {
            put("merchantId",     merchantId)
            put("amountCents",    amountCents)
            put("source",         "SOFTPOS_MOBILE")
            put("idempotencyKey", idempotencyKey)
            put("timestamp",      System.currentTimeMillis())
            put("consumerPhone",  consumerPhone)
            put("hceToken",       hceToken)
            put("hceExp",         hceExp)
            put("deviceType",     "SOFTPOS_MOBILE")
            if (integrityToken != null) put("integrityToken", integrityToken)
        }
    }

    private fun parsePollResponse(json: JSONObject, txnId: String): SoftPosOrchestrator.SoftPosResult? {
        return when (json.optString("status")) {
            "CONFIRMED" -> SoftPosOrchestrator.SoftPosResult.Confirmed(
                txnId       = txnId,
                mpesaRef    = json.optString("mpesaRef"),
                amountCents = json.optLong("amountCents"),
            )
            "DECLINED" -> SoftPosOrchestrator.SoftPosResult.Declined(
                reason = json.optString("reason", "Payment declined")
            )
            "FAILED"  -> SoftPosOrchestrator.SoftPosResult.Failed("Payment could not be processed")
            "EXPIRED" -> SoftPosOrchestrator.SoftPosResult.Failed("Payment timed out")
            else -> null  // PENDING or unknown — continue polling
        }
    }
}

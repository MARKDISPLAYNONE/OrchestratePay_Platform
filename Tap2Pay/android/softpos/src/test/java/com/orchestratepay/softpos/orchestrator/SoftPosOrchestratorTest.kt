package com.orchestratepay.softpos.orchestrator

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.Base64

/**
 * Unit tests for SoftPosOrchestrator.
 *
 * Full orchestrator tests (process() / runPayment()) require an Android Context and
 * a live OkHttp client, so they live in the instrumented test suite.
 *
 * Here we cover the JVM-testable logic:
 *   - SoftPosResult sealed class variants and field contracts
 *   - buildNonce() logic (mirrored — SHA-256 base64url)
 *   - Idempotency key format (UUID.randomUUID stripped of dashes)
 */
class SoftPosOrchestratorTest {

    // ─── SoftPosResult sealed class ───────────────────────────────────────────

    @Test
    fun `StkSent carries txnId`() {
        val r = SoftPosOrchestrator.SoftPosResult.StkSent("txn-1")
        assertEquals("txn-1", r.txnId)
    }

    @Test
    fun `Confirmed carries txnId, mpesaRef, amountCents`() {
        val r = SoftPosOrchestrator.SoftPosResult.Confirmed(
            txnId       = "txn-2",
            mpesaRef    = "NLJ7RT61SV",
            amountCents = 75_000L
        )
        assertEquals("txn-2",       r.txnId)
        assertEquals("NLJ7RT61SV", r.mpesaRef)
        assertEquals(75_000L,       r.amountCents)
    }

    @Test
    fun `Declined carries human-readable reason`() {
        val r = SoftPosOrchestrator.SoftPosResult.Declined("Insufficient funds")
        assertEquals("Insufficient funds", r.reason)
    }

    @Test
    fun `Failed defaults to retryable = true`() {
        val r = SoftPosOrchestrator.SoftPosResult.Failed("Network error")
        assertTrue(r.retryable)
    }

    @Test
    fun `Failed can be explicitly non-retryable`() {
        val r = SoftPosOrchestrator.SoftPosResult.Failed("Auth failed", retryable = false)
        assertFalse(r.retryable)
    }

    @Test
    fun `5xx errors should be retryable`() {
        // Business rule: 5xx = server-side transient failure, client should retry
        val httpCode = 500
        val retryable = httpCode >= 500
        assertTrue(retryable)
        val r = SoftPosOrchestrator.SoftPosResult.Failed("Server error", retryable = retryable)
        assertTrue(r.retryable)
    }

    @Test
    fun `4xx errors should not be retryable`() {
        // Business rule: 4xx = client error (bad auth, invalid merchant), do not retry
        val httpCode = 401
        val retryable = httpCode >= 500
        assertFalse(retryable)
        val r = SoftPosOrchestrator.SoftPosResult.Failed("Unauthorized", retryable = retryable)
        assertFalse(r.retryable)
    }

    @Test
    fun `when expression is exhaustive over all SoftPosResult variants`() {
        val results: List<SoftPosOrchestrator.SoftPosResult> = listOf(
            SoftPosOrchestrator.SoftPosResult.StkSent("t"),
            SoftPosOrchestrator.SoftPosResult.Confirmed("t", "r", 1L),
            SoftPosOrchestrator.SoftPosResult.Declined("x"),
            SoftPosOrchestrator.SoftPosResult.Failed("x")
        )
        var branches = 0
        results.forEach {
            when (it) {
                is SoftPosOrchestrator.SoftPosResult.StkSent   -> branches++
                is SoftPosOrchestrator.SoftPosResult.Confirmed -> branches++
                is SoftPosOrchestrator.SoftPosResult.Declined  -> branches++
                is SoftPosOrchestrator.SoftPosResult.Failed    -> branches++
            }
        }
        assertEquals(4, branches)
    }

    // ─── Nonce logic (mirrors SoftPosOrchestrator.buildNonce) ────────────────

    private fun buildNonce(merchantId: String, timestampMs: Long = System.currentTimeMillis()): String {
        val input  = "$merchantId:$timestampMs"
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }

    @Test
    fun `nonce is 43 characters (SHA-256 base64url without padding)`() {
        assertEquals(43, buildNonce("merchant-A", 0L).length)
    }

    @Test
    fun `nonce is URL-safe base64 — no plus, slash, or equals`() {
        val nonce = buildNonce("merchant-B", 1_700_000_000_000L)
        assertFalse(nonce.contains('+'))
        assertFalse(nonce.contains('/'))
        assertFalse(nonce.contains('='))
    }

    @Test
    fun `different merchantIds produce different nonces`() {
        val ts = 1_700_000_000_000L
        assertNotEquals(buildNonce("merchant-X", ts), buildNonce("merchant-Y", ts))
    }

    @Test
    fun `different timestamps produce different nonces`() {
        val n1 = buildNonce("m", 1_000L)
        val n2 = buildNonce("m", 2_000L)
        assertNotEquals(n1, n2)
    }

    @Test
    fun `nonce generation is deterministic`() {
        val n1 = buildNonce("merchant-Z", 1_700_000_000_000L)
        val n2 = buildNonce("merchant-Z", 1_700_000_000_000L)
        assertEquals(n1, n2)
    }

    // ─── Idempotency key format ───────────────────────────────────────────────

    @Test
    fun `idempotency key is UUID with dashes stripped — 32 hex chars`() {
        // SoftPosOrchestrator uses: UUID.randomUUID().toString().replace("-", "")
        val key = java.util.UUID.randomUUID().toString().replace("-", "")
        assertEquals(32, key.length)
        assertTrue(key.matches(Regex("[0-9a-f]{32}")))
    }

    @Test
    fun `two generated idempotency keys are distinct`() {
        val k1 = java.util.UUID.randomUUID().toString().replace("-", "")
        val k2 = java.util.UUID.randomUUID().toString().replace("-", "")
        assertNotEquals(k1, k2)
    }
}

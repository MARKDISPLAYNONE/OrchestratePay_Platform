package com.orchestratepay.payment

import com.orchestratepay.softpos.orchestrator.SoftPosOrchestrator
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.Base64

/**
 * Unit tests for SoftPosOrchestrator.SoftPosResult and its supporting logic.
 *
 * JVM-only — no Android framework required.
 */
class SoftPosResultTest {

    // ─── SoftPosResult sealed class variants ─────────────────────────────────

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
    fun `Declined carries reason`() {
        val r = SoftPosOrchestrator.SoftPosResult.Declined("Insufficient funds")
        assertEquals("Insufficient funds", r.reason)
    }

    @Test
    fun `Failed carries reason and defaults retryable to true`() {
        val r = SoftPosOrchestrator.SoftPosResult.Failed("Network error")
        assertEquals("Network error", r.reason)
        assertTrue(r.retryable)
    }

    @Test
    fun `Failed can be explicitly non-retryable`() {
        val r = SoftPosOrchestrator.SoftPosResult.Failed("Timed out", retryable = false)
        assertFalse(r.retryable)
    }

    @Test
    fun `SoftPosResult subtypes are distinct`() {
        val stk  = SoftPosOrchestrator.SoftPosResult.StkSent("t")
        val conf = SoftPosOrchestrator.SoftPosResult.Confirmed("t", "r", 1L)
        val decl = SoftPosOrchestrator.SoftPosResult.Declined("x")
        val fail = SoftPosOrchestrator.SoftPosResult.Failed("x")

        assertFalse(stk  is SoftPosOrchestrator.SoftPosResult.Confirmed)
        assertFalse(conf is SoftPosOrchestrator.SoftPosResult.Declined)
        assertFalse(decl is SoftPosOrchestrator.SoftPosResult.Failed)
        assertFalse(fail is SoftPosOrchestrator.SoftPosResult.StkSent)
    }

    // ─── Pattern matching exhaustiveness ─────────────────────────────────────

    @Test
    fun `when expression covers all SoftPosResult variants`() {
        val results: List<SoftPosOrchestrator.SoftPosResult> = listOf(
            SoftPosOrchestrator.SoftPosResult.StkSent("t"),
            SoftPosOrchestrator.SoftPosResult.Confirmed("t", "r", 1L),
            SoftPosOrchestrator.SoftPosResult.Declined("x"),
            SoftPosOrchestrator.SoftPosResult.Failed("x")
        )

        var handled = 0
        results.forEach { result ->
            when (result) {
                is SoftPosOrchestrator.SoftPosResult.StkSent   -> handled++
                is SoftPosOrchestrator.SoftPosResult.Confirmed -> handled++
                is SoftPosOrchestrator.SoftPosResult.Declined  -> handled++
                is SoftPosOrchestrator.SoftPosResult.Failed    -> handled++
            }
        }
        assertEquals(4, handled)
    }

    // ─── Nonce generation logic ────────────────────────────────────────────────

    // Mirrors the private buildNonce() method inside SoftPosOrchestrator.
    // We test it here as pure logic without instantiating the orchestrator.
    private fun buildNonce(merchantId: String, timestampMs: Long): String {
        val input  = "$merchantId:$timestampMs"
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }

    @Test
    fun `nonce is URL-safe base64`() {
        val nonce = buildNonce("merchant-abc", 1_700_000_000_000L)
        // Base64url should not contain +, /, or = padding
        assertFalse(nonce.contains('+'))
        assertFalse(nonce.contains('/'))
        assertFalse(nonce.contains('='))
    }

    @Test
    fun `nonce is non-empty`() {
        val nonce = buildNonce("merchant-abc", 1_700_000_000_000L)
        assertTrue(nonce.isNotEmpty())
    }

    @Test
    fun `nonces for different merchantIds are different`() {
        val ts = 1_700_000_000_000L
        val n1 = buildNonce("merchant-A", ts)
        val n2 = buildNonce("merchant-B", ts)
        assertNotEquals(n1, n2)
    }

    @Test
    fun `nonces for different timestamps are different`() {
        val n1 = buildNonce("merchant-X", 1_700_000_000_000L)
        val n2 = buildNonce("merchant-X", 1_700_000_001_000L)
        assertNotEquals(n1, n2)
    }

    @Test
    fun `same inputs always produce same nonce (deterministic)`() {
        val ts = 1_700_000_000_000L
        val n1 = buildNonce("merchant-Y", ts)
        val n2 = buildNonce("merchant-Y", ts)
        assertEquals(n1, n2)
    }

    @Test
    fun `SHA-256 base64url output is 43 chars without padding`() {
        val nonce = buildNonce("merchant-Z", 0L)
        // SHA-256 = 32 bytes; base64url without padding = ceil(32 * 4/3) = 43 chars
        assertEquals(43, nonce.length)
    }
}

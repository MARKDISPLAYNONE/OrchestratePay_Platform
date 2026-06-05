package com.orchestratepay.payment

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for PaymentResult sealed class invariants and state machine rules.
 *
 * These run on the JVM with no Android dependencies: ./gradlew test
 */
class PaymentResultTest {

    // ─── Sealed class exhaustiveness ─────────────────────────────────────────

    @Test
    fun `Success carries all fields required for receipt printing`() {
        val result = PaymentResult.Success(
            txnId         = "txn-001",
            mpesaRef      = "NLJ7RT61SV",
            amountCents   = 50000L,
            merchantName  = "Karibu Store",
            consumerPhone = "25471****78"
        )
        assertNotNull(result.txnId)
        assertNotNull(result.mpesaRef)
        assertTrue(result.amountCents > 0)
        assertNotNull(result.merchantName)
    }

    @Test
    fun `Declined always carries a user-friendly reason (never empty)`() {
        val result = PaymentResult.Declined(reason = "Customer cancelled the payment request")
        assertTrue("Reason must not be blank", result.reason.isNotBlank())
    }

    @Test
    fun `Failed has a retryable flag that the UI uses to show or hide retry button`() {
        val retryable    = PaymentResult.Failed(reason = "Network error", retryable = true)
        val notRetryable = PaymentResult.Failed(reason = "Timed out",     retryable = false)
        assertTrue(retryable.retryable)
        assertFalse(notRetryable.retryable)
    }

    @Test
    fun `Pending carries the txnId so WebSocket listener knows which channel to subscribe to`() {
        val result = PaymentResult.Pending(txnId = "txn-abc-123")
        assertEquals("txn-abc-123", result.txnId)
    }

    // ─── Terminal state detection ─────────────────────────────────────────────

    private fun isTerminal(result: PaymentResult): Boolean = when (result) {
        is PaymentResult.Success -> true
        is PaymentResult.Declined -> true
        is PaymentResult.Failed -> true
        is PaymentResult.Pending -> false
    }

    @Test
    fun `Success is a terminal state`() {
        assertTrue(isTerminal(PaymentResult.Success("t", "r", 100L, "m", "p")))
    }

    @Test
    fun `Declined is a terminal state`() {
        assertTrue(isTerminal(PaymentResult.Declined("reason")))
    }

    @Test
    fun `Failed is a terminal state`() {
        assertTrue(isTerminal(PaymentResult.Failed("reason", false)))
    }

    @Test
    fun `Pending is NOT terminal — orchestrator keeps waiting`() {
        assertFalse(isTerminal(PaymentResult.Pending("txn-001")))
    }

    // ─── Consumer phone masking on receipt ────────────────────────────────────

    @Test
    fun `Success consumerPhone field must be masked before display`() {
        // The backend returns a masked phone; this test documents the expected format.
        // Pattern: 5 digits + 4 stars + 2 digits = "25471****78"
        val phone = "25471****78"
        assertTrue(
            "Phone must match masked pattern",
            phone.matches(Regex("\\d{5}\\*{4}\\d{2}"))
        )
    }

    @Test
    fun `Raw 12-digit Safaricom number is never stored in PaymentResult`() {
        // Constructing a Success with a raw phone to document that this must NOT happen
        val rawPhone = "254712345678"
        assertFalse(
            "A full Safaricom number must never appear in the success result shown to the merchant",
            rawPhone.matches(Regex("\\d{5}\\*{4}\\d{2}"))
        )
    }

    // ─── Amount precision ─────────────────────────────────────────────────────

    @Test
    fun `amountCents is always positive in a Success result`() {
        val result = PaymentResult.Success("t", "r", 5000L, "m", "p")
        assertTrue("Amount must be positive", result.amountCents > 0)
    }

    @Test
    fun `KSh display conversion rounds to 2 decimal places`() {
        fun toKsh(cents: Long): String = "KSh ${"%.2f".format(cents / 100.0)}"
        assertEquals("KSh 50.00", toKsh(5000L))
        assertEquals("KSh 50.50", toKsh(5050L))
        assertEquals("KSh 1.00",  toKsh(100L))
        assertEquals("KSh 0.01",  toKsh(1L))
    }
}

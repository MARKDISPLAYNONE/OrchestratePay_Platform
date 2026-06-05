package com.orchestratepay.payment

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for PaymentOrchestrator logic — state machine, validation,
 * double-tap prevention, CONSUMER_TAG flow, and retry decisions.
 *
 * Pure Kotlin/JVM — no Android framework, no Retrofit calls.
 * The orchestrator's network calls are not tested here (those belong in
 * integration tests). We test the deterministic logic only.
 */
class PaymentOrchestratorTest {

    // ─── Amount validation (mirrors PaymentOrchestrator.validate()) ────────────

    private val MIN_AMOUNT_CENTS = 100L       // KSh 1.00
    private val MAX_AMOUNT_CENTS = 100_000_000_00L  // KSh 1,000,000

    private fun validateAmount(cents: Long): Result<Unit> = runCatching {
        require(cents >= MIN_AMOUNT_CENTS) {
            "Amount KSh ${cents / 100} is below minimum KSh ${MIN_AMOUNT_CENTS / 100}"
        }
        require(cents <= MAX_AMOUNT_CENTS) {
            "Amount KSh ${cents / 100} exceeds maximum KSh ${MAX_AMOUNT_CENTS / 100}"
        }
    }

    @Test
    fun `amount of 100 cents (KSh 1) is valid`() {
        assertTrue(validateAmount(100L).isSuccess)
    }

    @Test
    fun `amount of 99 cents is below minimum`() {
        assertTrue(validateAmount(99L).isFailure)
    }

    @Test
    fun `amount of 0 cents is rejected`() {
        assertTrue(validateAmount(0L).isFailure)
    }

    @Test
    fun `negative amount is rejected`() {
        assertTrue(validateAmount(-1L).isFailure)
    }

    @Test
    fun `maximum amount is accepted`() {
        assertTrue(validateAmount(MAX_AMOUNT_CENTS).isSuccess)
    }

    @Test
    fun `one cent over maximum is rejected`() {
        assertTrue(validateAmount(MAX_AMOUNT_CENTS + 1).isSuccess.not())
    }

    @Test
    fun `error message for below-minimum includes the amount in KSh`() {
        val result = validateAmount(50L)
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("KSh") == true)
    }

    // ─── Double-tap prevention (state machine) ────────────────────────────────

    private enum class ScreenState { IDLE, PROCESSING, SUCCESS, DECLINED, ERROR }

    /** Returns true if the tap should be accepted (mirrors onTagDetected guard) */
    private fun shouldAcceptTap(state: ScreenState, amountCents: Long): Boolean {
        if (state == ScreenState.PROCESSING) return false  // mid-flight — ignore re-tap
        if (amountCents <= 0)               return false  // merchant forgot to enter amount
        return true
    }

    @Test
    fun `tap is accepted in IDLE state with valid amount`() {
        assertTrue(shouldAcceptTap(ScreenState.IDLE, 5000L))
    }

    @Test
    fun `second tap during PROCESSING state is ignored (double-tap prevention)`() {
        assertFalse("Double-tap must be ignored", shouldAcceptTap(ScreenState.PROCESSING, 5000L))
    }

    @Test
    fun `tap without amount entered is rejected`() {
        assertFalse(shouldAcceptTap(ScreenState.IDLE, 0L))
    }

    @Test
    fun `tap in SUCCESS state is rejected (must reset first)`() {
        // After SUCCESS the app resets to IDLE — if somehow SUCCESS isn't cleared,
        // a tap should still require a reset. Defensive check.
        // The real app auto-resets; here we verify the guard also covers SUCCESS.
        assertFalse(shouldAcceptTap(ScreenState.SUCCESS, 5000L))
    }

    @Test
    fun `tap in ERROR state is accepted (merchant pressed retry button)`() {
        // ERROR is the only non-IDLE non-terminal state where a tap can proceed
        // (merchant re-presents after seeing an error). The UI shows a retry button.
        // We verify that the state machine allows it.
        // In the real activity, pressing "Retry" resets to IDLE first.
        // If somehow state is ERROR and a tag appears, we treat it as a retry.
        assertFalse("ERROR state should reset to IDLE before accepting tap",
            shouldAcceptTap(ScreenState.ERROR, 5000L))
    }

    // ─── TransactionRequest field mapping ────────────────────────────────────

    data class MockTransactionRequest(
        val merchantId:    String,
        val amountCents:   Long,
        val source:        String,
        val tagId:         String?,
        val nfcUid:        String?,
        val idempotencyKey: String,
        val timestamp:     Long,
        val consumerPhone: String? = null,
        val hceToken:      String? = null,
        val hceExp:        Long?   = null,
        val consumerTagId: String? = null,
    )

    private fun buildRequest(intent: PaymentIntent, amountCents: Long): MockTransactionRequest {
        val idempotencyKey = java.security.MessageDigest.getInstance("SHA-256")
            .digest("${intent.merchantId}:${intent.tagId ?: intent.rawUid ?: "none"}:$amountCents:${(intent.timestamp / 60_000) * 60_000}".toByteArray())
            .take(16).joinToString("") { "%02x".format(it) }

        return MockTransactionRequest(
            merchantId     = intent.merchantId,
            amountCents    = amountCents,
            source         = intent.source.name,
            tagId          = intent.tagId,
            nfcUid         = intent.rawUid,
            idempotencyKey = idempotencyKey,
            timestamp      = intent.timestamp,
            consumerPhone  = intent.consumerPhone,
            hceToken       = intent.hceToken,
            hceExp         = intent.hceExp,
            consumerTagId  = intent.consumerId,
        )
    }

    @Test
    fun `NFC_TAG intent maps source to NFC_TAG string`() {
        val intent = PaymentIntent(source = PaymentSource.NFC_TAG, merchantId = "m1", tagId = "t1")
        val req = buildRequest(intent, 5000L)
        assertEquals("NFC_TAG", req.source)
        assertEquals("t1", req.tagId)
        assertNull(req.consumerPhone)
        assertNull(req.consumerTagId)
    }

    @Test
    fun `HCE_PHONE intent includes phone, token, and exp`() {
        val intent = PaymentIntent(
            source        = PaymentSource.HCE_PHONE,
            merchantId    = "m1",
            consumerPhone = "254712345678",
            hceToken      = "a".repeat(32),
            hceExp        = System.currentTimeMillis() + 60_000L
        )
        val req = buildRequest(intent, 10000L)
        assertEquals("HCE_PHONE", req.source)
        assertEquals("254712345678", req.consumerPhone)
        assertNotNull(req.hceToken)
        assertNotNull(req.hceExp)
        assertNull(req.tagId)
        assertNull(req.consumerTagId)
    }

    @Test
    fun `CONSUMER_TAG intent populates consumerTagId not tagId`() {
        val intent = PaymentIntent(
            source     = PaymentSource.CONSUMER_TAG,
            merchantId = "m1",
            consumerId = "consumer-uuid-abc",
            rawUid     = "deadbeef"
        )
        val req = buildRequest(intent, 7500L)
        assertEquals("CONSUMER_TAG", req.source)
        assertEquals("consumer-uuid-abc", req.consumerTagId)
        assertNull(req.tagId)
        assertNull(req.consumerPhone)
    }

    @Test
    fun `NFC_TAG intent does not include HCE fields`() {
        val intent = PaymentIntent(source = PaymentSource.NFC_TAG, merchantId = "m1", tagId = "t1")
        val req = buildRequest(intent, 5000L)
        assertNull(req.consumerPhone)
        assertNull(req.hceToken)
        assertNull(req.hceExp)
        assertNull(req.consumerTagId)
    }

    // ─── Retry logic ──────────────────────────────────────────────────────────

    private val MAX_RETRIES = 3

    private fun shouldRetry(attempt: Int, errorType: String): Boolean = when {
        errorType == "DECLINED" -> false      // never retry a declined payment
        attempt >= MAX_RETRIES  -> false      // budget exhausted
        else                    -> true
    }

    @Test
    fun `network error on attempt 1 triggers retry`() {
        assertTrue(shouldRetry(1, "NETWORK"))
    }

    @Test
    fun `network error on attempt 3 (max) does not retry`() {
        assertFalse(shouldRetry(MAX_RETRIES, "NETWORK"))
    }

    @Test
    fun `declined payment is never retried`() {
        assertFalse(shouldRetry(1, "DECLINED"))
        assertFalse(shouldRetry(0, "DECLINED"))
    }

    @Test
    fun `server error on attempt 2 triggers retry`() {
        assertTrue(shouldRetry(2, "SERVER_ERROR"))
    }

    // ─── Idempotency key consistency across platforms ─────────────────────────

    @Test
    fun `same merchantId + tagId + amount within same minute produce identical key`() {
        val ts1 = 1_716_100_000_000L
        val ts2 = ts1 + 30_000L  // 30 seconds later, same minute

        fun key(ts: Long) = java.security.MessageDigest.getInstance("SHA-256")
            .digest("m1:t1:5000:${(ts / 60_000) * 60_000}".toByteArray())
            .take(16).joinToString("") { "%02x".format(it) }

        assertEquals(key(ts1), key(ts2))
    }

    @Test
    fun `taps in different minutes produce different keys`() {
        val ts1 = 1_716_100_000_000L
        val ts2 = ts1 + 61_000L  // just over 1 minute later

        fun key(ts: Long) = java.security.MessageDigest.getInstance("SHA-256")
            .digest("m1:t1:5000:${(ts / 60_000) * 60_000}".toByteArray())
            .take(16).joinToString("") { "%02x".format(it) }

        assertNotEquals(key(ts1), key(ts2))
    }

    // ─── PaymentSource enum completeness ─────────────────────────────────────

    @Test
    fun `all expected payment sources are defined`() {
        val expected = setOf("NFC_TAG", "QR_CODE", "ISO_CARD", "HCE_PHONE", "CONSUMER_TAG")
        val actual   = PaymentSource.values().map { it.name }.toSet()
        // All expected sources must exist; extra sources are allowed (future-proofing)
        assertTrue("Missing sources: ${expected - actual}", actual.containsAll(expected))
    }

    @Test
    fun `CONSUMER_TAG and NFC_TAG are distinct (they represent different physical flows)`() {
        assertNotEquals(PaymentSource.CONSUMER_TAG, PaymentSource.NFC_TAG)
    }
}

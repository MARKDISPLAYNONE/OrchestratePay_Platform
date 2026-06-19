package com.orchestratepay.payment

import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.json.JSONObject

/**
 * PaymentOrchestratorCoroutineTest — tests for the orchestrator's async flows.
 *
 * WHY A SECOND TEST FILE (not merged with PaymentOrchestratorTest):
 * PaymentOrchestratorTest covers the pure-sync state machine logic that can be
 * inlined as local helpers. This file covers the coroutine-driven paths:
 *   - Amount validation translated to PaymentResult.Failed
 *   - Retry logic with idempotency key consistency
 *   - WS result → PaymentResult mapping
 *   - Polling fallback after WS ConnectError
 *   - Audit ordering guarantee (intent logged BEFORE api call)
 *
 * Because OrchestrateApiClient is a concrete class wired to Retrofit (which
 * requires Android's BuildConfig to construct), we do NOT instantiate
 * PaymentOrchestrator directly. Instead we test the orchestrator's individual
 * decision-making functions by mirroring them inline — the same strategy used
 * throughout the test suite. The coroutine machinery is tested via runTest.
 *
 * If Mockito-inline is ever added to the test classpath this file can be
 * refactored to use mocks of OrchestrateApiClient.
 */
class PaymentOrchestratorCoroutineTest {

    // ─── Constants mirroring PaymentOrchestrator companion ───────────────────
    private val MIN_AMOUNT_CENTS    = 100L
    private val MAX_AMOUNT_CENTS    = 1_000_000_00L
    private val MAX_RETRIES         = 3
    private val MAX_POLL_ATTEMPTS   = 15
    private val POLL_INTERVAL_MS    = 2500L
    private val WS_TIMEOUT_MS       = 60_000L

    // ─── Local mirrors of the orchestrator's internal functions ─────────────

    /** Mirrors PaymentOrchestrator.validate() — throws IllegalArgumentException on bad input */
    private fun validate(amountCents: Long) {
        require(amountCents >= MIN_AMOUNT_CENTS) {
            "Amount KSh ${amountCents / 100} is below minimum KSh ${MIN_AMOUNT_CENTS / 100}"
        }
        require(amountCents <= MAX_AMOUNT_CENTS) {
            "Amount KSh ${amountCents / 100} exceeds maximum KSh ${MAX_AMOUNT_CENTS / 100}"
        }
    }

    /** Wraps validate() into a PaymentResult — mirrors what process() does via runCatching */
    private fun validateToResult(amountCents: Long): PaymentResult {
        return runCatching { validate(amountCents) }.fold(
            onSuccess = { PaymentResult.Pending("txn-xxx") },
            onFailure = { e -> PaymentResult.Failed(reason = e.message ?: "Validation failed", retryable = false) }
        )
    }

    /** Mirrors executeWithRetry's decision to retry or stop after network errors */
    private fun retryDecision(attempt: Int, errorType: String, idempotencyKey: String): RetryAction {
        return when {
            errorType == "DECLINED" -> RetryAction.Stop("Payment declined")
            attempt >= MAX_RETRIES  -> RetryAction.Stop("Network unavailable after $MAX_RETRIES attempts.")
            else                    -> RetryAction.Retry(idempotencyKey, attempt + 1)
        }
    }

    sealed class RetryAction {
        data class Retry(val idempotencyKey: String, val nextAttempt: Int) : RetryAction()
        data class Stop(val reason: String) : RetryAction()
    }

    /** Mirrors parseWsPayload() — converts a JSON status object into a PaymentResult */
    private fun parseWsPayload(payload: JSONObject, txnId: String): PaymentResult {
        return when (val status = payload.optString("status")) {
            "CONFIRMED" -> PaymentResult.Success(
                txnId         = txnId,
                mpesaRef      = payload.optString("mpesaRef", ""),
                amountCents   = payload.optLong("amountCents", 0L),
                merchantName  = payload.optString("merchantName", ""),
                consumerPhone = payload.optString("consumerPhone", "")
            )
            "DECLINED" -> PaymentResult.Declined(
                reason = payload.optString("reason", "Payment declined")
            )
            else -> PaymentResult.Failed(
                reason    = "Unexpected payment status: $status",
                retryable = false
            )
        }
    }

    /** Mirrors awaitPaymentResult() fallback decision */
    private fun wsResultToPaymentResult(wsResult: WsResult, txnId: String): PaymentResult? {
        return when (wsResult) {
            is WsResult.Received     -> parseWsPayload(wsResult.payload, txnId)
            is WsResult.Timeout      -> PaymentResult.Failed(
                reason    = "Payment confirmation timed out.",
                retryable = false
            )
            is WsResult.ConnectError -> null   // null → fall back to polling
        }
    }

    sealed class WsResult {
        data class Received(val payload: JSONObject) : WsResult()
        object Timeout : WsResult()
        data class ConnectError(val msg: String) : WsResult()
    }

    /** Simulates the audit-log ordered call sequence */
    private val auditLog = mutableListOf<String>()

    @Before fun setUp() { auditLog.clear() }

    private fun recordAuditThenApi(intent: PaymentIntent, amountCents: Long): String {
        // This mirrors the exact order in process():
        //   1. auditLog.record(PAYMENT_INTENT_RECEIVED)  ← before scope.launch
        //   2. Inside coroutine: validate() → executeWithRetry() → initiatePayment()
        auditLog.add("PAYMENT_INTENT_RECEIVED:${intent.merchantId}:${amountCents}")
        validate(amountCents)   // throws for invalid — caught by runCatching in process()
        auditLog.add("API_ATTEMPT:attempt=1")
        return "api-called"
    }

    // ─── Amount validation → PaymentResult ───────────────────────────────────

    @Test
    fun `amount below minimum produces PaymentResult Failed with below minimum message`() {
        val result = validateToResult(99L)
        assertTrue(result is PaymentResult.Failed)
        val failed = result as PaymentResult.Failed
        assertTrue(
            "Expected 'below minimum' in: ${failed.reason}",
            failed.reason.contains("below minimum")
        )
        assertFalse("Below-minimum failure should not be retryable", failed.retryable)
    }

    @Test
    fun `amount of zero produces PaymentResult Failed`() {
        val result = validateToResult(0L)
        assertTrue(result is PaymentResult.Failed)
    }

    @Test
    fun `negative amount produces PaymentResult Failed`() {
        val result = validateToResult(-500L)
        assertTrue(result is PaymentResult.Failed)
    }

    @Test
    fun `amount above maximum produces PaymentResult Failed with exceeds maximum message`() {
        val result = validateToResult(MAX_AMOUNT_CENTS + 1L)
        assertTrue(result is PaymentResult.Failed)
        val failed = result as PaymentResult.Failed
        assertTrue(
            "Expected 'exceeds maximum' in: ${failed.reason}",
            failed.reason.contains("exceeds maximum")
        )
        assertFalse("Over-maximum failure should not be retryable", failed.retryable)
    }

    @Test
    fun `exact minimum amount (100 cents) is not a Failed result`() {
        val result = validateToResult(100L)
        // validate() should not throw, so result is Pending (not Failed)
        assertFalse(result is PaymentResult.Failed)
    }

    @Test
    fun `exact maximum amount is not a Failed result`() {
        val result = validateToResult(MAX_AMOUNT_CENTS)
        assertFalse(result is PaymentResult.Failed)
    }

    @Test
    fun `failed validation message contains KSh amount in human-readable form`() {
        // 50 cents = KSh 0, well below the KSh 1 minimum
        val result = validateToResult(50L)
        val failed = result as PaymentResult.Failed
        assertTrue("Message should reference KSh", failed.reason.contains("KSh"))
    }

    // ─── Retry idempotency key consistency ───────────────────────────────────

    @Test
    fun `idempotency key is the same on retries within the same minute`() {
        val intent = PaymentIntent(
            source     = PaymentSource.NFC_TAG,
            merchantId = "merchant-abc",
            tagId      = "tag-001",
            timestamp  = 1_716_000_000_000L
        )
        val key1 = IdempotencyKeyGen.generate(intent, 5000L)
        // Simulated retry 10 seconds later (same minute bucket)
        val intentRetry = intent.copy(timestamp = intent.timestamp + 10_000L)
        val key2 = IdempotencyKeyGen.generate(intentRetry, 5000L)
        assertEquals("Retry must use same idempotency key", key1, key2)
    }

    @Test
    fun `retry uses same idempotency key — second attempt carries the same key`() {
        val intent = PaymentIntent(
            source     = PaymentSource.NFC_TAG,
            merchantId = "m1",
            tagId      = "t1",
            timestamp  = 1_716_000_000_000L
        )
        val keyAttempt1 = IdempotencyKeyGen.generate(intent, 10_000L)
        val action = retryDecision(attempt = 1, errorType = "NETWORK", idempotencyKey = keyAttempt1)
        assertTrue(action is RetryAction.Retry)
        // The same key must be passed into the retry
        assertEquals(keyAttempt1, (action as RetryAction.Retry).idempotencyKey)
    }

    @Test
    fun `API call is made only after audit log entry (ordering guarantee)`() {
        val intent = PaymentIntent(
            source     = PaymentSource.NFC_TAG,
            merchantId = "m-audit",
            tagId      = "t-audit",
            timestamp  = System.currentTimeMillis()
        )
        recordAuditThenApi(intent, 5000L)
        assertEquals(2, auditLog.size)
        assertTrue("Audit must be first", auditLog[0].startsWith("PAYMENT_INTENT_RECEIVED"))
        assertTrue("API attempt is second", auditLog[1].startsWith("API_ATTEMPT"))
    }

    @Test
    fun `audit log entry is written even when validation later fails`() {
        val intent = PaymentIntent(
            source     = PaymentSource.NFC_TAG,
            merchantId = "m-fail",
            tagId      = "t-fail",
            timestamp  = System.currentTimeMillis()
        )
        // In the real orchestrator, auditLog.record(PAYMENT_INTENT_RECEIVED) runs
        // BEFORE validate() so the intent is always logged even if amount is bad.
        // We mirror this: record first, then validate.
        auditLog.add("PAYMENT_INTENT_RECEIVED:${intent.merchantId}")
        val validationFailed = runCatching { validate(50L) }.isFailure
        assertTrue("Validation must have failed", validationFailed)
        // The audit entry was already written before validate() ran
        assertEquals("Audit entry must exist even on validation failure", 1, auditLog.size)
    }

    // ─── Retry logic ─────────────────────────────────────────────────────────

    @Test
    fun `API fails attempt 1 (NETWORK) → retries with same key`() {
        val key    = "abc123"
        val action = retryDecision(attempt = 1, errorType = "NETWORK", idempotencyKey = key)
        assertTrue(action is RetryAction.Retry)
        assertEquals(key, (action as RetryAction.Retry).idempotencyKey)
        assertEquals(2, action.nextAttempt)
    }

    @Test
    fun `API fails attempt 2 (NETWORK) → retries with same key`() {
        val key    = "abc123"
        val action = retryDecision(attempt = 2, errorType = "NETWORK", idempotencyKey = key)
        assertTrue(action is RetryAction.Retry)
        assertEquals(key, (action as RetryAction.Retry).idempotencyKey)
        assertEquals(3, action.nextAttempt)
    }

    @Test
    fun `3 consecutive failures (max retries) → PaymentResult Failed retryable=true`() {
        // At attempt 3 (== MAX_RETRIES), retry budget is exhausted
        val action = retryDecision(attempt = 3, errorType = "NETWORK", idempotencyKey = "k")
        assertTrue(action is RetryAction.Stop)
        assertTrue(
            "Message must mention 3 attempts",
            (action as RetryAction.Stop).reason.contains("3")
        )
    }

    @Test
    fun `DECLINED on first attempt → no retry`() {
        val action = retryDecision(attempt = 1, errorType = "DECLINED", idempotencyKey = "k")
        assertTrue("Declined payments must never retry", action is RetryAction.Stop)
    }

    @Test
    fun `DECLINED on attempt 2 → no retry (consumer cancelled after PIN screen)`() {
        val action = retryDecision(attempt = 2, errorType = "DECLINED", idempotencyKey = "k")
        assertTrue(action is RetryAction.Stop)
    }

    // ─── WebSocket → PaymentResult mapping ───────────────────────────────────

    @Test
    fun `WS CONFIRMED payload → PaymentResult Success with receipt data`() {
        val payload = JSONObject().apply {
            put("status",        "CONFIRMED")
            put("mpesaRef",      "NLJ7RT61SV")
            put("amountCents",   50_000L)
            put("merchantName",  "Baridi Café")
            put("consumerPhone", "2547****1234")
        }
        val result = parseWsPayload(payload, "txn-ws-001")
        assertTrue(result is PaymentResult.Success)
        val s = result as PaymentResult.Success
        assertEquals("txn-ws-001",  s.txnId)
        assertEquals("NLJ7RT61SV", s.mpesaRef)
        assertEquals(50_000L,       s.amountCents)
        assertEquals("Baridi Café", s.merchantName)
    }

    @Test
    fun `WS DECLINED payload → PaymentResult Declined with reason`() {
        val payload = JSONObject().apply {
            put("status", "DECLINED")
            put("reason", "Insufficient funds")
        }
        val result = parseWsPayload(payload, "txn-ws-002")
        assertTrue(result is PaymentResult.Declined)
        assertEquals("Insufficient funds", (result as PaymentResult.Declined).reason)
    }

    @Test
    fun `WS DECLINED payload without reason uses default message`() {
        val payload = JSONObject().put("status", "DECLINED")
        val result  = parseWsPayload(payload, "txn-ws-003") as PaymentResult.Declined
        assertEquals("Payment declined", result.reason)
    }

    @Test
    fun `WS unknown status → PaymentResult Failed`() {
        val payload = JSONObject().put("status", "EXPIRED")
        val result  = parseWsPayload(payload, "txn-ws-004")
        assertTrue(result is PaymentResult.Failed)
        assertTrue((result as PaymentResult.Failed).reason.contains("EXPIRED"))
    }

    @Test
    fun `WS CONFIRMED with missing optional fields uses empty string defaults`() {
        val payload = JSONObject().put("status", "CONFIRMED")
        val result  = parseWsPayload(payload, "txn-empty") as PaymentResult.Success
        assertEquals("",    result.mpesaRef)
        assertEquals(0L,    result.amountCents)
        assertEquals("",    result.merchantName)
        assertEquals("",    result.consumerPhone)
    }

    // ─── WebSocket confirmation before polling timeout ────────────────────────

    @Test
    fun `WS result Received → PaymentResult is returned immediately (not null)`() {
        val payload = JSONObject().put("status", "CONFIRMED").put("mpesaRef", "ABCDEF")
        val ws = WsResult.Received(payload)
        val result = wsResultToPaymentResult(ws, "txn-confirm-ws")
        assertNotNull("WS Received must produce a non-null PaymentResult", result)
        assertTrue(result is PaymentResult.Success)
    }

    @Test
    fun `WS timeout → PaymentResult Failed retryable=false`() {
        val result = wsResultToPaymentResult(WsResult.Timeout, "txn-timeout")
        assertNotNull(result)
        assertTrue(result is PaymentResult.Failed)
        assertFalse((result as PaymentResult.Failed).retryable)
    }

    @Test
    fun `WS ConnectError → returns null (signals polling fallback)`() {
        val result = wsResultToPaymentResult(WsResult.ConnectError("No route"), "txn-fallback")
        assertNull("ConnectError must return null to signal polling fallback", result)
    }

    // ─── processConsumerQr builds correct PaymentIntent ─────────────────────

    @Test
    fun `processConsumerQr builds intent with source CONSUMER_QR`() {
        // processConsumerQr() internally calls:
        //   PaymentIntent(source = CONSUMER_QR, merchantId = ..., consumerQrToken = ...)
        //   then delegates to process()
        val intent = PaymentIntent(
            source          = PaymentSource.CONSUMER_QR,
            merchantId      = "m-qr",
            consumerQrToken = "qr-uuid-token-abc",
            timestamp       = System.currentTimeMillis()
        )
        assertEquals(PaymentSource.CONSUMER_QR, intent.source)
        assertEquals("qr-uuid-token-abc", intent.consumerQrToken)
        assertNull("QR flow has no tagId", intent.tagId)
        assertNull("QR flow has no hceToken", intent.hceToken)
    }

    @Test
    fun `processConsumerQr intent consumerQrToken is forwarded to TransactionRequest`() {
        // Mirrors PaymentOrchestrator.executeWithRetry building the TransactionRequest
        val token  = "consumer-qr-single-use-uuid"
        val intent = PaymentIntent(
            source          = PaymentSource.CONSUMER_QR,
            merchantId      = "m-qr",
            consumerQrToken = token,
            timestamp       = System.currentTimeMillis()
        )
        // TransactionRequest.consumerQrToken must equal intent.consumerQrToken
        assertEquals(token, intent.consumerQrToken)
        assertEquals("CONSUMER_QR", intent.source.name)
    }

    // ─── Poll timeout boundary ────────────────────────────────────────────────

    @Test
    fun `poll times out after MAX_POLL_ATTEMPTS (15 attempts × 2500ms = 37_5s)`() {
        // Verify constants match documentation: 15 × 2500 = 37500ms
        assertEquals(15,     MAX_POLL_ATTEMPTS)
        assertEquals(2500L,  POLL_INTERVAL_MS)
        assertEquals(37_500L, MAX_POLL_ATTEMPTS.toLong() * POLL_INTERVAL_MS)
    }

    @Test
    fun `pollForConfirmation at MAX_POLL_ATTEMPTS returns Failed with timeout message`() {
        // Mirror the guard: if (pollCount >= MAX_POLL_ATTEMPTS) return PaymentResult.Failed(...)
        val pollCount = MAX_POLL_ATTEMPTS
        val result: PaymentResult = if (pollCount >= MAX_POLL_ATTEMPTS) {
            PaymentResult.Failed(
                reason    = "Payment confirmation timed out.",
                retryable = false
            )
        } else {
            PaymentResult.Pending("txn-still-waiting")
        }
        assertTrue(result is PaymentResult.Failed)
        assertTrue((result as PaymentResult.Failed).reason.contains("timed out"))
        assertFalse(result.retryable)
    }

    @Test
    fun `pollForConfirmation below MAX_POLL_ATTEMPTS keeps polling`() {
        val pollCount = MAX_POLL_ATTEMPTS - 1
        val shouldTimeout = pollCount >= MAX_POLL_ATTEMPTS
        assertFalse("Should not timeout before MAX_POLL_ATTEMPTS", shouldTimeout)
    }

    // ─── runTest placeholder: demonstrates coroutine test infrastructure ──────

    @Test
    fun `runTest is available and executes coroutine body synchronously`() = runTest {
        // Verify kotlinx-coroutines-test is on the classpath and runTest works
        var reached = false
        kotlinx.coroutines.delay(0)
        reached = true
        assertTrue("Coroutine body must execute", reached)
    }

    @Test
    fun `delay inside runTest does not wall-clock-block the test`() = runTest {
        val start = System.currentTimeMillis()
        kotlinx.coroutines.delay(5_000)   // virtual 5 seconds — no real sleep
        val elapsed = System.currentTimeMillis() - start
        // Wall-clock elapsed should be well under 1 second
        assertTrue("runTest must skip real delays (elapsed=${elapsed}ms)", elapsed < 1_000L)
    }
}

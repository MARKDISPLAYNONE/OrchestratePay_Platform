package com.orchestratepay.payment

import com.orchestratepay.api.ApiResponse
import com.orchestratepay.api.OrchestrateApiClient
import com.orchestratepay.api.TransactionRequest
import com.orchestratepay.db.AuditEvent
import com.orchestratepay.db.AuditLogger
import com.orchestratepay.realtime.PaymentWebSocketClient
import com.orchestratepay.realtime.WsPaymentResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * PaymentOrchestrator — the financial brain of the app.
 *
 * This class owns ALL money logic. It sits between the NFC layer (which knows
 * about hardware) and the API client (which knows about HTTP). Its responsibilities:
 *
 *   1. Receive a PaymentIntent from the NFC layer
 *   2. Validate the intent (amount > 0, merchant exists, etc.)
 *   3. Generate an idempotency key
 *   4. Write an audit event BEFORE touching the network
 *   5. Call the backend API with retry logic
 *   6. Poll for M-Pesa confirmation (STK Push is async)
 *   7. Return a PaymentResult to the UI
 *
 * WHY A SEPARATE CLASS: The orchestrator has no Android UI dependencies
 * (no Activity, no View). This means it can be unit-tested without an emulator,
 * which is critical for financial logic. We use constructor injection so tests
 * can swap in a fake ApiClient.
 *
 * THREADING MODEL:
 *   - process() is called from the Main thread (UI event)
 *   - All network/DB work runs on IO thread via coroutines
 *   - onResult callback is delivered back on Main thread
 */
class PaymentOrchestrator(
    private val apiClient: OrchestrateApiClient,
    private val auditLog: AuditLogger,
    private val scope: CoroutineScope,
    // wsClient is optional — if null, the orchestrator falls back to polling only.
    // Pass null in unit tests or when WebSocket is explicitly disabled.
    private val wsClient: PaymentWebSocketClient? = null,
    private val merchantToken: String? = null
) {
    companion object {
        private const val MAX_RETRIES = 3           // max API retry attempts
        private const val MAX_POLL_ATTEMPTS = 15    // 15 × 2500ms = 37.5s timeout
        private const val POLL_INTERVAL_MS = 2500L  // poll every 2.5 seconds
        private const val WS_TIMEOUT_MS = 60_000L   // WebSocket wait timeout
        private const val MIN_AMOUNT_CENTS = 100L   // KSh 1 minimum (100 cents)
        private const val MAX_AMOUNT_CENTS = 1_000_000_00L  // KSh 1,000,000 maximum
    }

    /**
     * Entry point — called by the UI after merchant enters amount and consumer taps.
     *
     * @param intent        The PaymentIntent from NfcReaderManager
     * @param amountCents   Amount in KSh cents (e.g. 50000 = KSh 500.00)
     * @param onStkSent     Optional callback fired on Main thread the moment the M-Pesa
     *                      prompt is confirmed delivered to the consumer's phone (status = STK_SENT).
     *                      Use this to update the UI message from "Sending..." to "Waiting for PIN".
     * @param onResult      Callback, always called on Main thread with the terminal result
     */
    fun process(
        intent: PaymentIntent,
        amountCents: Long,
        onStkSent: (() -> Unit)? = null,
        onResult: (PaymentResult) -> Unit
    ) {
        // Record the intent BEFORE doing anything financial.
        // If the app crashes after this but before confirming, this log entry
        // is how we know to check M-Pesa's records during reconciliation.
        auditLog.record(
            event = AuditEvent.PAYMENT_INTENT_RECEIVED,
            detail = "merchantId=${intent.merchantId} source=${intent.source} amount=${amountCents}"
        )

        scope.launch(Dispatchers.IO) {
            val result = runCatching {
                validate(amountCents)
                executeWithRetry(intent, amountCents, attempt = 1, onStkSent = onStkSent)
            }.getOrElse { e ->
                // Catch anything we didn't explicitly handle (e.g. OutOfMemoryError)
                auditLog.record(AuditEvent.ORCHESTRATOR_EXCEPTION, e.message ?: "unknown")
                PaymentResult.Failed(reason = "Unexpected error: ${e.message}", retryable = false)
            }

            withContext(Dispatchers.Main) { onResult(result) }
        }
    }

    /**
     * Entry point for Scenario 9 — merchant scans consumer wallet QR code.
     *
     * The consumer's wallet generates a single-use UUID token (90-second TTL) via
     * POST /consumers/qr-token. The merchant scans this QR with their camera and
     * calls this method. The token is forwarded to the backend which looks up the
     * consumer and fires the STK Push.
     *
     * Internally builds a PaymentIntent with source=CONSUMER_QR and delegates to
     * the same retry/polling pipeline used by NFC flows.
     */
    fun processConsumerQr(
        merchantId:      String,
        amountCents:     Long,
        consumerQrToken: String,
        onStkSent:       (() -> Unit)? = null,
        onResult:        (PaymentResult) -> Unit
    ) {
        val intent = PaymentIntent(
            source          = PaymentSource.CONSUMER_QR,
            merchantId      = merchantId,
            timestamp       = System.currentTimeMillis(),
            consumerQrToken = consumerQrToken
        )
        process(intent, amountCents, onStkSent, onResult)
    }

    // ─────────────────────────────────────────────────────────────────
    // Validation
    // ─────────────────────────────────────────────────────────────────

    private fun validate(amountCents: Long) {
        require(amountCents >= MIN_AMOUNT_CENTS) {
            "Amount KSh ${amountCents/100} is below minimum KSh ${MIN_AMOUNT_CENTS/100}"
        }
        require(amountCents <= MAX_AMOUNT_CENTS) {
            "Amount KSh ${amountCents/100} exceeds maximum KSh ${MAX_AMOUNT_CENTS/100}"
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Retry logic
    // ─────────────────────────────────────────────────────────────────

    /**
     * Executes the payment with exponential backoff on network errors.
     *
     * Retry strategy:
     *   - Attempt 1: immediate
     *   - Attempt 2: wait 1 second
     *   - Attempt 3: wait 2 seconds
     *   - After 3 failures: return Failed (not Declined — the consumer's money is fine)
     *
     * Crucially, we use the SAME idempotency key on every retry. If attempt 1
     * actually succeeded but the response got lost in transit, attempt 2 hits the
     * backend idempotency cache and returns the original confirmed result — no
     * second STK Push is sent to the consumer.
     */
    private suspend fun executeWithRetry(
        intent: PaymentIntent,
        amountCents: Long,
        attempt: Int,
        onStkSent: (() -> Unit)? = null
    ): PaymentResult {
        val idempotencyKey = IdempotencyKeyGen.generate(intent, amountCents)

        auditLog.record(
            AuditEvent.API_ATTEMPT,
            "attempt=$attempt key=$idempotencyKey"
        )

        val request = TransactionRequest(
            merchantId       = intent.merchantId,
            amountCents      = amountCents,
            source           = intent.source.name,
            tagId            = intent.tagId,
            nfcUid           = intent.rawUid,
            idempotencyKey   = idempotencyKey,
            timestamp        = intent.timestamp,
            // HCE_PHONE fields — only set when the customer used their phone to tap
            consumerPhone    = intent.consumerPhone,
            hceToken         = intent.hceToken,
            hceExp           = intent.hceExp,
            // CONSUMER_TAG fields — only set when the merchant read a consumer-written sticker
            consumerTagId    = intent.consumerId,
            // CONSUMER_QR fields — only set when the merchant scanned the consumer's QR code
            consumerQrToken  = intent.consumerQrToken
        )

        return when (val response = apiClient.initiatePayment(request)) {

            is ApiResponse.Pending -> {
                // STK Push sent — prompt is on the consumer's phone. Notify the UI
                // immediately so the merchant sees "Waiting for PIN" instead of "Sending...".
                auditLog.record(AuditEvent.STK_PUSH_SENT, response.txnId)
                withContext(Dispatchers.Main) { onStkSent?.invoke() }
                awaitPaymentResult(response.txnId)
            }

            is ApiResponse.Success -> {
                // Edge case: backend returned instant success (idempotency cache hit)
                auditLog.record(AuditEvent.PAYMENT_CONFIRMED, response.txnId)
                PaymentResult.Success(
                    txnId         = response.txnId,
                    mpesaRef      = response.mpesaRef ?: "",
                    amountCents   = amountCents,
                    merchantName  = response.merchantName ?: "",
                    consumerPhone = response.consumerPhone ?: ""
                )
            }

            is ApiResponse.Declined -> {
                // Definitive failure — don't retry (consumer cancelled, insufficient funds, etc.)
                auditLog.record(AuditEvent.PAYMENT_DECLINED, response.reason)
                PaymentResult.Declined(reason = response.reason)
            }

            is ApiResponse.NetworkError -> {
                if (attempt < MAX_RETRIES) {
                    // Exponential backoff: 1s, 2s, 4s...
                    delay(1000L * attempt)
                    executeWithRetry(intent, amountCents, attempt + 1, onStkSent)
                } else {
                    auditLog.record(AuditEvent.MAX_RETRIES_EXCEEDED, idempotencyKey)
                    PaymentResult.Failed(
                        reason = "Network unavailable after $MAX_RETRIES attempts. " +
                                 "Please check your connection and try again.",
                        retryable = true
                    )
                }
            }

            is ApiResponse.ServerError -> {
                // 5xx from our backend — don't retry immediately
                auditLog.record(AuditEvent.SERVER_ERROR, response.message)
                PaymentResult.Failed(
                    reason = "Server error. Please try again in a moment.",
                    retryable = true
                )
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Primary: WebSocket with polling fallback
    // ─────────────────────────────────────────────────────────────────

    /**
     * Waits for payment confirmation using WebSocket (primary) or polling (fallback).
     *
     * WebSocket is tried first because it delivers results in ~100ms after the
     * callback lands, vs. up to 2.5s with polling. If the WebSocket connection
     * fails (firewall, 2G-only, bad config), polling kicks in automatically so
     * the payment flow is never broken.
     */
    private suspend fun awaitPaymentResult(txnId: String): PaymentResult {
        val ws = wsClient
        val token = merchantToken

        if (ws != null && token != null) {
            when (val wsResult = ws.awaitPaymentStatus(txnId, token, WS_TIMEOUT_MS)) {
                is WsPaymentResult.Received -> {
                    auditLog.record(AuditEvent.PAYMENT_CONFIRMED, "ws txnId=$txnId")
                    return parseWsPayload(wsResult.payload, txnId)
                }
                is WsPaymentResult.Timeout -> {
                    auditLog.record(AuditEvent.POLL_TIMEOUT, "ws txnId=$txnId")
                    return PaymentResult.Failed(
                        reason = "Payment confirmation timed out. " +
                                 "Check with your customer — they may have received a " +
                                 "confirmation SMS from M-Pesa. Our system will reconcile shortly.",
                        retryable = false
                    )
                }
                is WsPaymentResult.ConnectError -> {
                    // WebSocket unavailable — fall through to polling silently
                    auditLog.record(AuditEvent.WS_FALLBACK, wsResult.message)
                }
            }
        }

        // Fallback: original polling path (always works, just slower)
        return pollForConfirmation(txnId)
    }

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
                reason = "Unexpected payment status: $status",
                retryable = false
            )
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Fallback: HTTP polling — wait for M-Pesa callback to land on the backend
    // ─────────────────────────────────────────────────────────────────

    /**
     * Polls the backend every 2.5 seconds until the M-Pesa callback arrives.
     *
     * WHY POLLING (not push/websocket): Simpler to implement reliably on flaky
     * Kenyan mobile data. A WebSocket that disconnects silently is worse than
     * polling that the user can see. Upgrade to SSE/WebSocket in a future sprint.
     *
     * WHY 2.5 SECONDS: M-Pesa STK Push callbacks typically arrive in 3–10 seconds
     * after the consumer approves. 2.5s means we catch it within the next interval
     * after it lands. Much shorter (0.5s) hammers the backend; much longer (10s)
     * makes the merchant's spinner frustrating.
     *
     * TIMEOUT: 15 attempts × 2.5s = 37.5 seconds. If no callback after 37.5s,
     * the backend's reconciliation job (runs every 5 min) will eventually resolve
     * it. The merchant should see a "timeout — check with customer" message.
     */
    private suspend fun pollForConfirmation(
        txnId: String,
        pollCount: Int = 0
    ): PaymentResult {
        if (pollCount >= MAX_POLL_ATTEMPTS) {
            auditLog.record(AuditEvent.POLL_TIMEOUT, txnId)
            return PaymentResult.Failed(
                reason = "Payment confirmation timed out. " +
                         "Check with your customer — they may have received a " +
                         "confirmation SMS from M-Pesa. Our system will reconcile shortly.",
                retryable = false
            )
        }

        delay(POLL_INTERVAL_MS)

        return when (val status = apiClient.getTransactionStatus(txnId)) {
            is ApiResponse.Success -> {
                auditLog.record(AuditEvent.PAYMENT_CONFIRMED, txnId)
                PaymentResult.Success(
                    txnId         = txnId,
                    mpesaRef      = status.mpesaRef ?: "",
                    amountCents   = status.amountCents ?: 0,
                    merchantName  = status.merchantName ?: "",
                    consumerPhone = status.consumerPhone ?: ""
                )
            }
            is ApiResponse.Pending -> pollForConfirmation(txnId, pollCount + 1)
            is ApiResponse.Declined -> PaymentResult.Declined(reason = status.reason)
            else -> pollForConfirmation(txnId, pollCount + 1) // network hiccup — keep polling
        }
    }
}

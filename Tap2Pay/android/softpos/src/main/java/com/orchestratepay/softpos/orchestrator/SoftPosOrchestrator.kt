package com.orchestratepay.softpos.orchestrator

import android.content.Context
import com.orchestratepay.nfccore.NfcReadResult
import com.orchestratepay.softpos.integrity.PlayIntegrityChecker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * SoftPosOrchestrator — payment processing pipeline for the SoftPOS app.
 *
 * Unlike the Sunmi terminal (dedicated hardware), the SoftPOS merchant uses their
 * own Android phone. Security requirements are higher because:
 *   1. The device is not MDM-enrolled
 *   2. The app can be sideloaded on a rooted device
 *   3. A "ghost merchant" (attacker pretending to be a merchant) could intercept payments
 *
 * Mitigations:
 *   a) Play Integrity token — proves the app and device are genuine
 *   b) Server-side ghost merchant check — verifies merchantId in token matches JWT
 *   c) Consumer token TTL — HMAC token expires in 60 seconds
 *
 * The flow mirrors PaymentOrchestrator from the terminal app, but adds the
 * Play Integrity attestation step before the transaction API call.
 */
class SoftPosOrchestrator(
    private val context:       Context,
    private val apiBaseUrl:    String,
    private val merchantToken: String,
    private val merchantId:    String,
    private val scope:         CoroutineScope,
) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val json = "application/json".toMediaType()

    sealed class SoftPosResult {
        data class StkSent(val txnId: String) : SoftPosResult()
        data class Confirmed(val txnId: String; val mpesaRef: String; val amountCents: Long) : SoftPosResult()
        data class Declined(val reason: String) : SoftPosResult()
        data class Failed(val reason: String; val retryable: Boolean = true) : SoftPosResult()
    }

    /**
     * Process a consumer NFC read result into a payment.
     *
     * [amountCents] is in KES cents (100 = KSh 1.00).
     * [onStkSent] called when the M-Pesa prompt has been sent to the consumer.
     * [onResult] called with the final outcome (confirmed / declined / failed).
     *
     * Both callbacks fire on the MAIN thread.
     */
    fun process(
        nfcResult:   NfcReadResult.HceRead,
        amountCents: Long,
        onStkSent:   () -> Unit,
        onResult:    (SoftPosResult) -> Unit,
    ) {
        scope.launch(Dispatchers.IO) {
            val result = runPayment(nfcResult, amountCents, onStkSent)
            withContext(Dispatchers.Main) { onResult(result) }
        }
    }

    private suspend fun runPayment(
        nfcResult:   NfcReadResult.HceRead,
        amountCents: Long,
        onStkSent:   () -> Unit,
    ): SoftPosResult {
        // Step 1: Get Play Integrity token
        // Nonce = SHA-256(merchantId + timestamp), base64url-encoded
        val nonce = buildNonce(merchantId)
        val integrityToken = PlayIntegrityChecker.getIntegrityToken(context, nonce)
        // integrityToken may be null in debug builds — server checks PLAY_INTEGRITY_REQUIRED

        // Step 2: Idempotency key
        val idempotencyKey = UUID.randomUUID().toString().replace("-", "")

        // Step 3: POST /api/v1/transactions
        val body = JSONObject().apply {
            put("merchantId",     merchantId)
            put("amountCents",    amountCents)
            put("source",         "SOFTPOS_MOBILE")
            put("idempotencyKey", idempotencyKey)
            put("timestamp",      System.currentTimeMillis())
            put("consumerPhone",  nfcResult.consumerPhone)
            put("hceToken",       nfcResult.hceToken)
            put("hceExp",         nfcResult.hceExp)
            put("deviceType",     "SOFTPOS_MOBILE")
            if (integrityToken != null) put("integrityToken", integrityToken)
        }

        val request = Request.Builder()
            .url("$apiBaseUrl/api/v1/transactions")
            .header("Authorization", "Bearer $merchantToken")
            .post(body.toString().toRequestBody(json))
            .build()

        val response = try {
            http.newCall(request).execute()
        } catch (e: Exception) {
            return SoftPosResult.Failed("Network error — check your connection")
        }

        val responseBody = response.body?.string() ?: ""
        if (!response.isSuccessful) {
            val err = runCatching { JSONObject(responseBody).optString("error") }.getOrDefault("Unknown error")
            return SoftPosResult.Failed(err, retryable = response.code >= 500)
        }

        val responseJson = JSONObject(responseBody)
        val txnId = responseJson.optString("txnId")

        withContext(Dispatchers.Main) { onStkSent() }

        // Step 4: Poll for result
        return pollForResult(txnId)
    }

    private suspend fun pollForResult(txnId: String): SoftPosResult {
        val deadline = System.currentTimeMillis() + 3 * 60 * 1000L

        while (System.currentTimeMillis() < deadline) {
            kotlinx.coroutines.delay(2500)

            val req = Request.Builder()
                .url("$apiBaseUrl/api/v1/transactions/$txnId/status")
                .header("Authorization", "Bearer $merchantToken")
                .get()
                .build()

            val resp = try {
                http.newCall(req).execute()
            } catch (_: Exception) { continue }

            val body = resp.body?.string() ?: continue
            val json = runCatching { JSONObject(body) }.getOrNull() ?: continue
            val status = json.optString("status")

            when (status) {
                "CONFIRMED" -> return SoftPosResult.Confirmed(
                    txnId      = txnId,
                    mpesaRef   = json.optString("mpesaRef"),
                    amountCents = json.optLong("amountCents"),
                )
                "DECLINED"  -> return SoftPosResult.Declined(
                    reason = json.optString("reason", "Payment declined")
                )
                "FAILED"    -> return SoftPosResult.Failed("Payment could not be processed")
                "EXPIRED"   -> return SoftPosResult.Failed("Payment timed out")
            }
        }

        return SoftPosResult.Failed("Timed out waiting for payment confirmation")
    }

    private fun buildNonce(merchantId: String): String {
        val input = "$merchantId:${System.currentTimeMillis()}"
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }
}

package com.orchestratepay.realtime

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URLEncoder
import kotlin.coroutines.resume

/**
 * PaymentWebSocketClient — real-time payment status delivery via WebSocket.
 *
 * Replaces the 2.5s polling loop in PaymentOrchestrator. When a payment is
 * initiated, the orchestrator connects here and suspends. The server pushes
 * the result the moment the M-Pesa callback arrives — typically 3–10 seconds
 * vs. up to 37.5s with polling.
 *
 * PROTOCOL (raw WebSocket, no Socket.io overhead):
 *   Connect: wss://api.orchestratepay.co.ke/ws?txnId=<uuid>&token=<jwt>
 *   Receive: { "status": "CONFIRMED"|"DECLINED"|"EXPIRED", "txnId": "...", ... }
 *   Server closes the connection after sending the result.
 *
 * FALLBACK: If the WebSocket connection fails (firewall, 2G-only network, Sunmi
 * configuration), the caller receives WsPaymentResult.ConnectError and should
 * fall back to HTTP polling.
 *
 * OkHttp WebSocket is used because OkHttp is already a transitive dependency
 * via Retrofit — no extra library required.
 */
class PaymentWebSocketClient(
    private val okHttpClient: OkHttpClient,
    private val wsBaseUrl: String   // e.g. "ws://10.0.2.2:3000" or "wss://api.orchestratepay.co.ke"
) {

    /**
     * Suspends until the server pushes a payment status update, or until timeout.
     *
     * @param txnId    Transaction ID to subscribe to
     * @param token    Merchant JWT for authentication
     * @param timeoutMs How long to wait before giving up (default 60s)
     * @return         WsPaymentResult — Received, Timeout, or ConnectError
     */
    suspend fun awaitPaymentStatus(
        txnId: String,
        token: String,
        timeoutMs: Long = 60_000L
    ): WsPaymentResult = withContext(Dispatchers.IO) {
        withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine { cont ->
                val encodedToken = URLEncoder.encode(token, "UTF-8")
                val url = "$wsBaseUrl/ws?txnId=$txnId&token=$encodedToken"
                val request = Request.Builder().url(url).build()

                val ws = okHttpClient.newWebSocket(request, object : WebSocketListener() {

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        val json = runCatching { JSONObject(text) }.getOrNull()
                            ?: return  // malformed JSON — wait for next message
                        webSocket.close(1000, "received")
                        if (cont.isActive) cont.resume(WsPaymentResult.Received(json))
                    }

                    override fun onFailure(
                        webSocket: WebSocket,
                        t: Throwable,
                        response: Response?
                    ) {
                        if (cont.isActive) {
                            cont.resume(WsPaymentResult.ConnectError(t.message ?: "WebSocket failed"))
                        }
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        // Server closed before sending a message (e.g. idle timeout)
                        // The withTimeoutOrNull above will fire Timeout, so just let it fall through.
                        if (cont.isActive) cont.resume(WsPaymentResult.Timeout)
                    }
                })

                cont.invokeOnCancellation { ws.cancel() }
            }
        } ?: WsPaymentResult.Timeout
    }
}

/**
 * Result of a WebSocket payment status wait.
 *
 * - Received: the server sent a payment status update; parse the JSON payload
 * - Timeout:  60 seconds elapsed with no update; backend reconciliation will resolve
 * - ConnectError: WebSocket connection failed; caller should fall back to polling
 */
sealed class WsPaymentResult {
    data class Received(val payload: JSONObject) : WsPaymentResult()
    object Timeout : WsPaymentResult()
    data class ConnectError(val message: String) : WsPaymentResult()
}

// ─── Singleton ──────────────────────────────────────────────────────────────

/**
 * App-level companion for accessing the shared PaymentWebSocketClient.
 * Initialised once in OrchestaPayApp.onCreate().
 */
object PaymentWebSocketSingleton {
    @Volatile private var instance: PaymentWebSocketClient? = null

    fun init(okHttpClient: okhttp3.OkHttpClient, wsBaseUrl: String) {
        instance = PaymentWebSocketClient(okHttpClient, wsBaseUrl)
    }

    val current: PaymentWebSocketClient?
        get() = instance
}

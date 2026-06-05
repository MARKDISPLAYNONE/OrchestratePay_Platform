package com.orchestratepay.consumer.realtime

import android.util.Log
import com.orchestratepay.consumer.db.ConsumerSessionManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

data class ConsumerPaymentEvent(
    val txnId:       String,
    val status:      String,
    val amountCents: Int,
    val merchantName: String,
    val mpesaRef:    String?
)

/**
 * ConsumerWebSocketClient — persistent WebSocket for real-time payment notifications.
 *
 * Connects to /ws?consumerId={id}&token={jwt} and listens for PAYMENT_RECEIVED events
 * published by mpesa-callback.ts via the consumer:payment:{consumerId} Redis channel.
 *
 * Unlike the merchant terminal client (which is per-transaction and one-shot),
 * this connection is long-lived — it receives events for every payment made to any
 * merchant while the consumer is logged in. Reconnects automatically on failure.
 *
 * WebSocket primary, FCM fallback:
 *   When connected, the backend skips FCM (presence key exists in Redis).
 *   When disconnected, the backend sends an FCM push instead.
 */
class ConsumerWebSocketClient(private val wsBaseUrl: String) {

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)   // persistent — no read timeout
        .pingInterval(20, TimeUnit.SECONDS)      // keepalive on 3G
        .build()

    private var ws:           WebSocket? = null
    private var reconnectJob: Job?       = null

    var onPaymentReceived: ((ConsumerPaymentEvent) -> Unit)? = null
    var onConnected:       (() -> Unit)?                     = null
    var onDisconnected:    (() -> Unit)?                     = null

    fun connect() {
        val token      = ConsumerSessionManager.getToken()      ?: return
        val consumerId = ConsumerSessionManager.getConsumerId() ?: return
        val encoded    = URLEncoder.encode(token, "UTF-8")
        val url        = "$wsBaseUrl/ws?consumerId=$consumerId&token=$encoded"

        ws = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {

            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectJob?.cancel()
                onConnected?.invoke()
                Log.i(TAG, "Consumer channel open")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val json = runCatching { JSONObject(text) }.getOrNull() ?: return
                onPaymentReceived?.invoke(
                    ConsumerPaymentEvent(
                        txnId        = json.optString("txnId"),
                        status       = json.optString("status"),
                        amountCents  = json.optInt("amountCents"),
                        merchantName = json.optString("merchantName"),
                        mpesaRef     = json.optString("mpesaRef").takeIf { it.isNotBlank() }
                    )
                )
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                onDisconnected?.invoke()
                scheduleReconnect()
                Log.w(TAG, "Connection failed: ${t.message}")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onDisconnected?.invoke()
                if (code != 1000) scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = CoroutineScope(Dispatchers.IO).launch {
            delay(5_000)
            if (ConsumerSessionManager.isLoggedIn()) connect()
        }
    }

    fun disconnect() {
        reconnectJob?.cancel()
        ws?.close(1000, "Logout")
        ws = null
    }

    companion object {
        private const val TAG = "ConsumerWS"

        @Volatile private var instance: ConsumerWebSocketClient? = null

        fun init(wsBaseUrl: String) { instance = ConsumerWebSocketClient(wsBaseUrl) }

        val shared: ConsumerWebSocketClient? get() = instance
    }
}

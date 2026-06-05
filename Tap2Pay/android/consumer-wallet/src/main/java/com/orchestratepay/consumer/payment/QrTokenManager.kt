package com.orchestratepay.consumer.payment

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.orchestratepay.consumer.api.ConsumerApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * QrTokenManager — manages the consumer's short-lived QR token.
 *
 * The backend issues a 90-second single-use UUID token via POST /consumers/qr-token.
 * This manager:
 *   1. Fetches a token on first request
 *   2. Caches it until 15s before expiry
 *   3. Auto-schedules a background refresh so the QR is never stale when displayed
 *
 * Usage: call getQrState() from TapToPayFragment when the QR tab becomes visible.
 */
data class QrState(val bitmap: Bitmap, val token: String, val expiresAt: Long)

class QrTokenManager {

    private var current:    QrState? = null
    private var refreshJob: Job?     = null

    suspend fun getQrState(): QrState {
        val c = current
        if (c != null && c.expiresAt - System.currentTimeMillis() > 15_000) return c
        return refresh()
    }

    private suspend fun refresh(): QrState {
        val response = ConsumerApiClient.requestQrToken()
        val bitmap   = generateQrBitmap(response.token)
        val state    = QrState(bitmap, response.token, response.expiresAt)
        current = state
        scheduleAutoRefresh(response.expiresAt)
        return state
    }

    private fun scheduleAutoRefresh(expiresAt: Long) {
        refreshJob?.cancel()
        val delay = expiresAt - System.currentTimeMillis() - 15_000
        if (delay <= 0) return
        refreshJob = CoroutineScope(Dispatchers.IO).launch {
            delay(delay)
            runCatching { refresh() }
        }
    }

    fun cancel() { refreshJob?.cancel(); current = null }

    /** Generates a square QR code bitmap from the token string. */
    private fun generateQrBitmap(token: String, sizePx: Int = 512): Bitmap {
        val hints  = mapOf(EncodeHintType.MARGIN to 1)
        val matrix = QRCodeWriter().encode(token, BarcodeFormat.QR_CODE, sizePx, sizePx, hints)
        val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.RGB_565)
        for (x in 0 until sizePx) {
            for (y in 0 until sizePx) {
                bitmap.setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
            }
        }
        return bitmap
    }
}

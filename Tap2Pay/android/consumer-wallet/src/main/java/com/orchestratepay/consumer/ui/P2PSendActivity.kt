package com.orchestratepay.consumer.ui

import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.hce.P2PHceSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * P2PSendActivity — Scenarios 6, 7, 10, 11 (payee side).
 *
 * The payee consumer:
 *   1. Optionally enters a preset amount (or leaves it blank for the payer to choose)
 *   2. Taps "Request" to call POST /consumers/p2p-token → gets a 90-second token
 *   3. The activity simultaneously:
 *      a. Calls P2PHceSession.activate() so ConsumerHceService emits a P2P_REQUEST
 *         payload when the payer taps their phone (Scenarios 6 & 7 — NFC)
 *      b. Renders the token as a QR bitmap (Scenarios 10 & 11 — QR)
 *   4. The payer reads the NFC tap OR scans the QR and calls POST /consumers/p2p-pay
 *
 * Token expires after 90 seconds.  A countdown is shown and the user can refresh.
 */
class P2PSendActivity : AppCompatActivity() {

    private lateinit var etAmount:   EditText
    private lateinit var btnRequest: Button
    private lateinit var ivQr:       ImageView
    private lateinit var tvStatus:   TextView
    private lateinit var tvTimer:    TextView
    private lateinit var btnRefresh: Button
    private lateinit var progress:   ProgressBar

    private var expiresAt: Long = 0L
    private var timerJob: kotlinx.coroutines.Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_p2p_send)

        if (ConsumerSessionManager.getToken() == null) {
            startActivity(android.content.Intent(this, LoginActivity::class.java))
            finish(); return
        }

        etAmount   = findViewById(R.id.et_amount)
        btnRequest = findViewById(R.id.btn_request)
        ivQr       = findViewById(R.id.iv_qr)
        tvStatus   = findViewById(R.id.tv_status)
        tvTimer    = findViewById(R.id.tv_timer)
        btnRefresh = findViewById(R.id.btn_refresh)
        progress   = findViewById(R.id.progress_bar)

        val displayName = ConsumerSessionManager.getDisplayName()
        tvStatus.text = if (displayName != null) "Receiving as $displayName" else "Request payment"

        btnRequest.setOnClickListener { requestToken() }
        btnRefresh.setOnClickListener {
            timerJob?.cancel()
            P2PHceSession.clear()
            ivQr.visibility     = View.GONE
            tvTimer.visibility  = View.GONE
            btnRefresh.visibility = View.GONE
            btnRequest.visibility = View.VISIBLE
            etAmount.visibility   = View.VISIBLE
            tvStatus.text = if (displayName != null) "Receiving as $displayName" else "Request payment"
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        timerJob?.cancel()
        P2PHceSession.clear()
    }

    private fun requestToken() {
        val amountText = etAmount.text.toString().trim()
        val amountCents: Int? = if (amountText.isNotEmpty()) {
            val ksh = amountText.toDoubleOrNull()
            if (ksh == null || ksh <= 0) {
                Toast.makeText(this, "Enter a valid amount or leave blank", Toast.LENGTH_SHORT).show()
                return
            }
            (ksh * 100).toInt()
        } else null

        progress.visibility   = View.VISIBLE
        btnRequest.isEnabled  = false

        lifecycleScope.launch {
            runCatching { ConsumerApiClient.requestP2pToken(amountCents) }
                .onSuccess { resp ->
                    expiresAt = resp.expiresAt
                    val consumerId = ConsumerSessionManager.getConsumerId() ?: ""
                    val displayName = ConsumerSessionManager.getDisplayName()

                    // Activate HCE so NFC tap works (Scenarios 6/7)
                    P2PHceSession.activate(
                        P2PHceSession.Session(
                            p2pToken    = resp.token,
                            consumerId  = consumerId,
                            displayName = displayName,
                            amountCents = amountCents?.toLong(),
                            expiresAt   = resp.expiresAt,
                        )
                    )

                    // Render QR for scanner flow (Scenarios 10/11)
                    val qrBitmap = withContext(Dispatchers.Default) {
                        generateQr(resp.token, 512)
                    }

                    progress.visibility    = View.GONE
                    etAmount.visibility    = View.GONE
                    btnRequest.visibility  = View.GONE
                    ivQr.visibility        = View.VISIBLE
                    ivQr.setImageBitmap(qrBitmap)
                    tvTimer.visibility     = View.VISIBLE
                    btnRefresh.visibility  = View.VISIBLE

                    val amountLabel = amountCents?.let { " — KSh ${"%.2f".format(it / 100.0)}" } ?: ""
                    tvStatus.text = "Hold your phone for tap, or show QR$amountLabel"

                    startCountdown()
                }
                .onFailure { e ->
                    progress.visibility   = View.GONE
                    btnRequest.isEnabled  = true
                    Toast.makeText(this@P2PSendActivity,
                        "Could not generate token: ${e.message}", Toast.LENGTH_LONG).show()
                }
        }
    }

    private fun startCountdown() {
        timerJob = lifecycleScope.launch {
            while (true) {
                val remaining = ((expiresAt - System.currentTimeMillis()) / 1000).coerceAtLeast(0)
                tvTimer.text = "Expires in ${remaining}s"
                if (remaining == 0L) {
                    P2PHceSession.clear()
                    ivQr.visibility       = View.GONE
                    tvTimer.visibility    = View.GONE
                    btnRefresh.visibility = View.VISIBLE
                    btnRequest.visibility = View.VISIBLE
                    etAmount.visibility   = View.VISIBLE
                    tvStatus.text = "Token expired — tap Refresh to generate a new one"
                    break
                }
                delay(1_000)
            }
        }
    }

    private fun generateQr(content: String, size: Int): Bitmap {
        val bits = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size)
        val bmp  = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
        for (x in 0 until size) for (y in 0 until size) {
            bmp.setPixel(x, y, if (bits[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }
        return bmp
    }
}

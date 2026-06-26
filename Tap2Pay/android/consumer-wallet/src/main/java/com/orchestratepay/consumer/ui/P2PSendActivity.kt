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
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.hce.P2PHceSession
import com.orchestratepay.consumer.ui.viewmodel.P2pTokenState
import com.orchestratepay.consumer.ui.viewmodel.P2PPayViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class P2PSendActivity : AppCompatActivity() {

    private val viewModel: P2PPayViewModel by viewModels()

    private lateinit var etAmount:   EditText
    private lateinit var btnRequest: Button
    private lateinit var ivQr:       ImageView
    private lateinit var tvStatus:   TextView
    private lateinit var tvTimer:    TextView
    private lateinit var btnRefresh: Button
    private lateinit var progress:   ProgressBar
    private lateinit var tilAmount:  View

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
        tilAmount  = findViewById(R.id.til_amount)

        val displayName = ConsumerSessionManager.getDisplayName()
        tvStatus.text = if (displayName != null) "Receiving as $displayName" else "Request payment"

        btnRequest.setOnClickListener { attemptRequest() }
        btnRefresh.setOnClickListener {
            resetUI()
        }

        setupViewModel()
    }

    private fun setupViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.tokenState.collect { state ->
                    when (state) {
                        is P2pTokenState.Idle -> {
                            progress.visibility = View.GONE
                            btnRequest.isEnabled = true
                        }
                        is P2pTokenState.Loading -> {
                            progress.visibility = View.VISIBLE
                            btnRequest.isEnabled = false
                        }
                        is P2pTokenState.Success -> {
                            handleTokenSuccess(state.response)
                        }
                        is P2pTokenState.Error -> {
                            progress.visibility = View.GONE
                            btnRequest.isEnabled = true
                            Toast.makeText(this@P2PSendActivity, state.message, Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
        }
    }

    private fun attemptRequest() {
        val amountText = etAmount.text.toString().trim()
        val amountCents: Int? = if (amountText.isNotEmpty()) {
            val ksh = amountText.toDoubleOrNull()
            if (ksh == null || ksh <= 0) {
                Toast.makeText(this, "Enter a valid amount or leave blank", Toast.LENGTH_SHORT).show()
                return
            }
            (ksh * 100).toInt()
        } else null
        
        viewModel.requestP2pToken(amountCents)
    }

    private suspend fun handleTokenSuccess(resp: com.orchestratepay.consumer.api.P2pTokenResponse) {
        expiresAt = resp.expiresAt
        val consumerId = ConsumerSessionManager.getConsumerId() ?: ""
        val displayName = ConsumerSessionManager.getDisplayName()

        // HCE
        P2PHceSession.activate(
            P2PHceSession.Session(
                p2pToken    = resp.token,
                consumerId  = consumerId,
                displayName = displayName,
                amountCents = etAmount.text.toString().toDoubleOrNull()?.let { (it * 100).toLong() },
                expiresAt   = resp.expiresAt,
            )
        )

        // QR
        val qrBitmap = withContext(Dispatchers.Default) {
            generateQr(resp.token, 512)
        }

        progress.visibility    = View.GONE
        tilAmount.visibility   = View.GONE
        btnRequest.visibility  = View.GONE
        ivQr.visibility        = View.VISIBLE
        ivQr.setImageBitmap(qrBitmap)
        tvTimer.visibility     = View.VISIBLE
        btnRefresh.visibility  = View.VISIBLE

        val amountLabel = etAmount.text.toString().toDoubleOrNull()?.let { " — KSh ${"%.2f".format(it)}" } ?: ""
        tvStatus.text = "Hold your phone for tap, or show QR$amountLabel"

        startCountdown()
    }

    private fun resetUI() {
        timerJob?.cancel()
        P2PHceSession.clear()
        ivQr.visibility     = View.GONE
        tvTimer.visibility  = View.GONE
        btnRefresh.visibility = View.GONE
        btnRequest.visibility = View.VISIBLE
        tilAmount.visibility  = View.VISIBLE
        val displayName = ConsumerSessionManager.getDisplayName()
        tvStatus.text = if (displayName != null) "Receiving as $displayName" else "Request payment"
    }

    override fun onDestroy() {
        super.onDestroy()
        timerJob?.cancel()
        P2PHceSession.clear()
    }

    private fun startCountdown() {
        timerJob?.cancel()
        timerJob = lifecycleScope.launch {
            while (true) {
                val remaining = ((expiresAt - System.currentTimeMillis()) / 1000).coerceAtLeast(0)
                tvTimer.text = "Expires in ${remaining}s"
                if (remaining == 0L) {
                    P2PHceSession.clear()
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

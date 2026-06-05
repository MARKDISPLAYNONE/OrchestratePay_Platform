package com.orchestratepay.wallet.ui

import android.os.Bundle
import android.os.CountDownTimer
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.wallet.R
import com.orchestratepay.wallet.api.SessionResult
import com.orchestratepay.wallet.api.WalletApiClient
import com.orchestratepay.wallet.hce.WalletSessionManager
import kotlinx.coroutines.launch

/**
 * ActivatePaymentActivity — the customer's "Ready to Pay" screen.
 *
 * FLOW:
 *   1. Customer opens app → arrives here
 *   2. Taps "Ready to Pay" → we call POST /api/v1/wallet/session
 *   3. Backend returns { token, exp } → we store in WalletSessionManager
 *   4. UI shows a 60-second countdown and "Hold phone to POS"
 *   5. When POS sends CONFIRM APDU, WalletHceService.handleConfirm() clears the session
 *   6. If timer hits 0 without a tap, we clear the session and reset UI
 *
 * SCREEN-ON REQUIREMENT:
 *   Android HCE only fires while the screen is on and the device is unlocked.
 *   The UI text explicitly tells the customer to keep the screen on.
 *
 * THREAD MODEL:
 *   - Coroutine (lifecycleScope) handles the network call on IO, delivers back on Main
 *   - CountDownTimer runs on Main thread — safe to touch Views directly
 */
class ActivatePaymentActivity : AppCompatActivity() {

    // ── Views ────────────────────────────────────────────────────────────────
    private lateinit var btnActivate: Button
    private lateinit var tvStatus: TextView
    private lateinit var tvCountdown: TextView
    private lateinit var progressBar: ProgressBar

    // ── State ────────────────────────────────────────────────────────────────
    private var countdownTimer: CountDownTimer? = null

    // This must match the customer's registered phone number.
    // In production, retrieve from EncryptedSharedPreferences after phone-verified login.
    private val customerPhone: String
        get() = getSharedPreferences("wallet_prefs", MODE_PRIVATE)
            .getString("phone", "") ?: ""

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_activate_payment)

        btnActivate = findViewById(R.id.btn_activate)
        tvStatus    = findViewById(R.id.tv_status)
        tvCountdown = findViewById(R.id.tv_countdown)
        progressBar = findViewById(R.id.progress_loading)

        btnActivate.setOnClickListener { activate() }

        // If a session is already active (e.g. user rotated the screen), restore countdown UI.
        if (WalletSessionManager.isActive) {
            val remaining = WalletSessionManager.get()?.exp?.let { it - System.currentTimeMillis() } ?: 0
            if (remaining > 0) startCountdownUi(remaining)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        countdownTimer?.cancel()
        // Do NOT clear the session on destroy — the HCE service may still fire
        // while the app is in the background, so the session must survive.
    }

    // ── Activation ───────────────────────────────────────────────────────────

    private fun activate() {
        if (customerPhone.isEmpty()) {
            tvStatus.text = "Phone number not set. Please log in first."
            return
        }

        setUiLoading(true)

        lifecycleScope.launch {
            when (val result = WalletApiClient.current.requestSession(customerPhone)) {
                is SessionResult.Ready -> {
                    WalletSessionManager.set(customerPhone, result.token, result.exp)
                    setUiLoading(false)
                    startCountdownUi(result.exp - System.currentTimeMillis())
                }
                is SessionResult.Error -> {
                    setUiLoading(false)
                    tvStatus.text = result.message
                    btnActivate.isEnabled = true
                }
            }
        }
    }

    // ── Countdown UI ─────────────────────────────────────────────────────────

    private fun startCountdownUi(remainingMs: Long) {
        btnActivate.visibility = View.GONE
        tvStatus.text = "Hold phone near the POS terminal\nKeep screen ON"
        tvCountdown.visibility = View.VISIBLE

        countdownTimer?.cancel()
        countdownTimer = object : CountDownTimer(remainingMs, 1_000) {
            override fun onTick(millisUntilFinished: Long) {
                val secs = millisUntilFinished / 1_000
                tvCountdown.text = "$secs"

                // Pulse red when under 10 seconds
                if (secs <= 10) {
                    tvCountdown.setTextColor(getColor(android.R.color.holo_red_light))
                }
            }

            override fun onFinish() {
                WalletSessionManager.clear()
                resetUi()
            }
        }.start()
    }

    // ── UI helpers ───────────────────────────────────────────────────────────

    private fun setUiLoading(loading: Boolean) {
        progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        btnActivate.isEnabled  = !loading
        if (loading) tvStatus.text = "Preparing your payment…"
    }

    private fun resetUi() {
        countdownTimer?.cancel()
        btnActivate.visibility  = View.VISIBLE
        btnActivate.isEnabled   = true
        tvCountdown.visibility  = View.GONE
        tvCountdown.setTextColor(getColor(android.R.color.white))
        tvStatus.text = "Tap when you're ready to pay"
        progressBar.visibility  = View.GONE
    }
}

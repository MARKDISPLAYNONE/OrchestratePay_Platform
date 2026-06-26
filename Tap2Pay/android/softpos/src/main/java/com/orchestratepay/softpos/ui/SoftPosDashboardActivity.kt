package com.orchestratepay.softpos.ui

import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.google.android.material.snackbar.Snackbar
import com.orchestratepay.nfccore.NfcPaymentReader
import com.orchestratepay.nfccore.NfcReadError
import com.orchestratepay.nfccore.NfcReadResult
import com.orchestratepay.nfccore.TapFeedback
import com.orchestratepay.softpos.databinding.ActivitySoftposDashboardBinding
import com.orchestratepay.softpos.orchestrator.SoftPosOrchestrator

/**
 * SoftPosDashboardActivity — main screen for the SoftPOS merchant app.
 *
 * Mirrors MerchantDashboardActivity in the Sunmi terminal app but is designed
 * for a regular Android phone (no Sunmi-specific APIs).
 *
 * Key differences from the terminal app:
 *   1. Uses nfc-core NfcPaymentReader (shared library) instead of NfcReaderManager
 *   2. No SunmiPrinterManager — digital receipts sent via SMS
 *   3. Play Integrity attestation via SoftPosOrchestrator
 *   4. Only accepts HCE_PHONE taps (SOFTPOS_MOBILE source) — NFC stickers are terminal-only
 *
 * Ghost merchant protection:
 *   The server checks that the merchantId in the JWT matches the transaction body.
 *   A different check on SOFTPOS_MOBILE verifies the device has a recent attestation.
 *
 * SCREEN STATES: IDLE → PROCESSING → SUCCESS / DECLINED / ERROR
 */
class SoftPosDashboardActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySoftposDashboardBinding

    private val nfcReader by lazy {
        NfcPaymentReader(
            activity = this,
            scope    = lifecycleScope,
            onResult = ::onNfcResult,
            onError  = ::onNfcError,
        )
    }

    private val orchestrator by lazy {
        val prefs = getSharedPreferences("softpos_prefs", MODE_PRIVATE)
        SoftPosOrchestrator(
            context       = applicationContext,
            apiBaseUrl    = prefs.getString("api_base_url", "https://api.orchestratepay.co.ke")!!,
            merchantToken = prefs.getString("merchant_token", "")!!,
            merchantId    = prefs.getString("merchant_id", "")!!,
            scope         = lifecycleScope,
        )
    }

    private var amountCents = 0L
    private var isProcessing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySoftposDashboardBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupAmountInput()
        showState("IDLE")
    }

    override fun onResume() {
        super.onResume()
        nfcReader.enable()
    }

    override fun onPause() {
        super.onPause()
        nfcReader.disable()
    }

    private fun setupAmountInput() {
        val digitButtons = listOf(
            binding.btn1 to 1, binding.btn2 to 2, binding.btn3 to 3,
            binding.btn4 to 4, binding.btn5 to 5, binding.btn6 to 6,
            binding.btn7 to 7, binding.btn8 to 8, binding.btn9 to 9,
            binding.btn0 to 0
        )
        digitButtons.forEach { (btn, digit) ->
            btn.setOnClickListener {
                if (amountCents < 100_000_00L) {
                    amountCents = amountCents * 10 + digit * 100L
                    updateAmountDisplay()
                }
            }
        }
        binding.btnClear.setOnClickListener {
            amountCents = 0
            updateAmountDisplay()
        }
        binding.btnConfirm.setOnClickListener {
            if (amountCents > 0) showInfo("Hold customer's phone to yours to tap")
        }
    }

    private fun updateAmountDisplay() {
        binding.tvAmountDisplay.text = "KSh ${"%.2f".format(amountCents / 100.0)}"
    }

    private fun onNfcResult(result: NfcReadResult) {
        if (isProcessing) return

        // SoftPOS only accepts HCE phone taps — no sticker support
        if (result !is NfcReadResult.HceRead) {
            showInfo("Hold the customer's phone closer to yours to tap")
            return
        }

        if (amountCents <= 0) {
            showError("Enter the amount before the customer taps")
            return
        }

        TapFeedback.detected(this)
        isProcessing = true
        showState("PROCESSING")

        orchestrator.process(
            nfcResult   = result,
            amountCents = amountCents,
            onStkSent   = { showInfo("M-Pesa prompt sent — ask customer to enter PIN") },
            onResult    = ::handleResult,
        )
    }

    private fun onNfcError(error: NfcReadError) {
        when (error) {
            NfcReadError.NOT_SUPPORTED     -> showError("NFC not available on this device")
            NfcReadError.TOKEN_EXPIRED     -> showInfo("Payment session expired — customer must re-activate wallet")
            NfcReadError.SIGNATURE_INVALID -> showError("Unrecognised tag — not an OrchestratePay device")
            else                           -> showInfo("Tap again — hold devices steady")
        }
    }

    private fun handleResult(result: SoftPosOrchestrator.SoftPosResult) {
        isProcessing = false
        when (result) {
            is SoftPosOrchestrator.SoftPosResult.Confirmed -> {
                TapFeedback.success(this)
                showState("SUCCESS")
                binding.tvResultIcon.text    = "✓"
                binding.tvResultMessage.text =
                    "KSh ${"%.2f".format(result.amountCents / 100.0)} confirmed\nRef: ${result.mpesaRef}"
                // Digital receipt sent via SMS by the backend (no printer here)
                window.decorView.postDelayed({ resetForNextPayment() }, 5000)
            }
            is SoftPosOrchestrator.SoftPosResult.Declined -> {
                TapFeedback.error(this)
                showState("DECLINED")
                binding.tvResultIcon.text    = "✗"
                binding.tvResultMessage.text = result.reason
                window.decorView.postDelayed({ showState("IDLE") }, 5000)
            }
            is SoftPosOrchestrator.SoftPosResult.Failed -> {
                TapFeedback.error(this)
                showState("ERROR")
                binding.tvResultIcon.text    = "!"
                binding.tvResultMessage.text = result.reason
            }
            is SoftPosOrchestrator.SoftPosResult.StkSent -> {
                // Intermediate state — handled by onStkSent callback above
            }
        }
    }

    internal fun showState(state: String) {
        val isIdle       = state == "IDLE"
        val isProcessing = state == "PROCESSING"
        val isResult     = state in listOf("SUCCESS", "DECLINED", "ERROR")

        binding.tvAmountDisplay.isVisible  = isIdle
        binding.keypadGrid.isVisible       = isIdle
        binding.tvTapPrompt.isVisible      = isIdle
        binding.layoutProcessing.isVisible = isProcessing
        binding.layoutResult.isVisible     = isResult

        if (isResult) {
            binding.tvResultIcon.setTextColor(when (state) {
                "SUCCESS"  -> android.graphics.Color.parseColor("#2E7D32")
                "DECLINED" -> android.graphics.Color.parseColor("#C62828")
                else       -> android.graphics.Color.parseColor("#E65100")
            })
        }

        android.util.Log.d("SoftPosDashboard", "State: $state")
    }

    private fun showInfo(msg: String) {
        android.util.Log.i("SoftPosDashboard", msg)
        Snackbar.make(binding.root, msg, Snackbar.LENGTH_SHORT).show()
    }

    private fun showError(msg: String) {
        android.util.Log.e("SoftPosDashboard", msg)
        Snackbar.make(binding.root, msg, Snackbar.LENGTH_LONG)
            .setBackgroundTint(android.graphics.Color.parseColor("#C62828"))
            .show()
    }

    internal fun resetForNextPayment() {
        amountCents = 0
        updateAmountDisplay()
        showState("IDLE")
    }
}

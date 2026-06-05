package com.orchestratepay.softpos.ui

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.nfccore.NfcPaymentReader
import com.orchestratepay.nfccore.NfcReadError
import com.orchestratepay.nfccore.NfcReadResult
import com.orchestratepay.nfccore.TapFeedback
import com.orchestratepay.softpos.orchestrator.SoftPosOrchestrator
import kotlinx.coroutines.launch

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
 * SCREEN STATES: same as MerchantDashboardActivity (IDLE → PROCESSING → SUCCESS/DECLINED)
 */
class SoftPosDashboardActivity : AppCompatActivity() {

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
        // setContentView(R.layout.activity_softpos_dashboard)
        setupAmountInput()
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
        // TODO: wire up keypad. Each digit press: amountCents = amountCents * 10 + digit * 100
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
                showInfo("KSh ${result.amountCents / 100} confirmed — Ref: ${result.mpesaRef}")
                // Digital receipt sent via SMS by the backend (no printer here)
                window.decorView.postDelayed({ resetForNextPayment() }, 5000)
            }
            is SoftPosOrchestrator.SoftPosResult.Declined -> {
                TapFeedback.error(this)
                showState("DECLINED")
                showError(result.reason)
                window.decorView.postDelayed({ showState("IDLE") }, 5000)
            }
            is SoftPosOrchestrator.SoftPosResult.Failed -> {
                TapFeedback.error(this)
                showState("ERROR")
                showError(result.reason)
            }
            is SoftPosOrchestrator.SoftPosResult.StkSent -> {
                // Intermediate state — handled by onStkSent callback above
            }
        }
    }

    private fun showState(state: String) {
        android.util.Log.d("SoftPosDashboard", "State: $state")
        // TODO: update ViewBinding views
    }

    private fun showInfo(msg: String) { android.util.Log.i("SoftPosDashboard", msg) }
    private fun showError(msg: String) { android.util.Log.e("SoftPosDashboard", msg) }

    private fun resetForNextPayment() {
        amountCents = 0
        showState("IDLE")
    }
}

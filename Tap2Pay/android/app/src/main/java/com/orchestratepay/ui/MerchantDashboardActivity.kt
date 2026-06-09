package com.orchestratepay.ui

import android.content.Intent
import android.os.Bundle
import android.os.Vibrator
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.getSystemService
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.google.android.material.snackbar.Snackbar
import com.orchestratepay.api.OrchestrateApiClient
import com.orchestratepay.databinding.ActivityMerchantDashboardBinding
import com.orchestratepay.db.AuditEvent
import com.orchestratepay.db.AuditLogger
import com.orchestratepay.db.SessionManager
import com.orchestratepay.hce.MerchantHceSession
import com.orchestratepay.nfc.NfcError
import com.orchestratepay.nfc.NfcReaderManager
import com.orchestratepay.offline.ConnectivityMonitor
import com.orchestratepay.offline.OfflineQueueDatabase
import com.orchestratepay.offline.QueuedIntent
import com.orchestratepay.payment.IdempotencyKeyGen
import com.orchestratepay.payment.PaymentIntent
import com.orchestratepay.payment.PaymentOrchestrator
import com.orchestratepay.payment.PaymentResult
import com.orchestratepay.payment.PaymentSource
import com.orchestratepay.printer.PrintResult
import com.orchestratepay.printer.PrinterState
import com.orchestratepay.printer.SunmiPrinterManager
import com.orchestratepay.realtime.PaymentWebSocketSingleton
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

/**
 * MerchantDashboardActivity — the main screen the merchant sees all day.
 *
 * SCREEN STATES:
 *   IDLE        → shows amount keypad, "Ready to tap" indicator
 *   PROCESSING  → spinner + "Waiting for customer..."
 *   SUCCESS     → large green checkmark + M-Pesa receipt number
 *   DECLINED    → red X + reason text
 *   ERROR       → yellow warning + retry button
 *
 * NFC LIFECYCLE:
 *   onResume  → enableReaderMode (start listening)
 *   onPause   → disableReaderMode (stop listening — MUST do this or crash)
 *   onNewIntent → called when a tag is tapped while activity is foreground (singleTop)
 */
class MerchantDashboardActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMerchantDashboardBinding

    // ─── Dependencies ───────────────────────────────────────────────────────

    private val auditLog by lazy { AuditLogger() }

    private val nfcManager by lazy {
        NfcReaderManager(
            activity = this,
            onIntent = ::onTagDetected,
            onError  = ::onNfcError
        )
    }

    private val orchestrator by lazy {
        PaymentOrchestrator(
            apiClient     = OrchestrateApiClient.current,
            auditLog      = auditLog,
            scope         = lifecycleScope,
            wsClient      = PaymentWebSocketSingleton.current,
            merchantToken = SessionManager.getToken()
        )
    }

    private val printer by lazy { SunmiPrinterManager(this) }
    private val offlineDb by lazy { OfflineQueueDatabase.get(this) }

    // ─── State ──────────────────────────────────────────────────────────────

    private enum class ScreenState { IDLE, PROCESSING, SUCCESS, DECLINED, ERROR }
    private var currentState = ScreenState.IDLE
    private var enteredAmountCents = 0L
    private var isOnline = true

    // ─── Lifecycle ──────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMerchantDashboardBinding.inflate(layoutInflater)
        setContentView(binding.root)

        if (!SessionManager.isLoggedIn()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        binding.tvMerchantName.text = SessionManager.getMerchantName() ?: ""
        setupAmountKeypad()
        showState(ScreenState.IDLE)
        observeConnectivity()

        binding.btnScanQr.setOnClickListener    { scanConsumerQrCode() }
        binding.btnPresentNfc.setOnClickListener { presentToCustomerViaNfc() }
    }

    override fun onResume() {
        super.onResume()
        nfcManager.enable()
        // Re-check JWT expiry every time the activity comes to foreground
        if (!SessionManager.isLoggedIn()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
        }
    }

    override fun onPause() {
        super.onPause()
        nfcManager.disable()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // NfcReaderManager handles tag discovery via the reader callback — nothing to do here.
    }

    // ─── Offline awareness ───────────────────────────────────────────────────

    private fun observeConnectivity() {
        lifecycleScope.launch {
            ConnectivityMonitor.observe(this@MerchantDashboardActivity).collect { online ->
                isOnline = online
                binding.tvStatusBar.isVisible = !online
                if (online) {
                    binding.tvStatusBar.text = "Back online"
                } else {
                    binding.tvStatusBar.text = "Offline — NFC and QR payments will be queued"
                    binding.tvStatusBar.visibility = View.VISIBLE
                }
            }
        }
    }

    private suspend fun queueOfflineIntent(intent: PaymentIntent, amountCents: Long) {
        if (intent.source == PaymentSource.HCE_PHONE) {
            showError("Phone tap cannot be queued offline — ask customer to retry when online")
            showState(ScreenState.ERROR)
            return
        }
        val queued = QueuedIntent(
            idempotencyKey = IdempotencyKeyGen.generate(intent, amountCents),
            merchantId  = intent.merchantId,
            tagId       = intent.tagId,
            rawUid      = intent.rawUid,
            source      = intent.source.name,
            amountCents = amountCents,
        )
        offlineDb.dao().enqueue(queued)
        showInfo("Payment queued — will sync when online (${intent.source.name})")
        resetForNextPayment()
    }

    // ─── NFC callbacks ──────────────────────────────────────────────────────

    private fun onTagDetected(intent: PaymentIntent) {
        if (currentState == ScreenState.PROCESSING) return
        if (enteredAmountCents <= 0) {
            showError("Please enter the amount before the customer taps")
            return
        }

        getSystemService<Vibrator>()?.vibrate(100)

        when (intent.source) {
            PaymentSource.HCE_PHONE -> {
                auditLog.record(AuditEvent.HCE_TAP_DETECTED,
                    "phone=${intent.consumerPhone?.take(5)}**** merchantId=${intent.merchantId}")
                showInfo("Phone tapped — check your phone for M-Pesa PIN prompt")
            }
            PaymentSource.CONSUMER_TAG -> {
                auditLog.record(AuditEvent.NFC_TAG_DETECTED,
                    "source=CONSUMER_TAG consumerId=${intent.consumerId} merchantId=${intent.merchantId}")
                showInfo("Customer sticker tapped — sending M-Pesa prompt")
            }
            else -> auditLog.record(AuditEvent.NFC_TAG_DETECTED,
                "source=${intent.source} merchantId=${intent.merchantId}")
        }

        if (!isOnline) {
            lifecycleScope.launch { queueOfflineIntent(intent, enteredAmountCents) }
            return
        }

        showState(ScreenState.PROCESSING)
        orchestrator.process(
            intent      = intent,
            amountCents = enteredAmountCents,
            onStkSent   = { showInfo("M-Pesa prompt sent — waiting for customer to enter PIN") },
            onResult    = ::handlePaymentResult
        )
    }

    private fun onNfcError(error: NfcError) {
        when (error) {
            NfcError.NOT_SUPPORTED     -> showInfo("NFC not available — use QR code")
            NfcError.READ_FAILED       -> showInfo("Tap again — hold device steady")
            NfcError.UNRECOGNISED_TAG  -> showInfo("Unregistered tag — customer needs an OrchestratePay sticker")
            NfcError.PARSE_ERROR       -> showInfo("Tag read error — tap again")
            NfcError.SIGNATURE_INVALID -> {
                auditLog.record(AuditEvent.NFC_READ_FAILED, "SIGNATURE_INVALID")
                showError("Invalid payment tag — please contact support")
            }
            NfcError.TOKEN_EXPIRED -> {
                auditLog.record(AuditEvent.NFC_TOKEN_EXPIRED, "HCE session expired before POS read")
                showInfo("Payment session expired — ask customer to tap 'Ready to Pay' again")
            }
        }
    }

    // ─── Payment result handler ──────────────────────────────────────────────

    private fun handlePaymentResult(result: PaymentResult) {
        when (result) {
            is PaymentResult.Success -> {
                showState(ScreenState.SUCCESS)
                binding.tvResultIcon.text    = "✓"
                binding.tvResultMessage.text = "Paid KSh ${"%.2f".format(result.amountCents / 100.0)}\nRef: ${result.mpesaRef}"

                lifecycleScope.launchWhenResumed {
                    when (val pr = printer.printReceipt(result, SessionManager.getKraPin())) {
                        is PrintResult.Success -> Unit
                        is PrintResult.Failed  -> showInfo("Receipt not printed: ${pr.message}")
                    }
                }

                startActivity(Intent(this, ReceiptActivity::class.java).apply {
                    putExtra("txn_id",       result.txnId)
                    putExtra("mpesa_ref",    result.mpesaRef)
                    putExtra("amount_cents", result.amountCents)
                    putExtra("merchant_name", result.merchantName)
                })
                resetForNextPayment()
            }

            is PaymentResult.Declined -> {
                showState(ScreenState.DECLINED)
                binding.tvResultIcon.text    = "✗"
                binding.tvResultMessage.text = result.reason
                window.decorView.postDelayed({ showState(ScreenState.IDLE) }, 5000)
            }

            is PaymentResult.Failed -> {
                showState(ScreenState.ERROR)
                binding.tvResultIcon.text    = "!"
                binding.tvResultMessage.text = result.reason
                binding.btnRetry.isVisible   = result.retryable
            }

            is PaymentResult.Pending -> Unit
        }
    }

    // ─── Keypad setup ────────────────────────────────────────────────────────

    private fun setupAmountKeypad() {
        val digitButtons = listOf(
            binding.btn1 to 1, binding.btn2 to 2, binding.btn3 to 3,
            binding.btn4 to 4, binding.btn5 to 5, binding.btn6 to 6,
            binding.btn7 to 7, binding.btn8 to 8, binding.btn9 to 9,
            binding.btn0 to 0
        )
        digitButtons.forEach { (btn, digit) ->
            btn.setOnClickListener {
                if (enteredAmountCents < 100_000_00L) {  // guard against overflow
                    enteredAmountCents = enteredAmountCents * 10 + digit * 100L
                    updateAmountDisplay()
                }
            }
        }
        binding.btnClear.setOnClickListener {
            enteredAmountCents = 0
            updateAmountDisplay()
        }
        binding.btnConfirm.setOnClickListener {
            if (enteredAmountCents > 0) onAmountConfirmed(enteredAmountCents)
        }
        binding.btnRetry.setOnClickListener {
            showState(ScreenState.IDLE)
        }
    }

    private fun updateAmountDisplay() {
        binding.tvAmountDisplay.text = "KSh ${"%.2f".format(enteredAmountCents / 100.0)}"
    }

    private fun onAmountConfirmed(amountCents: Long) {
        enteredAmountCents = amountCents
        lifecycleScope.launchWhenResumed {
            when (val state = printer.checkPrinterState()) {
                is PrinterState.OutOfPaper   -> showInfo("Printer out of paper — please reload")
                is PrinterState.LowPaper     -> showInfo("Paper running low — consider reloading")
                is PrinterState.Overheating  -> showInfo("Printer overheating — receipt may be delayed")
                is PrinterState.Disconnected -> showInfo("Printer not connected — receipt won't print")
                is PrinterState.Error        -> showInfo("Printer error (${state.code})")
                is PrinterState.Ready        -> Unit
            }
        }
    }

    // ─── State display ───────────────────────────────────────────────────────

    private fun showState(state: ScreenState) {
        currentState = state
        val isIdle       = state == ScreenState.IDLE
        val isProcessing = state == ScreenState.PROCESSING
        val isResult     = state == ScreenState.SUCCESS || state == ScreenState.DECLINED || state == ScreenState.ERROR

        binding.tvAmountDisplay.isVisible  = isIdle
        binding.tvTapPrompt.isVisible      = isIdle
        binding.keypadGrid.isVisible       = isIdle
        binding.layoutActions.isVisible    = isIdle
        binding.layoutProcessing.isVisible = isProcessing
        binding.layoutResult.isVisible     = isResult

        if (isResult) {
            binding.tvResultIcon.setTextColor(when (state) {
                ScreenState.SUCCESS  -> android.graphics.Color.parseColor("#2E7D32")
                ScreenState.DECLINED -> android.graphics.Color.parseColor("#C62828")
                else                 -> android.graphics.Color.parseColor("#E65100")
            })
        }
    }

    private fun showInfo(msg: String) {
        android.util.Log.i("Dashboard", msg)
        Snackbar.make(binding.root, msg, Snackbar.LENGTH_SHORT).show()
    }

    private fun showError(msg: String) {
        android.util.Log.e("Dashboard", msg)
        Snackbar.make(binding.root, msg, Snackbar.LENGTH_LONG)
            .setBackgroundTint(android.graphics.Color.parseColor("#C62828"))
            .show()
    }

    private fun resetForNextPayment() {
        enteredAmountCents = 0
        updateAmountDisplay()
        showState(ScreenState.IDLE)
    }

    // ─── NFC / QR action buttons ─────────────────────────────────────────────

    fun presentToCustomerViaNfc() {
        if (enteredAmountCents <= 0) { showError("Enter an amount first"); return }
        lifecycleScope.launch {
            runCatching {
                OrchestrateApiClient.current.issueMerchantHceToken(enteredAmountCents)
            }.onSuccess { resp ->
                MerchantHceSession.activate(MerchantHceSession.Session(
                    token        = resp.token,
                    merchantId   = SessionManager.getMerchantId() ?: "",
                    merchantName = resp.merchantName,
                    amountCents  = resp.amountCents,
                    expiresAt    = resp.expiresAt,
                ))
                showInfo("Hold this phone to customer's wallet — NFC active")
            }.onFailure { e ->
                showError("Could not activate NFC payment request: ${e.message}")
            }
        }
    }

    fun scanConsumerQrCode() {
        if (enteredAmountCents <= 0) { showError("Enter an amount first"); return }
        startActivityForResult(
            Intent(this, ConsumerQrScannerActivity::class.java)
                .putExtra("amountCents", enteredAmountCents),
            REQ_CONSUMER_QR_SCAN
        )
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_CONSUMER_QR_SCAN && resultCode == RESULT_OK) {
            val token = data?.getStringExtra("consumerQrToken") ?: return
            showState(ScreenState.PROCESSING)
            orchestrator.processConsumerQr(
                merchantId      = SessionManager.getMerchantId() ?: "",
                amountCents     = enteredAmountCents,
                consumerQrToken = token,
                onStkSent       = { showInfo("M-Pesa prompt sent — waiting for customer PIN") },
                onResult        = ::handlePaymentResult,
            )
        }
    }

    fun printZReport(date: String? = null) {
        lifecycleScope.launchWhenResumed {
            val report = OrchestrateApiClient.current.getZReport(date)
            if (report == null) {
                showInfo("Could not load Z-Report — check connection")
                return@launchWhenResumed
            }
            when (val result = printer.printZReport(report)) {
                is PrintResult.Success -> showInfo("Z-Report printed")
                is PrintResult.Failed  -> showInfo("Z-Report print failed: ${result.message}")
            }
            auditLog.record(AuditEvent.RECEIPT_PRINT_STARTED,
                "z-report date=${report.date} confirmed=${report.transactions.confirmed.count}")
        }
    }

    companion object {
        private const val REQ_CONSUMER_QR_SCAN = 1001
    }
}

package com.orchestratepay.ui

import android.content.Intent
import android.os.Bundle
import android.os.Vibrator
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.getSystemService
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.api.OrchestrateApiClient
import com.orchestratepay.db.AuditEvent
import com.orchestratepay.db.AuditLogger
import com.orchestratepay.db.SessionManager
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
import com.orchestratepay.hce.MerchantHceSession
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
 *
 * THREADING:
 *   NFC callbacks arrive on a background thread → we pass them to orchestrator
 *   Orchestrator callbacks are delivered back on Main thread (via runOnUiThread)
 *   All UI updates happen on Main thread only
 */
class MerchantDashboardActivity : AppCompatActivity() {

    // ─── Dependencies ───────────────────────────────────────────────────────
    // Using lazy so they're created after Application.onCreate() runs init()

    private val auditLog by lazy { AuditLogger() }

    private val nfcManager by lazy {
        NfcReaderManager(
            activity  = this,
            onIntent  = ::onTagDetected,
            onError   = ::onNfcError
        )
    }

    private val orchestrator by lazy {
        PaymentOrchestrator(
            apiClient     = OrchestrateApiClient.current,
            auditLog      = auditLog,
            scope         = lifecycleScope,  // cancelled automatically when activity is destroyed
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
        // setContentView(R.layout.activity_merchant_dashboard) // uncomment with real layout

        // Check session validity — redirect to login if expired
        if (!SessionManager.isLoggedIn()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        setupAmountKeypad()
        showState(ScreenState.IDLE)
        observeConnectivity()
    }

    override fun onResume() {
        super.onResume()
        // Start NFC reader every time the activity comes to foreground.
        // This also handles the case where the user backgrounds then returns.
        nfcManager.enable()
    }

    override fun onPause() {
        super.onPause()
        // MUST disable reader mode when not in foreground.
        // Failing to do this throws an IllegalStateException.
        nfcManager.disable()
    }

    /**
     * onNewIntent is called when a new NFC tag intent arrives while this activity
     * is already running (because launchMode="singleTop" in the manifest).
     * Without singleTop, Android would create a new instance of this activity.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // The NFC tag data is in the new intent — NfcReaderManager.enableReaderMode
        // handles the actual tag parsing via the ReaderCallback. We don't need to
        // parse the intent here — it's handled in onTagDiscovered().
    }

    // ─── Offline awareness ───────────────────────────────────────────────────

    private fun observeConnectivity() {
        lifecycleScope.launch {
            ConnectivityMonitor.observe(this@MerchantDashboardActivity).collect { online ->
                isOnline = online
                if (online) {
                    // Connectivity banner hidden — we're back online
                    showInfo("Back online")
                } else {
                    // Show offline banner — NFC_TAG + QR payments still work
                    showInfo("Offline mode — NFC tag and QR payments will be queued")
                }
            }
        }
    }

    /**
     * Queues an NFC_TAG or QR_CODE PaymentIntent to the local Room database when
     * the terminal is offline. The QueueSyncService will flush it when connectivity
     * is restored.
     *
     * HCE_PHONE intents are NEVER queued — their session token has a 60s TTL
     * and will be expired long before connectivity can be restored.
     */
    private suspend fun queueOfflineIntent(intent: PaymentIntent, amountCents: Long) {
        if (intent.source == PaymentSource.HCE_PHONE) {
            showError("Phone tap cannot be queued offline — ask customer to retry when online")
            showState(ScreenState.ERROR)
            return
        }
        val queued = QueuedIntent(
            idempotencyKey = IdempotencyKeyGen.generate(
                intent.merchantId, intent.tagId ?: "", amountCents
            ),
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

    /**
     * Called by NfcReaderManager when a valid OrchestratePay tag is tapped.
     * This runs on the MAIN thread (NfcReaderManager calls runOnUiThread for us).
     */
    private fun onTagDetected(intent: PaymentIntent) {
        if (currentState == ScreenState.PROCESSING) {
            // Ignore double-taps during active payment
            return
        }

        if (enteredAmountCents <= 0) {
            showError("Please enter the amount before the customer taps")
            return
        }

        // Haptic feedback — brief buzz confirms the tap registered
        getSystemService<Vibrator>()?.vibrate(100)

        // Log a distinct event for HCE phone taps vs. sticker taps — different audit trail
        // for CBK reconciliation (sticker = passive read, HCE = active APDU handshake + token exchange)
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
            else -> {
                auditLog.record(AuditEvent.NFC_TAG_DETECTED,
                    "source=${intent.source} merchantId=${intent.merchantId}")
            }
        }
        // If offline, queue NFC_TAG/QR intents for later sync; reject HCE taps
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
            NfcError.NOT_SUPPORTED    -> showInfo("NFC not available — use QR code")
            NfcError.READ_FAILED      -> showInfo("Tap again — hold device steady")
            NfcError.UNRECOGNISED_TAG -> showInfo("Unregistered tag — customer needs an OrchestratePay sticker")
            NfcError.PARSE_ERROR      -> showInfo("Tag read error — tap again")
            NfcError.SIGNATURE_INVALID -> {
                // Log as security event — a forged or improperly cloned tag was detected.
                auditLog.record(AuditEvent.NFC_READ_FAILED, "SIGNATURE_INVALID")
                showError("Invalid payment tag — please contact support")
            }
            NfcError.TOKEN_EXPIRED -> {
                // Customer's HCE session timed out before they tapped. They must re-activate
                // the wallet app. This is normal — 60s window elapsed.
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
                // Show M-Pesa receipt number prominently
                // binding.mpesaRefText.text = result.mpesaRef
                // binding.amountConfirmedText.text = formatAmount(result.amountCents)

                // Print thermal receipt — fire and forget (don't block UI).
                // Show a warning if the printer can't print, but never block or
                // reverse the payment — the transaction is already confirmed.
                lifecycleScope.launchWhenResumed {
                    when (val printResult = printer.printReceipt(result, SessionManager.getKraPin())) {
                        is PrintResult.Success -> { /* no action needed */ }
                        is PrintResult.Failed  -> showInfo("Receipt not printed: ${printResult.message}")
                    }
                }

                // Navigate to full receipt screen
                val intent = Intent(this, ReceiptActivity::class.java).apply {
                    putExtra("txn_id", result.txnId)
                    putExtra("mpesa_ref", result.mpesaRef)
                    putExtra("amount_cents", result.amountCents)
                    putExtra("merchant_name", result.merchantName)
                }
                startActivity(intent)

                // Reset for next payment
                resetForNextPayment()
            }

            is PaymentResult.Declined -> {
                showState(ScreenState.DECLINED)
                // binding.declineReasonText.text = result.reason
                // Auto-reset after 5 seconds so merchant doesn't have to tap anything
                window.decorView.postDelayed({ showState(ScreenState.IDLE) }, 5000)
            }

            is PaymentResult.Failed -> {
                showState(ScreenState.ERROR)
                // binding.errorText.text = result.reason
                // binding.retryButton.isVisible = result.retryable
            }

            is PaymentResult.Pending -> {
                // This case is handled by the orchestrator polling internally
                // We won't receive Pending here, but the UI stays in PROCESSING
            }
        }
    }

    // ─── UI helpers ─────────────────────────────────────────────────────────

    private fun setupAmountKeypad() {
        // TODO: wire up numpad buttons to update enteredAmountCents
        // Each numpad press: enteredAmountCents = enteredAmountCents * 10 + digit * 100
        // Clear button: enteredAmountCents = 0
        // Display: "KSh ${enteredAmountCents / 100}"
        //
        // Call onAmountConfirmed() when the merchant presses the confirm/enter key.
    }

    /**
     * Called when the merchant presses the confirm key after entering an amount.
     * Runs a printer pre-flight so the merchant can reload paper before the customer
     * taps, not after — avoiding the situation where the PIN prompt fires and the
     * receipt silently fails because the paper ran out mid-shift.
     *
     * We warn but never block the payment — the customer can still pay even if the
     * printer is out of paper. The merchant can reprint from the receipt screen.
     */
    private fun onAmountConfirmed(amountCents: Long) {
        enteredAmountCents = amountCents
        lifecycleScope.launchWhenResumed {
            when (val state = printer.checkPrinterState()) {
                is PrinterState.OutOfPaper   -> showInfo("Printer is out of paper — please reload before accepting payment")
                is PrinterState.LowPaper     -> showInfo("Paper running low — consider reloading after this payment")
                is PrinterState.Overheating  -> showInfo("Printer is overheating — receipt may be delayed")
                is PrinterState.Disconnected -> showInfo("Printer not connected — receipt will not be printed")
                is PrinterState.Error        -> showInfo("Printer error (${state.code}) — receipt may fail")
                is PrinterState.Ready        -> { /* all good */ }
            }
        }
    }

    private fun showState(state: ScreenState) {
        currentState = state
        // TODO: show/hide layout sections based on state
        // IDLE: show keypad, hide spinner
        // PROCESSING: hide keypad, show spinner
        // SUCCESS: show checkmark
        // DECLINED / ERROR: show message
    }

    private fun showInfo(msg: String) {
        // TODO: show a snackbar or toast
        android.util.Log.i("Dashboard", msg)
    }

    private fun showError(msg: String) {
        android.util.Log.e("Dashboard", msg)
    }

    private fun resetForNextPayment() {
        enteredAmountCents = 0
        showState(ScreenState.IDLE)
    }

    /**
     * Called when the merchant taps "Present to Customer" on the dashboard.
     * Scenario 5: merchant's phone becomes an NFC card emulator carrying a
     * signed payment request. The consumer holds their wallet phone to this phone
     * to read the request and initiate payment — no amount entry needed on the
     * consumer side.
     *
     * Flow:
     *   1. Call POST /transactions/merchant-hce-token with the entered amount
     *   2. Backend returns a 60-second single-use UUID token
     *   3. Activate MerchantHceSession so OrchestrateHceService can serve the payload
     *   4. OrchestrateHceService is registered for AID F04F52434845535441 — Android
     *      routes any ISO-DEP SELECT to it automatically while this app is foreground
     *   5. Consumer wallet reads the payload, calls POST /consumers/pay/{merchantId}
     *      with merchantHceToken — STK Push fires to consumer's phone
     */
    fun presentToCustomerViaNfc() {
        if (enteredAmountCents <= 0) {
            showError("Enter an amount before presenting to customer")
            return
        }
        lifecycleScope.launch {
            runCatching {
                OrchestrateApiClient.current.issueMerchantHceToken(enteredAmountCents)
            }.onSuccess { resp ->
                MerchantHceSession.activate(
                    MerchantHceSession.Session(
                        token        = resp.token,
                        merchantId   = SessionManager.getMerchantId() ?: "",
                        merchantName = resp.merchantName,
                        amountCents  = resp.amountCents,
                        expiresAt    = resp.expiresAt,
                    )
                )
                showInfo("Hold this phone to customer's wallet — waiting for tap (${resp.expiresAt / 1000}s)")
            }.onFailure { e ->
                showError("Could not activate NFC payment request: ${e.message}")
            }
        }
    }

    /**
     * Launches the QR scanner to read a consumer's wallet QR code.
     * Scenario 9: consumer shows a QR from their wallet; merchant scans it here.
     * Opens ConsumerQrScannerActivity which decodes the token and returns it via
     * Activity Result; this method then fires the payment with that token.
     */
    fun scanConsumerQrCode() {
        if (enteredAmountCents <= 0) {
            showError("Enter an amount before scanning customer QR code")
            return
        }
        val intent = android.content.Intent(this,
            com.orchestratepay.ui.ConsumerQrScannerActivity::class.java)
        intent.putExtra("amountCents", enteredAmountCents)
        startActivityForResult(intent, REQ_CONSUMER_QR_SCAN)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_CONSUMER_QR_SCAN && resultCode == RESULT_OK) {
            val token = data?.getStringExtra("consumerQrToken") ?: return
            val intent = PaymentIntent(
                source     = PaymentSource.QR_CODE,
                merchantId = SessionManager.getMerchantId() ?: "",
            )
            showState(ScreenState.PROCESSING)
            orchestrator.processConsumerQr(
                merchantId     = SessionManager.getMerchantId() ?: "",
                amountCents    = enteredAmountCents,
                consumerQrToken = token,
                onStkSent      = { showInfo("M-Pesa prompt sent — waiting for customer PIN") },
                onResult       = ::handlePaymentResult,
            )
        }
    }

    companion object {
        private const val REQ_CONSUMER_QR_SCAN = 1001
    }

    /**
     * Prints a Z-Report for today (or a given date).
     * Triggered by a "Print Z-Report" button in the merchant menu.
     *
     * Fetches the daily summary from the backend and prints it via the Sunmi thermal
     * printer. If the fetch fails, shows a retry message — does not crash.
     */
    fun printZReport(date: String? = null) {
        lifecycleScope.launchWhenResumed {
            val report = OrchestrateApiClient.current.getZReport(date)
            if (report == null) {
                showInfo("Could not load Z-Report — check connection and try again")
                return@launchWhenResumed
            }
            when (val result = printer.printZReport(report)) {
                is PrintResult.Success -> showInfo("Z-Report printed")
                is PrintResult.Failed  -> showInfo("Z-Report print failed: ${result.message}")
            }
            auditLog.record(
                AuditEvent.RECEIPT_PRINT_STARTED,
                "z-report date=${report.date} confirmed=${report.transactions.confirmed.count}"
            )
        }
    }

    private fun formatAmount(cents: Long): String = "KSh ${"%.2f".format(cents / 100.0)}"
}

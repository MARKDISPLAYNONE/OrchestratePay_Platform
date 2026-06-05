package com.orchestratepay.consumer.ui

import android.app.PendingIntent
import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.nfc.MerchantHceReader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.security.SecureRandom

/**
 * MerchantHcePayActivity — handles Scenario 5.
 *
 * Consumer opens this screen, taps their phone to the merchant's phone.
 * MerchantHceReader reads the merchant's HCE payload, extracts the payment
 * request (merchantId, amount), and the consumer confirms to pay.
 *
 * Entry points:
 *   - "Tap to Merchant's Phone" button in TapToPayFragment
 *   - ACTION_TECH_DISCOVERED NFC intent (if registered in manifest with IsoDep filter)
 *
 * Flow:
 *   Waiting state → consumer taps phone to merchant's phone →
 *   NFC ISO-DEP read → show confirmation dialog (amount + merchant name) →
 *   consumer taps Confirm → POST /consumers/pay/{merchantId} →
 *   poll status → show result
 */
class MerchantHcePayActivity : AppCompatActivity() {

    private var nfcAdapter: NfcAdapter? = null
    private var pendingRequest: MerchantHceReader.MerchantPaymentRequest? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_merchant_hce_pay)

        if (ConsumerSessionManager.getToken() == null) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish(); return
        }

        nfcAdapter = NfcAdapter.getDefaultAdapter(this)
        if (nfcAdapter == null) {
            Toast.makeText(this, "NFC not available on this device", Toast.LENGTH_LONG).show()
            finish(); return
        }

        findViewById<TextView>(R.id.tv_instruction).text =
            "Hold this phone to the merchant's phone to read the payment request."
    }

    override fun onResume() {
        super.onResume()
        val pending = PendingIntent.getActivity(
            this, 0,
            Intent(this, MerchantHcePayActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // Listen for ISO-DEP (HCE) tags — not just NDEF
        val techFilter = arrayOf(arrayOf(android.nfc.tech.IsoDep::class.java.name))
        nfcAdapter?.enableForegroundDispatch(this, pending, null, techFilter)
    }

    override fun onPause() {
        super.onPause()
        nfcAdapter?.disableForegroundDispatch(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action != NfcAdapter.ACTION_TECH_DISCOVERED) return
        val tag: Tag? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(NfcAdapter.EXTRA_TAG)
        }
        tag?.let { readMerchantHce(it) }
    }

    // ── NFC read ──────────────────────────────────────────────────────────────

    private fun readMerchantHce(tag: Tag) {
        lifecycleScope.launch(Dispatchers.IO) {
            val request = runCatching { MerchantHceReader.read(tag) }.getOrNull()
            withContext(Dispatchers.Main) {
                if (request == null) {
                    Toast.makeText(this@MerchantHcePayActivity,
                        "Could not read payment request — ask merchant to re-activate",
                        Toast.LENGTH_LONG).show()
                } else {
                    showConfirmation(request)
                }
            }
        }
    }

    // ── Confirmation UI ───────────────────────────────────────────────────────

    private fun showConfirmation(request: MerchantHceReader.MerchantPaymentRequest) {
        pendingRequest = request
        val amountKsh = "%.2f".format(request.amountCents / 100.0)

        val tvInstruction = findViewById<TextView>(R.id.tv_instruction)
        val tvAmount      = findViewById<TextView>(R.id.tv_amount)
        val btnConfirm    = findViewById<Button>(R.id.btn_confirm)
        val btnCancel     = findViewById<Button>(R.id.btn_cancel)

        tvInstruction.text = "Payment request from ${request.merchantName}"
        tvAmount.text      = "KSh $amountKsh"
        tvAmount.visibility    = View.VISIBLE
        btnConfirm.visibility  = View.VISIBLE
        btnCancel.visibility   = View.VISIBLE

        btnConfirm.setOnClickListener { initiatePayment(request) }
        btnCancel.setOnClickListener  { finish() }
    }

    // ── Payment ───────────────────────────────────────────────────────────────

    private fun initiatePayment(request: MerchantHceReader.MerchantPaymentRequest) {
        val progressBar = findViewById<ProgressBar>(R.id.progress_bar)
        val tvStatus    = findViewById<TextView>(R.id.tv_status)
        val btnConfirm  = findViewById<Button>(R.id.btn_confirm)
        val btnCancel   = findViewById<Button>(R.id.btn_cancel)

        btnConfirm.isEnabled  = false
        btnCancel.isEnabled   = false
        progressBar.visibility = View.VISIBLE
        tvStatus.text          = "Sending payment request…"
        tvStatus.visibility    = View.VISIBLE

        val idempotencyKey = buildIdempotencyKey()

        lifecycleScope.launch {
            runCatching {
                ConsumerApiClient.payMerchantViaHce(
                    merchantId       = request.merchantId,
                    amountCents      = request.amountCents.toInt(),
                    idempotencyKey   = idempotencyKey,
                    timestamp        = System.currentTimeMillis(),
                    merchantHceToken = request.token,
                )
            }.onSuccess { resp ->
                tvStatus.text = "Check your phone for M-Pesa PIN prompt…"
                pollTransactionStatus(resp.transactionId, progressBar, tvStatus)
            }.onFailure { e ->
                progressBar.visibility = View.GONE
                tvStatus.text = "Payment failed: ${e.message}"
                btnConfirm.isEnabled = true
                btnCancel.isEnabled  = true
            }
        }
    }

    private fun pollTransactionStatus(
        txnId: String,
        progressBar: ProgressBar,
        tvStatus: TextView
    ) {
        var elapsed = 0
        val timeout = 90

        val timer = object : android.os.CountDownTimer(timeout * 1_000L, 3_000L) {
            override fun onTick(ms: Long) {
                elapsed += 3
                tvStatus.text = "Waiting for M-Pesa… (${timeout - elapsed}s)"
                lifecycleScope.launch {
                    runCatching { ConsumerApiClient.getTransactionStatus(txnId) }
                        .onSuccess { status ->
                            when (status.status) {
                                "CONFIRMED" -> {
                                    cancel()
                                    progressBar.visibility = View.GONE
                                    val amountKsh = "%.2f".format((status.amountCents ?: 0) / 100.0)
                                    tvStatus.text = "✓ KSh $amountKsh paid\nM-Pesa ref: ${status.mpesaReceipt ?: ""}"
                                    lifecycleScope.launch { delay(3_000); finish() }
                                }
                                "DECLINED", "FAILED" -> {
                                    cancel()
                                    progressBar.visibility = View.GONE
                                    tvStatus.text = "Payment ${status.status.lowercase()} — please try again"
                                }
                            }
                        }
                }
            }
            override fun onFinish() {
                progressBar.visibility = View.GONE
                tvStatus.text = "Timed out — check your transaction history"
            }
        }
        timer.start()
    }

    private fun buildIdempotencyKey(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

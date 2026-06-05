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
import com.orchestratepay.consumer.nfc.ConsumerP2PReader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.security.SecureRandom

/**
 * P2PPayActivity — Scenarios 6 & 7 (payer side, NFC tap).
 *
 * Payer consumer opens this screen and taps their phone to the payee's phone.
 * ConsumerP2PReader reads the P2P_REQUEST payload from the payee's ConsumerHceService.
 * After reading, the payer sees the payee name + amount and taps Confirm to pay.
 *
 * Entry points:
 *   - "Tap to pay friend" button in TapToPayFragment
 *   - ACTION_TECH_DISCOVERED NFC intent (IsoDep filter in manifest)
 *
 * Flow:
 *   Waiting → payer taps → NFC read → show confirmation → Confirm →
 *   POST /consumers/p2p-pay source=P2P_NFC → poll status → show result
 */
class P2PPayActivity : AppCompatActivity() {

    private var nfcAdapter: NfcAdapter? = null
    private var pendingP2pRequest: ConsumerP2PReader.P2PPaymentRequest? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_p2p_pay)

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
            "Hold your phone to your friend's phone to read the payment request."

        // "Scan QR instead" button for Scenarios 10/11
        findViewById<Button>(R.id.btn_scan_qr).setOnClickListener {
            startActivity(Intent(this, P2PQrScannerActivity::class.java))
        }
    }

    override fun onResume() {
        super.onResume()
        val pending = PendingIntent.getActivity(
            this, 0,
            Intent(this, P2PPayActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
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
        tag?.let { readP2PRequest(it) }
    }

    // ── NFC read ──────────────────────────────────────────────────────────────

    private fun readP2PRequest(tag: Tag) {
        lifecycleScope.launch(Dispatchers.IO) {
            val request = runCatching { ConsumerP2PReader.read(tag) }.getOrNull()
            withContext(Dispatchers.Main) {
                if (request == null) {
                    Toast.makeText(this@P2PPayActivity,
                        "Could not read payment request — ask friend to re-activate",
                        Toast.LENGTH_LONG).show()
                } else {
                    showConfirmation(request)
                }
            }
        }
    }

    // ── Confirmation UI ───────────────────────────────────────────────────────

    private fun showConfirmation(request: ConsumerP2PReader.P2PPaymentRequest) {
        pendingP2pRequest = request
        val amountCents = request.amountCents

        val tvInstruction = findViewById<TextView>(R.id.tv_instruction)
        val tvAmount      = findViewById<TextView>(R.id.tv_amount)
        val etAmount      = findViewById<android.widget.EditText>(R.id.et_amount)
        val btnConfirm    = findViewById<Button>(R.id.btn_confirm)
        val btnCancel     = findViewById<Button>(R.id.btn_cancel)
        val btnScanQr     = findViewById<Button>(R.id.btn_scan_qr)

        btnScanQr.visibility = View.GONE

        val payeeName = request.displayName ?: "Friend"
        tvInstruction.text = "Pay $payeeName"

        if (amountCents != null) {
            // Payee preset the amount — show it, no editing
            tvAmount.text       = "KSh ${"%.2f".format(amountCents / 100.0)}"
            tvAmount.visibility = View.VISIBLE
            etAmount.visibility = View.GONE
            btnConfirm.setOnClickListener { initiateP2PPayment(request, amountCents) }
        } else {
            // Payer enters amount
            tvAmount.visibility = View.GONE
            etAmount.visibility = View.VISIBLE
            etAmount.hint       = "Amount (KSh)"
            btnConfirm.setOnClickListener {
                val ksh = etAmount.text.toString().toDoubleOrNull()
                if (ksh == null || ksh < 1.0) {
                    etAmount.error = "Enter a valid amount"
                    return@setOnClickListener
                }
                initiateP2PPayment(request, (ksh * 100).toLong())
            }
        }

        btnConfirm.visibility = View.VISIBLE
        btnCancel.visibility  = View.VISIBLE
        btnCancel.setOnClickListener { finish() }
    }

    // ── Payment ───────────────────────────────────────────────────────────────

    private fun initiateP2PPayment(
        request:     ConsumerP2PReader.P2PPaymentRequest,
        amountCents: Long
    ) {
        val progress   = findViewById<ProgressBar>(R.id.progress_bar)
        val tvStatus   = findViewById<TextView>(R.id.tv_status)
        val btnConfirm = findViewById<Button>(R.id.btn_confirm)
        val btnCancel  = findViewById<Button>(R.id.btn_cancel)

        btnConfirm.isEnabled   = false
        btnCancel.isEnabled    = false
        progress.visibility    = View.VISIBLE
        tvStatus.text          = "Sending payment request…"
        tvStatus.visibility    = View.VISIBLE

        val idempotencyKey = buildIdempotencyKey()

        lifecycleScope.launch {
            runCatching {
                ConsumerApiClient.p2pPay(
                    p2pToken        = request.p2pToken,
                    payeeConsumerId = null,
                    amountCents     = amountCents.toInt(),
                    idempotencyKey  = idempotencyKey,
                    timestamp       = System.currentTimeMillis(),
                    source          = "P2P_NFC",
                )
            }.onSuccess { resp ->
                tvStatus.text = "Check your phone for M-Pesa PIN prompt…"
                pollStatus(resp.txnId, progress, tvStatus)
            }.onFailure { e ->
                progress.visibility  = View.GONE
                tvStatus.text        = "Payment failed: ${e.message}"
                btnConfirm.isEnabled = true
                btnCancel.isEnabled  = true
            }
        }
    }

    private fun pollStatus(txnId: String, progressBar: ProgressBar, tvStatus: TextView) {
        var elapsed = 0
        val timeout = 90

        object : android.os.CountDownTimer(timeout * 1_000L, 3_000L) {
            override fun onTick(ms: Long) {
                elapsed += 3
                tvStatus.text = "Waiting for M-Pesa… (${timeout - elapsed}s)"
                lifecycleScope.launch {
                    runCatching { ConsumerApiClient.getTransactionStatus(txnId) }
                        .onSuccess { s ->
                            when (s.status) {
                                "CONFIRMED" -> {
                                    cancel()
                                    progressBar.visibility = View.GONE
                                    val payee = pendingP2pRequest?.displayName ?: "friend"
                                    tvStatus.text = "✓ KSh ${"%.2f".format((s.amountCents ?: 0) / 100.0)} sent to $payee\nM-Pesa ref: ${s.mpesaRef ?: ""}"
                                    lifecycleScope.launch { delay(3_000); finish() }
                                }
                                "DECLINED", "FAILED" -> {
                                    cancel()
                                    progressBar.visibility = View.GONE
                                    tvStatus.text = "Payment ${s.status.lowercase()} — please try again"
                                }
                            }
                        }
                }
            }
            override fun onFinish() {
                progressBar.visibility = View.GONE
                tvStatus.text = "Timed out — check your transaction history"
            }
        }.start()
    }

    private fun buildIdempotencyKey(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

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
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.nfc.MerchantHceReader
import com.orchestratepay.consumer.ui.viewmodel.HcePaymentState
import com.orchestratepay.consumer.ui.viewmodel.MerchantHcePayViewModel
import com.orchestratepay.consumer.util.BiometricGate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MerchantHcePayActivity : AppCompatActivity() {

    private val viewModel: MerchantHcePayViewModel by viewModels()
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

        setupViewModel()
    }

    private fun setupViewModel() {
        val progressBar = findViewById<ProgressBar>(R.id.progress_bar)
        val tvStatus    = findViewById<TextView>(R.id.tv_status)
        val btnConfirm  = findViewById<Button>(R.id.btn_confirm)
        val btnCancel   = findViewById<Button>(R.id.btn_cancel)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    when (state) {
                        is HcePaymentState.Idle -> {
                            progressBar.visibility = View.GONE
                            tvStatus.visibility = View.GONE
                        }
                        is HcePaymentState.Processing -> {
                            btnConfirm.isEnabled = false
                            btnCancel.isEnabled = false
                            progressBar.visibility = View.VISIBLE
                            tvStatus.text = "Sending payment request…"
                            tvStatus.visibility = View.VISIBLE
                        }
                        is HcePaymentState.WaitingForMpesa -> {
                            tvStatus.text = "Waiting for M-Pesa… (${state.secondsRemaining}s)"
                        }
                        is HcePaymentState.Success -> {
                            progressBar.visibility = View.GONE
                            val amountKsh = "%.2f".format((state.status.amountCents ?: 0) / 100.0)
                            tvStatus.text = "✓ KSh $amountKsh paid successfully"
                            delay(3000)
                            finish()
                        }
                        is HcePaymentState.Error -> {
                            progressBar.visibility = View.GONE
                            tvStatus.text = state.message
                            btnConfirm.isEnabled = state.canRetry
                            btnCancel.isEnabled = true
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        val pending = PendingIntent.getActivity(
            this, 0,
            Intent(this, MerchantHcePayActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
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
        tag?.let { readMerchantHce(it) }
    }

    private fun readMerchantHce(tag: Tag) {
        lifecycleScope.launch(Dispatchers.IO) {
            val request = runCatching { MerchantHceReader.read(tag) }.getOrNull()
            withContext(Dispatchers.Main) {
                if (request == null) {
                    Toast.makeText(this@MerchantHcePayActivity,
                        "Could not read payment request",
                        Toast.LENGTH_LONG).show()
                } else {
                    showConfirmation(request)
                }
            }
        }
    }

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

        btnConfirm.setOnClickListener { attemptPayment(request) }
        btnCancel.setOnClickListener  { finish() }
    }

    private fun attemptPayment(request: MerchantHceReader.MerchantPaymentRequest) {
        if (request.amountCents > 500000 && BiometricGate.isAvailable(this)) {
            BiometricGate.prompt(this,
                subtitle = "Confirm KSh ${"%.2f".format(request.amountCents/100.0)} payment to ${request.merchantName}",
                onSuccess = { viewModel.initiatePayment(request.merchantId, request.amountCents.toInt(), request.token) },
                onFailure = { msg -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show() },
                onCancel = {}
            )
        } else {
            viewModel.initiatePayment(request.merchantId, request.amountCents.toInt(), request.token)
        }
    }
}

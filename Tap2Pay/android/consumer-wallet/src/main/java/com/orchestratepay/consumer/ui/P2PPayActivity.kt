package com.orchestratepay.consumer.ui

import android.app.PendingIntent
import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
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
import com.orchestratepay.consumer.nfc.ConsumerP2PReader
import com.orchestratepay.consumer.ui.viewmodel.P2pPayState
import com.orchestratepay.consumer.ui.viewmodel.P2PSendViewModel
import com.orchestratepay.consumer.util.BiometricGate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class P2PPayActivity : AppCompatActivity() {

    private val viewModel: P2PSendViewModel by viewModels()
    private var nfcAdapter: NfcAdapter? = null
    private var pendingP2pRequest: ConsumerP2PReader.P2PPaymentRequest? = null
    private var sentAmountCents: Int = 0

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

        findViewById<Button>(R.id.btn_scan_qr).setOnClickListener {
            startActivity(Intent(this, P2PQrScannerActivity::class.java))
        }

        setupViewModel()
    }

    private fun setupViewModel() {
        val progress   = findViewById<ProgressBar>(R.id.progress_bar)
        val tvStatus   = findViewById<TextView>(R.id.tv_status)
        val btnConfirm = findViewById<Button>(R.id.btn_confirm)
        val btnCancel  = findViewById<Button>(R.id.btn_cancel)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    when (state) {
                        is P2pPayState.Idle -> {
                            progress.visibility = View.GONE
                            tvStatus.visibility = View.GONE
                        }
                        is P2pPayState.Processing -> {
                            progress.visibility = View.VISIBLE
                            tvStatus.text = "Sending payment request…"
                            tvStatus.visibility = View.VISIBLE
                            btnConfirm.isEnabled = false
                            btnCancel.isEnabled = false
                        }
                        is P2pPayState.Success -> {
                            progress.visibility = View.GONE
                            val amountKsh = "%.2f".format(sentAmountCents / 100.0)
                            tvStatus.text = "✓ KSh $amountKsh sent successfully"
                            delay(3000)
                            finish()
                        }
                        is P2pPayState.Error -> {
                            progress.visibility = View.GONE
                            tvStatus.text = state.message
                            btnConfirm.isEnabled = true
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

    private fun readP2PRequest(tag: Tag) {
        lifecycleScope.launch(Dispatchers.IO) {
            val request = runCatching { ConsumerP2PReader.read(tag) }.getOrNull()
            withContext(Dispatchers.Main) {
                if (request == null) {
                    Toast.makeText(this@P2PPayActivity,
                        "Could not read payment request",
                        Toast.LENGTH_LONG).show()
                } else {
                    showConfirmation(request)
                }
            }
        }
    }

    private fun showConfirmation(request: ConsumerP2PReader.P2PPaymentRequest) {
        pendingP2pRequest = request
        val tvInstruction = findViewById<TextView>(R.id.tv_instruction)
        val tvAmount      = findViewById<TextView>(R.id.tv_amount)
        val etAmount      = findViewById<EditText>(R.id.et_amount)
        val btnConfirm    = findViewById<Button>(R.id.btn_confirm)
        val btnCancel     = findViewById<Button>(R.id.btn_cancel)
        val tilAmount     = findViewById<View>(R.id.til_amount)

        tvInstruction.text = "Pay ${request.displayName ?: "Friend"}"
        
        if (request.amountCents != null) {
            val amountInt = request.amountCents.toInt()
            tvAmount.text = "KSh ${"%.2f".format(amountInt / 100.0)}"
            tvAmount.visibility = View.VISIBLE
            tilAmount.visibility = View.GONE
            btnConfirm.setOnClickListener { attemptPayment(amountInt) }
        } else {
            tvAmount.visibility = View.GONE
            tilAmount.visibility = View.VISIBLE
            btnConfirm.setOnClickListener {
                val ksh = etAmount.text.toString().toDoubleOrNull()
                if (ksh == null || ksh < 1.0) {
                    etAmount.error = "Enter a valid amount"
                    return@setOnClickListener
                }
                attemptPayment((ksh * 100).toLong().toInt())
            }
        }

        btnConfirm.visibility = View.VISIBLE
        btnCancel.visibility  = View.VISIBLE
        btnCancel.setOnClickListener { finish() }
    }

    private fun attemptPayment(amountCents: Int) {
        val request = pendingP2pRequest ?: return
        sentAmountCents = amountCents
        
        // Security: Biometric for high value
        if (amountCents > 500000 && BiometricGate.isAvailable(this)) {
            BiometricGate.prompt(this,
                subtitle = "Confirm KSh ${"%.2f".format(amountCents/100.0)} P2P payment",
                onSuccess = { viewModel.p2pPay(request.p2pToken, null, amountCents, "P2P_NFC") },
                onFailure = { msg -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show() },
                onCancel = {}
            )
        } else {
            viewModel.p2pPay(request.p2pToken, null, amountCents, "P2P_NFC")
        }
    }
}

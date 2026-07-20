package com.orchestratepay.consumer.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.textfield.TextInputLayout
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.db.ConsumerSessionManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * P2PQrScannerActivity — Scenarios 10 & 11 (payer side, QR scan).
 *
 * Payer consumer scans the QR code shown on the payee's P2PSendActivity.
 * The QR encodes the p2pToken UUID.  After scanning, the user confirms the payee
 * name + amount and initiates payment via POST /consumers/p2p-pay source=P2P_QR.
 *
 * After a successful scan the camera stops and a confirmation form is shown.
 * If the payee preset an amount the payer sees it read-only; otherwise they enter it.
 *
 * Opened from P2PPayActivity ("Scan QR instead" button) or directly from the wallet home.
 */
class P2PQrScannerActivity : AppCompatActivity() {

    private lateinit var cameraExecutor: ExecutorService
    private var tokenFound = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_p2p_qr_scanner)

        if (ConsumerSessionManager.getToken() == null) {
            startActivity(android.content.Intent(this, LoginActivity::class.java))
            finish(); return
        }

        cameraExecutor = Executors.newSingleThreadExecutor()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            ActivityCompat.requestPermissions(this,
                arrayOf(Manifest.permission.CAMERA), REQ_CAMERA_PERMISSION)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_CAMERA_PERMISSION &&
            grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            Toast.makeText(this, "Camera permission required", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun startCamera() {
        val previewView = findViewById<PreviewView>(R.id.preview_view)
        val cameraFuture = ProcessCameraProvider.getInstance(this)

        cameraFuture.addListener({
            val cameraProvider = cameraFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            val scanner = BarcodeScanning.getClient()
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { ia ->
                    ia.setAnalyzer(cameraExecutor) { imageProxy ->
                        if (tokenFound) { imageProxy.close(); return@setAnalyzer }

                        val mediaImage = imageProxy.image
                        if (mediaImage != null) {
                            val image = InputImage.fromMediaImage(
                                mediaImage, imageProxy.imageInfo.rotationDegrees)
                            scanner.process(image)
                                .addOnSuccessListener { barcodes ->
                                    for (bc in barcodes) {
                                        if (bc.format == Barcode.FORMAT_QR_CODE) {
                                            val raw = bc.rawValue ?: continue
                                            if (isValidP2PToken(raw)) {
                                                tokenFound = true
                                                runOnUiThread { onTokenScanned(raw) }
                                                break
                                            }
                                        }
                                    }
                                }
                                .addOnCompleteListener { imageProxy.close() }
                        } else {
                            imageProxy.close()
                        }
                    }
                }

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (e: Exception) {
                Toast.makeText(this, "Camera error: ${e.message}", Toast.LENGTH_LONG).show()
                finish()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    // P2P tokens are UUIDs (same format as QR tokens and merchant HCE tokens)
    private fun isValidP2PToken(value: String): Boolean =
        try { UUID.fromString(value); true } catch (_: Exception) { false }

    // ── After scan: show confirmation form ────────────────────────────────────

    private fun onTokenScanned(token: String) {
        // Hide camera, show confirmation UI
        findViewById<PreviewView>(R.id.preview_view).visibility = View.GONE
        findViewById<TextView>(R.id.tv_instruction).text = "Confirming payment…"

        lifecycleScope.launch {
            // We don't know the payee name / amount until we look it up server-side
            // after the token is consumed — show a generic confirmation + amount entry
            // The actual payee name will come back from the p2p-pay response or
            // we resolve it in the token. For now: prompt user to enter amount if needed.
            showPayConfirmation(token)
        }
    }

    private fun showPayConfirmation(token: String) {
        val tvInstruction = findViewById<TextView>(R.id.tv_instruction)
        val tilAmount     = findViewById<TextInputLayout>(R.id.til_amount)
        val etAmount      = findViewById<EditText>(R.id.et_amount)
        val btnConfirm    = findViewById<Button>(R.id.btn_confirm)
        val btnCancel     = findViewById<Button>(R.id.btn_cancel)

        tvInstruction.text = "Enter amount to send (or leave blank if preset)"
        tilAmount.visibility  = View.VISIBLE
        etAmount.visibility   = View.VISIBLE
        btnConfirm.visibility = View.VISIBLE
        btnCancel.visibility  = View.VISIBLE

        btnCancel.setOnClickListener { finish() }
        btnConfirm.setOnClickListener {
            val amountText = etAmount.text.toString().trim()
            val ksh = amountText.toDoubleOrNull()
            if (ksh == null || ksh < 1.0) {
                etAmount.error = "Enter a valid amount (KSh)"
                return@setOnClickListener
            }
            initiateP2QrPayment(token, (ksh * 100).toInt())
        }
    }

    // ── Payment ───────────────────────────────────────────────────────────────

    private fun initiateP2QrPayment(token: String, amountCents: Int) {
        val progress   = findViewById<ProgressBar>(R.id.progress_bar)
        val tvStatus   = findViewById<TextView>(R.id.tv_status)
        val btnConfirm = findViewById<Button>(R.id.btn_confirm)
        val btnCancel  = findViewById<Button>(R.id.btn_cancel)
        val etAmount   = findViewById<EditText>(R.id.et_amount)

        btnConfirm.isEnabled  = false
        btnCancel.isEnabled   = false
        etAmount.isEnabled    = false
        progress.visibility   = View.VISIBLE
        tvStatus.text         = "Sending payment request…"
        tvStatus.visibility   = View.VISIBLE

        val idempotencyKey = buildIdempotencyKey()

        lifecycleScope.launch {
            runCatching {
                ConsumerApiClient.p2pPay(
                    p2pToken        = token,
                    payeeConsumerId = null,
                    amountCents     = amountCents,
                    idempotencyKey  = idempotencyKey,
                    timestamp       = System.currentTimeMillis(),
                    source          = "P2P_QR",
                )
            }.onSuccess { resp ->
                tvStatus.text = "Check your phone for M-Pesa PIN prompt…"
                pollStatus(resp.txnId, progress, tvStatus)
            }.onFailure { e ->
                progress.visibility  = View.GONE
                tvStatus.text        = "Payment failed: ${e.message}"
                btnConfirm.isEnabled = true
                btnCancel.isEnabled  = true
                etAmount.isEnabled   = true
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
                                    tvStatus.text = "✓ KSh ${"%.2f".format((s.amountCents ?: 0) / 100.0)} sent\nM-Pesa ref: ${s.mpesaRef ?: ""}"
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

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
    }

    private fun buildIdempotencyKey(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    companion object {
        private const val REQ_CAMERA_PERMISSION = 3001
    }
}

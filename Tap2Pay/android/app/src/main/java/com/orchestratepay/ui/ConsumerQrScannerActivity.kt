package com.orchestratepay.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
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
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.orchestratepay.R
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.UUID

/**
 * ConsumerQrScannerActivity — Scenario 9.
 *
 * Merchant scans the consumer's wallet QR code. The consumer's wallet app
 * generates a 90-second single-use UUID token via POST /consumers/qr-token,
 * encodes it as a QR bitmap, and shows it on screen.
 *
 * This activity opens the camera, decodes the QR, validates that the value
 * is a valid UUID (matches the token format), and returns it to
 * MerchantDashboardActivity via setResult().
 *
 * MerchantDashboardActivity.onActivityResult() then calls
 * PaymentOrchestrator.processConsumerQr() which POSTs to
 * /api/v1/transactions with { source: "CONSUMER_QR", consumerQrToken, amountCents }.
 *
 * Launch intent extras:
 *   amountCents (Long) — pre-entered amount, shown as confirmation context
 *
 * Result extras on RESULT_OK:
 *   consumerQrToken (String) — UUID token to include in transaction request
 */
class ConsumerQrScannerActivity : AppCompatActivity() {

    private lateinit var cameraExecutor: ExecutorService
    private var amountCents: Long = 0L
    private var tokenFound = false  // prevent double-processing on rapid scan

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_consumer_qr_scanner)

        amountCents = intent.getLongExtra("amountCents", 0L)

        val amountKsh = "%.2f".format(amountCents / 100.0)
        findViewById<TextView>(R.id.tv_instruction).text =
            "Scan customer's QR code — charging KSh $amountKsh"

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
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_CAMERA_PERMISSION &&
            grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            Toast.makeText(this, "Camera permission required to scan QR codes",
                Toast.LENGTH_LONG).show()
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
                .also { imageAnalysis ->
                    imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                        if (tokenFound) { imageProxy.close(); return@setAnalyzer }

                        val mediaImage = imageProxy.image
                        if (mediaImage != null) {
                            val image = InputImage.fromMediaImage(
                                mediaImage, imageProxy.imageInfo.rotationDegrees)
                            scanner.process(image)
                                .addOnSuccessListener { barcodes ->
                                    for (barcode in barcodes) {
                                        if (barcode.format == Barcode.FORMAT_QR_CODE) {
                                            val raw = barcode.rawValue ?: continue
                                            if (isValidConsumerToken(raw)) {
                                                tokenFound = true
                                                returnToken(raw)
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

    // Consumer QR tokens are UUIDs (36 chars, standard UUID format)
    private fun isValidConsumerToken(value: String): Boolean {
        return try { UUID.fromString(value); true } catch (_: Exception) { false }
    }

    private fun returnToken(token: String) {
        runOnUiThread {
            val result = Intent().putExtra("consumerQrToken", token)
            setResult(Activity.RESULT_OK, result)
            finish()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
    }

    companion object {
        private const val REQ_CAMERA_PERMISSION = 2001
    }
}

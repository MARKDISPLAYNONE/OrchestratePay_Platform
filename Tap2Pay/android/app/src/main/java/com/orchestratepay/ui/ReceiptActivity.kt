package com.orchestratepay.ui

import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.databinding.ActivityReceiptBinding
import com.orchestratepay.db.ReceiptCache
import com.orchestratepay.db.ReceiptRecord
import com.orchestratepay.printer.PrintResult
import com.orchestratepay.printer.SunmiPrinterManager
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.*

/**
 * ReceiptActivity — digital receipt screen with offline-safe reprint support.
 *
 * Two entry modes:
 *   1. IMMEDIATE (post-payment): all Intent extras populated by MerchantDashboardActivity.
 *      Saves the receipt to Room on first display, then shows it.
 *   2. REPRINT (from history): only "txn_id" is set. Loads from Room cache — no network.
 */
class ReceiptActivity : AppCompatActivity() {

    private lateinit var binding: ActivityReceiptBinding
    private val printer by lazy { SunmiPrinterManager(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityReceiptBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val txnId    = intent.getStringExtra("txn_id") ?: run { finish(); return }
        val mpesaRef = intent.getStringExtra("mpesa_ref")

        if (mpesaRef != null) {
            val record = ReceiptRecord(
                txnId          = txnId,
                mpesaRef       = mpesaRef,
                amountCents    = intent.getLongExtra("amount_cents", 0L),
                merchantName   = intent.getStringExtra("merchant_name") ?: "",
                consumerPhone  = intent.getStringExtra("consumer_phone") ?: "",
                kraPin         = intent.getStringExtra("kra_pin"),
                confirmedAtIso = DateTimeFormatter.ISO_INSTANT.format(Instant.now())
            )
            ReceiptCache.save(record)
            displayReceipt(record, isFirstPrint = true)
        } else {
            lifecycleScope.launch {
                val record = ReceiptCache.get(txnId)
                if (record != null) displayReceipt(record, isFirstPrint = false)
                else finish()
            }
        }
    }

    private fun displayReceipt(record: ReceiptRecord, isFirstPrint: Boolean) {
        val amountDisplay = "KSh ${"%.2f".format(record.amountCents / 100.0)}"
        val dateDisplay   = try {
            val instant = Instant.parse(record.confirmedAtIso)
            SimpleDateFormat("dd MMM yyyy HH:mm", Locale.getDefault()).format(Date.from(instant))
        } catch (e: Exception) {
            SimpleDateFormat("dd MMM yyyy HH:mm", Locale.getDefault()).format(Date())
        }

        binding.tvMerchantName.text = record.merchantName
        binding.tvAmount.text       = amountDisplay
        binding.tvMpesaRef.text     = record.mpesaRef
        binding.tvDate.text         = dateDisplay
        binding.tvPhone.text        = "Phone: ${record.consumerPhone}"

        if (record.kraPin != null) {
            binding.tvKra.text       = "KRA PIN: ${record.kraPin}"
            binding.tvKra.visibility = View.VISIBLE
        }

        binding.btnReprint.text = if (isFirstPrint)
            getString(com.orchestratepay.R.string.btn_reprint)
        else
            getString(com.orchestratepay.R.string.btn_reprint_again)

        binding.btnReprint.setOnClickListener {
            lifecycleScope.launch { doPrint(record) }
        }

        binding.btnDone.setOnClickListener { finish() }

        if (isFirstPrint) {
            lifecycleScope.launch { doPrint(record) }
        }
    }

    private suspend fun doPrint(record: ReceiptRecord) {
        val paymentResult = com.orchestratepay.payment.PaymentResult.Success(
            txnId         = record.txnId,
            mpesaRef      = record.mpesaRef,
            amountCents   = record.amountCents,
            merchantName  = record.merchantName,
            consumerPhone = record.consumerPhone
        )
        printer.printReceipt(paymentResult, record.kraPin)
        ReceiptCache.markPrinted(record.txnId)
    }
}

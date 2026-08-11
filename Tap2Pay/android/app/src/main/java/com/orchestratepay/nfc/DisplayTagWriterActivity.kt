package com.orchestratepay.nfc

import android.app.PendingIntent
import android.content.Intent
import android.nfc.tech.NdefFormatable
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.os.Build
import android.os.Bundle
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.R
import com.orchestratepay.db.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * DisplayTagWriterActivity — programs a blank NTAG215 sticker as a merchant
 * display tag. The sticker is placed on the merchant's counter so consumers
 * can tap it with their phone to open the OrchestratePay consumer wallet
 * (or the web payment page as fallback).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Tag types in OrchestratePay                                            │
 * │                                                                         │
 * │  Consumer identity tag  (written by TagWriterActivity)                  │
 * │    URI: orchestratepay://pay?mid={merchantId}&tid={tagId}&v=1&sign=...  │
 * │    → identifies a specific consumer; HMAC-signed; used as a "card"      │
 * │    → read by Sunmi terminal or SoftPOS                                  │
 * │                                                                         │
 * │  Merchant display tag  (written by THIS activity)                       │
 * │    URI: https://orchestratepay.co.ke/pay/{merchantId}                   │
 * │    → identifies the merchant; no consumer data; plain HTTPS URL         │
 * │    → read by consumer's phone (wallet app or browser)                   │
 * │    → consumer enters amount and pays via M-Pesa                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * HTTPS is used (not orchestratepay://) so that:
 *   - iPhones can open the tag and redirect to the web payment page
 *   - Android opens the consumer wallet app via App Links if installed,
 *     otherwise falls back to the browser
 *
 * No backend call is needed — the URL is constructed locally from the
 * merchant's own ID in SessionManager.
 *
 * After writing, makeReadOnly() locks the tag — prevents consumers from
 * accidentally overwriting it in the field.
 *
 * Launch from MerchantDashboardActivity settings menu:
 *   startActivity(Intent(this, DisplayTagWriterActivity::class.java))
 */
class DisplayTagWriterActivity : AppCompatActivity() {

    private var nfcAdapter: NfcAdapter? = null
    private lateinit var displayUrl: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_display_tag_writer)

        val merchantId = SessionManager.getMerchantId() ?: run {
            Toast.makeText(this, "Not logged in", Toast.LENGTH_SHORT).show()
            finish(); return
        }

        nfcAdapter = NfcAdapter.getDefaultAdapter(this)
        if (nfcAdapter == null) {
            Toast.makeText(this, "NFC not available on this device", Toast.LENGTH_LONG).show()
            finish(); return
        }

        // Standard HTTPS URL — opens wallet app via App Links, browser as fallback
        displayUrl = "https://orchestratepay.co.ke/pay/$merchantId"

        findViewById<TextView>(R.id.tv_instruction).text =
            "Hold a blank NTAG215 sticker to the back of this device to program it.\n\n" +
            "Customers will tap this sticker with their phone to pay you."

        findViewById<TextView>(R.id.tv_url_preview).text = displayUrl
    }

    override fun onResume() {
        super.onResume()
        val pending = PendingIntent.getActivity(
            this, 0,
            Intent(this, DisplayTagWriterActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        nfcAdapter?.enableForegroundDispatch(
            this, pending, null,
            arrayOf(arrayOf(Ndef::class.java.name), arrayOf(NdefFormatable::class.java.name))
        )
    }

    override fun onPause() {
        super.onPause()
        nfcAdapter?.disableForegroundDispatch(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action != NfcAdapter.ACTION_TECH_DISCOVERED &&
            intent.action != NfcAdapter.ACTION_NDEF_DISCOVERED) return

        val tag: Tag? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(NfcAdapter.EXTRA_TAG)
        }
        tag?.let { writeDisplayTag(it) }
    }

    private fun writeDisplayTag(tag: Tag) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val record  = NdefRecord.createUri(displayUrl)
                val message = NdefMessage(arrayOf(record))

                val ndef = Ndef.get(tag)
                if (ndef != null) {
                    ndef.connect()
                    if (!ndef.isWritable) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@DisplayTagWriterActivity,
                                "Tag is already locked — use a blank sticker", Toast.LENGTH_LONG).show()
                        }
                        ndef.close(); return@launch
                    }
                    if (ndef.maxSize < message.toByteArray().size) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@DisplayTagWriterActivity,
                                "Tag storage too small", Toast.LENGTH_LONG).show()
                        }
                        ndef.close(); return@launch
                    }
                    ndef.writeNdefMessage(message)
                    ndef.makeReadOnly()
                    ndef.close()
                } else {
                    // Factory-blank tag — format + write atomically
                    val formatable = NdefFormatable.get(tag) ?: run {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@DisplayTagWriterActivity,
                                "Unsupported tag type — use NTAG215", Toast.LENGTH_LONG).show()
                        }
                        return@launch
                    }
                    formatable.connect()
                    formatable.format(message)
                    formatable.close()

                    // format() does not lock — reconnect as Ndef to makeReadOnly
                    Ndef.get(tag)?.let { ndefa ->
                        ndefa.connect()
                        ndefa.makeReadOnly()
                        ndefa.close()
                    }
                }

                withContext(Dispatchers.Main) {
                    Toast.makeText(this@DisplayTagWriterActivity,
                        "Display tag programmed — tap with a customer's phone to test",
                        Toast.LENGTH_LONG).show()
                    setResult(RESULT_OK)
                    finish()
                }

            } catch (e: android.nfc.TagLostException) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@DisplayTagWriterActivity,
                        "Tag moved too soon — hold steady and try again", Toast.LENGTH_LONG).show()
                }
            } catch (e: IOException) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@DisplayTagWriterActivity,
                        "Write failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }
}

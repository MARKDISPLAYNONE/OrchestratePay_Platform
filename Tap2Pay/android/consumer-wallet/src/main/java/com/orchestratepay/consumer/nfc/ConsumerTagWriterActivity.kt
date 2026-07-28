package com.orchestratepay.consumer.nfc

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
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.db.ConsumerSessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * ConsumerTagWriterActivity — programs a blank NTAG215 sticker as a consumer
 * identity tag that merchants can tap to initiate a payment.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Consumer-written tag                                                    │
 * │    URI: https://orchestratepay.co.ke/c/{consumerId}                     │
 * │    → identifies this consumer; no signing needed (M-Pesa PIN is the     │
 * │      real authorization — sent to the consumer's registered phone)      │
 * │    → read by merchant Android app (NfcReaderManager), merchant web      │
 * │      dashboard (/merchant/scan), or any NFC reader                      │
 * │    → merchant looks up consumer name, enters amount, STK Push fires     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Usage: consumer places their sticker on a physical wallet/phone case.
 * Merchant taps it with the Sunmi terminal or their phone's browser.
 *
 * Security note: the consumerId is a UUID (not guessable). Even if someone
 * reads the UUID, they cannot charge the consumer without the consumer
 * physically receiving and approving the M-Pesa STK Push on their own phone.
 *
 * Launch from ProfileFragment "Program My Payment Tag" button.
 */
class ConsumerTagWriterActivity : AppCompatActivity() {

    private var nfcAdapter: NfcAdapter? = null
    private lateinit var tagUrl: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_consumer_tag_writer)

        val consumerId = ConsumerSessionManager.getConsumerId() ?: run {
            Toast.makeText(this, "Not logged in", Toast.LENGTH_SHORT).show()
            finish(); return
        }

        nfcAdapter = NfcAdapter.getDefaultAdapter(this)
        if (nfcAdapter == null) {
            Toast.makeText(this, "NFC not available on this device", Toast.LENGTH_LONG).show()
            finish(); return
        }

        tagUrl = "https://orchestratepay.co.ke/c/$consumerId"

        findViewById<TextView>(R.id.tv_instruction).text =
            "Hold a blank NTAG215 sticker to the back of this device to program it.\n\n" +
            "Merchants can tap your sticker to charge you — you will always receive " +
            "an M-Pesa PIN prompt before any payment goes through."

        findViewById<TextView>(R.id.tv_url_preview).text = tagUrl
    }

    override fun onResume() {
        super.onResume()
        val pending = PendingIntent.getActivity(
            this, 0,
            Intent(this, ConsumerTagWriterActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
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
        tag?.let { writeConsumerTag(it) }
    }

    private fun writeConsumerTag(tag: Tag) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val record  = NdefRecord.createUri(tagUrl)
                val message = NdefMessage(arrayOf(record))

                val ndef = Ndef.get(tag)
                if (ndef != null) {
                    ndef.connect()
                    if (!ndef.isWritable) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@ConsumerTagWriterActivity,
                                "Tag is already locked — use a blank sticker",
                                Toast.LENGTH_LONG).show()
                        }
                        ndef.close(); return@launch
                    }
                    if (ndef.maxSize < message.toByteArray().size) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@ConsumerTagWriterActivity,
                                "Tag storage too small", Toast.LENGTH_LONG).show()
                        }
                        ndef.close(); return@launch
                    }
                    ndef.writeNdefMessage(message)
                    ndef.makeReadOnly()
                    ndef.close()
                } else {
                    val formatable = NdefFormatable.get(tag) ?: run {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@ConsumerTagWriterActivity,
                                "Unsupported tag type — use NTAG215", Toast.LENGTH_LONG).show()
                        }
                        return@launch
                    }
                    formatable.connect()
                    formatable.format(message)
                    formatable.close()

                    Ndef.get(tag)?.let { ndefa ->
                        ndefa.connect()
                        ndefa.makeReadOnly()
                        ndefa.close()
                    }
                }

                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ConsumerTagWriterActivity,
                        "Payment tag programmed — merchants can now tap it to charge you",
                        Toast.LENGTH_LONG).show()
                    setResult(RESULT_OK)
                    finish()
                }

            } catch (e: android.nfc.TagLostException) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ConsumerTagWriterActivity,
                        "Tag moved too soon — hold steady and try again",
                        Toast.LENGTH_LONG).show()
                }
            } catch (e: IOException) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ConsumerTagWriterActivity,
                        "Write failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }
}

package com.orchestratepay.nfc

import android.app.PendingIntent
import android.content.Intent
import android.nfc.NdefFormatable
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.api.OrchestaApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * TagWriterActivity — programs a blank NTAG215 sticker with a signed
 * orchestratepay:// URI during merchant onboarding.
 *
 * IMPORTANT: This activity uses foreground dispatch, not enableReaderMode.
 * The two modes are mutually exclusive — never call NfcReaderManager.enable()
 * here. Failure to keep them separate causes Android to intercept the tag
 * for reading before this activity can see it.
 *
 * After programming, the tag is locked with makeReadOnly() — irreversible
 * and prevents consumer devices from overwriting the sticker in the field.
 *
 * Start this activity with:
 *   Intent(this, TagWriterActivity::class.java).apply {
 *       putExtra("merchantId", merchantId)
 *       putExtra("tagId", tagId)   // pre-allocated UUID from backend
 *   }
 */
class TagWriterActivity : AppCompatActivity() {

    private var nfcAdapter: NfcAdapter? = null
    private lateinit var merchantId: String
    private lateinit var tagId: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        merchantId = intent.getStringExtra("merchantId") ?: run {
            showError("merchantId not provided"); finish(); return
        }
        tagId = intent.getStringExtra("tagId") ?: run {
            showError("tagId not provided"); finish(); return
        }
        nfcAdapter = NfcAdapter.getDefaultAdapter(this)
        if (nfcAdapter == null) {
            showError("NFC not available on this device")
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        // Use foreground dispatch — NOT enableReaderMode — for writing
        val intent = Intent(this, TagWriterActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        // FLAG_IMMUTABLE: the PendingIntent is never modified at runtime
        val pending = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val techFilter = arrayOf(
            arrayOf(Ndef::class.java.name),
            arrayOf(NdefFormatable::class.java.name)
        )
        nfcAdapter?.enableForegroundDispatch(this, pending, null, techFilter)
    }

    override fun onPause() {
        super.onPause()
        nfcAdapter?.disableForegroundDispatch(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (NfcAdapter.ACTION_TECH_DISCOVERED != intent.action &&
            NfcAdapter.ACTION_NDEF_DISCOVERED != intent.action) return

        // API 33+ requires the two-arg form; suppress deprecation on the legacy branch
        val tag: Tag? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(NfcAdapter.EXTRA_TAG)
        }
        tag?.let { writeSignedTag(it) }
    }

    private fun writeSignedTag(tag: Tag) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                // Fetch the signed URI from the backend — never build it locally
                // Backend calls buildSignedUri(merchantId, tagId) → "orchestratepay://pay?...&sign=<16hex>"
                val uriString = OrchestaApiClient.current.getSignedTagUri(merchantId, tagId)
                    ?: run {
                        withContext(Dispatchers.Main) { showError("Could not fetch signed URI from backend") }
                        return@launch
                    }

                val record  = NdefRecord.createUri(uriString)
                val message = NdefMessage(arrayOf(record))

                val ndef = Ndef.get(tag)
                if (ndef != null) {
                    // Tag already formatted (most common case for pre-formatted NTAG215)
                    ndef.connect()
                    if (!ndef.isWritable) {
                        withContext(Dispatchers.Main) { showError("Tag is read-only — cannot reprogram") }
                        ndef.close(); return@launch
                    }
                    if (ndef.maxSize < message.toByteArray().size) {
                        withContext(Dispatchers.Main) { showError("Tag too small for this URI") }
                        ndef.close(); return@launch
                    }
                    ndef.writeNdefMessage(message)
                    ndef.makeReadOnly()
                    ndef.close()

                } else {
                    // Blank factory tag — format and write atomically, then lock
                    val formatable = NdefFormatable.get(tag)
                    if (formatable != null) {
                        formatable.connect()
                        formatable.format(message)  // format + write in one NDEF command
                        formatable.close()

                        // NdefFormatable.format() does NOT lock the tag.
                        // Reconnect as Ndef immediately to call makeReadOnly().
                        val ndefa = Ndef.get(tag)
                        if (ndefa != null) {
                            ndefa.connect()
                            ndefa.makeReadOnly()
                            ndefa.close()
                        }
                    } else {
                        withContext(Dispatchers.Main) { showError("Unsupported tag type") }
                        return@launch
                    }
                }

                withContext(Dispatchers.Main) {
                    Toast.makeText(this@TagWriterActivity, "Tag programmed — tap to verify", Toast.LENGTH_LONG).show()
                    setResult(RESULT_OK)
                    finish()
                }

            } catch (e: android.nfc.TagLostException) {
                withContext(Dispatchers.Main) { showError("Tag moved too soon — tap again") }
            } catch (e: IOException) {
                withContext(Dispatchers.Main) { showError("Write failed: ${e.message}") }
            }
        }
    }

    private fun showError(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }
}

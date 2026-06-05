package com.orchestratepay.nfccore

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.nfc.tech.IsoDep
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * NfcPaymentReader — shared NFC reader used by both the Tap2Pay terminal app
 * and the SoftPOS consumer app.
 *
 * Detects and dispatches two tag types:
 *   1. NDEF tags containing an orchestratepay:// URI  → NfcTagResult
 *   2. ISO-DEP tags responding to the OrchestratePay AID → HceResult
 *
 * The caller supplies onResult and onError lambdas. Both are invoked on the
 * main thread via [scope].
 *
 * Usage:
 *   val reader = NfcPaymentReader(activity, scope, ::onResult, ::onError)
 *   reader.enable()   // call in onResume
 *   reader.disable()  // call in onPause
 */
class NfcPaymentReader(
    private val activity: Activity,
    private val scope:    CoroutineScope,
    private val onResult: (NfcReadResult) -> Unit,
    private val onError:  (NfcReadError)  -> Unit,
) {
    private val nfcAdapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(activity)

    fun enable() {
        val adapter = nfcAdapter ?: run {
            onError(NfcReadError.NOT_SUPPORTED)
            return
        }
        adapter.enableReaderMode(
            activity,
            ::onTagDiscovered,
            NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or
            NfcAdapter.FLAG_READER_NFC_V or
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
            null
        )
    }

    fun disable() {
        nfcAdapter?.disableReaderMode(activity)
    }

    private fun onTagDiscovered(tag: Tag) {
        scope.launch(Dispatchers.IO) {
            val result = try {
                // Try ISO-DEP (HCE) first — higher priority than NDEF
                if (tag.techList.contains(IsoDep::class.java.name)) {
                    ApduProtocol.readHceTag(tag)
                } else {
                    NdefTagParser.parse(tag)
                }
            } catch (e: Exception) {
                NfcReadResult.Error(NfcReadError.READ_FAILED)
            }

            scope.launch(Dispatchers.Main) {
                when (result) {
                    is NfcReadResult.TagRead -> onResult(result)
                    is NfcReadResult.HceRead -> onResult(result)
                    is NfcReadResult.Error   -> onError(result.error)
                }
            }
        }
    }
}

sealed class NfcReadResult {
    /** An OrchestratePay NDEF sticker tag */
    data class TagRead(
        val merchantId: String,
        val tagId:      String,
        val rawUid:     String,
        val signature:  String,
    ) : NfcReadResult()

    /** An HCE token read via ISO-DEP APDU exchange */
    data class HceRead(
        val consumerPhone: String,
        val hceToken:      String,
        val hceExp:        Long,
        val rawUid:        String,
    ) : NfcReadResult()

    data class Error(val error: NfcReadError) : NfcReadResult()
}

enum class NfcReadError {
    NOT_SUPPORTED,
    READ_FAILED,
    UNRECOGNISED_TAG,
    PARSE_ERROR,
    SIGNATURE_INVALID,
    TOKEN_EXPIRED,
}

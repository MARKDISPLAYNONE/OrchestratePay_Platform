package com.orchestratepay.nfc

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.nfc.tech.Ndef
import android.net.Uri
import android.os.Bundle
import com.orchestratepay.db.SessionManager
import com.orchestratepay.payment.PaymentIntent
import com.orchestratepay.payment.PaymentSource
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException

/**
 * NfcReaderManager — Hardware abstraction layer for NFC.
 *
 * This class owns ALL NFC hardware interaction. It knows nothing about money.
 * Its only job is:
 *   1. Enable/disable the NFC reader when the app goes foreground/background
 *   2. Parse whatever tag is tapped
 *   3. Hand off a PaymentIntent to whoever called it
 *
 * The clean boundary here matters: PaymentOrchestrator never touches NfcAdapter,
 * and NfcReaderManager never touches retrofit or M-Pesa. This makes both
 * independently testable and auditable.
 *
 * @param activity  The activity that owns the NFC lifecycle
 * @param onIntent  Called on the MAIN thread when a valid tag is parsed
 * @param onError   Called on the MAIN thread when something goes wrong
 */
class NfcReaderManager(
    private val activity: Activity,
    private val onIntent: (PaymentIntent) -> Unit,
    private val onError: (NfcError) -> Unit
) : NfcAdapter.ReaderCallback {

    // NfcAdapter is the Android system entry point for all NFC operations.
    // It's null on devices without NFC hardware.
    private val nfcAdapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(activity)

    /**
     * Call from Activity.onResume() to start listening for NFC tags.
     *
     * enableReaderMode() is preferred over the older foreground dispatch system
     * because it gives us lower-level control:
     *   - We choose which tag technologies to accept (NFC-A, NFC-B covers 99% of cards)
     *   - FLAG_READER_SKIP_NDEF_CHECK speeds up detection by skipping the NDEF probe
     *     for tags we'll read ourselves (IsoDep bank cards don't use NDEF anyway)
     *   - Platform sounds and vibrations are suppressed — we handle UX ourselves
     */
    fun enable() {
        if (nfcAdapter == null) {
            onError(NfcError.NOT_SUPPORTED)
            return
        }

        val flags =
            NfcAdapter.FLAG_READER_NFC_A or         // MIFARE, NTAG, Visa payWave
            NfcAdapter.FLAG_READER_NFC_B or         // Some Mastercard, ID documents
            NfcAdapter.FLAG_READER_NFC_F or         // FeliCa (Kenyan transit future-proofing)
            NfcAdapter.FLAG_READER_NFC_V or         // ISO 15693 inventory tags
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK  // Don't pre-read NDEF — we do it ourselves

        // extras bundle: EXTRA_READER_PRESENCE_CHECK_DELAY controls how long
        // Android waits before deciding the tag moved away (ms). 250ms is snappy
        // but doesn't cause false "tag lost" errors during a tap.
        val extras = Bundle().apply {
            putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 250)
        }

        nfcAdapter.enableReaderMode(activity, this, flags, extras)
    }

    /**
     * Call from Activity.onPause() to stop listening.
     * Not calling this causes a crash when the activity is backgrounded.
     */
    fun disable() {
        nfcAdapter?.disableReaderMode(activity)
    }

    /**
     * Called by Android on a background thread when any NFC tag enters the RF field.
     * We dispatch to the right reader based on what technologies the tag supports.
     */
    override fun onTagDiscovered(tag: Tag) {
        try {
            val intent = when {
                // NDEF: OrchestratePay stickers (NTAG215) and general NFC tags
                Ndef.get(tag) != null -> readNdefTag(tag)

                // IsoDep: bank cards, transit cards, some IDs (ISO 14443-4)
                IsoDep.get(tag) != null -> readIsoDepTag(tag)

                else -> null
            }

            // Post result back to Main thread — UI can only be touched on Main
            activity.runOnUiThread {
                if (intent != null) onIntent(intent)
                else onError(NfcError.UNRECOGNISED_TAG)
            }
        } catch (e: IOException) {
            // Tag moved away during read, or RF noise
            activity.runOnUiThread { onError(NfcError.READ_FAILED) }
        } catch (e: Exception) {
            activity.runOnUiThread { onError(NfcError.PARSE_ERROR) }
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // NDEF reader — for OrchestratePay NFC stickers (NTAG215)
    // ────────────────────────────────────────────────────────────────────

    /**
     * Reads an NDEF-formatted tag and parses it as an OrchestratePay payment tag.
     *
     * Signed tag format (post-Phase 2):
     *   orchestratepay://pay?mid=MERCHANT_ID&tid=TAG_ID&v=1&sign=<16-hex>
     *
     * Legacy unsigned format (pre-Phase 2, still accepted with a warning):
     *   orchestratepay://pay?mid=MERCHANT_ID&tid=TAG_ID&v=1
     *
     * If a tag has a sign param and it fails verification, the tap is rejected
     * with SIGNATURE_INVALID — this blocks cloned/forged tags.
     * If no sign param is present, the tap is accepted (backward compatibility)
     * but logged as a warning.
     */
    private fun readNdefTag(tag: Tag): PaymentIntent? {
        val ndef = Ndef.get(tag) ?: return null

        ndef.connect()
        val message = ndef.ndefMessage   // null if blank tag
        ndef.close()

        if (message == null || message.records.isEmpty()) return null

        // The first record is always our URI record.
        // NdefRecord.payload for a URI record has a 1-byte prefix (URI identifier code)
        // followed by the URI string. We drop the prefix byte then parse.
        val record = message.records[0]
        val rawPayload = String(record.payload, Charsets.UTF_8)

        // URI identifier prefix byte. 0x04 = "https://", 0x00 = no prefix (full URI)
        // Our tags use 0x00 prefix since orchestratepay:// is not a standard scheme
        val uriString = if (rawPayload[0].code == 0) rawPayload.substring(1) else rawPayload

        val uri = Uri.parse(uriString)

        // Consumer-written identity tag: https://orchestratepay.co.ke/c/{consumerId}
        if (uri.scheme == "https" &&
            uri.host == "orchestratepay.co.ke" &&
            uri.path?.startsWith("/c/") == true) {
            val consumerId = uri.lastPathSegment ?: return null
            return PaymentIntent(
                source     = PaymentSource.CONSUMER_TAG,
                merchantId = SessionManager.getMerchantId() ?: "",
                consumerId = consumerId,
                rawUid     = tag.id.toHexString()
            )
        }

        // Validate it's actually an OrchestratePay consumer identity tag
        if (uri.scheme != "orchestratepay" || uri.host != "pay") return null

        val merchantId = uri.getQueryParameter("mid") ?: return null
        val tagId      = uri.getQueryParameter("tid") ?: return null
        val version    = uri.getQueryParameter("v")   ?: "1"
        val sign       = uri.getQueryParameter("sign")  // null on legacy unsigned tags

        if (version != "1") return null   // reject future tag versions we don't understand yet

        // ── Signature verification ──────────────────────────────────────
        if (sign != null) {
            // Tag has a signature — verify it using the cached merchant signing key.
            val signingKey = SessionManager.getNfcSigningKey()
            if (signingKey == null) {
                // Terminal has no signing key (not yet refreshed after upgrade).
                // Log the warning but allow the tap — don't break payments mid-shift.
                android.util.Log.w("NfcReaderManager",
                    "Signed tag tapped but no signing key cached — skipping verification")
            } else {
                val valid = NfcSignatureVerifier.verify(merchantId, tagId, sign, signingKey)
                if (!valid) {
                    // Signature is wrong — this is a forged or cloned-to-different-merchant tag.
                    activity.runOnUiThread { onError(NfcError.SIGNATURE_INVALID) }
                    return null
                }
            }
        } else {
            // Unsigned tag — accepted for backward compat but logged
            android.util.Log.w("NfcReaderManager",
                "Unsigned tag tapped mid=$merchantId — reprogram with sign param at next opportunity")
        }

        return PaymentIntent(
            source     = PaymentSource.NFC_TAG,
            merchantId = merchantId,
            tagId      = tagId,
            rawUid     = tag.id.toHexString()  // raw 4-7 byte UID for audit logging
        )
    }

    // ────────────────────────────────────────────────────────────────────
    // IsoDep reader — OrchestratePay Wallet HCE phones + bank card stub
    // ────────────────────────────────────────────────────────────────────

    /**
     * Reads an ISO 14443-4 device using APDU commands.
     *
     * Two cases handled here:
     *
     *   1. OrchestratePay Wallet phone (HCE_PHONE)
     *      SELECT our proprietary AID → GET DATA → receive JSON payload with
     *      (phone, token, exp) → CONFIRM (single-use — wallet clears session).
     *      Returns PaymentIntent with source=HCE_PHONE. No manual phone entry needed.
     *
     *   2. Bank card (Visa/Mastercard contactless)
     *      Our AID SELECT will fail (9000 not returned). We return null here.
     *      Accepting real bank cards requires PCI MPoC SCRA certification — not
     *      implemented. The merchant sees "unrecognised tag" and falls back to sticker.
     *
     * APDU PROTOCOL (proprietary — NOT EMV):
     *   POS → SELECT AID F04F52434845535441
     *   Phone → 90 00
     *   POS → 80 C0 00 00 00  (GET DATA)
     *   Phone → <JSON bytes> 90 00
     *   POS → 80 C1 00 00 00  (CONFIRM — single-use, wallet clears session)
     *   Phone → 90 00
     */
    private fun readIsoDepTag(tag: Tag): PaymentIntent? {
        val isoDep = IsoDep.get(tag) ?: return null
        isoDep.connect()
        isoDep.timeout = 5_000

        return try {
            // Step 1 — SELECT our proprietary AID
            // AID: F0 4F 52 43 48 45 53 54 41  ("F0ORCHESTAT" = 9 bytes)
            val aid = byteArrayOf(
                0xF0.toByte(), 0x4F, 0x52, 0x43, 0x48, 0x45, 0x53, 0x54, 0x41
            )
            val selectApdu = byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00,
                                         aid.size.toByte()) + aid + byteArrayOf(0x00)
            val selectResp = isoDep.transceive(selectApdu)

            if (!isSW_OK(selectResp)) {
                isoDep.close()
                return null  // Not our wallet — possibly a bank card
            }

            // Step 2 — GET DATA: wallet responds with signed JSON payload
            val getDataApdu = byteArrayOf(0x80.toByte(), 0x80.toByte(), 0x00, 0x00, 0x00)
            val dataResp    = isoDep.transceive(getDataApdu)

            if (!isSW_OK(dataResp)) {
                isoDep.close()
                return null  // Wallet responded to SELECT but has no active session
            }

            // Step 3 — Parse JSON (strip trailing SW1 SW2 bytes)
            val jsonBytes = dataResp.copyOf(dataResp.size - 2)
            val payload   = JSONObject(String(jsonBytes, Charsets.UTF_8))
            val phone     = payload.getString("phone")
            val token     = payload.getString("token")
            val exp       = payload.getLong("exp")

            // Step 4 — CONFIRM: tells wallet to clear the session (single-use)
            val confirmApdu = byteArrayOf(0x80.toByte(), 0x81.toByte(), 0x00, 0x00, 0x00)
            isoDep.transceive(confirmApdu)
            isoDep.close()

            // Client-side expiry guard — server will re-verify, but fail fast if obviously stale
            if (System.currentTimeMillis() > exp) {
                activity.runOnUiThread { onError(NfcError.TOKEN_EXPIRED) }
                return null
            }

            PaymentIntent(
                source        = PaymentSource.HCE_PHONE,
                merchantId    = SessionManager.getMerchantId() ?: "",
                consumerPhone = phone,
                hceToken      = token,
                hceExp        = exp,
                rawUid        = tag.id.toHexString()
            )

        } catch (e: JSONException) {
            try { isoDep.close() } catch (_: Exception) {}
            null  // Payload not valid JSON — treat as unrecognised
        } catch (e: IOException) {
            try { isoDep.close() } catch (_: Exception) {}
            throw e  // Rethrown — caught by onTagDiscovered as READ_FAILED
        }
    }

    // SW1=0x90, SW2=0x00 means success in ISO 7816-4
    private fun isSW_OK(resp: ByteArray): Boolean =
        resp.size >= 2 &&
        resp[resp.size - 2] == 0x90.toByte() &&
        resp[resp.size - 1] == 0x00.toByte()
}

/** Errors that the NFC layer can surface to the UI */
enum class NfcError {
    NOT_SUPPORTED,    // device has no NFC hardware
    READ_FAILED,      // tag moved away during read — ask user to tap again
    UNRECOGNISED_TAG, // not an OrchestratePay tag and not a supported card
    PARSE_ERROR,      // tag was read but content was malformed
    SIGNATURE_INVALID,// tag has a sign param that failed HMAC verification — possible forgery
    TOKEN_EXPIRED     // HCE session token has passed its 60-second TTL — customer must re-activate
}

/** Extension: converts a raw NFC UID byte array to a hex string for logging */
fun ByteArray.toHexString(): String = joinToString("") { "%02x".format(it) }

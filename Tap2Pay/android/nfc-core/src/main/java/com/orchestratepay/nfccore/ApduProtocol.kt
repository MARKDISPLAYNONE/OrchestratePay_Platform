package com.orchestratepay.nfccore

import android.nfc.Tag
import android.nfc.tech.IsoDep
import org.json.JSONObject

/**
 * ApduProtocol — ISO-DEP (HCE) APDU handshake.
 *
 * AID: F04F52434845535441 (OrchestratePay proprietary)
 *
 * Three-step protocol:
 *   1. SELECT AID       → card responds with 9000 (success)
 *   2. GET DATA (0x80)  → card responds with JSON payload + 9000
 *   3. CONFIRM (0x81)   → card responds with 9000 (session closed on HCE side)
 *
 * JSON payload (step 2):
 *   { "phone": "254XXXXXXXXX", "token": "<32hex>", "exp": <epoch_ms> }
 *
 * This class is called from [NfcPaymentReader] on a background thread.
 * Never call from the main thread — IsoDep I/O is blocking.
 */
object ApduProtocol {

    private val AID = byteArrayOf(
        0xF0.toByte(), 0x4F, 0x52, 0x43, 0x48, 0x45, 0x53, 0x54, 0x41
    )

    private val SELECT_APDU = byteArrayOf(
        0x00, 0xA4.toByte(), 0x04, 0x00,
        AID.size.toByte()
    ) + AID + byteArrayOf(0x00)

    private val GET_DATA_APDU  = byteArrayOf(0x80.toByte(), 0x80.toByte(), 0x00, 0x00, 0x00)
    private val CONFIRM_APDU   = byteArrayOf(0x80.toByte(), 0x81.toByte(), 0x00, 0x00)

    fun readHceTag(tag: Tag): NfcReadResult {
        val isoDep = IsoDep.get(tag) ?: return NfcReadResult.Error(NfcReadError.READ_FAILED)

        return try {
            isoDep.connect()
            isoDep.timeout = 5_000

            // Step 1: SELECT AID
            val selectResp = isoDep.transceive(SELECT_APDU)
            if (!isSuccess(selectResp)) return NfcReadResult.Error(NfcReadError.UNRECOGNISED_TAG)

            // Step 2: GET DATA
            val dataResp = isoDep.transceive(GET_DATA_APDU)
            if (!isSuccess(dataResp)) return NfcReadResult.Error(NfcReadError.READ_FAILED)

            val jsonBytes = dataResp.dropLast(2).toByteArray()
            val json      = JSONObject(String(jsonBytes))

            val phone = json.optString("phone")
            val token = json.optString("token")
            val exp   = json.optLong("exp", 0L)

            if (phone.isBlank() || token.isBlank() || exp == 0L) {
                return NfcReadResult.Error(NfcReadError.PARSE_ERROR)
            }

            if (System.currentTimeMillis() > exp) {
                return NfcReadResult.Error(NfcReadError.TOKEN_EXPIRED)
            }

            // Step 3: CONFIRM (tells the HCE service the read was successful)
            isoDep.transceive(CONFIRM_APDU)

            val rawUid = tag.id.joinToString("") { "%02x".format(it) }

            NfcReadResult.HceRead(
                consumerPhone = phone,
                hceToken      = token,
                hceExp        = exp,
                rawUid        = rawUid,
            )

        } catch (e: Exception) {
            NfcReadResult.Error(NfcReadError.READ_FAILED)
        } finally {
            try { isoDep.close() } catch (_: Exception) {}
        }
    }

    /** Returns true if the last 2 bytes of [response] are 0x90 0x00 (success SW). */
    private fun isSuccess(response: ByteArray): Boolean =
        response.size >= 2 &&
        response[response.size - 2] == 0x90.toByte() &&
        response[response.size - 1] == 0x00.toByte()
}

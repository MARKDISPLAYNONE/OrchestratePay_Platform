package com.orchestratepay.consumer.nfc

import android.nfc.Tag
import android.nfc.tech.IsoDep
import org.json.JSONObject
import java.io.IOException

/**
 * MerchantHceReader — reads a merchant phone's HCE payment request.
 *
 * Scenario 5: merchant's phone taps consumer's phone (consumer initiates).
 * The merchant activates HCE mode on their app (OrchestrateHceService emitting
 * a MERCHANT_REQUEST payload). The consumer brings their wallet phone to the
 * merchant's phone. This reader:
 *   1. Sends SELECT AID to the merchant's phone
 *   2. Sends GET DATA → receives {type, token, merchantId, merchantName, amountCents, exp}
 *   3. Sends CONFIRM → merchant's HCE session is cleared (single-use)
 *   4. Returns MerchantPaymentRequest for the UI to display
 *
 * Same AID as ConsumerHceService (F04F52434845535441). The "type" field
 * in the payload distinguishes a merchant request from a consumer payment token.
 * If the remote device is a consumer wallet (type = "CONSUMER_PAYMENT") this
 * reader returns null — that path is handled by SoftPosOrchestrator / NfcReaderManager.
 */
object MerchantHceReader {

    private val AID = byteArrayOf(
        0xF0.toByte(), 0x4F, 0x52, 0x43, 0x48, 0x45, 0x53, 0x54, 0x41
    )

    data class MerchantPaymentRequest(
        val token:        String,
        val merchantId:   String,
        val merchantName: String,
        val amountCents:  Long,
        val expiresAt:    Long,
    )

    /**
     * Attempts to read a merchant HCE payment request from [tag].
     *
     * @return the payment request, or null if the tag is not a merchant HCE device
     *         (e.g. it responded with a consumer payload, or did not respond to our AID)
     * @throws IOException if the tag moved away during the APDU exchange
     */
    @Throws(IOException::class)
    fun read(tag: Tag): MerchantPaymentRequest? {
        val isoDep = IsoDep.get(tag) ?: return null
        isoDep.connect()
        isoDep.timeout = 5_000

        return try {
            // Step 1: SELECT our proprietary AID
            val selectApdu = byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00,
                                         AID.size.toByte()) + AID + byteArrayOf(0x00)
            val selectResp = isoDep.transceive(selectApdu)
            if (!isSW_OK(selectResp)) { isoDep.close(); return null }

            // Step 2: GET DATA
            val getDataApdu = byteArrayOf(0x80.toByte(), 0xC0.toByte(), 0x00, 0x00, 0x00)
            val dataResp    = isoDep.transceive(getDataApdu)
            if (!isSW_OK(dataResp)) { isoDep.close(); return null }

            val jsonBytes = dataResp.copyOf(dataResp.size - 2)
            val payload   = JSONObject(String(jsonBytes, Charsets.UTF_8))

            // Distinguish merchant HCE from consumer HCE
            if (payload.optString("type") != "MERCHANT_REQUEST") {
                isoDep.close()
                return null  // consumer wallet — not our job here
            }

            val expiresAt = payload.getLong("exp")
            if (System.currentTimeMillis() > expiresAt) {
                isoDep.close()
                return null  // expired session — merchant must re-activate
            }

            // Step 3: CONFIRM — clears the merchant's HCE session (single-use)
            val confirmApdu = byteArrayOf(0x80.toByte(), 0xC1.toByte(), 0x00, 0x00, 0x00)
            isoDep.transceive(confirmApdu)
            isoDep.close()

            MerchantPaymentRequest(
                token        = payload.getString("token"),
                merchantId   = payload.getString("merchantId"),
                merchantName = payload.getString("merchantName"),
                amountCents  = payload.getLong("amountCents"),
                expiresAt    = expiresAt,
            )
        } catch (e: Exception) {
            try { isoDep.close() } catch (_: Exception) {}
            if (e is IOException) throw e
            null
        }
    }

    private fun isSW_OK(resp: ByteArray): Boolean =
        resp.size >= 2 &&
        resp[resp.size - 2] == 0x90.toByte() &&
        resp[resp.size - 1] == 0x00.toByte()
}

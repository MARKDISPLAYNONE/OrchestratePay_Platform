package com.orchestratepay.consumer.nfc

import android.nfc.Tag
import android.nfc.tech.IsoDep
import org.json.JSONObject
import java.io.IOException

/**
 * ConsumerP2PReader — reads a P2P payment request from another consumer's phone.
 *
 * Scenario 6/7: payer taps their phone to the payee's phone.
 * The payee's ConsumerHceService emits a P2P_REQUEST payload when P2PHceSession is active.
 *
 * Uses the same AID (F04F52434845535441) and APDU sequence as MerchantHceReader.
 * The "type" field in the payload distinguishes P2P from other HCE modes:
 *   - "P2P_REQUEST"     → this reader processes it
 *   - "MERCHANT_REQUEST"→ return null (handled by MerchantHceReader in merchant app)
 *   - "CONSUMER_PAYMENT"→ return null (payment token, not a P2P request)
 *
 * @throws IOException if the tag moved during the APDU exchange
 */
object ConsumerP2PReader {

    private val AID = byteArrayOf(
        0xF0.toByte(), 0x4F, 0x52, 0x43, 0x48, 0x45, 0x53, 0x54, 0x41
    )

    data class P2PPaymentRequest(
        val p2pToken:    String,
        val displayName: String?,
        val amountCents: Long?,
        val expiresAt:   Long,
    )

    @Throws(IOException::class)
    fun read(tag: Tag): P2PPaymentRequest? {
        val isoDep = IsoDep.get(tag) ?: return null
        isoDep.connect()
        isoDep.timeout = 5_000

        return try {
            // SELECT AID
            val selectApdu = byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00,
                                         AID.size.toByte()) + AID + byteArrayOf(0x00)
            val selectResp = isoDep.transceive(selectApdu)
            if (!isSW_OK(selectResp)) { isoDep.close(); return null }

            // GET DATA
            val getDataApdu = byteArrayOf(0x80.toByte(), 0xC0.toByte(), 0x00, 0x00, 0x00)
            val dataResp    = isoDep.transceive(getDataApdu)
            if (!isSW_OK(dataResp)) { isoDep.close(); return null }

            val jsonBytes = dataResp.copyOf(dataResp.size - 2)
            val payload   = JSONObject(String(jsonBytes, Charsets.UTF_8))

            if (payload.optString("type") != "P2P_REQUEST") {
                isoDep.close()
                return null
            }

            val expiresAt = payload.getLong("exp")
            if (System.currentTimeMillis() > expiresAt) {
                isoDep.close()
                return null  // session expired — payee must regenerate
            }

            // CONFIRM — clears the payee's P2PHceSession (single-use)
            val confirmApdu = byteArrayOf(0x80.toByte(), 0xC1.toByte(), 0x00, 0x00, 0x00)
            isoDep.transceive(confirmApdu)
            isoDep.close()

            P2PPaymentRequest(
                p2pToken    = payload.getString("p2pToken"),
                displayName = payload.optString("displayName").takeIf { it.isNotEmpty() && it != "null" },
                amountCents = if (payload.isNull("amountCents")) null else payload.getLong("amountCents"),
                expiresAt   = expiresAt,
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

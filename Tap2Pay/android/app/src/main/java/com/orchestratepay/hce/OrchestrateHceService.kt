package com.orchestratepay.hce

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import org.json.JSONObject

/**
 * OrchestrateHceService — makes the merchant's phone act as an NFC card emulator.
 *
 * Scenario 5: consumer initiates — consumer holds their wallet phone and the merchant
 * taps their own phone TO the consumer's phone. But also covers the reverse: merchant
 * activates this service with an amount, consumer taps merchant's phone to pay.
 *
 * Flow (consumer wallet reads merchant HCE):
 *   1. Merchant enters amount on dashboard, taps "Present to Customer"
 *   2. Dashboard calls POST /transactions/merchant-hce-token → gets signed token
 *   3. Dashboard calls MerchantHceSession.activate(session)
 *   4. Consumer holds their wallet phone to the merchant's phone
 *   5. Consumer wallet (ApduMerchantReader) sends SELECT AID → this service responds 9000
 *   6. Consumer wallet sends GET DATA → this service returns JSON payload + 9000
 *   7. Consumer wallet sends CONFIRM → this service clears session, responds 9000
 *   8. Consumer wallet calls POST /consumers/pay/{merchantId} with the merchantHceToken
 *   9. STK Push fires to the consumer's registered phone
 *
 * Payload (GET DATA response):
 *   {
 *     "type":         "MERCHANT_REQUEST",   ← distinguishes from consumer HCE payload
 *     "token":        "<uuid>",             ← single-use backend token
 *     "merchantId":   "<uuid>",
 *     "merchantName": "Mama Mboga Shop",
 *     "amountCents":  5000,                 ← KSh 50.00
 *     "exp":          <epoch_ms>
 *   }
 *
 * Same AID as consumer wallet (F04F52434845535441) — readers distinguish by "type" field.
 */
class OrchestrateHceService : HostApduService() {

    companion object {
        private val SW_OK        = byteArrayOf(0x90.toByte(), 0x00)
        private val SW_UNKNOWN   = byteArrayOf(0x6F, 0x00)
        private val SW_NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())

        private const val INS_SELECT   = 0xA4.toByte()
        private const val INS_GET_DATA = 0x80.toByte()
        private const val INS_CONFIRM  = 0x81.toByte()
    }

    private var sessionPayload: ByteArray? = null

    override fun processCommandApdu(commandApdu: ByteArray, extras: Bundle?): ByteArray {
        if (commandApdu.size < 4) return SW_UNKNOWN

        return when (commandApdu[1]) {
            INS_SELECT -> {
                sessionPayload = buildSessionPayload()
                if (sessionPayload != null) SW_OK else SW_NOT_FOUND
            }
            INS_GET_DATA -> {
                val payload = sessionPayload ?: return SW_NOT_FOUND
                payload + SW_OK
            }
            INS_CONFIRM -> {
                sessionPayload = null
                MerchantHceSession.clear()
                SW_OK
            }
            else -> SW_UNKNOWN
        }
    }

    override fun onDeactivated(reason: Int) {
        sessionPayload = null
    }

    private fun buildSessionPayload(): ByteArray? {
        val session = MerchantHceSession.get() ?: return null

        return JSONObject().apply {
            put("type",         "MERCHANT_REQUEST")
            put("token",        session.token)
            put("merchantId",   session.merchantId)
            put("merchantName", session.merchantName)
            put("amountCents",  session.amountCents)
            put("exp",          session.expiresAt)
        }.toString().toByteArray(Charsets.UTF_8)
    }
}

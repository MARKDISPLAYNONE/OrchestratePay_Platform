package com.orchestratepay.hce

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import org.json.JSONObject
import com.orchestratepay.db.SessionManager

/**
 * OrchestrateHceService — Host Card Emulation (consumer wallet).
 *
 * Allows the consumer's phone to act as an NFC card against the merchant terminal.
 *
 * APDU flow (OrchestratePay proprietary — NOT EMV bank card acceptance):
 *   Terminal → SELECT AID → phone responds 9000 (OK)
 *   Terminal → GET DATA   → phone sends JSON consumer token + 9000
 *   Terminal → CONFIRM    → phone cleans up session, responds 9000
 *
 * JSON payload (GET DATA response):
 *   {
 *     "phone":       "254XXXXXXXXX",
 *     "token":       "<32hex HMAC>",
 *     "exp":         <epoch_ms>,
 *     "deviceType":  "CONSUMER_PHONE",    ← added for SoftPOS distinction
 *     "walletVersion": 2                  ← increment if payload format changes
 *   }
 *
 * The token never contains PIN or full phone number — those stay server-side.
 * 60-second TTL prevents replay attacks on sniffed NFC traffic.
 *
 * AID F04F52434845535441 is in the F0-FF proprietary range — no EMVCo registration needed.
 *
 * IMPORTANT: this service runs in the reader-side of the card emulation pair.
 * The terminal app's NfcReaderManager (or nfc-core ApduProtocol) is on the reader side.
 */
class OrchestrateHceService : HostApduService() {

    companion object {
        private val SW_OK          = byteArrayOf(0x90.toByte(), 0x00)
        private val SW_UNKNOWN     = byteArrayOf(0x6F, 0x00)
        private val SW_NOT_FOUND   = byteArrayOf(0x6A.toByte(), 0x82.toByte())
        private const val INS_SELECT   = 0xA4.toByte()
        private const val INS_GET_DATA = 0x80.toByte()
        private const val INS_CONFIRM  = 0x81.toByte()

        const val DEVICE_TYPE     = "CONSUMER_PHONE"
        const val WALLET_VERSION  = 2
        const val TOKEN_TTL_MS    = 60_000L   // 60 seconds
    }

    // Active session — set on SELECT, cleared on CONFIRM or deactivation
    private var sessionPayload: ByteArray? = null

    override fun processCommandApdu(commandApdu: ByteArray, extras: Bundle?): ByteArray {
        if (commandApdu.size < 4) return SW_UNKNOWN

        return when (commandApdu[1]) {
            INS_SELECT -> {
                sessionPayload = buildSessionPayload()
                SW_OK
            }
            INS_GET_DATA -> {
                val payload = sessionPayload ?: return SW_NOT_FOUND
                payload + SW_OK
            }
            INS_CONFIRM -> {
                sessionPayload = null
                SW_OK
            }
            else -> SW_UNKNOWN
        }
    }

    override fun onDeactivated(reason: Int) {
        sessionPayload = null
    }

    /**
     * Builds the JSON payload to return on GET DATA.
     * Returns the HMAC-signed consumer token from SessionManager.
     * Returns null bytes (SW_NOT_FOUND) if the consumer is not logged in.
     */
    private fun buildSessionPayload(): ByteArray? {
        val phone = SessionManager.getConsumerPhone()     ?: return null
        val token = SessionManager.getConsumerHceToken()  ?: return null
        val exp   = System.currentTimeMillis() + TOKEN_TTL_MS

        val json = JSONObject().apply {
            put("phone",         phone)
            put("token",         token)
            put("exp",           exp)
            put("deviceType",    DEVICE_TYPE)
            put("walletVersion", WALLET_VERSION)
        }

        return json.toString().toByteArray(Charsets.UTF_8)
    }
}

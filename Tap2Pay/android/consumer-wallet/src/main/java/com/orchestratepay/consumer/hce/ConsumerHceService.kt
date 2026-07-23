package com.orchestratepay.consumer.hce

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import com.orchestratepay.consumer.db.ConsumerSessionManager
import org.json.JSONObject

/**
 * ConsumerHceService — Host Card Emulation for the consumer wallet.
 *
 * Supports two emulation modes distinguished by the "type" field in the payload:
 *
 * 1. CONSUMER_PAYMENT (default)
 *    Tapped by Sunmi terminal or SoftPOS merchant phone.
 *    Payload: { type, phone, token, exp, deviceType, walletVersion }
 *    Reader: NfcReaderManager / SoftPosOrchestrator → POST /transactions source=HCE_PHONE
 *
 * 2. P2P_REQUEST
 *    Activated when payee opens P2PSendActivity.  Tapped by another consumer (payer).
 *    Payload: { type, p2pToken, displayName?, amountCents?, exp }
 *    Reader: ConsumerP2PReader → POST /consumers/p2p-pay source=P2P_NFC
 *
 * Same AID for both (F04F52434845535441). Readers check the "type" field to route.
 * P2PHceSession takes priority — if it holds an active session, P2P mode is used.
 *
 * APDU handshake:
 *   SELECT AID → 9000
 *   GET DATA (0x80 0xC0) → JSON + 9000
 *   CONFIRM  (0x80 0xC1) → clears session + 9000
 */
class ConsumerHceService : HostApduService() {

    companion object {
        private val SW_OK        = byteArrayOf(0x90.toByte(), 0x00)
        private val SW_UNKNOWN   = byteArrayOf(0x6F, 0x00)
        private val SW_NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())

        private const val INS_SELECT   = 0xA4.toByte()
        private const val INS_GET_DATA = 0x80.toByte()
        private const val INS_CONFIRM  = 0x81.toByte()

        const val DEVICE_TYPE    = "CONSUMER_PHONE"
        const val WALLET_VERSION = 2
        const val TOKEN_TTL_MS   = 60_000L
    }

    private val sessionPayload = java.util.concurrent.atomic.AtomicReference<ByteArray?>(null)

    override fun processCommandApdu(commandApdu: ByteArray, extras: Bundle?): ByteArray {
        if (commandApdu.size < 4) return SW_UNKNOWN
        return when (commandApdu[1]) {
            INS_SELECT -> {
                val payload = buildSessionPayload(); sessionPayload.set(payload)
                if (sessionPayload.get() != null) SW_OK else SW_NOT_FOUND
            }
            INS_GET_DATA -> {
                val payload = sessionPayload.get() ?: return SW_NOT_FOUND
                payload + SW_OK
            }
            INS_CONFIRM -> {
                sessionPayload.set(null)
                P2PHceSession.clear()  // clear P2P session on confirm (single-use)
                SW_OK
            }
            else -> SW_UNKNOWN
        }
    }

    override fun onDeactivated(reason: Int) {
        sessionPayload.set(null)
    }

    private fun buildSessionPayload(): ByteArray? {
        // P2P mode takes priority when a P2P session is active
        val p2p = P2PHceSession.get()
        if (p2p != null) {
            return JSONObject().apply {
                put("type",        "P2P_REQUEST")
                put("p2pToken",    p2p.p2pToken)
                put("displayName", p2p.displayName ?: JSONObject.NULL)
                put("amountCents", p2p.amountCents ?: JSONObject.NULL)
                put("exp",         p2p.expiresAt)
            }.toString().toByteArray(Charsets.UTF_8)
        }

        // Default: consumer payment mode (for merchant terminals)
        val phone = ConsumerSessionManager.getPhone()    ?: return null
        val token = ConsumerSessionManager.getHceToken() ?: return null
        val exp   = System.currentTimeMillis() + TOKEN_TTL_MS

        return JSONObject().apply {
            put("type",          "CONSUMER_PAYMENT")
            put("phone",         phone)
            put("token",         token)
            put("exp",           exp)
            put("deviceType",    DEVICE_TYPE)
            put("walletVersion", WALLET_VERSION)
        }.toString().toByteArray(Charsets.UTF_8)
    }
}

package com.orchestratepay.wallet.hce

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log

/**
 * WalletHceService — the core of the customer tap-to-pay experience.
 *
 * This service makes the customer's phone behave like an NFC "smart tag".
 * When the customer taps their phone on the Sunmi POS terminal:
 *
 *   1. Android wakes this service (even if the app is background — screen must be ON)
 *   2. Sunmi POS sends: SELECT AID F04F52434845535441
 *   3. We respond: 90 00 (success)
 *   4. Sunmi POS sends: GET DATA (INS 0xC0)
 *   5. We respond: JSON payload + 90 00
 *      Payload: { "phone":"254712345678", "token":"<32 hex>", "exp":<epoch ms> }
 *   6. Sunmi POS sends: CONFIRM (INS 0xC1)
 *   7. We respond: 90 00, then clear the session (single-use)
 *
 * SECURITY:
 *   - The token is HMAC-SHA256(phone:exp) signed by the server — cannot be forged
 *   - 60-second TTL prevents replay attacks on sniffed NFC traffic
 *   - Single-use: CONFIRM APDU clears the session; the POS cannot reuse the token
 *
 * SCREEN STATE:
 *   Android HCE only works when the screen is on and the device is unlocked.
 *   The ActivatePaymentActivity UI must instruct the customer: "Unlock to Pay".
 *
 * REGISTERED IN:
 *   AndroidManifest.xml as a <service> with BIND_NFC_SERVICE permission.
 *   apduservice.xml declares the AID filter.
 */
class WalletHceService : HostApduService() {

    companion object {
        private const val TAG = "WalletHceService"

        private val SW_OK          = byteArrayOf(0x90.toByte(), 0x00)
        private val SW_NOT_FOUND   = byteArrayOf(0x6A.toByte(), 0x82.toByte())  // 6A82 = file not found
        private val SW_CONDITIONS  = byteArrayOf(0x69.toByte(), 0x85.toByte())  // 6985 = conditions not satisfied (expired)
        private val SW_UNKNOWN     = byteArrayOf(0x6F.toByte(), 0x00)

        private const val INS_SELECT   = 0xA4.toByte()
        private const val INS_GET_DATA = 0xC0.toByte()
        private const val INS_CONFIRM  = 0xC1.toByte()
    }

    override fun processCommandApdu(commandApdu: ByteArray, extras: Bundle?): ByteArray {
        if (commandApdu.size < 4) return SW_UNKNOWN

        return when (commandApdu[1]) {
            INS_SELECT   -> handleSelect()
            INS_GET_DATA -> handleGetData()
            INS_CONFIRM  -> handleConfirm()
            else         -> SW_UNKNOWN
        }
    }

    /**
     * SELECT AID — POS is initiating communication.
     * Load and validate the active session.
     */
    private fun handleSelect(): ByteArray {
        val session = WalletSessionManager.get()
        return if (session != null) {
            Log.d(TAG, "SELECT accepted — session active for ${session.phone.take(5)}****")
            SW_OK
        } else {
            Log.d(TAG, "SELECT rejected — no active session")
            SW_NOT_FOUND
        }
    }

    /**
     * GET DATA — POS wants the payment payload.
     * Returns the JSON with phone, token, and expiry.
     */
    private fun handleGetData(): ByteArray {
        val session = WalletSessionManager.get() ?: return SW_NOT_FOUND

        if (System.currentTimeMillis() > session.exp) {
            WalletSessionManager.clear()
            Log.w(TAG, "GET DATA rejected — session expired")
            return SW_CONDITIONS
        }

        val json = """{"phone":"${session.phone}","token":"${session.token}","exp":${session.exp}}"""
        Log.d(TAG, "GET DATA — sending payload for ${session.phone.take(5)}****")
        return json.toByteArray(Charsets.UTF_8) + SW_OK
    }

    /**
     * CONFIRM — POS has received the payload and sent it to the backend.
     * Clear the session so it cannot be replayed.
     */
    private fun handleConfirm(): ByteArray {
        WalletSessionManager.clear()
        Log.d(TAG, "CONFIRM — session cleared (single-use)")
        return SW_OK
    }

    /**
     * onDeactivated fires when the phone is moved away from the POS field.
     * We intentionally do NOT clear the session here. If the customer's phone
     * was moved away before CONFIRM arrived (e.g., lifted too quickly), they
     * should be able to tap again within the 60-second window.
     */
    override fun onDeactivated(reason: Int) {
        Log.d(TAG, "HCE deactivated reason=$reason — session preserved for retry within TTL")
    }
}

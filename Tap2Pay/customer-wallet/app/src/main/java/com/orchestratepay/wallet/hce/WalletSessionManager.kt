package com.orchestratepay.wallet.hce

/**
 * WalletSessionManager — holds the active 60-second HCE payment session.
 *
 * WHY A COMPANION OBJECT (not SharedPreferences):
 *   - WalletHceService is a separate Android Service — it cannot access Activity memory.
 *   - Both the Activity (which fetches the token) and the Service (which sends it via APDU)
 *     run in the same process, so a static companion object is visible to both.
 *   - The session is only valid for 60 seconds — it's not worth encrypting/persisting to disk.
 *   - @Volatile ensures visibility across threads (Service runs on a different thread
 *     from the coroutine that writes the session from ActivatePaymentActivity).
 *
 * LIFECYCLE:
 *   1. Customer taps "Ready to Pay" → ActivatePaymentActivity.activate() sets the session.
 *   2. Customer taps phone to POS → WalletHceService reads the session and sends it via APDU.
 *   3. POS sends CONFIRM APDU → WalletHceService calls clear().
 *   4. If 60s pass without a tap, ActivatePaymentActivity's countdown calls clear().
 */
object WalletSessionManager {

    data class HceSession(
        val phone: String,
        val token: String,
        val exp: Long
    )

    @Volatile
    private var activeSession: HceSession? = null

    /** Called by ActivatePaymentActivity after the backend issues a session token. */
    fun set(phone: String, token: String, exp: Long) {
        activeSession = HceSession(phone, token, exp)
    }

    /**
     * Called by WalletHceService on each SELECT APDU.
     * Returns null if no session is active or if the session has expired.
     */
    fun get(): HceSession? {
        val session = activeSession ?: return null
        if (System.currentTimeMillis() > session.exp) {
            activeSession = null  // auto-clear expired session
            return null
        }
        return session
    }

    /** Called by WalletHceService after CONFIRM APDU — single-use token. */
    fun clear() {
        activeSession = null
    }

    val isActive: Boolean
        get() = get() != null
}

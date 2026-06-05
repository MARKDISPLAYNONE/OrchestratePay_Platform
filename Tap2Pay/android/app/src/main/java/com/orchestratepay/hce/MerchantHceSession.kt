package com.orchestratepay.hce

/**
 * MerchantHceSession — in-memory store for the merchant's active HCE payment request.
 *
 * The merchant taps "Present to customer" on the dashboard after entering the amount.
 * MerchantDashboardActivity calls activate() with the backend-issued token.
 * OrchestrateHceService reads from here to build the APDU payload.
 *
 * Cleared automatically when the HCE session is confirmed or expires (60s TTL).
 *
 * Thread safety: all writes come from the Main thread; the HCE service reads
 * from a background thread. @Volatile is sufficient — no payment can fire
 * mid-assignment on a simple data class swap.
 */
object MerchantHceSession {

    data class Session(
        val token:        String,   // single-use UUID issued by POST /transactions/merchant-hce-token
        val merchantId:   String,
        val merchantName: String,
        val amountCents:  Long,
        val expiresAt:    Long,     // epoch millis
    )

    @Volatile
    private var active: Session? = null

    fun activate(session: Session) {
        active = session
    }

    fun get(): Session? {
        val s = active ?: return null
        if (System.currentTimeMillis() > s.expiresAt) {
            active = null
            return null
        }
        return s
    }

    /** Called by OrchestrateHceService after the CONFIRM APDU — token is spent. */
    fun clear() {
        active = null
    }

    fun isActive(): Boolean = get() != null
}

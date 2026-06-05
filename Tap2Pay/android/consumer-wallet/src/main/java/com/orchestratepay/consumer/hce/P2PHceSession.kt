package com.orchestratepay.consumer.hce

/**
 * P2PHceSession — in-memory store for the active P2P HCE payee session.
 *
 * The payee consumer calls POST /consumers/p2p-token to get a short-lived UUID
 * token, then calls activate() here. ConsumerHceService reads the session and
 * emits a P2P_REQUEST payload so the payer's phone can read it via NFC tap.
 *
 * Same design as MerchantHceSession in the merchant app — @Volatile field for
 * thread safety between the UI thread (activate/clear) and the HCE service
 * binder thread (get).
 */
object P2PHceSession {

    data class Session(
        val p2pToken:    String,
        val consumerId:  String,
        val displayName: String?,
        val amountCents: Long?,
        val expiresAt:   Long,
    )

    @Volatile private var active: Session? = null

    fun activate(session: Session) { active = session }

    fun get(): Session? {
        val s = active ?: return null
        if (System.currentTimeMillis() > s.expiresAt) { active = null; return null }
        return s
    }

    fun clear() { active = null }

    fun isActive(): Boolean = get() != null
}

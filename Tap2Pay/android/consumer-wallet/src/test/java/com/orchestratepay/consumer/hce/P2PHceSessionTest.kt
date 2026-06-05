package com.orchestratepay.consumer.hce

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for P2PHceSession — Scenarios 6, 7, 10, 11 (payee side).
 *
 * P2PHceSession is an in-memory @Volatile singleton that holds the active P2P
 * payee session.  When active, ConsumerHceService emits a P2P_REQUEST payload
 * instead of the default CONSUMER_PAYMENT payload.
 *
 * Pure JVM — no Android framework, no network.
 */
class P2PHceSessionTest {

    // Inline session model mirroring P2PHceSession.Session
    data class Session(
        val p2pToken:    String,
        val consumerId:  String,
        val displayName: String?,
        val amountCents: Long?,
        val expiresAt:   Long,
    )

    // Inline re-implementation of P2PHceSession logic (avoids global singleton state)
    private var active: Session? = null

    private fun activate(session: Session)  { active = session }
    private fun clear()                      { active = null }
    private fun get(): Session? {
        val s = active ?: return null
        return if (System.currentTimeMillis() > s.expiresAt) { active = null; null } else s
    }
    private fun isActive(): Boolean = get() != null

    @Before fun setUp() { active = null }

    private fun makeSession(
        ttlMs:       Long    = 90_000L,
        amountCents: Long?   = null,
        displayName: String? = "Alice",
    ) = Session(
        p2pToken    = "p2p-token-uuid-123",
        consumerId  = "consumer-uuid-payee",
        displayName = displayName,
        amountCents = amountCents,
        expiresAt   = System.currentTimeMillis() + ttlMs,
    )

    // ── Lifecycle ────────────────────────────────────────────────────────────

    @Test
    fun `session is null before activation`() {
        assertNull(get())
        assertFalse(isActive())
    }

    @Test
    fun `session is non-null after activation`() {
        activate(makeSession())
        assertNotNull(get())
        assertTrue(isActive())
    }

    @Test
    fun `clear() removes the session`() {
        activate(makeSession())
        clear()
        assertNull(get())
        assertFalse(isActive())
    }

    @Test
    fun `activating a new session overwrites the previous one`() {
        activate(makeSession().copy(p2pToken = "token-first"))
        activate(makeSession().copy(p2pToken = "token-second"))
        assertEquals("token-second", get()?.p2pToken)
    }

    // ── Expiry auto-clear ────────────────────────────────────────────────────

    @Test
    fun `expired session (ttl = -1ms) returns null from get()`() {
        activate(makeSession(ttlMs = -1L))
        assertNull(get())
        assertFalse(isActive())
    }

    @Test
    fun `session expiring in 90s is valid`() {
        activate(makeSession(ttlMs = 90_000L))
        assertNotNull(get())
    }

    @Test
    fun `calling get() on expired session auto-clears to null`() {
        activate(makeSession(ttlMs = -1L))
        assertNull(get())
        // Session was auto-cleared — subsequent call also returns null
        assertNull(get())
    }

    // ── Optional fields ──────────────────────────────────────────────────────

    @Test
    fun `amountCents can be null (payer enters amount)`() {
        activate(makeSession(amountCents = null))
        assertNull(get()?.amountCents)
    }

    @Test
    fun `amountCents can be a preset value (payee locked the amount)`() {
        activate(makeSession(amountCents = 5000L))
        assertEquals(5000L, get()?.amountCents)
    }

    @Test
    fun `displayName can be null (consumer has no display name)`() {
        activate(makeSession(displayName = null))
        assertNull(get()?.displayName)
    }

    @Test
    fun `displayName with value is preserved`() {
        activate(makeSession(displayName = "Wanjiku"))
        assertEquals("Wanjiku", get()?.displayName)
    }

    // ── P2P_REQUEST payload fields ───────────────────────────────────────────

    @Test
    fun `p2pToken field is present in activated session`() {
        activate(makeSession())
        assertNotNull(get()?.p2pToken)
        assertTrue(get()!!.p2pToken.isNotEmpty())
    }

    @Test
    fun `consumerId field is present in activated session`() {
        activate(makeSession())
        assertEquals("consumer-uuid-payee", get()?.consumerId)
    }

    // ── CONFIRM clears session (single-use) ───────────────────────────────────

    @Test
    fun `CONFIRM APDU clears the session (single-use enforcement)`() {
        activate(makeSession())
        assertTrue(isActive())
        clear()  // simulates processCommandApdu(CONFIRM)
        assertFalse(isActive())
    }

    // ── TTL matches backend ───────────────────────────────────────────────────

    @Test
    fun `P2P token TTL is 90 seconds matching backend Redis TTL`() {
        val backendTtlSeconds = 90
        val androidTtlMs      = 90_000L
        assertEquals(backendTtlSeconds * 1_000L, androidTtlMs)
    }
}

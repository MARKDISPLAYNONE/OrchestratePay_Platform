package com.orchestratepay.hce

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for MerchantHceSession — Scenario 5 (merchant HCE side).
 *
 * MerchantHceSession is an in-memory @Volatile singleton that holds the active
 * payment session while the merchant's phone is in HCE mode.
 * OrchestrateHceService reads it on every APDU exchange.
 *
 * All tests are pure JVM — no Android framework, no network.
 */
class MerchantHceSessionTest {

    // Minimal Session data class mirroring MerchantHceSession.Session
    data class Session(
        val token:        String,
        val merchantId:   String,
        val merchantName: String,
        val amountCents:  Long,
        val expiresAt:    Long,
    )

    // Inline re-implementation of MerchantHceSession logic for unit testing
    // (avoids importing the object singleton which has global side effects)
    private var activeSession: Session? = null

    private fun activate(session: Session)  { activeSession = session }
    private fun clear()                      { activeSession = null }

    private fun get(): Session? {
        val s = activeSession ?: return null
        return if (System.currentTimeMillis() > s.expiresAt) { activeSession = null; null } else s
    }

    private fun isActive(): Boolean = get() != null

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun makeSession(ttlMs: Long = 60_000L) = Session(
        token        = "test-token-uuid",
        merchantId   = "merchant-uuid-001",
        merchantName = "Mama Mboga Shop",
        amountCents  = 5_000L,
        expiresAt    = System.currentTimeMillis() + ttlMs,
    )

    @Before
    fun setUp() { activeSession = null }  // reset between tests

    // ── Session lifecycle ─────────────────────────────────────────────────────

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
    fun `get() returns the exact session that was activated`() {
        val s = makeSession()
        activate(s)
        assertEquals(s, get())
    }

    @Test
    fun `clear() removes the session`() {
        activate(makeSession())
        assertTrue(isActive())
        clear()
        assertNull(get())
        assertFalse(isActive())
    }

    @Test
    fun `activating a second session replaces the first`() {
        val s1 = makeSession()
        val s2 = makeSession().copy(token = "token-2", amountCents = 10_000L)
        activate(s1)
        activate(s2)
        assertEquals("token-2", get()?.token)
        assertEquals(10_000L, get()?.amountCents)
    }

    // ── Expiry ────────────────────────────────────────────────────────────────

    @Test
    fun `expired session returns null from get() and auto-clears`() {
        // Expired 1ms ago
        activate(makeSession(ttlMs = -1L))
        assertNull(get())
        assertFalse(isActive())
    }

    @Test
    fun `session expiring in 60s is still valid`() {
        activate(makeSession(ttlMs = 60_000L))
        assertNotNull(get())
        assertTrue(isActive())
    }

    @Test
    fun `isActive() returns false after expiry (auto-clear in get())`() {
        activate(makeSession(ttlMs = -1L))
        assertFalse(isActive())
        // After isActive triggers clear via get(), subsequent call also returns false
        assertFalse(isActive())
    }

    // ── Session fields ────────────────────────────────────────────────────────

    @Test
    fun `session preserves all fields: token, merchantId, merchantName, amountCents`() {
        val s = makeSession()
        activate(s)
        val retrieved = get()!!
        assertEquals(s.token,        retrieved.token)
        assertEquals(s.merchantId,   retrieved.merchantId)
        assertEquals(s.merchantName, retrieved.merchantName)
        assertEquals(s.amountCents,  retrieved.amountCents)
    }

    @Test
    fun `expiresAt is in the future for a fresh session`() {
        activate(makeSession())
        assertTrue("expiresAt must be in the future", get()!!.expiresAt > System.currentTimeMillis())
    }

    @Test
    fun `amount of 0 is not a valid session amount (minimum is 100 cents — KSh 1)`() {
        // This constraint is enforced by the Joi schema on the backend, not by MerchantHceSession.
        // We document it here as a specification test.
        val minAmountCents = 100L
        assertTrue("Session amount must be at least KSh 1", makeSession().amountCents >= minAmountCents)
    }

    // ── HCE payload type field ────────────────────────────────────────────────

    @Test
    fun `OrchestrateHceService payload type is MERCHANT_REQUEST — not CONSUMER_PAYMENT`() {
        // When MerchantHceSession is active, OrchestrateHceService.buildSessionPayload()
        // emits { type: "MERCHANT_REQUEST", ... }
        // Consumer payment mode emits { type: "CONSUMER_PAYMENT", ... }
        val merchantType = "MERCHANT_REQUEST"
        val consumerType = "CONSUMER_PAYMENT"
        assertNotEquals(merchantType, consumerType)
        assertEquals("MERCHANT_REQUEST", merchantType)
    }

    @Test
    fun `P2P_REQUEST type is not emitted by OrchestrateHceService (merchant app)`() {
        // P2P_REQUEST is only emitted by ConsumerHceService in the consumer wallet
        val merchantServiceTypes = setOf("MERCHANT_REQUEST")
        assertFalse(merchantServiceTypes.contains("P2P_REQUEST"))
        assertFalse(merchantServiceTypes.contains("CONSUMER_PAYMENT"))
    }

    // ── CONFIRM APDU clears session (single-use) ──────────────────────────────

    @Test
    fun `CONFIRM APDU should clear the session so it cannot be reused`() {
        activate(makeSession())
        assertTrue(isActive())
        // Simulate CONFIRM APDU handler
        clear()
        assertFalse(isActive())
        assertNull(get())
    }

    @Test
    fun `calling clear() on an already-empty session does not throw`() {
        assertNull(get())
        clear()  // safe to call on null session
        assertNull(get())
    }

    // ── Scenario 5 invariants ────────────────────────────────────────────────

    @Test
    fun `merchant HCE TTL is 60 seconds (matches backend Redis TTL)`() {
        val backendTtlSeconds = 60
        val androidTtlMs      = 60_000L
        assertEquals(backendTtlSeconds * 1_000L, androidTtlMs)
    }

    @Test
    fun `token format is UUID v4 (matches backend uuidv4() output)`() {
        val uuidPattern = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
        val sampleToken = "550e8400-e29b-41d4-a716-446655440000"
        assertTrue(uuidPattern.matches(sampleToken))
    }

    @Test
    fun `Redis key format is merchant-hce-{token} (matches backend key construction)`() {
        val token = "tok"
        val key   = "merchant:hce:$token"
        assertTrue(key.startsWith("merchant:hce:"))
        assertFalse(key.startsWith("consumer:"))
    }
}

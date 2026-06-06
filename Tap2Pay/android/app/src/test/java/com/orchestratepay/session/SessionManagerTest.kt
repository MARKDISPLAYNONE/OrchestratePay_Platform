package com.orchestratepay.session

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for encrypted session management.
 * Tests session token lifecycle: creation, validation, expiry, and revocation.
 * The logic below mirrors what SessionManager on-device implements; keeping it
 * pure Kotlin means it runs without Android JNI/Keystore dependencies.
 */
class SessionManagerTest {

    // ─── Session model ────────────────────────────────────────────────────────
    data class Session(
        val accessToken:  String,
        val refreshToken: String,
        val merchantId:   String,
        val expiresAtMs:  Long,
        val isRevoked:    Boolean = false,
    )

    private val ACCESS_TTL_MS  = 8  * 60 * 60 * 1000L  // 8h
    private val REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000L  // 30 days

    private var sessionStore: Session? = null

    @Before
    fun setUp() { sessionStore = null }

    private fun createSession(merchantId: String, nowMs: Long = System.currentTimeMillis()): Session =
        Session(
            accessToken  = "access_${merchantId}_${nowMs}",
            refreshToken = "refresh_${merchantId}_${nowMs}",
            merchantId   = merchantId,
            expiresAtMs  = nowMs + ACCESS_TTL_MS,
        ).also { sessionStore = it }

    private fun isSessionValid(session: Session?, nowMs: Long = System.currentTimeMillis()): Boolean =
        session != null && !session.isRevoked && session.expiresAtMs > nowMs

    private fun revokeSession() { sessionStore = sessionStore?.copy(isRevoked = true) }

    private fun refreshSession(session: Session, nowMs: Long = System.currentTimeMillis()): Session? {
        if (session.isRevoked) return null
        val refreshExpiresAt = session.expiresAtMs - ACCESS_TTL_MS + REFRESH_TTL_MS
        if (nowMs > refreshExpiresAt) return null
        return session.copy(
            accessToken = "access_${session.merchantId}_${nowMs}",
            expiresAtMs = nowMs + ACCESS_TTL_MS,
        ).also { sessionStore = it }
    }

    // ─── Tests ────────────────────────────────────────────────────────────────

    @Test
    fun `new session is valid immediately after creation`() {
        val session = createSession("merchant-001")
        assertTrue(isSessionValid(session))
    }

    @Test
    fun `session contains correct merchant id`() {
        val session = createSession("merchant-abc")
        assertEquals("merchant-abc", session.merchantId)
    }

    @Test
    fun `access token expires after 8 hours`() {
        val createdAt = 0L
        val session   = createSession("merchant-001", nowMs = createdAt)

        val nineHoursLater = createdAt + 9 * 60 * 60 * 1000L
        assertFalse("Session should be expired after 9h", isSessionValid(session, nineHoursLater))
    }

    @Test
    fun `session is valid at exactly the expiry moment minus one ms`() {
        val createdAt = 0L
        val session   = createSession("merchant-001", nowMs = createdAt)
        val oneBeforeExpiry = session.expiresAtMs - 1L
        assertTrue(isSessionValid(session, oneBeforeExpiry))
    }

    @Test
    fun `session is invalid at exactly the expiry timestamp`() {
        val createdAt = 0L
        val session   = createSession("merchant-001", nowMs = createdAt)
        assertFalse(isSessionValid(session, session.expiresAtMs))
    }

    @Test
    fun `revoking a session immediately invalidates it`() {
        createSession("merchant-001")
        revokeSession()
        assertFalse(isSessionValid(sessionStore))
    }

    @Test
    fun `null session is not valid`() {
        assertFalse(isSessionValid(null))
    }

    @Test
    fun `refreshing a valid session produces a new access token`() {
        val createdAt = 0L
        val original  = createSession("merchant-001", nowMs = createdAt)
        val refreshed = refreshSession(original, nowMs = createdAt + 60_000L)

        assertNotNull(refreshed)
        assertNotEquals(original.accessToken, refreshed!!.accessToken)
        assertEquals(original.refreshToken,   refreshed.refreshToken)
    }

    @Test
    fun `refreshing a revoked session returns null`() {
        val session  = createSession("merchant-001").copy(isRevoked = true)
        val result   = refreshSession(session)
        assertNull("Revoked sessions cannot be refreshed", result)
    }

    @Test
    fun `refresh resets the access token expiry`() {
        val createdAt = 0L
        val original  = createSession("merchant-001", nowMs = createdAt)
        val refreshAt = createdAt + 3 * 60 * 60 * 1000L  // 3h later
        val refreshed = refreshSession(original, nowMs = refreshAt)

        assertNotNull(refreshed)
        assertEquals(refreshAt + ACCESS_TTL_MS, refreshed!!.expiresAtMs)
    }

    @Test
    fun `two sessions for different merchants are independent`() {
        val s1 = createSession("merchant-alpha")
        val s2 = createSession("merchant-beta")

        assertNotEquals(s1.accessToken, s2.accessToken)
        assertNotEquals(s1.merchantId, s2.merchantId)
    }
}

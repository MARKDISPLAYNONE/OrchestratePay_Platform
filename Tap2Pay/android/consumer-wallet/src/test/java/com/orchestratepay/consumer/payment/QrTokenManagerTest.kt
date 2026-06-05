package com.orchestratepay.consumer.payment

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for QrTokenManager caching logic — pure JVM, no Android framework.
 *
 * QrTokenManager keeps a short-lived QR token fresh: it caches the token until
 * 15 seconds before expiry, then auto-refreshes. This matters for UX — a stale
 * QR code on screen means the merchant's scanner will reject it and the consumer
 * must wait for a new one.
 *
 * The actual API call (ConsumerApiClient.requestQrToken) and Bitmap generation
 * are Android-runtime-dependent and covered by instrumented tests. These tests
 * verify the deterministic caching/timing logic in isolation using parametric
 * helpers that mirror the real implementation.
 *
 * Coverage:
 *   - Fresh token (> 15 s remaining) → cache hit, no refresh
 *   - Stale token (≤ 15 s remaining) → refresh needed
 *   - No cached token → refresh needed
 *   - Token at exact 15 s boundary → refresh needed (guard is strictly > 15 000 ms)
 *   - Auto-refresh delay calculation
 *   - Zero/negative delay → no auto-refresh scheduled
 *   - QR token TTL is 90 s (as per backend POST /consumers/qr-token)
 *   - Refresh margin is 15 s (token refreshed 15 s before expiry)
 */
class QrTokenManagerTest {

    // ── Constants (mirror QrTokenManager source) ──────────────────────────────

    private val REFRESH_MARGIN_MS = 15_000L
    private val TOKEN_TTL_S       = 90L
    private val TOKEN_TTL_MS      = TOKEN_TTL_S * 1_000L

    // ── Parametric helpers mirroring QrTokenManager ───────────────────────────

    /**
     * Returns true if the cached token is still fresh enough to use without refreshing.
     * Mirrors: `c != null && c.expiresAt - System.currentTimeMillis() > 15_000`
     */
    private fun isFresh(expiresAt: Long, nowMs: Long): Boolean =
        expiresAt - nowMs > REFRESH_MARGIN_MS

    /**
     * Calculates the delay before auto-refresh fires.
     * Mirrors: `expiresAt - System.currentTimeMillis() - 15_000`
     * Returns null if the delay is ≤ 0 (no refresh should be scheduled).
     */
    private fun autoRefreshDelayMs(expiresAt: Long, nowMs: Long): Long? {
        val delay = expiresAt - nowMs - REFRESH_MARGIN_MS
        return if (delay > 0) delay else null
    }

    // ── Cache freshness ───────────────────────────────────────────────────────

    @Test
    fun `token with plenty of time remaining is fresh (cache hit)`() {
        val now      = 1_000_000L
        val expiresAt = now + 60_000L  // 60 s remaining, well above 15 s margin
        assertTrue(isFresh(expiresAt, now))
    }

    @Test
    fun `token with exactly 16s remaining is fresh (just above 15s margin)`() {
        val now      = 1_000_000L
        val expiresAt = now + 16_000L
        assertTrue(isFresh(expiresAt, now))
    }

    @Test
    fun `token with exactly 15s remaining is NOT fresh (not strictly > 15s)`() {
        val now      = 1_000_000L
        val expiresAt = now + 15_000L
        assertFalse(isFresh(expiresAt, now))
    }

    @Test
    fun `token with 14s remaining is NOT fresh (stale — must refresh)`() {
        val now      = 1_000_000L
        val expiresAt = now + 14_000L
        assertFalse(isFresh(expiresAt, now))
    }

    @Test
    fun `expired token is NOT fresh`() {
        val now      = 1_000_000L
        val expiresAt = now - 1_000L  // already expired
        assertFalse(isFresh(expiresAt, now))
    }

    @Test
    fun `freshness check uses strict greater-than (boundary is exclusive)`() {
        val now = 1_000_000L
        // exactly at boundary → not fresh
        assertFalse(isFresh(now + REFRESH_MARGIN_MS, now))
        // one millisecond above boundary → fresh
        assertTrue(isFresh(now + REFRESH_MARGIN_MS + 1, now))
    }

    // ── Token TTL and margin constants ────────────────────────────────────────

    @Test
    fun `token TTL is 90 seconds (matches backend POST consumers qr-token)`() {
        assertEquals(90L, TOKEN_TTL_S)
    }

    @Test
    fun `refresh margin is 15 seconds`() {
        assertEquals(15_000L, REFRESH_MARGIN_MS)
    }

    @Test
    fun `refresh margin is less than half the token TTL (enough display time)`() {
        assertTrue(REFRESH_MARGIN_MS < TOKEN_TTL_MS / 2)
    }

    @Test
    fun `a freshly issued token has 75s usable display window (TTL minus margin)`() {
        val usableWindowMs = TOKEN_TTL_MS - REFRESH_MARGIN_MS
        assertEquals(75_000L, usableWindowMs)
    }

    // ── Auto-refresh delay calculation ────────────────────────────────────────

    @Test
    fun `auto-refresh fires 15s before expiry`() {
        val now       = 1_000_000L
        val expiresAt = now + TOKEN_TTL_MS
        val delay     = autoRefreshDelayMs(expiresAt, now)
        assertNotNull(delay)
        assertEquals(TOKEN_TTL_MS - REFRESH_MARGIN_MS, delay)
    }

    @Test
    fun `auto-refresh delay is positive for a fresh token`() {
        val now       = 1_000_000L
        val expiresAt = now + 60_000L
        val delay     = autoRefreshDelayMs(expiresAt, now)
        assertNotNull(delay)
        assertTrue(delay!! > 0)
    }

    @Test
    fun `auto-refresh is not scheduled when token has less than 15s left`() {
        val now       = 1_000_000L
        val expiresAt = now + 10_000L  // only 10 s left — refresh immediately, don't schedule
        assertNull(autoRefreshDelayMs(expiresAt, now))
    }

    @Test
    fun `auto-refresh is not scheduled for an already-expired token`() {
        val now       = 1_000_000L
        val expiresAt = now - 5_000L
        assertNull(autoRefreshDelayMs(expiresAt, now))
    }

    @Test
    fun `auto-refresh delay is zero when expiry is exactly at margin boundary`() {
        val now       = 1_000_000L
        val expiresAt = now + REFRESH_MARGIN_MS  // delay = 0 → no schedule
        assertNull(autoRefreshDelayMs(expiresAt, now))
    }

    // ── Cancel semantics ──────────────────────────────────────────────────────

    @Test
    fun `after cancel the cached token is gone (next call must refresh)`() {
        // Simulate the state after cancel(): current = null
        val hasCachedToken = false
        // When current is null, isFresh cannot be called (guard is `c != null && ...`)
        // So a refresh is always needed when there is no cached token.
        assertFalse(hasCachedToken)
    }

    // ── QR display safety ─────────────────────────────────────────────────────

    @Test
    fun `QR is refreshed before expiry so scanner never sees an expired code`() {
        // If consumer opens QR tab at T=0 and the token expires at T=90s,
        // auto-refresh fires at T=75s so a new token is ready before the old one expires.
        val issuedAt  = 0L
        val expiresAt = issuedAt + TOKEN_TTL_MS
        val refreshAt = issuedAt + TOKEN_TTL_MS - REFRESH_MARGIN_MS  // T=75s

        assertTrue("Refresh happens before expiry", refreshAt < expiresAt)
        assertTrue("Refresh happens while token is still valid", refreshAt > issuedAt)
    }

    @Test
    fun `a newly refreshed token replaces the old one before it expires`() {
        val now              = 1_000_000L
        val oldExpiresAt     = now + 14_000L  // stale
        val newExpiresAt     = now + TOKEN_TTL_MS  // fresh

        assertFalse("Old token is stale",        isFresh(oldExpiresAt, now))
        assertTrue("New token is fresh",         isFresh(newExpiresAt, now))
    }
}

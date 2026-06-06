package com.orchestratepay.connectivity

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for the connectivity monitor's offline-mode transition logic.
 * The monitor decides when to enter offline mode and when to re-sync.
 *
 * Pure Kotlin — no Android framework dependency, so it runs on JVM.
 */
class ConnectivityMonitorTest {

    // ─── Model ────────────────────────────────────────────────────────────────
    enum class NetworkState { ONLINE, OFFLINE, DEGRADED }

    data class ConnectivityStatus(
        val state:              NetworkState,
        val lastOnlineMs:       Long?,
        val consecutiveFails:   Int,
    )

    private val DEGRADED_THRESHOLD   = 2     // consecutive failures → DEGRADED
    private val OFFLINE_THRESHOLD    = 5     // consecutive failures → OFFLINE
    private val RECONNECT_GRACE_MS   = 5_000L  // wait before declaring re-online

    private var status = ConnectivityStatus(NetworkState.ONLINE, System.currentTimeMillis(), 0)

    @Before
    fun setUp() {
        status = ConnectivityStatus(NetworkState.ONLINE, System.currentTimeMillis(), 0)
    }

    private fun recordSuccess(nowMs: Long = System.currentTimeMillis()) {
        status = status.copy(state = NetworkState.ONLINE, lastOnlineMs = nowMs, consecutiveFails = 0)
    }

    private fun recordFailure() {
        val fails = status.consecutiveFails + 1
        val newState = when {
            fails >= OFFLINE_THRESHOLD  -> NetworkState.OFFLINE
            fails >= DEGRADED_THRESHOLD -> NetworkState.DEGRADED
            else                        -> status.state
        }
        status = status.copy(state = newState, consecutiveFails = fails)
    }

    private fun isOfflineMode(): Boolean = status.state == NetworkState.OFFLINE

    // ─── Tests ────────────────────────────────────────────────────────────────

    @Test
    fun `initial state is ONLINE`() {
        assertEquals(NetworkState.ONLINE, status.state)
    }

    @Test
    fun `single failure does not trigger DEGRADED`() {
        recordFailure()
        assertEquals(NetworkState.ONLINE, status.state)
        assertEquals(1, status.consecutiveFails)
    }

    @Test
    fun `two consecutive failures trigger DEGRADED`() {
        repeat(DEGRADED_THRESHOLD) { recordFailure() }
        assertEquals(NetworkState.DEGRADED, status.state)
    }

    @Test
    fun `five consecutive failures trigger OFFLINE`() {
        repeat(OFFLINE_THRESHOLD) { recordFailure() }
        assertEquals(NetworkState.OFFLINE, status.state)
        assertTrue(isOfflineMode())
    }

    @Test
    fun `single success resets to ONLINE and clears fail count`() {
        repeat(OFFLINE_THRESHOLD) { recordFailure() }
        assertEquals(NetworkState.OFFLINE, status.state)

        recordSuccess()
        assertEquals(NetworkState.ONLINE, status.state)
        assertEquals(0, status.consecutiveFails)
    }

    @Test
    fun `success after DEGRADED also resets to ONLINE`() {
        repeat(DEGRADED_THRESHOLD) { recordFailure() }
        assertEquals(NetworkState.DEGRADED, status.state)

        recordSuccess()
        assertEquals(NetworkState.ONLINE, status.state)
    }

    @Test
    fun `lastOnlineMs is updated on success`() {
        val before = status.lastOnlineMs ?: 0L
        Thread.sleep(2)   // ensure measurable time difference
        recordSuccess()
        assertTrue(status.lastOnlineMs!! > before)
    }

    @Test
    fun `lastOnlineMs is preserved on failure`() {
        val before = status.lastOnlineMs
        recordFailure()
        assertEquals(before, status.lastOnlineMs)
    }

    @Test
    fun `isOfflineMode returns false when DEGRADED`() {
        repeat(DEGRADED_THRESHOLD) { recordFailure() }
        assertFalse("DEGRADED should not trigger offline mode", isOfflineMode())
    }

    @Test
    fun `consecutive failures beyond OFFLINE_THRESHOLD remain OFFLINE`() {
        repeat(OFFLINE_THRESHOLD + 10) { recordFailure() }
        assertEquals(NetworkState.OFFLINE, status.state)
        assertEquals(OFFLINE_THRESHOLD + 10, status.consecutiveFails)
    }
}

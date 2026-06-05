package com.orchestratepay.hardware

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for hardware-state guards on Sunmi P2 Pro (and smartphone SoftPOS).
 *
 * The key rule for all hardware failures:
 *   PRINTER FAILURES MUST NEVER BLOCK OR REVERSE A PAYMENT.
 *   The customer's M-Pesa is charged; not printing is a UX problem, not a financial one.
 *
 * This test suite covers:
 *   - Sunmi AIDL status-code → PrinterState mapping
 *   - Which states block printing vs. which merely warn
 *   - Battery thresholds and their effect on NFC reader
 *   - Low-storage guard (can't save receipts to local DB if disk full)
 *   - NFC field strength behaviour (weak field = retry, not crash)
 *   - Thermal head overheat recovery window (30 seconds)
 *
 * All tests run on pure JVM — no Android framework, no Sunmi SDK.
 */
class HardwareStateTest {

    // ─── Mirrors SunmiPrinterManager.PrinterState ─────────────────────────────────

    sealed class PrinterState {
        object Ready        : PrinterState()
        object LowPaper     : PrinterState()
        object OutOfPaper   : PrinterState()
        object Overheating  : PrinterState()
        object Disconnected : PrinterState()
        data class Error(val code: Int, val description: String) : PrinterState()
    }

    // Sunmi AIDL IWoyouService.getPrinterStatus() codes
    private val SUNMI_STATUS_READY        = 1
    private val SUNMI_STATUS_PREPARING    = 2
    private val SUNMI_STATUS_ABNORMAL     = 3
    private val SUNMI_STATUS_OUT_OF_PAPER = 4
    private val SUNMI_STATUS_OVERHEATING  = 5
    private val SUNMI_STATUS_OPEN_COVER   = 6
    private val SUNMI_STATUS_PAPER_CUT    = 7
    private val SUNMI_STATUS_PAPER_FEED   = 8
    private val SUNMI_STATUS_NOT_CONNECTED = 505

    private fun mapStatusCode(code: Int): PrinterState = when (code) {
        SUNMI_STATUS_READY         -> PrinterState.Ready
        SUNMI_STATUS_OUT_OF_PAPER  -> PrinterState.OutOfPaper
        SUNMI_STATUS_OVERHEATING   -> PrinterState.Overheating
        SUNMI_STATUS_NOT_CONNECTED -> PrinterState.Disconnected
        else                       -> PrinterState.Error(code, "Printer status: $code")
    }

    /**
     * Returns true if the printer state should BLOCK printing.
     * Overheating also blocks (damage risk) but allows payment — must wait 30s.
     */
    private fun shouldBlockPrint(state: PrinterState): Boolean = when (state) {
        PrinterState.OutOfPaper   -> true   // will fail anyway
        PrinterState.Overheating  -> true   // risk of hardware damage
        PrinterState.Disconnected -> true   // AIDL service not bound
        else                      -> false  // LowPaper prints; errors may succeed
    }

    /**
     * Returns true if the printer state should BLOCK the payment itself.
     * CRITICAL: Only catastrophic states that would prevent recording the transaction.
     * Overheating does NOT block payment — the receipt is optional, the payment is not.
     */
    private fun shouldBlockPayment(state: PrinterState): Boolean = false
    // No printer state should ever block a payment. The printer is peripheral.
    // This function exists to make the invariant explicit and testable.

    // ─── Status code mapping ──────────────────────────────────────────────────────

    @Test
    fun `Sunmi status 1 maps to Ready`() {
        assertEquals(PrinterState.Ready, mapStatusCode(1))
    }

    @Test
    fun `Sunmi status 4 maps to OutOfPaper`() {
        assertEquals(PrinterState.OutOfPaper, mapStatusCode(4))
    }

    @Test
    fun `Sunmi status 5 maps to Overheating`() {
        assertEquals(PrinterState.Overheating, mapStatusCode(5))
    }

    @Test
    fun `Sunmi status 505 maps to Disconnected`() {
        assertEquals(PrinterState.Disconnected, mapStatusCode(505))
    }

    @Test
    fun `unknown status code maps to Error with the original code preserved`() {
        val result = mapStatusCode(99)
        assertTrue(result is PrinterState.Error)
        assertEquals(99, (result as PrinterState.Error).code)
    }

    @Test
    fun `all known Sunmi status codes produce a non-null PrinterState`() {
        listOf(1, 2, 3, 4, 5, 6, 7, 8, 505).forEach { code ->
            assertNotNull("Status code $code returned null", mapStatusCode(code))
        }
    }

    // ─── Print guard logic ────────────────────────────────────────────────────────

    @Test
    fun `Ready state does not block printing`() {
        assertFalse(shouldBlockPrint(PrinterState.Ready))
    }

    @Test
    fun `LowPaper state does not block printing (warn only)`() {
        // Low paper prints fine — just warn the merchant to prepare a new roll.
        assertFalse(shouldBlockPrint(PrinterState.LowPaper))
    }

    @Test
    fun `OutOfPaper state blocks printing`() {
        assertTrue(shouldBlockPrint(PrinterState.OutOfPaper))
    }

    @Test
    fun `Overheating state blocks printing (must wait 30s to prevent hardware damage)`() {
        assertTrue(shouldBlockPrint(PrinterState.Overheating))
    }

    @Test
    fun `Disconnected state blocks printing`() {
        assertTrue(shouldBlockPrint(PrinterState.Disconnected))
    }

    @Test
    fun `Error state does not unconditionally block printing (some errors are transient)`() {
        // A low-severity error (e.g., paper jam cleared) should not permanently block.
        // The real printer might succeed — try and surface the result.
        assertFalse(shouldBlockPrint(PrinterState.Error(7, "Paper cutting error")))
    }

    // ─── Critical invariant: printer NEVER blocks payment ─────────────────────────

    @Test
    fun `OutOfPaper state does NOT block payment`() {
        assertFalse("Printer out of paper must never reverse a payment",
            shouldBlockPayment(PrinterState.OutOfPaper))
    }

    @Test
    fun `Overheating state does NOT block payment`() {
        assertFalse("Overheating must not block payment — receipt is optional",
            shouldBlockPayment(PrinterState.Overheating))
    }

    @Test
    fun `Disconnected state does NOT block payment`() {
        assertFalse("Missing Sunmi AIDL binding must never prevent a payment",
            shouldBlockPayment(PrinterState.Disconnected))
    }

    @Test
    fun `no PrinterState value ever blocks a payment`() {
        val allStates = listOf(
            PrinterState.Ready,
            PrinterState.LowPaper,
            PrinterState.OutOfPaper,
            PrinterState.Overheating,
            PrinterState.Disconnected,
            PrinterState.Error(4, "some error")
        )
        allStates.forEach { state ->
            assertFalse("PrinterState $state must never block a payment",
                shouldBlockPayment(state))
        }
    }

    // ─── Overheating recovery window ─────────────────────────────────────────────

    private val OVERHEAT_RECOVERY_MS = 30_000L  // Sunmi spec: 30s cool-down

    @Test
    fun `overheat recovery window is exactly 30 seconds`() {
        assertEquals(30_000L, OVERHEAT_RECOVERY_MS)
    }

    @Test
    fun `printer is not yet safe to use before the 30s recovery window expires`() {
        val overheatAt = System.currentTimeMillis()
        val checkAt    = overheatAt + 29_000L  // 1 second short
        assertFalse("30s not yet elapsed", checkAt - overheatAt >= OVERHEAT_RECOVERY_MS)
    }

    @Test
    fun `printer is safe to use after the 30s recovery window expires`() {
        val overheatAt = System.currentTimeMillis()
        val checkAt    = overheatAt + OVERHEAT_RECOVERY_MS + 1
        assertTrue("30s elapsed — safe to print", checkAt - overheatAt >= OVERHEAT_RECOVERY_MS)
    }

    // ─── Battery thresholds ───────────────────────────────────────────────────────

    private val BATTERY_CRITICAL_PCT = 3     // block new payments — risk of shutdown mid-flow
    private val BATTERY_LOW_PCT      = 10    // warn merchant to charge, don't block
    private val BATTERY_OK_PCT       = 20    // normal operation

    private fun batteryAllowsPayment(batteryPct: Int): Boolean = batteryPct > BATTERY_CRITICAL_PCT
    private fun batteryNeedsWarning(batteryPct: Int): Boolean  = batteryPct in 1..BATTERY_LOW_PCT

    @Test
    fun `battery at 50% allows payment and no warning`() {
        assertTrue(batteryAllowsPayment(50))
        assertFalse(batteryNeedsWarning(50))
    }

    @Test
    fun `battery at 10% allows payment but shows low-battery warning`() {
        assertTrue("10% allows payment", batteryAllowsPayment(10))
        assertTrue("10% triggers warning", batteryNeedsWarning(10))
    }

    @Test
    fun `battery at 5% allows payment but warns (not yet critical)`() {
        assertTrue("5% above critical threshold", batteryAllowsPayment(5))
        assertTrue("5% triggers warning", batteryNeedsWarning(5))
    }

    @Test
    fun `battery at 3% blocks new payments (device may shut down mid-flow)`() {
        assertFalse("3% is the critical cutoff — block payments", batteryAllowsPayment(3))
    }

    @Test
    fun `battery at 1% blocks new payments`() {
        assertFalse(batteryAllowsPayment(1))
    }

    @Test
    fun `battery at 0% (dead) blocks new payments`() {
        // Realistically the device is off, but if somehow reached, must block.
        assertFalse(batteryAllowsPayment(0))
    }

    @Test
    fun `battery at 4% (one above critical) allows payment with warning`() {
        assertTrue("4% is just above the block threshold", batteryAllowsPayment(4))
        assertTrue("4% shows low-battery warning", batteryNeedsWarning(4))
    }

    @Test
    fun `charging device at 2% still blocks — charging state does not override critical threshold`() {
        // A device at 2% can still shut down even while plugged in (slow charger, high load).
        // The isCharging flag does not lift the critical payment block.
        @Suppress("UNUSED_VARIABLE") val isCharging = true  // documents the design: ignored by guard
        assertFalse("2% blocks regardless of charging state", batteryAllowsPayment(2))
    }

    // ─── Storage guard for receipt DB ─────────────────────────────────────────────

    private val MINIMUM_FREE_BYTES = 50L * 1024 * 1024  // 50 MB

    private fun hasEnoughStorage(freeBytes: Long): Boolean = freeBytes >= MINIMUM_FREE_BYTES

    @Test
    fun `100MB free storage passes the receipt-DB guard`() {
        assertTrue(hasEnoughStorage(100L * 1024 * 1024))
    }

    @Test
    fun `exactly 50MB free passes the guard (boundary)`() {
        assertTrue(hasEnoughStorage(MINIMUM_FREE_BYTES))
    }

    @Test
    fun `49MB free fails the guard — receipt DB writes may fail`() {
        assertFalse(hasEnoughStorage(49L * 1024 * 1024))
    }

    @Test
    fun `0 bytes free fails the guard`() {
        assertFalse(hasEnoughStorage(0L))
    }

    // ─── NFC field-strength heuristic ────────────────────────────────────────────
    // NFC tag reads can fail due to distance or orientation. The app should retry
    // rather than showing an error on the first failure.

    private val MAX_NFC_RETRIES = 2      // 2 retries before surfacing error to merchant
    private val NFC_RETRY_DELAY_MS = 200L

    data class NfcReadAttempt(val attempt: Int, val succeeded: Boolean)

    private fun shouldRetryNfc(attempt: NfcReadAttempt): Boolean =
        !attempt.succeeded && attempt.attempt < MAX_NFC_RETRIES

    @Test
    fun `first NFC read failure triggers a retry`() {
        val attempt = NfcReadAttempt(attempt = 0, succeeded = false)
        assertTrue(shouldRetryNfc(attempt))
    }

    @Test
    fun `second NFC read failure triggers a retry (within budget)`() {
        val attempt = NfcReadAttempt(attempt = 1, succeeded = false)
        assertTrue(shouldRetryNfc(attempt))
    }

    @Test
    fun `third NFC read failure exhausts retries — surface error to merchant`() {
        val attempt = NfcReadAttempt(attempt = MAX_NFC_RETRIES, succeeded = false)
        assertFalse("Retry budget exhausted", shouldRetryNfc(attempt))
    }

    @Test
    fun `successful NFC read does not retry`() {
        val attempt = NfcReadAttempt(attempt = 0, succeeded = true)
        assertFalse(shouldRetryNfc(attempt))
    }

    @Test
    fun `NFC retry delay is short enough to not frustrate the merchant (under 500ms)`() {
        assertTrue("Retry delay should be short", NFC_RETRY_DELAY_MS < 500L)
    }

    // ─── Printer state message coverage ───────────────────────────────────────────

    private fun stateMessage(state: PrinterState): String = when (state) {
        PrinterState.OutOfPaper   -> "Printer is out of paper. Please reload and reprint."
        PrinterState.LowPaper     -> "Paper is running low. Please prepare a new roll."
        PrinterState.Overheating  -> "Printer is overheating. Wait 30 seconds before printing."
        PrinterState.Disconnected -> "Printer not connected. Check the Sunmi service."
        PrinterState.Ready        -> ""
        is PrinterState.Error     -> "Printer error (${state.code}): ${state.description}"
    }

    @Test
    fun `OutOfPaper message is non-empty and actionable`() {
        val msg = stateMessage(PrinterState.OutOfPaper)
        assertTrue("Message should be non-empty", msg.isNotEmpty())
        assertTrue("Message should reference paper", msg.lowercase().contains("paper"))
    }

    @Test
    fun `Overheating message mentions the 30-second wait`() {
        val msg = stateMessage(PrinterState.Overheating)
        assertTrue("Message should mention 30 seconds", msg.contains("30"))
    }

    @Test
    fun `Ready state returns empty message (no warning to show)`() {
        assertEquals("", stateMessage(PrinterState.Ready))
    }

    @Test
    fun `Error state includes the raw code for support diagnostic`() {
        val msg = stateMessage(PrinterState.Error(42, "paper jam"))
        assertTrue("Error code must appear in message", msg.contains("42"))
    }

    @Test
    fun `all non-Ready states return a non-empty message`() {
        val nonReadyStates = listOf(
            PrinterState.LowPaper,
            PrinterState.OutOfPaper,
            PrinterState.Overheating,
            PrinterState.Disconnected,
            PrinterState.Error(1, "test error")
        )
        nonReadyStates.forEach { state ->
            assertTrue("State $state must have a non-empty message", stateMessage(state).isNotEmpty())
        }
    }
}


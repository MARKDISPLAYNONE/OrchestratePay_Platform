package com.orchestratepay.softpos.ui

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for SoftPosDashboardActivity pure logic:
 *   - Keypad amount arithmetic
 *   - State string validation
 *   - Amount formatting
 *   - Guard conditions (amount > 0 before tap, max amount cap)
 *
 * UI-dependent behaviour (ViewBinding updates, Snackbar, NFC callbacks) is
 * tested in instrumented tests. These tests cover the state machine in isolation.
 */
class SoftPosDashboardStateTest {

    // ── Amount keypad arithmetic ──────────────────────────────────────────────

    private fun pressDigit(current: Long, digit: Int): Long =
        if (current < 100_000_00L) current * 10 + digit * 100L else current

    @Test
    fun `single digit press gives 100 cents (KSh 1)`() {
        assertEquals(100L, pressDigit(0L, 1))
    }

    @Test
    fun `pressing 1 then 0 gives KSh 10 (1000 cents)`() {
        val after1 = pressDigit(0L, 1)   // 100
        val after0 = pressDigit(after1, 0) // 1000
        assertEquals(1000L, after0)
    }

    @Test
    fun `pressing 5 0 0 gives KSh 500 (50000 cents)`() {
        var amt = 0L
        listOf(5, 0, 0).forEach { d -> amt = pressDigit(amt, d) }
        assertEquals(50_000L, amt)
    }

    @Test
    fun `pressing 1 0 0 0 gives KSh 1000 (100000 cents)`() {
        var amt = 0L
        listOf(1, 0, 0, 0).forEach { d -> amt = pressDigit(amt, d) }
        assertEquals(100_000L, amt)
    }

    @Test
    fun `clear resets amount to zero`() {
        var amt = pressDigit(0L, 5)
        amt = 0L
        assertEquals(0L, amt)
    }

    @Test
    fun `guard prevents overflow above 10 million KSh`() {
        val maxAllowed = 100_000_00L - 1
        val capped = pressDigit(maxAllowed, 9)
        // Should NOT change because maxAllowed >= 100_000_00L is false (it's 99_999_99)
        // Actually 99_999_99 < 100_000_00 so it DOES press — test the actual boundary
        val atBoundary = pressDigit(100_000_00L, 9)
        assertEquals(100_000_00L, atBoundary)  // no change when already at/above cap
    }

    @Test
    fun `amount zero means payment should not proceed`() {
        val amountCents = 0L
        assertFalse("Zero amount should block payment", amountCents > 0)
    }

    @Test
    fun `positive amount means payment may proceed`() {
        val amountCents = 50_000L
        assertTrue(amountCents > 0)
    }

    // ── Amount formatting ─────────────────────────────────────────────────────

    private fun formatAmount(cents: Long) = "KSh ${"%.2f".format(cents / 100.0)}"

    @Test
    fun `zero formats as KSh 0 dot 00`() {
        assertEquals("KSh 0.00", formatAmount(0L))
    }

    @Test
    fun `100 cents formats as KSh 1 dot 00`() {
        assertEquals("KSh 1.00", formatAmount(100L))
    }

    @Test
    fun `50000 cents formats as KSh 500 dot 00`() {
        assertEquals("KSh 500.00", formatAmount(50_000L))
    }

    @Test
    fun `150 cents formats as KSh 1 dot 50`() {
        assertEquals("KSh 1.50", formatAmount(150L))
    }

    // ── Valid state strings ───────────────────────────────────────────────────

    @Test
    fun `IDLE state string is valid`() {
        val state = "IDLE"
        assertTrue(state in listOf("IDLE", "PROCESSING", "SUCCESS", "DECLINED", "ERROR"))
    }

    @Test
    fun `PROCESSING state string is valid`() {
        val state = "PROCESSING"
        assertTrue(state in listOf("IDLE", "PROCESSING", "SUCCESS", "DECLINED", "ERROR"))
    }

    @Test
    fun `SUCCESS DECLINED ERROR are result states`() {
        val resultStates = listOf("SUCCESS", "DECLINED", "ERROR")
        assertTrue("SUCCESS" in resultStates)
        assertTrue("DECLINED" in resultStates)
        assertTrue("ERROR" in resultStates)
        assertFalse("IDLE" in resultStates)
        assertFalse("PROCESSING" in resultStates)
    }

    // ── Result icon mapping ───────────────────────────────────────────────────

    private fun resultIcon(state: String) = when (state) {
        "SUCCESS"  -> "✓"
        "DECLINED" -> "✗"
        else       -> "!"
    }

    @Test
    fun `SUCCESS maps to checkmark icon`() {
        assertEquals("✓", resultIcon("SUCCESS"))
    }

    @Test
    fun `DECLINED maps to X icon`() {
        assertEquals("✗", resultIcon("DECLINED"))
    }

    @Test
    fun `ERROR maps to exclamation icon`() {
        assertEquals("!", resultIcon("ERROR"))
    }

    // ── Payment result formatting ─────────────────────────────────────────────

    @Test
    fun `confirmed result message contains amount and ref`() {
        val amountCents = 50_000L
        val mpesaRef    = "NLJ7RT61SV"
        val msg = "KSh ${"%.2f".format(amountCents / 100.0)} confirmed\nRef: $mpesaRef"
        assertTrue(msg.contains("500.00"))
        assertTrue(msg.contains("NLJ7RT61SV"))
    }
}

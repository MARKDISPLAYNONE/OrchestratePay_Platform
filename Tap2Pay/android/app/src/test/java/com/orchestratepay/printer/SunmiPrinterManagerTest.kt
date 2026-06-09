package com.orchestratepay.printer

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for SunmiPrinterManager logic that runs on the JVM.
 *
 * Android-specific code (Canvas, Bitmap, Context) is NOT tested here —
 * that requires an instrumented test. We test the pure business logic:
 *   - VAT calculation
 *   - Paper width constant
 *   - PrinterState exhaustiveness
 *   - PrintResult variants
 */
class SunmiPrinterManagerTest {

    // ─── VAT calculation ──────────────────────────────────────────────────────

    @Test
    fun `VAT on KSh 100 inclusive is approximately KSh 13_79`() {
        // KSh 100 includes 16% VAT: VAT = 100 * (0.16 / 1.16) ≈ 13.79 (in cents: 1379)
        val vatCents = SunmiPrinterManager.vatFromInclusive(10_000L)
        // Within 1 cent of expected 1379
        assertTrue("VAT should be ~1379 cents, got $vatCents",
            vatCents in 1_378L..1_380L)
    }

    @Test
    fun `VAT is zero on zero amount`() {
        assertEquals(0L, SunmiPrinterManager.vatFromInclusive(0L))
    }

    @Test
    fun `net amount is total minus VAT`() {
        val total  = 10_000L
        val vat    = SunmiPrinterManager.vatFromInclusive(total)
        val net    = total - vat
        assertTrue("Net should be less than total", net < total)
        assertTrue("Net should be positive", net > 0)
    }

    @Test
    fun `VAT rate is consistent with 16 percent`() {
        // For an inclusive amount A, VAT = A * 16/116
        val total = 50_000L
        val vat   = SunmiPrinterManager.vatFromInclusive(total)
        val expectedVat = (total * 16.0 / 116.0).toLong()
        // Allow ±1 for integer rounding
        assertTrue(Math.abs(vat - expectedVat) <= 1L)
    }

    @Test
    fun `VAT scales linearly with amount`() {
        val vat100  = SunmiPrinterManager.vatFromInclusive(10_000L)
        val vat200  = SunmiPrinterManager.vatFromInclusive(20_000L)
        // Double the amount → double the VAT (within 1 cent for rounding)
        assertTrue(Math.abs(vat200 - vat100 * 2) <= 1L)
    }

    // ─── Paper width constant ─────────────────────────────────────────────────

    @Test
    fun `PAPER_WIDTH_PX is 384 (58mm at 203 DPI)`() {
        assertEquals(384, SunmiPrinterManager.PAPER_WIDTH_PX)
    }

    @Test
    fun `MARGIN_PX is positive`() {
        assertTrue(SunmiPrinterManager.MARGIN_PX > 0)
    }

    // ─── PrinterState sealed class ────────────────────────────────────────────

    @Test
    fun `PrinterState Ready is distinct from OutOfPaper`() {
        assertFalse(PrinterState.Ready is PrinterState.OutOfPaper)
    }

    @Test
    fun `PrinterState Error carries code and description`() {
        val e = PrinterState.Error(code = 7, description = "Paper cut error")
        assertEquals(7, e.code)
        assertEquals("Paper cut error", e.description)
    }

    @Test
    fun `when expression covers all PrinterState variants`() {
        val states: List<PrinterState> = listOf(
            PrinterState.Ready,
            PrinterState.LowPaper,
            PrinterState.OutOfPaper,
            PrinterState.Overheating,
            PrinterState.Disconnected,
            PrinterState.Error(1, "test")
        )
        var handled = 0
        states.forEach { state ->
            when (state) {
                is PrinterState.Ready        -> handled++
                is PrinterState.LowPaper     -> handled++
                is PrinterState.OutOfPaper   -> handled++
                is PrinterState.Overheating  -> handled++
                is PrinterState.Disconnected -> handled++
                is PrinterState.Error        -> handled++
            }
        }
        assertEquals(6, handled)
    }

    // ─── PrintResult sealed class ─────────────────────────────────────────────

    @Test
    fun `PrintResult Success is not Failed`() {
        val r: PrintResult = PrintResult.Success
        assertFalse(r is PrintResult.Failed)
    }

    @Test
    fun `PrintResult Failed carries state and message`() {
        val r = PrintResult.Failed(PrinterState.OutOfPaper, "No paper in printer")
        assertTrue(r.state is PrinterState.OutOfPaper)
        assertEquals("No paper in printer", r.message)
    }

    @Test
    fun `PrintResult when covers all variants`() {
        val results: List<PrintResult> = listOf(
            PrintResult.Success,
            PrintResult.Failed(PrinterState.Disconnected, "Not connected")
        )
        var handled = 0
        results.forEach { r ->
            when (r) {
                is PrintResult.Success -> handled++
                is PrintResult.Failed  -> handled++
            }
        }
        assertEquals(2, handled)
    }

    // ─── lastPrinterStatus volatile ─────────────────────────────────────────

    @Test
    fun `lastPrinterStatus defaults to 1 (Ready)`() {
        // 1 = Sunmi AIDL code for Ready state
        assertEquals(1, SunmiPrinterManager.lastPrinterStatus)
    }

    @Test
    fun `lastPrinterStatus can be updated`() {
        val previous = SunmiPrinterManager.lastPrinterStatus
        SunmiPrinterManager.lastPrinterStatus = 4  // 4 = OutOfPaper
        assertEquals(4, SunmiPrinterManager.lastPrinterStatus)
        SunmiPrinterManager.lastPrinterStatus = previous  // restore
    }
}

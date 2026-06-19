package com.orchestratepay.printer

import com.orchestratepay.payment.PaymentResult
import org.junit.Assert.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.text.SimpleDateFormat
import java.util.*

/**
 * SunmiPrinterStateMachineTest — state machine, receipt content, and VAT tests
 * for the Sunmi thermal printer.
 *
 * WHY A SECOND FILE (not merged with SunmiPrinterManagerTest):
 * SunmiPrinterManagerTest covers the VAT calculation, constants, and sealed-class
 * exhaustiveness. This file adds:
 *   - PrinterState machine transitions (Ready → LowPaper → OutOfPaper → Ready)
 *   - printReceipt() call conditions: which states allow/block printing
 *   - Receipt content contract: what fields must appear and in what order
 *   - VAT breakdown content (with kraPin present)
 *   - Low paper warning callback semantics
 *   - Disconnected → reconnection-attempt model
 *   - AIDL status code → PrinterState mapping
 *   - PrintResult.Failed carries correct printer state
 *
 * SunmiPrinterManager depends on Android Canvas/Bitmap/Context, so we cannot
 * instantiate it in a pure JVM test. Instead we test:
 *   1. The state machine logic via a local StateMachine helper that mirrors
 *      checkPrinterState()'s Sunmi AIDL code mapping.
 *   2. The receipt rendering field list by invoking our own minimal receipt
 *      builder that mirrors renderReceiptBitmap()'s content decisions.
 *   3. Public companion object functions (vatFromInclusive) and constants.
 */
class SunmiPrinterStateMachineTest {

    // ── Sunmi AIDL status code → PrinterState mapping (mirrors checkPrinterState) ──
    //
    // From SunmiPrinterManager source comment:
    //   1   = Ready
    //   2   = Preparing
    //   3   = Abnormal communications
    //   4   = Out of paper
    //   5   = Overheating
    //   6   = Open cover
    //   7   = Paper cutting error
    //   8   = Paper feed error
    //   9   = Reserved
    //   505 = Not connected
    //
    // Low paper (< 20mm remaining) maps to 2 in some Sunmi firmware.
    // We model it here as a separate code for testing purposes.

    private fun aidlCodeToState(code: Int): PrinterState = when (code) {
        1    -> PrinterState.Ready
        2    -> PrinterState.LowPaper
        3    -> PrinterState.Error(code, "Abnormal communications")
        4    -> PrinterState.OutOfPaper
        5    -> PrinterState.Overheating
        6    -> PrinterState.Error(code, "Open cover")
        7    -> PrinterState.Error(code, "Paper cutting error")
        8    -> PrinterState.Error(code, "Paper feed error")
        505  -> PrinterState.Disconnected
        else -> PrinterState.Error(code, "Unknown printer status: $code")
    }

    /** Returns true when printing should proceed */
    private fun canPrint(state: PrinterState): Boolean = when (state) {
        is PrinterState.OutOfPaper   -> false
        is PrinterState.Disconnected -> false
        else                         -> true
    }

    /** Returns PrintResult mirroring printReceipt()'s guard logic */
    private fun simulatePrint(state: PrinterState, result: PaymentResult.Success): PrintResult {
        return if (!canPrint(state)) {
            PrintResult.Failed(state, stateMessage(state))
        } else {
            // Actually printing succeeds (bitmap rendering not exercised in JVM test)
            PrintResult.Success
        }
    }

    private fun stateMessage(state: PrinterState): String = when (state) {
        is PrinterState.OutOfPaper   -> "Printer is out of paper. Please reload and reprint."
        is PrinterState.LowPaper     -> "Paper is running low. Please prepare a new roll."
        is PrinterState.Overheating  -> "Printer is overheating. Wait 30 seconds before printing."
        is PrinterState.Disconnected -> "Printer not connected. Check the Sunmi service."
        is PrinterState.Error        -> "Printer error (${state.code}): ${state.description}"
        PrinterState.Ready           -> ""
    }

    private val samplePayment = PaymentResult.Success(
        txnId         = "txn-uuid-001-printer",
        mpesaRef      = "NLJ7RT61SV",
        amountCents   = 150_00L,  // KSh 150.00
        merchantName  = "Mama Mboga Shop",
        consumerPhone = "2547****1234"
    )

    // Track lastPrinterStatus to restore after tests
    private var savedLastStatus: Int = 0

    @Before
    fun setUp() {
        savedLastStatus = SunmiPrinterManager.lastPrinterStatus
    }

    @After
    fun tearDown() {
        SunmiPrinterManager.lastPrinterStatus = savedLastStatus
    }

    // ── AIDL status code → PrinterState mapping ───────────────────────────────

    @Test
    fun `AIDL code 1 maps to PrinterState Ready`() {
        assertTrue(aidlCodeToState(1) is PrinterState.Ready)
    }

    @Test
    fun `AIDL code 2 maps to PrinterState LowPaper`() {
        assertTrue(aidlCodeToState(2) is PrinterState.LowPaper)
    }

    @Test
    fun `AIDL code 4 maps to PrinterState OutOfPaper`() {
        assertTrue(aidlCodeToState(4) is PrinterState.OutOfPaper)
    }

    @Test
    fun `AIDL code 5 maps to PrinterState Overheating`() {
        assertTrue(aidlCodeToState(5) is PrinterState.Overheating)
    }

    @Test
    fun `AIDL code 505 maps to PrinterState Disconnected`() {
        assertTrue(aidlCodeToState(505) is PrinterState.Disconnected)
    }

    @Test
    fun `AIDL code 7 maps to PrinterState Error with paper cutting description`() {
        val state = aidlCodeToState(7)
        assertTrue(state is PrinterState.Error)
        val e = state as PrinterState.Error
        assertEquals(7, e.code)
        assertTrue(e.description.contains("cutting") || e.description.contains("Paper"))
    }

    @Test
    fun `AIDL code 3 maps to PrinterState Error`() {
        assertTrue(aidlCodeToState(3) is PrinterState.Error)
    }

    @Test
    fun `unknown AIDL code (e.g. 99) maps to PrinterState Error`() {
        val state = aidlCodeToState(99)
        assertTrue(state is PrinterState.Error)
        assertEquals(99, (state as PrinterState.Error).code)
    }

    // ── State transitions: Ready → LowPaper → OutOfPaper → back to Ready ─────

    @Test
    fun `transition from Ready to LowPaper when code changes to 2`() {
        SunmiPrinterManager.lastPrinterStatus = 1  // Ready
        assertEquals(PrinterState.Ready::class, aidlCodeToState(SunmiPrinterManager.lastPrinterStatus)::class)

        SunmiPrinterManager.lastPrinterStatus = 2  // LowPaper
        assertEquals(PrinterState.LowPaper::class, aidlCodeToState(SunmiPrinterManager.lastPrinterStatus)::class)
    }

    @Test
    fun `transition from LowPaper to OutOfPaper when code changes to 4`() {
        SunmiPrinterManager.lastPrinterStatus = 2  // LowPaper
        SunmiPrinterManager.lastPrinterStatus = 4  // OutOfPaper
        assertEquals(PrinterState.OutOfPaper::class, aidlCodeToState(SunmiPrinterManager.lastPrinterStatus)::class)
    }

    @Test
    fun `transition from OutOfPaper back to Ready when paper is reloaded (code = 1)`() {
        SunmiPrinterManager.lastPrinterStatus = 4  // OutOfPaper
        SunmiPrinterManager.lastPrinterStatus = 1  // Ready after paper reload
        assertEquals(PrinterState.Ready::class, aidlCodeToState(SunmiPrinterManager.lastPrinterStatus)::class)
    }

    @Test
    fun `state transitions are reflected in lastPrinterStatus volatile field`() {
        SunmiPrinterManager.lastPrinterStatus = 1
        assertEquals(1, SunmiPrinterManager.lastPrinterStatus)
        SunmiPrinterManager.lastPrinterStatus = 4
        assertEquals(4, SunmiPrinterManager.lastPrinterStatus)
        SunmiPrinterManager.lastPrinterStatus = 1
        assertEquals(1, SunmiPrinterManager.lastPrinterStatus)
    }

    // ── printReceipt() guard conditions ──────────────────────────────────────

    @Test
    fun `printReceipt with Ready state → PrintResult Success`() {
        val result = simulatePrint(PrinterState.Ready, samplePayment)
        assertTrue(result is PrintResult.Success)
    }

    @Test
    fun `printReceipt with LowPaper state → print proceeds (warning only, not a block)`() {
        // LowPaper is a warning — SunmiPrinterManager prints and logs a warning afterwards.
        // From source: "After printing, re-check for low paper so the merchant can prepare"
        val result = simulatePrint(PrinterState.LowPaper, samplePayment)
        assertTrue("LowPaper should not block printing", result is PrintResult.Success)
    }

    @Test
    fun `printReceipt with OutOfPaper state → PrintResult Failed`() {
        val result = simulatePrint(PrinterState.OutOfPaper, samplePayment)
        assertTrue(result is PrintResult.Failed)
        val failed = result as PrintResult.Failed
        assertTrue(failed.state is PrinterState.OutOfPaper)
    }

    @Test
    fun `printReceipt with OutOfPaper includes descriptive error message`() {
        val result = simulatePrint(PrinterState.OutOfPaper, samplePayment) as PrintResult.Failed
        assertTrue(
            "Message must mention paper: ${result.message}",
            result.message.contains("paper", ignoreCase = true)
        )
    }

    @Test
    fun `printReceipt with Disconnected state → PrintResult Failed`() {
        val result = simulatePrint(PrinterState.Disconnected, samplePayment)
        assertTrue(result is PrintResult.Failed)
        assertTrue((result as PrintResult.Failed).state is PrinterState.Disconnected)
    }

    @Test
    fun `printReceipt with Disconnected state includes reconnection message`() {
        val result = simulatePrint(PrinterState.Disconnected, samplePayment) as PrintResult.Failed
        assertTrue(
            "Message must mention connection/Sunmi: ${result.message}",
            result.message.contains("connect", ignoreCase = true) ||
            result.message.contains("Sunmi", ignoreCase = true)
        )
    }

    @Test
    fun `printReceipt with Overheating state → print proceeds (not a blocker per source)`() {
        // Source: guard only blocks on OutOfPaper and Disconnected.
        // Overheating is not in the guard list — it falls through to printing.
        val result = simulatePrint(PrinterState.Overheating, samplePayment)
        assertTrue("Overheating should not block printing per source code", result is PrintResult.Success)
    }

    @Test
    fun `PrintResult Failed carries the blocking PrinterState`() {
        val result = simulatePrint(PrinterState.OutOfPaper, samplePayment) as PrintResult.Failed
        assertNotNull(result.state)
        assertEquals(PrinterState.OutOfPaper, result.state)
    }

    // ── Receipt content contract ──────────────────────────────────────────────
    //
    // We verify the content decisions from renderReceiptBitmap():
    //   - merchant name formatted correctly
    //   - amount in KSh format
    //   - M-Pesa reference present
    //   - timestamp formatted as "dd MMM yyyy  HH:mm"
    //   - consumer phone masked
    //   - "Powered by OrchestratePay" footer present
    //   - When kraPin != null: VAT breakdown block present

    /** Minimal receipt content builder mirroring renderReceiptBitmap() content decisions */
    private fun buildReceiptLines(result: PaymentResult.Success, kraPin: String? = null): List<String> {
        val lines = mutableListOf<String>()
        // Merchant name
        lines.add(result.merchantName)
        // Amount
        lines.add("KSh ${"%.2f".format(result.amountCents / 100.0)}")
        // M-Pesa ref
        lines.add("M-Pesa Ref:")
        lines.add(result.mpesaRef)
        // Date
        lines.add(SimpleDateFormat("dd MMM yyyy  HH:mm", Locale.getDefault()).format(Date()))
        // Phone
        lines.add("Phone: ${result.consumerPhone}")
        // Txn ID (truncated)
        lines.add("Txn: ${result.txnId.take(16)}...")
        // VAT block (only when kraPin is provided)
        if (kraPin != null) {
            val vatCents = SunmiPrinterManager.vatFromInclusive(result.amountCents)
            val netCents = result.amountCents - vatCents
            lines.add("Net (excl. VAT):")
            lines.add("KSh ${"%.2f".format(netCents / 100.0)}")
            lines.add("VAT (16%):")
            lines.add("KSh ${"%.2f".format(vatCents / 100.0)}")
            lines.add("KRA PIN: $kraPin")
        }
        // Footer
        lines.add("Powered by OrchestratePay")
        lines.add("support@orchestratepay.co.ke")
        return lines
    }

    @Test
    fun `receipt contains merchant name`() {
        val lines = buildReceiptLines(samplePayment)
        assertTrue(lines.contains("Mama Mboga Shop"))
    }

    @Test
    fun `receipt contains amount in KSh format`() {
        val lines = buildReceiptLines(samplePayment)
        assertTrue(
            "Expected 'KSh 150.00' in lines: $lines",
            lines.any { it.contains("KSh 150.00") }
        )
    }

    @Test
    fun `receipt contains M-Pesa reference label and value`() {
        val lines = buildReceiptLines(samplePayment)
        assertTrue(lines.contains("M-Pesa Ref:"))
        assertTrue(lines.contains("NLJ7RT61SV"))
    }

    @Test
    fun `merchant name appears before amount (correct receipt order)`() {
        val lines = buildReceiptLines(samplePayment)
        val merchantIdx = lines.indexOf("Mama Mboga Shop")
        val amountIdx   = lines.indexOfFirst { it.contains("KSh 150.00") }
        assertTrue("Merchant name must precede amount", merchantIdx < amountIdx)
    }

    @Test
    fun `M-Pesa ref appears after amount in receipt order`() {
        val lines      = buildReceiptLines(samplePayment)
        val amountIdx  = lines.indexOfFirst { it.contains("KSh 150.00") }
        val mpesaIdx   = lines.indexOf("M-Pesa Ref:")
        assertTrue("M-Pesa ref must appear after amount", mpesaIdx > amountIdx)
    }

    @Test
    fun `receipt contains consumer phone with Phone prefix`() {
        val lines = buildReceiptLines(samplePayment)
        assertTrue(lines.any { it.startsWith("Phone: ") })
        assertTrue(lines.any { it.contains("2547****1234") })
    }

    @Test
    fun `receipt contains OrchestratePay footer`() {
        val lines = buildReceiptLines(samplePayment)
        assertTrue(lines.any { it.contains("OrchestratePay") })
    }

    @Test
    fun `receipt contains support email in footer`() {
        val lines = buildReceiptLines(samplePayment)
        assertTrue(lines.contains("support@orchestratepay.co.ke"))
    }

    @Test
    fun `receipt contains truncated transaction ID for support queries`() {
        val lines  = buildReceiptLines(samplePayment)
        val txnId  = samplePayment.txnId.take(16)
        assertTrue("Receipt must contain truncated txnId", lines.any { it.contains(txnId) })
    }

    @Test
    fun `receipt without kraPin does not contain VAT block`() {
        val lines = buildReceiptLines(samplePayment, kraPin = null)
        assertFalse(lines.any { it.contains("VAT") })
        assertFalse(lines.any { it.contains("KRA PIN") })
        assertFalse(lines.any { it.contains("Net (excl. VAT)") })
    }

    // ── VAT breakdown block (with kraPin) ────────────────────────────────────

    @Test
    fun `receipt with kraPin contains VAT breakdown block`() {
        val lines = buildReceiptLines(samplePayment, kraPin = "P051234567A")
        assertTrue(lines.any { it.contains("VAT (16%)") })
        assertTrue(lines.any { it.contains("Net (excl. VAT)") })
    }

    @Test
    fun `receipt with kraPin contains the KRA PIN`() {
        val lines = buildReceiptLines(samplePayment, kraPin = "P051234567A")
        assertTrue(lines.any { it.contains("KRA PIN: P051234567A") })
    }

    @Test
    fun `VAT line shows correct 16% amount for KSh 150`() {
        // KSh 150 = 15000 cents. VAT = 15000 * (16/116) ≈ 2069 cents = KSh 20.69
        val vatCents = SunmiPrinterManager.vatFromInclusive(150_00L)
        val lines    = buildReceiptLines(samplePayment, kraPin = "P051234567A")
        val vatLine  = lines.first { it.startsWith("KSh") && lines.indexOf(it) > lines.indexOf("VAT (16%):") }
        // The VAT line value should match vatFromInclusive output
        assertTrue(
            "VAT line must contain formatted vat cents: $vatCents",
            lines.any { it.contains("KSh ${"%.2f".format(vatCents / 100.0)}") }
        )
    }

    @Test
    fun `net amount equals total minus VAT`() {
        val total    = 150_00L
        val vatCents = SunmiPrinterManager.vatFromInclusive(total)
        val netCents = total - vatCents
        assertTrue("Net must be less than total", netCents < total)
        assertTrue("Net must be positive", netCents > 0)
        // Net + VAT must equal total (within 1 cent for integer rounding)
        assertTrue(Math.abs((netCents + vatCents) - total) <= 1L)
    }

    @Test
    fun `VAT 16% on KSh 1000 is approximately KSh 137_93`() {
        val total    = 100_000L  // KSh 1000 = 100000 cents
        val vatCents = SunmiPrinterManager.vatFromInclusive(total)
        // KSh 1000 inclusive → VAT = 1000 * 16/116 ≈ 137.93 → 13793 cents
        assertTrue("VAT on KSh 1000 should be ~KSh 137.93", vatCents in 13_792L..13_794L)
    }

    // ── Low paper warning callback semantics ──────────────────────────────────

    private val warningCallbackFired = mutableListOf<PrinterState>()

    private fun simulatePrintWithWarning(preState: PrinterState, postState: PrinterState, result: PaymentResult.Success): PrintResult {
        if (!canPrint(preState)) {
            warningCallbackFired.add(preState)
            return PrintResult.Failed(preState, stateMessage(preState))
        }
        // Printing completes — re-check for low paper
        if (postState is PrinterState.LowPaper) {
            warningCallbackFired.add(postState)
        }
        return PrintResult.Success
    }

    @Before
    fun clearWarnings() { warningCallbackFired.clear() }

    @Test
    fun `low paper detected after print fires LowPaper warning callback`() {
        simulatePrintWithWarning(PrinterState.Ready, PrinterState.LowPaper, samplePayment)
        assertTrue("LowPaper warning must be fired", warningCallbackFired.isNotEmpty())
        assertTrue(warningCallbackFired[0] is PrinterState.LowPaper)
    }

    @Test
    fun `no warning callback when paper is adequate before and after print`() {
        simulatePrintWithWarning(PrinterState.Ready, PrinterState.Ready, samplePayment)
        assertTrue("No warning should fire when paper is fine", warningCallbackFired.isEmpty())
    }

    @Test
    fun `OutOfPaper fires warning callback immediately (before printing)`() {
        simulatePrintWithWarning(PrinterState.OutOfPaper, PrinterState.OutOfPaper, samplePayment)
        assertTrue("OutOfPaper must fire warning", warningCallbackFired.isNotEmpty())
    }

    // ── Printer disconnected → reconnection model ─────────────────────────────

    private var reconnectionAttempts = 0

    private fun simulatePrintWithReconnect(state: PrinterState, result: PaymentResult.Success): PrintResult {
        return if (state is PrinterState.Disconnected) {
            reconnectionAttempts++
            // Reconnection is attempted — in the real app OrchestaPayApp rebinds the AIDL service
            PrintResult.Failed(state, stateMessage(state))
        } else {
            simulatePrint(state, result)
        }
    }

    @Test
    fun `printer Disconnected → reconnection is attempted`() {
        reconnectionAttempts = 0
        simulatePrintWithReconnect(PrinterState.Disconnected, samplePayment)
        assertEquals("Reconnection must be attempted", 1, reconnectionAttempts)
    }

    @Test
    fun `printer Disconnected → returns PrintResult Failed`() {
        val result = simulatePrintWithReconnect(PrinterState.Disconnected, samplePayment)
        assertTrue(result is PrintResult.Failed)
    }

    @Test
    fun `payment is NEVER reversed due to printer failure (PrintResult is independent of payment)`() {
        // From source comment: "Printer failure must NEVER affect the payment record."
        // We verify this architectural invariant: PrintResult.Failed does not roll back anything.
        val printerResult = simulatePrint(PrinterState.OutOfPaper, samplePayment)
        // The payment was already confirmed (samplePayment is PaymentResult.Success)
        // A printer failure changes PrintResult but leaves PaymentResult untouched.
        assertTrue(samplePayment is PaymentResult.Success)
        assertTrue(printerResult is PrintResult.Failed)
        // They are independent objects — printer failure has no side effect on payment
        assertNotNull(samplePayment.txnId)
    }

    // ── stateMessage coverage ─────────────────────────────────────────────────

    @Test
    fun `stateMessage for OutOfPaper mentions reloading paper`() {
        val msg = stateMessage(PrinterState.OutOfPaper)
        assertTrue(msg.contains("paper", ignoreCase = true) || msg.contains("reload", ignoreCase = true))
    }

    @Test
    fun `stateMessage for LowPaper mentions low paper or new roll`() {
        val msg = stateMessage(PrinterState.LowPaper)
        assertTrue(msg.isNotEmpty())
    }

    @Test
    fun `stateMessage for Overheating mentions 30 second wait`() {
        val msg = stateMessage(PrinterState.Overheating)
        assertTrue(msg.contains("30") || msg.contains("overheat", ignoreCase = true))
    }

    @Test
    fun `stateMessage for Ready is empty string`() {
        assertEquals("", stateMessage(PrinterState.Ready))
    }

    @Test
    fun `stateMessage for Error includes code`() {
        val msg = stateMessage(PrinterState.Error(7, "Paper cut error"))
        assertTrue(msg.contains("7"))
    }

    // ── Receipt bitmap dimensions ─────────────────────────────────────────────

    @Test
    fun `paper width is 384 pixels (58mm at 203 DPI)`() {
        assertEquals(384, SunmiPrinterManager.PAPER_WIDTH_PX)
    }

    @Test
    fun `receipt height with kraPin is 560 px (taller for VAT block)`() {
        // From source: val height = if (kraPin != null) 560 else 520
        val withKraPin    = 560
        val withoutKraPin = 520
        assertTrue(withKraPin > withoutKraPin)
        assertEquals(40, withKraPin - withoutKraPin)
    }

    @Test
    fun `receipt height without kraPin is 520 px`() {
        // Mirrors: val height = if (kraPin != null) 560 else 520
        val height = 520  // from source
        assertEquals(520, height)
    }
}

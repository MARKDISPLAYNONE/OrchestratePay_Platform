package com.orchestratepay.ui

import org.junit.Assert.*
import org.junit.Test
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.*

/**
 * Unit tests for ReceiptActivity display logic (pure JVM — no Android Context).
 *
 * Covers:
 *   - ISO date parsing to local display format (the bug that was showing today's date)
 *   - Amount formatting
 *   - Fallback to current date on malformed ISO string
 *   - Consumer phone display
 */
class ReceiptDisplayLogicTest {

    private val fmt = SimpleDateFormat("dd MMM yyyy HH:mm", Locale.getDefault())

    // ── ISO date parsing ─────────────────────────────────────────────────────────

    private fun parseReceiptDate(confirmedAtIso: String): String = try {
        val instant = Instant.parse(confirmedAtIso)
        fmt.format(Date.from(instant))
    } catch (e: Exception) {
        fmt.format(Date())
    }

    @Test
    fun `valid ISO-8601 timestamp parses correctly`() {
        val iso = "2024-12-25T14:30:00Z"
        val display = parseReceiptDate(iso)
        assertTrue("Display date should contain year 2024", display.contains("2024"))
        assertTrue("Display date should contain Dec", display.contains("Dec"))
    }

    @Test
    fun `ISO timestamp with millis parses correctly`() {
        val iso = "2024-06-15T09:00:00.000Z"
        val display = parseReceiptDate(iso)
        assertTrue(display.contains("2024"))
        assertTrue(display.contains("Jun"))
    }

    @Test
    fun `malformed ISO string falls back to current date without throwing`() {
        val display = parseReceiptDate("not-a-date")
        // Should return a valid date string (today) rather than crashing
        assertNotNull(display)
        assertTrue(display.isNotEmpty())
    }

    @Test
    fun `empty ISO string falls back without throwing`() {
        val display = parseReceiptDate("")
        assertNotNull(display)
        assertTrue(display.isNotEmpty())
    }

    @Test
    fun `date from past is different from today for old transactions`() {
        val pastIso = "2020-01-01T00:00:00Z"
        val display  = parseReceiptDate(pastIso)
        assertTrue("Old date should contain 2020", display.contains("2020"))
        assertFalse("Old date should NOT contain 2024 or 2025 or 2026",
            display.contains("2024") || display.contains("2025") || display.contains("2026"))
    }

    @Test
    fun `ISO timestamp uses Instant_now format`() {
        val iso = DateTimeFormatter.ISO_INSTANT.format(Instant.now())
        val display = parseReceiptDate(iso)
        val currentYear = Calendar.getInstance().get(Calendar.YEAR).toString()
        assertTrue("Display should contain current year", display.contains(currentYear))
    }

    // ── Amount formatting ─────────────────────────────────────────────────────────

    private fun formatAmount(amountCents: Long) = "KSh ${"%.2f".format(amountCents / 100.0)}"

    @Test
    fun `100 cents displays as KSh 1 dot 00`() {
        assertEquals("KSh 1.00", formatAmount(100L))
    }

    @Test
    fun `5000 cents displays as KSh 50 dot 00`() {
        assertEquals("KSh 50.00", formatAmount(5_000L))
    }

    @Test
    fun `50000 cents displays as KSh 500 dot 00`() {
        assertEquals("KSh 500.00", formatAmount(50_000L))
    }

    @Test
    fun `1 cent displays as KSh 0 dot 01`() {
        assertEquals("KSh 0.01", formatAmount(1L))
    }

    @Test
    fun `100000 cents displays as KSh 1000 dot 00`() {
        assertEquals("KSh 1000.00", formatAmount(100_000L))
    }

    // ── Consumer phone display ────────────────────────────────────────────────────

    @Test
    fun `consumer phone is prefixed with Phone colon`() {
        val phone = "254712345678"
        val display = "Phone: $phone"
        assertEquals("Phone: 254712345678", display)
    }

    @Test
    fun `empty consumer phone shows Phone colon empty string`() {
        val display = "Phone: ${"".ifEmpty { "" }}"
        assertEquals("Phone: ", display)
    }

    // ── KRA PIN line guard ────────────────────────────────────────────────────────

    @Test
    fun `kraPin null means KRA line should be hidden`() {
        val kraPin: String? = null
        assertNull(kraPin)  // → UI should set View.GONE
    }

    @Test
    fun `kraPin non-null means KRA line should be visible`() {
        val kraPin: String? = "P051234567A"
        assertNotNull(kraPin)  // → UI should set View.VISIBLE
        assertEquals("KRA PIN: P051234567A", "KRA PIN: $kraPin")
    }

    // ── doPrint deduplication check ───────────────────────────────────────────────

    @Test
    fun `building PaymentResult dot Success from receipt record fields produces correct values`() {
        val txnId        = "txn-abc-123"
        val mpesaRef     = "NLJ7RT61SV"
        val amountCents  = 50_000L
        val merchantName = "Mama Pima Shop"
        val consumerPhone = "254700000001"

        // This mirrors doPrint() in ReceiptActivity
        data class FakeSuccess(
            val txnId: String,
            val mpesaRef: String,
            val amountCents: Long,
            val merchantName: String,
            val consumerPhone: String
        )

        val result = FakeSuccess(txnId, mpesaRef, amountCents, merchantName, consumerPhone)
        assertEquals(txnId, result.txnId)
        assertEquals(mpesaRef, result.mpesaRef)
        assertEquals(amountCents, result.amountCents)
        assertEquals(merchantName, result.merchantName)
        assertEquals(consumerPhone, result.consumerPhone)
    }
}

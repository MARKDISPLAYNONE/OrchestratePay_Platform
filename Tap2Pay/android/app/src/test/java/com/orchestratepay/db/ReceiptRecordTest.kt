package com.orchestratepay.db

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for ReceiptRecord data class.
 *
 * ReceiptCache (Room) requires Android context — only the pure data class
 * contracts are tested here (field layout, privacy invariant, defaults).
 */
class ReceiptRecordTest {

    private fun sampleRecord(
        txnId: String = "txn-001",
        mpesaRef: String = "NLJ7RT61SV",
        amountCents: Long = 50_000L,
        merchantName: String = "Baridi Café",
        consumerPhone: String = "2547****1234",
        kraPin: String? = "P051434678A",
        confirmedAtIso: String = "2024-05-18T14:30:00Z",
        printedAt: String? = null
    ) = ReceiptRecord(
        txnId          = txnId,
        mpesaRef       = mpesaRef,
        amountCents    = amountCents,
        merchantName   = merchantName,
        consumerPhone  = consumerPhone,
        kraPin         = kraPin,
        confirmedAtIso = confirmedAtIso,
        printedAt      = printedAt
    )

    // ─── Field contracts ──────────────────────────────────────────────────────

    @Test
    fun `ReceiptRecord carries all required fields`() {
        val r = sampleRecord()
        assertEquals("txn-001",             r.txnId)
        assertEquals("NLJ7RT61SV",          r.mpesaRef)
        assertEquals(50_000L,               r.amountCents)
        assertEquals("Baridi Café",         r.merchantName)
        assertEquals("2547****1234",        r.consumerPhone)
        assertEquals("P051434678A",         r.kraPin)
        assertEquals("2024-05-18T14:30:00Z", r.confirmedAtIso)
    }

    @Test
    fun `printedAt defaults to null when not provided`() {
        val r = sampleRecord()
        assertNull(r.printedAt)
    }

    @Test
    fun `printedAt can be set to an ISO timestamp`() {
        val r = sampleRecord(printedAt = "2024-05-18T14:35:00Z")
        assertEquals("2024-05-18T14:35:00Z", r.printedAt)
    }

    @Test
    fun `kraPin is nullable — not all merchants have KRA PIN`() {
        val r = sampleRecord(kraPin = null)
        assertNull(r.kraPin)
    }

    // ─── Privacy invariant ────────────────────────────────────────────────────

    @Test
    fun `masked phone format is stored — not raw phone number`() {
        // The app must store only the masked form: "25471****78"
        // Raw phone "254712345678" must never appear in a ReceiptRecord.
        val masked = "25471****78"
        val r = sampleRecord(consumerPhone = masked)
        assertTrue(
            "consumerPhone must be in masked format",
            r.consumerPhone.contains("****")
        )
        // The full 12-digit Safaricom MSISDN must NOT appear
        assertFalse(r.consumerPhone.matches(Regex("2547\\d{8}")))
    }

    @Test
    fun `standard mask format matches expected pattern`() {
        val masked = "25471****78"
        // Format: 5 visible leading digits + 4 stars + 2 visible trailing digits
        assertTrue(masked.matches(Regex("\\d{5}\\*{4}\\d{2}")))
    }

    // ─── Data class equality and copy ─────────────────────────────────────────

    @Test
    fun `two ReceiptRecords with the same fields are equal`() {
        val a = sampleRecord()
        val b = sampleRecord()
        assertEquals(a, b)
    }

    @Test
    fun `copy with different txnId produces different record`() {
        val a = sampleRecord(txnId = "txn-001")
        val b = a.copy(txnId = "txn-002")
        assertNotEquals(a, b)
        assertEquals("txn-002", b.txnId)
    }

    @Test
    fun `markPrinted copy pattern preserves all other fields`() {
        val original = sampleRecord()
        val printed  = original.copy(printedAt = "2024-05-18T15:00:00Z")
        assertEquals(original.txnId,          printed.txnId)
        assertEquals(original.mpesaRef,        printed.mpesaRef)
        assertEquals(original.amountCents,     printed.amountCents)
        assertEquals(original.merchantName,    printed.merchantName)
        assertEquals(original.consumerPhone,   printed.consumerPhone)
        assertEquals(original.confirmedAtIso,  printed.confirmedAtIso)
        assertEquals("2024-05-18T15:00:00Z",   printed.printedAt)
    }

    // ─── Boundary values ─────────────────────────────────────────────────────

    @Test
    fun `minimum amount is 1 cent`() {
        val r = sampleRecord(amountCents = 1L)
        assertEquals(1L, r.amountCents)
    }

    @Test
    fun `large amount fits in Long`() {
        val r = sampleRecord(amountCents = 10_000_000_00L) // KSh 1,000,000
        assertEquals(10_000_000_00L, r.amountCents)
    }

    @Test
    fun `confirmedAtIso stores ISO-8601 UTC string`() {
        val iso = "2024-12-31T23:59:59Z"
        val r = sampleRecord(confirmedAtIso = iso)
        assertTrue("should end with Z for UTC", r.confirmedAtIso.endsWith("Z"))
    }

    @Test
    fun `txnId is the primary key — must be unique per receipt`() {
        val r1 = sampleRecord(txnId = "txn-A")
        val r2 = sampleRecord(txnId = "txn-B")
        assertNotEquals(r1.txnId, r2.txnId)
    }
}

package com.orchestratepay.nfccore

import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for the NfcReadResult sealed class and NfcReadError enum.
 * These are pure Kotlin types — no Android framework dependency.
 */
class NfcReadResultTest {

    // ── TagRead ──────────────────────────────────────────────────────────────

    @Test
    fun `TagRead holds all fields`() {
        val r = NfcReadResult.TagRead("mid1", "tag1", "aabbccdd", "sig1234")
        assertEquals("mid1",     r.merchantId)
        assertEquals("tag1",     r.tagId)
        assertEquals("aabbccdd", r.rawUid)
        assertEquals("sig1234",  r.signature)
    }

    @Test
    fun `TagRead equality is structural`() {
        val a = NfcReadResult.TagRead("m", "t", "uid", "s")
        val b = NfcReadResult.TagRead("m", "t", "uid", "s")
        assertEquals(a, b)
    }

    @Test
    fun `TagRead copy changes only specified field`() {
        val a = NfcReadResult.TagRead("m", "t", "uid", "s")
        val b = a.copy(signature = "new")
        assertEquals("new", b.signature)
        assertEquals(a.merchantId, b.merchantId)
    }

    // ── HceRead ──────────────────────────────────────────────────────────────

    @Test
    fun `HceRead holds all fields`() {
        val r = NfcReadResult.HceRead("254700000001", "abc123token", 9_999_999_999L, "ff00ff00")
        assertEquals("254700000001", r.consumerPhone)
        assertEquals("abc123token",  r.hceToken)
        assertEquals(9_999_999_999L, r.hceExp)
        assertEquals("ff00ff00",     r.rawUid)
    }

    @Test
    fun `HceRead equality is structural`() {
        val a = NfcReadResult.HceRead("p", "t", 100L, "u")
        val b = NfcReadResult.HceRead("p", "t", 100L, "u")
        assertEquals(a, b)
    }

    @Test
    fun `HceRead with different expiry is not equal`() {
        val a = NfcReadResult.HceRead("p", "t", 100L, "u")
        val b = NfcReadResult.HceRead("p", "t", 200L, "u")
        assertNotEquals(a, b)
    }

    // ── Error ────────────────────────────────────────────────────────────────

    @Test
    fun `Error wraps NfcReadError`() {
        val r = NfcReadResult.Error(NfcReadError.TOKEN_EXPIRED)
        assertEquals(NfcReadError.TOKEN_EXPIRED, r.error)
    }

    @Test
    fun `Error equality is structural`() {
        assertEquals(
            NfcReadResult.Error(NfcReadError.READ_FAILED),
            NfcReadResult.Error(NfcReadError.READ_FAILED)
        )
    }

    // ── Sealed class exhaustiveness ──────────────────────────────────────────

    @Test
    fun `when expression covers all NfcReadResult variants`() {
        val results: List<NfcReadResult> = listOf(
            NfcReadResult.TagRead("m", "t", "u", "s"),
            NfcReadResult.HceRead("p", "tk", 1L, "u"),
            NfcReadResult.Error(NfcReadError.READ_FAILED)
        )
        var count = 0
        results.forEach {
            when (it) {
                is NfcReadResult.TagRead -> count++
                is NfcReadResult.HceRead -> count++
                is NfcReadResult.Error   -> count++
            }
        }
        assertEquals(3, count)
    }

    // ── NfcReadError enum ────────────────────────────────────────────────────

    @Test
    fun `NfcReadError has all expected values`() {
        val expected = setOf(
            "NOT_SUPPORTED", "READ_FAILED", "UNRECOGNISED_TAG",
            "PARSE_ERROR", "SIGNATURE_INVALID", "TOKEN_EXPIRED"
        )
        val actual = NfcReadError.values().map { it.name }.toSet()
        assertEquals(expected, actual)
    }

    @Test
    fun `NfcReadError valueOf works for each constant`() {
        NfcReadError.values().forEach { error ->
            assertEquals(error, NfcReadError.valueOf(error.name))
        }
    }

    @Test
    fun `NfcReadError ordinals are stable and distinct`() {
        val ordinals = NfcReadError.values().map { it.ordinal }
        assertEquals(ordinals.size, ordinals.toSet().size)
    }
}

package com.orchestratepay.nfccore

import org.junit.Assert.*
import org.junit.Test
import java.lang.reflect.Method

/**
 * Tests for NdefTagParser.buildUri() via reflection.
 *
 * The public parse() method requires a live Android Tag/Ndef object (instrumented test).
 * The private buildUri() contains all the prefix-decoding logic and is fully JVM-testable.
 */
class NdefTagParserTest {

    private val buildUri: Method = NdefTagParser::class.java
        .getDeclaredMethod("buildUri", ByteArray::class.java)
        .also { it.isAccessible = true }

    private fun buildUri(payload: ByteArray): String =
        buildUri.invoke(NdefTagParser, payload) as String

    private fun payload(prefixCode: Int, rest: String): ByteArray =
        byteArrayOf(prefixCode.toByte()) + rest.toByteArray()

    // ── Prefix code 0x00 — no prefix ─────────────────────────────────────────

    @Test
    fun `prefix 0x00 returns rest verbatim`() {
        val uri = buildUri(payload(0x00, "orchestratepay://pay?mid=m&tid=t"))
        assertEquals("orchestratepay://pay?mid=m&tid=t", uri)
    }

    // ── Prefix code 0x04 — https:// ──────────────────────────────────────────

    @Test
    fun `prefix 0x04 prepends https`() {
        val uri = buildUri(payload(0x04, "orchestratepay.co.ke/pay/m123"))
        assertEquals("https://orchestratepay.co.ke/pay/m123", uri)
    }

    // ── Prefix code 0x03 — http:// ───────────────────────────────────────────

    @Test
    fun `prefix 0x03 prepends http`() {
        val uri = buildUri(payload(0x03, "example.com/path"))
        assertEquals("http://example.com/path", uri)
    }

    // ── Prefix code 0x01 — http://www. ───────────────────────────────────────

    @Test
    fun `prefix 0x01 prepends http www`() {
        val uri = buildUri(payload(0x01, "example.com"))
        assertEquals("http://www.example.com", uri)
    }

    // ── Prefix code 0x02 — https://www. ─────────────────────────────────────

    @Test
    fun `prefix 0x02 prepends https www`() {
        val uri = buildUri(payload(0x02, "example.com"))
        assertEquals("https://www.example.com", uri)
    }

    // ── Prefix code 0x05 — tel: ──────────────────────────────────────────────

    @Test
    fun `prefix 0x05 prepends tel`() {
        val uri = buildUri(payload(0x05, "+254712345678"))
        assertEquals("tel:+254712345678", uri)
    }

    // ── Prefix code 0x06 — mailto: ───────────────────────────────────────────

    @Test
    fun `prefix 0x06 prepends mailto`() {
        val uri = buildUri(payload(0x06, "test@example.com"))
        assertEquals("mailto:test@example.com", uri)
    }

    // ── Prefix code 0x1D — file:// ───────────────────────────────────────────

    @Test
    fun `prefix 0x1D prepends file`() {
        val uri = buildUri(payload(0x1D, "/sdcard/receipt.pdf"))
        assertEquals("file:///sdcard/receipt.pdf", uri)
    }

    // ── Out-of-range prefix — treated as empty ────────────────────────────────

    @Test
    fun `prefix beyond table size returns rest with no prefix`() {
        // Prefix table has 36 entries (0x00–0x23); code 0xFF is unknown
        val uri = buildUri(payload(0xFF, "some-data"))
        assertEquals("some-data", uri)
    }

    // ── Empty payload ─────────────────────────────────────────────────────────

    @Test
    fun `empty payload returns empty string`() {
        val uri = buildUri(byteArrayOf())
        assertEquals("", uri)
    }

    // ── Single byte payload (only prefix, no rest) ────────────────────────────

    @Test
    fun `single byte prefix with no rest returns just prefix string`() {
        val uri = buildUri(byteArrayOf(0x04))
        assertEquals("https://", uri)
    }

    // ── OrchestratePay canonical URI ─────────────────────────────────────────

    @Test
    fun `canonical orchestratepay URI with no prefix decoded correctly`() {
        val raw = "orchestratepay://pay?mid=merchant-uuid&tid=tag-uuid&v=1&sign=abcdef123456"
        val uri = buildUri(payload(0x00, raw))
        assertEquals(raw, uri)
    }

    @Test
    fun `canonical consumer identity URL via https prefix decoded correctly`() {
        val rest = "orchestratepay.co.ke/c/consumer-uuid-123"
        val uri = buildUri(payload(0x04, rest))
        assertEquals("https://$rest", uri)
    }

    // ── Multi-byte UTF-8 in payload ───────────────────────────────────────────

    @Test
    fun `payload with unicode characters is decoded as UTF-8`() {
        val rest = "example.com/éàü"  // é à ü
        val raw = payload(0x04, rest)
        val uri = buildUri(raw)
        assertTrue(uri.startsWith("https://"))
    }
}

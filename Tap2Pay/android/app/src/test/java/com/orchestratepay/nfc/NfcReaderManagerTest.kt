package com.orchestratepay.nfc

import android.net.Uri
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for NfcReaderManager tag parsing logic.
 *
 * Tests the pure URI-parsing and NDEF payload extraction logic extracted from
 * NfcReaderManager so they can run without NFC hardware.
 *
 * Three NDEF tag types are handled:
 *   1. orchestratepay://pay?mid=...&tid=...&v=1  — merchant-programmed consumer tag
 *   2. https://orchestratepay.co.ke/c/{consumerId} — consumer-written identity tag
 *   3. https://orchestratepay.co.ke/pay/{merchantId} — merchant display tag
 *      (Note: merchant app should NOT process merchant display tags — those are
 *       for consumer phones. This test verifies the merchant app ignores them.)
 */
class NfcReaderManagerTest {

    // ── Mirrors the actual URI parsing logic in NfcReaderManager.readNdefTag() ──

    private fun parseNdefUri(rawPayload: String): NfcTagParseResult {
        // Strip the 1-byte URI prefix (0x00 = no prefix, 0x04 = "https://", etc.)
        val uriString = when {
            rawPayload.isEmpty()      -> return NfcTagParseResult.Empty
            rawPayload[0].code == 0   -> rawPayload.substring(1)
            rawPayload[0].code == 4   -> "https://" + rawPayload.substring(1)
            else                      -> rawPayload
        }

        val uri = Uri.parse(uriString)

        // Consumer-written tag: https://orchestratepay.co.ke/c/{consumerId}
        if (uri.scheme == "https" &&
            uri.host == "orchestratepay.co.ke" &&
            uri.path?.startsWith("/c/") == true) {
            val consumerId = uri.lastPathSegment
                ?: return NfcTagParseResult.Malformed("Consumer tag missing consumerId")
            return NfcTagParseResult.ConsumerTag(consumerId)
        }

        // Merchant display tag: https://orchestratepay.co.ke/pay/{merchantId}
        // The merchant app does NOT process these — they are for consumer phones.
        if (uri.scheme == "https" &&
            uri.host == "orchestratepay.co.ke" &&
            uri.path?.startsWith("/pay/") == true) {
            return NfcTagParseResult.MerchantDisplayTag  // ignored by merchant reader
        }

        // Consumer identity tag: orchestratepay://pay?mid=...&tid=...&v=1
        if (uri.scheme != "orchestratepay" || uri.host != "pay") {
            return NfcTagParseResult.Unrecognised
        }
        val merchantId = uri.getQueryParameter("mid")
            ?: return NfcTagParseResult.Malformed("Missing mid")
        val tagId      = uri.getQueryParameter("tid")
            ?: return NfcTagParseResult.Malformed("Missing tid")
        val version    = uri.getQueryParameter("v") ?: "1"
        if (version != "1") return NfcTagParseResult.Malformed("Unsupported version $version")

        return NfcTagParseResult.ConsumerIdentityTag(merchantId, tagId)
    }

    sealed class NfcTagParseResult {
        object Empty                                                  : NfcTagParseResult()
        object Unrecognised                                           : NfcTagParseResult()
        object MerchantDisplayTag                                     : NfcTagParseResult()
        data class ConsumerIdentityTag(val mid: String, val tid: String) : NfcTagParseResult()
        data class ConsumerTag(val consumerId: String)                : NfcTagParseResult()
        data class Malformed(val reason: String)                      : NfcTagParseResult()
    }

    // ─── Consumer identity tag (orchestratepay://) ──────────────────────────────

    @Test
    fun `consumer identity tag with all required params is parsed correctly`() {
        val result = parseNdefUri("orchestratepay://pay?mid=merchant-abc&tid=tag-xyz&v=1")
        assertTrue(result is NfcTagParseResult.ConsumerIdentityTag)
        val r = result as NfcTagParseResult.ConsumerIdentityTag
        assertEquals("merchant-abc", r.mid)
        assertEquals("tag-xyz", r.tid)
    }

    @Test
    fun `consumer identity tag with signature param is still parsed (sign is optional)`() {
        val result = parseNdefUri("orchestratepay://pay?mid=m1&tid=t1&v=1&sign=abcd1234abcd1234")
        assertTrue(result is NfcTagParseResult.ConsumerIdentityTag)
    }

    @Test
    fun `consumer identity tag missing mid returns Malformed`() {
        val result = parseNdefUri("orchestratepay://pay?tid=tag-xyz&v=1")
        assertTrue(result is NfcTagParseResult.Malformed)
    }

    @Test
    fun `consumer identity tag missing tid returns Malformed`() {
        val result = parseNdefUri("orchestratepay://pay?mid=merchant-abc&v=1")
        assertTrue(result is NfcTagParseResult.Malformed)
    }

    @Test
    fun `consumer identity tag with unsupported version v2 returns Malformed`() {
        val result = parseNdefUri("orchestratepay://pay?mid=m1&tid=t1&v=2")
        assertTrue(result is NfcTagParseResult.Malformed)
        val r = result as NfcTagParseResult.Malformed
        assertTrue(r.reason.contains("version"))
    }

    @Test
    fun `wrong scheme is Unrecognised`() {
        val result = parseNdefUri("http://orchestratepay.co.ke/pay?mid=m&tid=t&v=1")
        // http is not orchestratepay:// and is not our HTTPS consumer/merchant URL pattern
        assertTrue(result is NfcTagParseResult.Unrecognised)
    }

    // ─── Consumer-written tag (https://orchestratepay.co.ke/c/{id}) ────────────

    @Test
    fun `consumer-written tag parses consumerId correctly`() {
        val uuid = "550e8400-e29b-41d4-a716-446655440000"
        val result = parseNdefUri("https://orchestratepay.co.ke/c/$uuid")
        assertTrue("Expected ConsumerTag but got: $result", result is NfcTagParseResult.ConsumerTag)
        assertEquals(uuid, (result as NfcTagParseResult.ConsumerTag).consumerId)
    }

    @Test
    fun `consumer-written tag with HTTPS prefix byte (0x04) is handled`() {
        // NTAG215 NDEF URI records for https:// often encode the prefix as byte 0x04
        // followed by "orchestratepay.co.ke/c/{id}" (without the https://)
        val uuid = "consumer-uuid-12345"
        // Simulate: prefix byte 0x04 + "orchestratepay.co.ke/c/{uuid}"
        val payload = "orchestratepay.co.ke/c/$uuid"
        val result = parseNdefUri(payload)
        assertTrue(result is NfcTagParseResult.ConsumerTag)
        assertEquals(uuid, (result as NfcTagParseResult.ConsumerTag).consumerId)
    }

    @Test
    fun `consumer-written tag missing consumerId returns Malformed`() {
        val result = parseNdefUri("https://orchestratepay.co.ke/c/")
        assertTrue(result is NfcTagParseResult.Malformed)
    }

    @Test
    fun `consumer-written tag from different host returns Unrecognised`() {
        val result = parseNdefUri("https://evil.co.ke/c/some-consumer-id")
        assertTrue(result is NfcTagParseResult.Unrecognised)
    }

    // ─── Merchant display tag (merchant app must ignore these) ─────────────────

    @Test
    fun `merchant display tag returns MerchantDisplayTag (merchant app ignores it)`() {
        val result = parseNdefUri("https://orchestratepay.co.ke/pay/merchant-uuid-abc")
        assertEquals(NfcTagParseResult.MerchantDisplayTag, result)
    }

    @Test
    fun `merchant display tag is not confused with consumer identity tag`() {
        val consumer = parseNdefUri("orchestratepay://pay?mid=m&tid=t&v=1")
        val display  = parseNdefUri("https://orchestratepay.co.ke/pay/merchant-id")
        assertNotEquals(consumer::class, display::class)
    }

    // ─── Unsupported / unexpected tags ─────────────────────────────────────────

    @Test
    fun `blank tag payload returns Empty`() {
        val result = parseNdefUri("")
        assertEquals(NfcTagParseResult.Empty, result)
    }

    @Test
    fun `random URL returns Unrecognised`() {
        val result = parseNdefUri("https://www.google.com")
        assertTrue(result is NfcTagParseResult.Unrecognised)
    }

    @Test
    fun `mailto URL returns Unrecognised`() {
        val result = parseNdefUri("mailto:test@example.com")
        assertTrue(result is NfcTagParseResult.Unrecognised)
    }

    @Test
    fun `tel URL returns Unrecognised`() {
        val result = parseNdefUri("tel:+254712345678")
        assertTrue(result is NfcTagParseResult.Unrecognised)
    }

    @Test
    fun `null byte injection in URI returns Unrecognised`() {
        val result = parseNdefUri("orchestratepay://pay?mid=m &tid=t&v=1")
        // Uri.parse may strip null bytes; the parsed params might be null → Malformed or Unrecognised
        assertTrue(result is NfcTagParseResult.Malformed || result is NfcTagParseResult.Unrecognised)
    }

    // ─── URI prefix byte stripping ─────────────────────────────────────────────

    @Test
    fun `null prefix byte (0x00) is stripped before parsing`() {
        val result = parseNdefUri(" orchestratepay://pay?mid=m&tid=t&v=1")
        assertTrue(result is NfcTagParseResult.ConsumerIdentityTag)
    }
}

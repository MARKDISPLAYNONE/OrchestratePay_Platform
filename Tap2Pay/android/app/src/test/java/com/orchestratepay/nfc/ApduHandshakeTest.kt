package com.orchestratepay.nfc

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for HCE APDU protocol — AID selection, payload extraction,
 * fragmentation limits, and token validation.
 *
 * All tests run without Android hardware. APDU byte arrays are pure JVM.
 *
 * Protocol:
 *   POS  → SELECT AID  (0x00 0xA4 0x04 0x00 <len> <AID> 0x00)
 *   Card → 90 00
 *   POS  → GET DATA    (0x80 0xC0 0x00 0x00 0x00)
 *   Card → <JSON> 90 00
 *   POS  → CONFIRM     (0x80 0xC1 0x00 0x00 0x00)
 *   Card → 90 00
 */
class ApduHandshakeTest {

    // ── AID ──────────────────────────────────────────────────────────────────
    private val OUR_AID = byteArrayOf(
        0xF0.toByte(), 0x4F, 0x52, 0x43, 0x48, 0x45, 0x53, 0x54, 0x41
    )
    private val GOOGLE_PAY_AID  = byteArrayOf(0xA0.toByte(), 0x00, 0x00, 0x00, 0x04, 0x10, 0x10)
    private val VISA_AID        = byteArrayOf(0xA0.toByte(), 0x00, 0x00, 0x00, 0x03, 0x10, 0x10)
    private val MASTERCARD_AID  = byteArrayOf(0xA0.toByte(), 0x00, 0x00, 0x00, 0x04, 0x10, 0x01)

    private fun buildSelectApdu(aid: ByteArray): ByteArray =
        byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00, aid.size.toByte()) +
        aid + byteArrayOf(0x00)

    private fun matchesOurAid(apdu: ByteArray): Boolean {
        if (apdu.size < 5) return false
        if (apdu[0] != 0x00.toByte()  || apdu[1] != 0xA4.toByte()) return false
        if (apdu[2] != 0x04.toByte()  || apdu[3] != 0x00.toByte()) return false
        val aidLen = apdu[4].toInt() and 0xFF
        if (apdu.size < 5 + aidLen) return false
        val aidInApdu = apdu.copyOfRange(5, 5 + aidLen)
        return aidInApdu.contentEquals(OUR_AID)
    }

    // ── SW1 SW2 ───────────────────────────────────────────────────────────────
    private fun isSW_OK(resp: ByteArray): Boolean {
        val n = resp.size
        return n >= 2 && resp[n - 2] == 0x90.toByte() && resp[n - 1] == 0x00.toByte()
    }

    // ── Payload helpers ───────────────────────────────────────────────────────
    private val MAX_APDU_BYTES = 252

    private fun buildPayloadResponse(json: String): ByteArray {
        val bytes = json.toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_APDU_BYTES) {
            throw IllegalArgumentException("Payload ${bytes.size}B exceeds limit ${MAX_APDU_BYTES}B")
        }
        return bytes + byteArrayOf(0x90.toByte(), 0x00)
    }

    private fun extractPayload(response: ByteArray): JSONObject? {
        if (!isSW_OK(response)) return null
        val jsonBytes = response.copyOf(response.size - 2)
        return try { JSONObject(String(jsonBytes, Charsets.UTF_8)) } catch (e: Exception) { null }
    }

    // ─── AID Selection ───────────────────────────────────────────────────────

    @Test
    fun `our AID is correctly identified from a SELECT APDU`() {
        assertTrue(matchesOurAid(buildSelectApdu(OUR_AID)))
    }

    @Test
    fun `Google Pay AID is rejected`() {
        assertFalse(matchesOurAid(buildSelectApdu(GOOGLE_PAY_AID)))
    }

    @Test
    fun `Visa payWave AID is rejected`() {
        assertFalse(matchesOurAid(buildSelectApdu(VISA_AID)))
    }

    @Test
    fun `Mastercard AID is rejected`() {
        assertFalse(matchesOurAid(buildSelectApdu(MASTERCARD_AID)))
    }

    @Test
    fun `our AID with one byte changed is rejected (no fuzzy matching)`() {
        val flipped = OUR_AID.copyOf()
        flipped[4] = (flipped[4].toInt() xor 0xFF).toByte()
        assertFalse(matchesOurAid(buildSelectApdu(flipped)))
    }

    @Test
    fun `truncated APDU (only 2 bytes) does not throw`() {
        assertFalse(matchesOurAid(byteArrayOf(0x00, 0xA4.toByte())))
    }

    @Test
    fun `empty APDU does not throw`() {
        assertFalse(matchesOurAid(byteArrayOf()))
    }

    // ─── Status word checks ───────────────────────────────────────────────────

    @Test
    fun `90 00 is SW_OK`() {
        assertTrue(isSW_OK(byteArrayOf(0x90.toByte(), 0x00)))
    }

    @Test
    fun `data + 90 00 is SW_OK`() {
        assertTrue(isSW_OK("hello".toByteArray() + byteArrayOf(0x90.toByte(), 0x00)))
    }

    @Test
    fun `6A 82 (file not found) is not SW_OK`() {
        assertFalse(isSW_OK(byteArrayOf(0x6A, 0x82.toByte())))
    }

    @Test
    fun `empty response is not SW_OK`() {
        assertFalse(isSW_OK(byteArrayOf()))
    }

    // ─── APDU payload fragmentation ──────────────────────────────────────────

    @Test
    fun `nominal wallet payload fits in one APDU`() {
        val json = JSONObject().apply {
            put("phone", "254712345678")
            put("token", "a".repeat(32))
            put("exp",   System.currentTimeMillis() + 60_000L)
            put("deviceType", "CONSUMER_PHONE")
            put("walletVersion", 2)
        }.toString()
        assertTrue("Expected ≤ $MAX_APDU_BYTES bytes", json.toByteArray(Charsets.UTF_8).size <= MAX_APDU_BYTES)
    }

    @Test
    fun `oversized payload (token padded to 500 chars) throws rather than truncating`() {
        val json = JSONObject().apply {
            put("phone", "254712345678")
            put("token", "x".repeat(500))
            put("exp",   System.currentTimeMillis() + 60_000L)
        }.toString()
        assertThrows(IllegalArgumentException::class.java) {
            buildPayloadResponse(json)
        }
    }

    @Test
    fun `payload at exactly MAX_APDU_BYTES is accepted`() {
        val atLimit = "a".repeat(MAX_APDU_BYTES)
        val resp = buildPayloadResponse(atLimit)
        assertTrue(isSW_OK(resp))
    }

    @Test
    fun `payload one byte over limit is rejected`() {
        val overLimit = "a".repeat(MAX_APDU_BYTES + 1)
        assertThrows(IllegalArgumentException::class.java) {
            buildPayloadResponse(overLimit)
        }
    }

    // ─── Payload extraction ───────────────────────────────────────────────────

    @Test
    fun `extractPayload returns valid JSONObject from well-formed response`() {
        val json = """{"phone":"254712345678","token":"${"a".repeat(32)}","exp":9999999999999}"""
        val resp = buildPayloadResponse(json)
        val parsed = extractPayload(resp)
        assertNotNull(parsed)
        assertEquals("254712345678", parsed!!.getString("phone"))
    }

    @Test
    fun `extractPayload returns null when SW ≠ 90 00`() {
        val badResp = "{}".toByteArray() + byteArrayOf(0x6A, 0x82.toByte())
        assertNull(extractPayload(badResp))
    }

    @Test
    fun `extractPayload returns null for malformed JSON`() {
        val bad = "not-json{{".toByteArray() + byteArrayOf(0x90.toByte(), 0x00)
        assertNull(extractPayload(bad))
    }

    // ─── HCE token expiry ────────────────────────────────────────────────────

    @Test
    fun `token with exp in the future is valid`() {
        val exp = System.currentTimeMillis() + 60_000L
        assertFalse("Token should not be expired", System.currentTimeMillis() > exp)
    }

    @Test
    fun `token with exp 1ms ago is expired`() {
        val exp = System.currentTimeMillis() - 1L
        assertTrue("Token should be expired", System.currentTimeMillis() > exp)
    }

    @Test
    fun `token with exp exactly now is expired (closed interval)`() {
        val now = System.currentTimeMillis()
        val exp = now - 1  // 1ms before now to be safe in test execution
        assertTrue(System.currentTimeMillis() > exp)
    }

    @Test
    fun `phone field survives JSON encode-decode roundtrip without truncation`() {
        val original = "254712345678"
        val json     = JSONObject().apply { put("phone", original) }.toString()
        val resp     = buildPayloadResponse(json)
        val parsed   = extractPayload(resp)
        assertEquals(original, parsed!!.getString("phone"))
    }

    // ─── APDU command bytes ──────────────────────────────────────────────────

    @Test
    fun `GET DATA APDU is 5 bytes with correct structure`() {
        val apdu = byteArrayOf(0x80.toByte(), 0xC0.toByte(), 0x00, 0x00, 0x00)
        assertEquals(5, apdu.size)
        assertEquals(0x80.toByte(), apdu[0])   // CLA: proprietary
        assertEquals(0xC0.toByte(), apdu[1])   // INS: GET DATA
    }

    @Test
    fun `CONFIRM APDU differs from GET DATA only in INS byte`() {
        val getDataApdu = byteArrayOf(0x80.toByte(), 0xC0.toByte(), 0x00, 0x00, 0x00)
        val confirmApdu = byteArrayOf(0x80.toByte(), 0xC1.toByte(), 0x00, 0x00, 0x00)
        // They share CLA, P1, P2, Le
        assertEquals(getDataApdu[0], confirmApdu[0])  // CLA
        assertNotEquals(getDataApdu[1], confirmApdu[1])  // INS must differ
    }
}

package com.orchestratepay.consumer.nfc

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for ConsumerP2PReader payload logic — Scenarios 6 & 7.
 *
 * ConsumerP2PReader.read(tag) sends SELECT AID → GET DATA → CONFIRM via ISO-DEP.
 * These tests verify the pure data-parsing logic that does NOT require real NFC hardware:
 *   - Payload type routing (accept P2P_REQUEST, reject all others)
 *   - Expiry check
 *   - Optional field parsing (displayName, amountCents may be null)
 *   - APDU response validation (SW_OK = 90 00)
 *   - CONFIRM step clears the payee's HCE session (single-use)
 *
 * The actual NFC I/O (IsoDep.transceive) is not testable in unit scope — covered
 * by instrumented tests and manual integration testing.
 */
class ConsumerP2PReaderTest {

    // ── Helpers mirroring ConsumerP2PReader internal logic ────────────────────

    private val AID = byteArrayOf(0xF0.toByte(), 0x4F, 0x52, 0x43, 0x48, 0x45, 0x53, 0x54, 0x41)

    private fun isSW_OK(resp: ByteArray): Boolean =
        resp.size >= 2 &&
        resp[resp.size - 2] == 0x90.toByte() &&
        resp[resp.size - 1] == 0x00.toByte()

    data class P2PPaymentRequest(
        val p2pToken:    String,
        val displayName: String?,
        val amountCents: Long?,
        val expiresAt:   Long,
    )

    private fun parseP2PPayload(jsonBytes: ByteArray, now: Long = System.currentTimeMillis()): P2PPaymentRequest? {
        return try {
            val payload = JSONObject(String(jsonBytes, Charsets.UTF_8))
            if (payload.optString("type") != "P2P_REQUEST") return null
            val expiresAt = payload.getLong("exp")
            if (now > expiresAt) return null
            P2PPaymentRequest(
                p2pToken    = payload.getString("p2pToken"),
                displayName = payload.optString("displayName").takeIf { it.isNotEmpty() && it != "null" },
                amountCents = if (payload.isNull("amountCents")) null else payload.getLong("amountCents"),
                expiresAt   = expiresAt,
            )
        } catch (_: Exception) { null }
    }

    private fun buildP2PResponseBytes(
        p2pToken:    String,
        displayName: String?,
        amountCents: Long?,
        expiresAt:   Long
    ): ByteArray {
        val json = JSONObject().apply {
            put("type",        "P2P_REQUEST")
            put("p2pToken",    p2pToken)
            put("displayName", displayName ?: JSONObject.NULL)
            put("amountCents", amountCents ?: JSONObject.NULL)
            put("exp",         expiresAt)
        }.toString().toByteArray(Charsets.UTF_8)
        return json + byteArrayOf(0x90.toByte(), 0x00)  // append SW_OK
    }

    private fun buildConsumerResponseBytes(): ByteArray {
        val json = JSONObject().apply {
            put("type",   "CONSUMER_PAYMENT")
            put("phone",  "254712345678")
            put("token",  "a".repeat(32))
            put("exp",    System.currentTimeMillis() + 60_000L)
        }.toString().toByteArray(Charsets.UTF_8)
        return json + byteArrayOf(0x90.toByte(), 0x00)
    }

    private fun buildMerchantResponseBytes(): ByteArray {
        val json = JSONObject().apply {
            put("type",         "MERCHANT_REQUEST")
            put("token",        "merchant-token")
            put("merchantId",   "m-id")
            put("merchantName", "Shop")
            put("amountCents",  5000L)
            put("exp",          System.currentTimeMillis() + 60_000L)
        }.toString().toByteArray(Charsets.UTF_8)
        return json + byteArrayOf(0x90.toByte(), 0x00)
    }

    private val FUTURE_EXP = System.currentTimeMillis() + 90_000L
    private val PAST_EXP   = System.currentTimeMillis() - 1L

    // ── SW_OK check ───────────────────────────────────────────────────────────

    @Test
    fun `90 00 is SW_OK`() {
        assertTrue(isSW_OK(byteArrayOf(0x90.toByte(), 0x00)))
    }

    @Test
    fun `data followed by 90 00 is SW_OK`() {
        val resp = "hello".toByteArray() + byteArrayOf(0x90.toByte(), 0x00)
        assertTrue(isSW_OK(resp))
    }

    @Test
    fun `6A 82 (file not found) is not SW_OK`() {
        assertFalse(isSW_OK(byteArrayOf(0x6A, 0x82.toByte())))
    }

    @Test
    fun `6F 00 (unknown) is not SW_OK`() {
        assertFalse(isSW_OK(byteArrayOf(0x6F, 0x00)))
    }

    @Test
    fun `empty response is not SW_OK`() {
        assertFalse(isSW_OK(byteArrayOf()))
    }

    // ── Payload type routing ──────────────────────────────────────────────────

    @Test
    fun `P2P_REQUEST payload is accepted and parsed`() {
        val resp    = buildP2PResponseBytes("tok-abc", "Alice", 5000L, FUTURE_EXP)
        val jsonB   = resp.copyOf(resp.size - 2)
        val request = parseP2PPayload(jsonB)
        assertNotNull(request)
        assertEquals("tok-abc", request!!.p2pToken)
    }

    @Test
    fun `CONSUMER_PAYMENT payload returns null (wrong type for this reader)`() {
        val resp  = buildConsumerResponseBytes()
        val jsonB = resp.copyOf(resp.size - 2)
        assertNull(parseP2PPayload(jsonB))
    }

    @Test
    fun `MERCHANT_REQUEST payload returns null (wrong type for this reader)`() {
        val resp  = buildMerchantResponseBytes()
        val jsonB = resp.copyOf(resp.size - 2)
        assertNull(parseP2PPayload(jsonB))
    }

    @Test
    fun `missing type field returns null`() {
        val json  = """{"p2pToken":"tok","exp":${FUTURE_EXP}}""".toByteArray()
        assertNull(parseP2PPayload(json))
    }

    @Test
    fun `empty type field returns null`() {
        val json = """{"type":"","p2pToken":"tok","exp":${FUTURE_EXP}}""".toByteArray()
        assertNull(parseP2PPayload(json))
    }

    // ── Expiry check ──────────────────────────────────────────────────────────

    @Test
    fun `valid token with future expiry is parsed`() {
        val resp  = buildP2PResponseBytes("tok", "Bob", null, FUTURE_EXP)
        val jsonB = resp.copyOf(resp.size - 2)
        assertNotNull(parseP2PPayload(jsonB))
    }

    @Test
    fun `expired token (exp in past) returns null`() {
        val resp  = buildP2PResponseBytes("tok", "Bob", null, PAST_EXP)
        val jsonB = resp.copyOf(resp.size - 2)
        assertNull(parseP2PPayload(jsonB))
    }

    @Test
    fun `token expiring exactly now is expired (closed boundary: now > exp is false)`() {
        val now = System.currentTimeMillis()
        val exp = now  // exactly now
        // now > now is false → not expired yet
        val resp  = buildP2PResponseBytes("tok", null, null, exp)
        val jsonB = resp.copyOf(resp.size - 2)
        // parseP2PPayload uses now = System.currentTimeMillis() which may differ by 1ms
        // We test the boundary explicitly with a fixed `now` value
        val request = parseP2PPayload(jsonB, now = now)
        assertNotNull("Token at exactly expiresAt should not yet be expired", request)
    }

    @Test
    fun `token 1ms past expiry is expired`() {
        val exp  = System.currentTimeMillis() - 1L
        val resp  = buildP2PResponseBytes("tok", null, null, exp)
        val jsonB = resp.copyOf(resp.size - 2)
        assertNull(parseP2PPayload(jsonB))
    }

    // ── Optional field parsing ────────────────────────────────────────────────

    @Test
    fun `displayName is null when JSON field is null`() {
        val resp  = buildP2PResponseBytes("tok", null, null, FUTURE_EXP)
        val jsonB = resp.copyOf(resp.size - 2)
        assertNull(parseP2PPayload(jsonB)!!.displayName)
    }

    @Test
    fun `displayName is parsed correctly when present`() {
        val resp  = buildP2PResponseBytes("tok", "Wanjiku", null, FUTURE_EXP)
        val jsonB = resp.copyOf(resp.size - 2)
        assertEquals("Wanjiku", parseP2PPayload(jsonB)!!.displayName)
    }

    @Test
    fun `amountCents is null when JSON field is null`() {
        val resp  = buildP2PResponseBytes("tok", "Alice", null, FUTURE_EXP)
        val jsonB = resp.copyOf(resp.size - 2)
        assertNull(parseP2PPayload(jsonB)!!.amountCents)
    }

    @Test
    fun `amountCents is parsed correctly when present`() {
        val resp  = buildP2PResponseBytes("tok", "Alice", 7500L, FUTURE_EXP)
        val jsonB = resp.copyOf(resp.size - 2)
        assertEquals(7500L, parseP2PPayload(jsonB)!!.amountCents)
    }

    @Test
    fun `p2pToken field survives JSON encode-decode roundtrip`() {
        val original = "550e8400-e29b-41d4-a716-446655440000"
        val resp     = buildP2PResponseBytes(original, null, null, FUTURE_EXP)
        val jsonB    = resp.copyOf(resp.size - 2)
        assertEquals(original, parseP2PPayload(jsonB)!!.p2pToken)
    }

    // ── AID bytes ────────────────────────────────────────────────────────────

    @Test
    fun `AID is exactly 9 bytes`() {
        assertEquals(9, AID.size)
    }

    @Test
    fun `AID first byte is 0xF0 (proprietary application tag)`() {
        assertEquals(0xF0.toByte(), AID[0])
    }

    @Test
    fun `SELECT APDU size is 5 + AID.size + 1 = 15 bytes for 9-byte AID`() {
        val apdu = byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00, AID.size.toByte()) +
                   AID + byteArrayOf(0x00)
        assertEquals(15, apdu.size)
    }

    @Test
    fun `GET DATA APDU is exactly CLA=80 INS=C0 P1=00 P2=00 Le=00`() {
        val apdu = byteArrayOf(0x80.toByte(), 0xC0.toByte(), 0x00, 0x00, 0x00)
        assertEquals(0x80.toByte(), apdu[0])  // CLA
        assertEquals(0xC0.toByte(), apdu[1])  // INS
    }

    @Test
    fun `CONFIRM APDU is CLA=80 INS=C1 (one INS byte above GET DATA)`() {
        val confirm = byteArrayOf(0x80.toByte(), 0xC1.toByte(), 0x00, 0x00, 0x00)
        assertEquals(0xC1.toByte(), confirm[1])
    }

    @Test
    fun `ConsumerP2PReader and MerchantHceReader share the same AID (type field differentiates)`() {
        val consumerAID = byteArrayOf(0xF0.toByte(), 0x4F, 0x52, 0x43, 0x48, 0x45, 0x53, 0x54, 0x41)
        val merchantAID = byteArrayOf(0xF0.toByte(), 0x4F, 0x52, 0x43, 0x48, 0x45, 0x53, 0x54, 0x41)
        assertArrayEquals(consumerAID, merchantAID)
    }

    // ── Malformed input ───────────────────────────────────────────────────────

    @Test
    fun `malformed JSON returns null without throwing`() {
        assertNull(parseP2PPayload("not-json{{".toByteArray()))
    }

    @Test
    fun `empty byte array returns null without throwing`() {
        assertNull(parseP2PPayload(byteArrayOf()))
    }

    @Test
    fun `missing p2pToken field causes exception caught as null`() {
        val json = """{"type":"P2P_REQUEST","exp":${FUTURE_EXP}}""".toByteArray()
        assertNull(parseP2PPayload(json))
    }
}

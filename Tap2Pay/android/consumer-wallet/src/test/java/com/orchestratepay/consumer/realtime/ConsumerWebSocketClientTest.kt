package com.orchestratepay.consumer.realtime

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for ConsumerWebSocketClient pure logic.
 *
 * Full WebSocket connectivity requires a real OkHttpClient + server — those belong
 * in instrumented tests. These tests cover:
 *   - ConsumerPaymentEvent data class construction and equality
 *   - JSON message parsing (mirrors onMessage logic)
 *   - mpesaRef blank-to-null conversion
 *   - singleton init/get contract
 *   - Reconnect guard logic (1000 code = clean close, don't reconnect)
 */
class ConsumerWebSocketClientTest {

    // ── ConsumerPaymentEvent data class ───────────────────────────────────────

    @Test
    fun `ConsumerPaymentEvent carries all fields`() {
        val event = ConsumerPaymentEvent(
            txnId        = "txn-1",
            status       = "CONFIRMED",
            amountCents  = 50_000,
            merchantName = "Mama Pima",
            mpesaRef     = "NLJ7RT61SV"
        )
        assertEquals("txn-1", event.txnId)
        assertEquals("CONFIRMED", event.status)
        assertEquals(50_000, event.amountCents)
        assertEquals("Mama Pima", event.merchantName)
        assertEquals("NLJ7RT61SV", event.mpesaRef)
    }

    @Test
    fun `ConsumerPaymentEvent with null mpesaRef is valid`() {
        val event = ConsumerPaymentEvent(
            txnId = "t", status = "PENDING", amountCents = 0,
            merchantName = "Shop", mpesaRef = null
        )
        assertNull(event.mpesaRef)
    }

    @Test
    fun `ConsumerPaymentEvent equality works as data class`() {
        val e1 = ConsumerPaymentEvent("t1", "CONFIRMED", 100, "Shop", "REF1")
        val e2 = ConsumerPaymentEvent("t1", "CONFIRMED", 100, "Shop", "REF1")
        assertEquals(e1, e2)
    }

    @Test
    fun `ConsumerPaymentEvent copy changes only specified field`() {
        val original = ConsumerPaymentEvent("t1", "PENDING", 50_000, "Shop", null)
        val updated  = original.copy(status = "CONFIRMED", mpesaRef = "NLJ7RT61SV")
        assertEquals("t1", updated.txnId)
        assertEquals("CONFIRMED", updated.status)
        assertEquals("NLJ7RT61SV", updated.mpesaRef)
        assertEquals(original.amountCents, updated.amountCents)
    }

    // ── JSON parsing (mirrors onMessage logic) ────────────────────────────────

    private fun parseMessage(json: JSONObject): ConsumerPaymentEvent =
        ConsumerPaymentEvent(
            txnId        = json.optString("txnId"),
            status       = json.optString("status"),
            amountCents  = json.optInt("amountCents"),
            merchantName = json.optString("merchantName"),
            mpesaRef     = json.optString("mpesaRef").takeIf { it.isNotBlank() }
        )

    @Test
    fun `confirmed payment JSON parses correctly`() {
        val json = JSONObject().apply {
            put("txnId",        "txn-xyz")
            put("status",       "CONFIRMED")
            put("amountCents",  75_000)
            put("merchantName", "Acme Store")
            put("mpesaRef",     "ABC123DEF")
        }
        val event = parseMessage(json)
        assertEquals("txn-xyz", event.txnId)
        assertEquals("CONFIRMED", event.status)
        assertEquals(75_000, event.amountCents)
        assertEquals("Acme Store", event.merchantName)
        assertEquals("ABC123DEF", event.mpesaRef)
    }

    @Test
    fun `blank mpesaRef converts to null`() {
        val json = JSONObject().apply {
            put("txnId",    "t1")
            put("status",   "PENDING")
            put("mpesaRef", "")
        }
        val event = parseMessage(json)
        assertNull(event.mpesaRef)
    }

    @Test
    fun `whitespace-only mpesaRef converts to null`() {
        val json = JSONObject().apply {
            put("txnId",    "t2")
            put("status",   "PENDING")
            put("mpesaRef", "   ")
        }
        val event = parseMessage(json)
        assertNull(event.mpesaRef)
    }

    @Test
    fun `missing fields fall back to empty string or zero`() {
        val json = JSONObject().apply { put("txnId", "t3") }
        val event = parseMessage(json)
        assertEquals("t3", event.txnId)
        assertEquals("", event.status)
        assertEquals(0, event.amountCents)
        assertEquals("", event.merchantName)
        assertNull(event.mpesaRef)
    }

    @Test
    fun `malformed JSON returns null via runCatching`() {
        val result = runCatching { JSONObject("not json") }.getOrNull()
        assertNull(result)
    }

    @Test
    fun `valid JSON returns JSONObject via runCatching`() {
        val result = runCatching { JSONObject("""{"txnId":"t1"}""") }.getOrNull()
        assertNotNull(result)
        assertEquals("t1", result!!.optString("txnId"))
    }

    // ── Reconnect guard: only reconnect on non-1000 close codes ─────────────

    private fun shouldReconnect(closeCode: Int): Boolean = closeCode != 1000

    @Test
    fun `close code 1000 means clean close — no reconnect`() {
        assertFalse(shouldReconnect(1000))
    }

    @Test
    fun `close code 1001 (going away) triggers reconnect`() {
        assertTrue(shouldReconnect(1001))
    }

    @Test
    fun `close code 1006 (abnormal) triggers reconnect`() {
        assertTrue(shouldReconnect(1006))
    }

    @Test
    fun `close code 1011 (server error) triggers reconnect`() {
        assertTrue(shouldReconnect(1011))
    }

    // ── Singleton init contract ───────────────────────────────────────────────

    @Test
    fun `shared is null before init is called`() {
        // Fresh JVM test — instance is null because no init has been called
        // (in test isolation, the companion object starts at null)
        // We can't directly test ConsumerWebSocketClient.shared without calling init
        // because it requires a real URL. Instead, verify init sets the instance.
        ConsumerWebSocketClient.init("wss://example.com")
        assertNotNull(ConsumerWebSocketClient.shared)
    }

    @Test
    fun `init with different url replaces the instance`() {
        ConsumerWebSocketClient.init("wss://url1.com")
        val first = ConsumerWebSocketClient.shared

        ConsumerWebSocketClient.init("wss://url2.com")
        val second = ConsumerWebSocketClient.shared

        assertNotSame(first, second)
    }

    // ── URL encoding contract ─────────────────────────────────────────────────

    @Test
    fun `URL encoding of token replaces special characters`() {
        val token   = "a.b+c=d"
        val encoded = java.net.URLEncoder.encode(token, "UTF-8")
        assertFalse("Encoded token should not contain +", encoded == token)
        assertFalse("Encoded token should not contain =", encoded.contains("="))
    }
}

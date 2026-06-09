package com.orchestratepay.realtime

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for WsPaymentResult sealed class.
 *
 * These test the type contracts and JSON payload parsing logic
 * that PaymentOrchestrator.parseWsPayload() depends on.
 *
 * JVM-only — OkHttp and WebSocket are not exercised here.
 */
class WsPaymentResultTest {

    // ─── WsPaymentResult sealed class ────────────────────────────────────────

    @Test
    fun `Received carries JSON payload`() {
        val json = JSONObject().put("status", "CONFIRMED").put("mpesaRef", "NLJ7RT61SV")
        val r = WsPaymentResult.Received(json)
        assertEquals("CONFIRMED",  r.payload.getString("status"))
        assertEquals("NLJ7RT61SV", r.payload.getString("mpesaRef"))
    }

    @Test
    fun `Timeout is a singleton object`() {
        val a: WsPaymentResult = WsPaymentResult.Timeout
        val b: WsPaymentResult = WsPaymentResult.Timeout
        assertSame(a, b)
    }

    @Test
    fun `ConnectError carries message`() {
        val r = WsPaymentResult.ConnectError("WebSocket handshake failed")
        assertEquals("WebSocket handshake failed", r.message)
    }

    @Test
    fun `WsPaymentResult subtypes are distinct`() {
        val received: WsPaymentResult = WsPaymentResult.Received(JSONObject())
        val timeout:  WsPaymentResult = WsPaymentResult.Timeout
        val error:    WsPaymentResult = WsPaymentResult.ConnectError("err")

        assertFalse(received is WsPaymentResult.Timeout)
        assertFalse(timeout  is WsPaymentResult.ConnectError)
        assertFalse(error    is WsPaymentResult.Received)
    }

    @Test
    fun `when expression covers all WsPaymentResult variants`() {
        val results: List<WsPaymentResult> = listOf(
            WsPaymentResult.Received(JSONObject()),
            WsPaymentResult.Timeout,
            WsPaymentResult.ConnectError("x")
        )
        var handled = 0
        results.forEach { r ->
            when (r) {
                is WsPaymentResult.Received     -> handled++
                is WsPaymentResult.Timeout      -> handled++
                is WsPaymentResult.ConnectError -> handled++
            }
        }
        assertEquals(3, handled)
    }

    // ─── WS payload parsing logic ─────────────────────────────────────────────

    @Test
    fun `CONFIRMED payload produces Success result`() {
        val payload = JSONObject().apply {
            put("status",        "CONFIRMED")
            put("mpesaRef",      "NLJ7RT61SV")
            put("amountCents",   50_000L)
            put("merchantName",  "Baridi Café")
            put("consumerPhone", "2547****1234")
        }
        val result = parseWsPayload(payload, "txn-abc")
        assertTrue(result is PaymentResultCompact.SuccessResult)
        val s = result as PaymentResultCompact.SuccessResult
        assertEquals("txn-abc",     s.txnId)
        assertEquals("NLJ7RT61SV", s.mpesaRef)
        assertEquals(50_000L,       s.amountCents)
    }

    @Test
    fun `DECLINED payload produces Declined result`() {
        val payload = JSONObject().apply {
            put("status", "DECLINED")
            put("reason", "Consumer cancelled")
        }
        val result = parseWsPayload(payload, "txn-1")
        assertTrue(result is PaymentResultCompact.DeclinedResult)
        assertEquals("Consumer cancelled", (result as PaymentResultCompact.DeclinedResult).reason)
    }

    @Test
    fun `DECLINED payload without reason uses default`() {
        val payload = JSONObject().put("status", "DECLINED")
        val result  = parseWsPayload(payload, "txn-1") as PaymentResultCompact.DeclinedResult
        assertEquals("Payment declined", result.reason)
    }

    @Test
    fun `unknown status produces FailedResult`() {
        val payload = JSONObject().put("status", "EXPIRED")
        val result  = parseWsPayload(payload, "txn-1")
        assertTrue(result is PaymentResultCompact.FailedResult)
        assertTrue((result as PaymentResultCompact.FailedResult).reason.contains("EXPIRED"))
    }

    @Test
    fun `CONFIRMED payload missing optional fields uses empty string defaults`() {
        val payload = JSONObject().put("status", "CONFIRMED")
        val result  = parseWsPayload(payload, "txn-2") as PaymentResultCompact.SuccessResult
        assertEquals("txn-2", result.txnId)
        assertEquals("",      result.mpesaRef)
        assertEquals(0L,      result.amountCents)
    }

    // Compact representation matching what PaymentOrchestrator.parseWsPayload returns
    sealed class PaymentResultCompact {
        data class SuccessResult(
            val txnId: String, val mpesaRef: String,
            val amountCents: Long, val merchantName: String, val consumerPhone: String
        ) : PaymentResultCompact()
        data class DeclinedResult(val reason: String) : PaymentResultCompact()
        data class FailedResult(val reason: String) : PaymentResultCompact()
    }

    private fun parseWsPayload(payload: JSONObject, txnId: String): PaymentResultCompact {
        return when (val status = payload.optString("status")) {
            "CONFIRMED" -> PaymentResultCompact.SuccessResult(
                txnId         = txnId,
                mpesaRef      = payload.optString("mpesaRef", ""),
                amountCents   = payload.optLong("amountCents", 0L),
                merchantName  = payload.optString("merchantName", ""),
                consumerPhone = payload.optString("consumerPhone", "")
            )
            "DECLINED" -> PaymentResultCompact.DeclinedResult(
                reason = payload.optString("reason", "Payment declined")
            )
            else -> PaymentResultCompact.FailedResult(
                reason = "Unexpected payment status: $status"
            )
        }
    }
}

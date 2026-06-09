package com.orchestratepay.api

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for ApiResponse sealed class behaviour and TransactionRequest field mapping.
 *
 * These tests run on the JVM — no Android SDK or network calls required.
 * They verify the contracts that OrchestrateApiClient promises to its callers.
 */
class ApiResponseMappingTest {

    // ─── ApiResponse sealed class ──────────────────────────────────────────────

    @Test
    fun `Success carries all payment confirmation fields`() {
        val r = ApiResponse.Success("txn-1", "NLJ7RT61SV", 50_000L, "Shop A", "2547****1234")
        assertEquals("txn-1",       r.txnId)
        assertEquals("NLJ7RT61SV", r.mpesaRef)
        assertEquals(50_000L,       r.amountCents)
        assertEquals("Shop A",      r.merchantName)
        assertEquals("2547****1234", r.consumerPhone)
    }

    @Test
    fun `Success fields are nullable except txnId`() {
        val r = ApiResponse.Success("txn-2", null, null, null, null)
        assertEquals("txn-2", r.txnId)
        assertNull(r.mpesaRef)
        assertNull(r.amountCents)
        assertNull(r.merchantName)
        assertNull(r.consumerPhone)
    }

    @Test
    fun `Pending carries txnId only`() {
        val r = ApiResponse.Pending("txn-3")
        assertEquals("txn-3", r.txnId)
    }

    @Test
    fun `Declined carries human-readable reason`() {
        val r = ApiResponse.Declined("Insufficient funds")
        assertEquals("Insufficient funds", r.reason)
    }

    @Test
    fun `NetworkError carries message`() {
        val r = ApiResponse.NetworkError("Connection timed out")
        assertEquals("Connection timed out", r.message)
    }

    @Test
    fun `ServerError carries message`() {
        val r = ApiResponse.ServerError("Internal server error")
        assertEquals("Internal server error", r.message)
    }

    @Test
    fun `ApiResponse subtypes are distinct`() {
        val success  = ApiResponse.Success("t", null, null, null, null)
        val pending  = ApiResponse.Pending("t")
        val declined = ApiResponse.Declined("x")
        val netErr   = ApiResponse.NetworkError("x")
        val srvErr   = ApiResponse.ServerError("x")

        assertFalse(success  is ApiResponse.Pending)
        assertFalse(pending  is ApiResponse.Success)
        assertFalse(declined is ApiResponse.NetworkError)
        assertFalse(netErr   is ApiResponse.ServerError)
        assertFalse(srvErr   is ApiResponse.Declined)
    }

    // ─── TransactionRequest field mapping ─────────────────────────────────────

    @Test
    fun `TransactionRequest carries all required fields`() {
        val req = TransactionRequest(
            merchantId     = "m1",
            amountCents    = 10_000L,
            source         = "NFC_TAG",
            tagId          = "tag-abc",
            nfcUid         = "04:AB:CD",
            idempotencyKey = "abc123",
            timestamp      = 1_000_000L
        )
        assertEquals("m1",      req.merchantId)
        assertEquals(10_000L,   req.amountCents)
        assertEquals("NFC_TAG", req.source)
        assertEquals("tag-abc", req.tagId)
        assertEquals("04:AB:CD", req.nfcUid)
        assertEquals("abc123",  req.idempotencyKey)
        assertEquals(1_000_000L, req.timestamp)
    }

    @Test
    fun `TransactionRequest optional fields default to null`() {
        val req = TransactionRequest(
            merchantId     = "m1",
            amountCents    = 1_000L,
            source         = "QR_CODE",
            tagId          = null,
            nfcUid         = null,
            idempotencyKey = "k",
            timestamp      = 0L
        )
        assertNull(req.consumerPhone)
        assertNull(req.hceToken)
        assertNull(req.hceExp)
        assertNull(req.consumerTagId)
        assertNull(req.consumerQrToken)
    }

    @Test
    fun `TransactionRequest accepts consumerQrToken for CONSUMER_QR source`() {
        val req = TransactionRequest(
            merchantId      = "m1",
            amountCents     = 5_000L,
            source          = "CONSUMER_QR",
            tagId           = null,
            nfcUid          = null,
            idempotencyKey  = "k",
            timestamp       = 0L,
            consumerQrToken = "550e8400-e29b-41d4-a716-446655440000"
        )
        assertEquals("CONSUMER_QR", req.source)
        assertEquals("550e8400-e29b-41d4-a716-446655440000", req.consumerQrToken)
        assertNull(req.consumerPhone)
        assertNull(req.hceToken)
    }

    @Test
    fun `TransactionRequest HCE_PHONE carries phone token and exp`() {
        val exp = System.currentTimeMillis() + 60_000L
        val req = TransactionRequest(
            merchantId     = "m1",
            amountCents    = 3_000L,
            source         = "HCE_PHONE",
            tagId          = null,
            nfcUid         = null,
            idempotencyKey = "k",
            timestamp      = 0L,
            consumerPhone  = "254712345678",
            hceToken       = "a".repeat(32),
            hceExp         = exp
        )
        assertEquals("HCE_PHONE",     req.source)
        assertEquals("254712345678",  req.consumerPhone)
        assertEquals("a".repeat(32),  req.hceToken)
        assertEquals(exp,             req.hceExp)
        assertNull(req.consumerTagId)
        assertNull(req.consumerQrToken)
    }

    @Test
    fun `TransactionRequest CONSUMER_TAG carries consumerTagId`() {
        val req = TransactionRequest(
            merchantId     = "m1",
            amountCents    = 2_000L,
            source         = "CONSUMER_TAG",
            tagId          = null,
            nfcUid         = "uid-xyz",
            idempotencyKey = "k",
            timestamp      = 0L,
            consumerTagId  = "consumer-uuid-abc"
        )
        assertEquals("CONSUMER_TAG",  req.source)
        assertEquals("consumer-uuid-abc", req.consumerTagId)
        assertNull(req.consumerPhone)
        assertNull(req.consumerQrToken)
    }

    // ─── MerchantHceTokenRequest/Response models ──────────────────────────────

    @Test
    fun `MerchantHceTokenRequest carries amountCents`() {
        val req = MerchantHceTokenRequest(amountCents = 15_000L)
        assertEquals(15_000L, req.amountCents)
    }

    @Test
    fun `MerchantHceTokenResponse carries all session fields`() {
        val resp = MerchantHceTokenResponse(
            token        = "uuid-token-123",
            merchantName = "Supermarket A",
            amountCents  = 15_000L,
            expiresAt    = System.currentTimeMillis() + 60_000L
        )
        assertEquals("uuid-token-123", resp.token)
        assertEquals("Supermarket A", resp.merchantName)
        assertEquals(15_000L,          resp.amountCents)
        assertTrue("expiresAt should be in the future", resp.expiresAt > System.currentTimeMillis())
    }

    @Test
    fun `MerchantHceTokenResponse expiresAt is a future timestamp`() {
        val nowMs = System.currentTimeMillis()
        val resp = MerchantHceTokenResponse(
            token        = "t",
            merchantName = "M",
            amountCents  = 1_000L,
            expiresAt    = nowMs + 60_000L
        )
        assertTrue(resp.expiresAt > nowMs)
    }

    // ─── AuthResponse ─────────────────────────────────────────────────────────

    @Test
    fun `AuthResponse carries all login response fields`() {
        val resp = AuthResponse(
            token        = "jwt.abc.def",
            merchantId   = "mid-123",
            merchantName = "Baridi Café",
            expiresAt    = System.currentTimeMillis() + 8 * 3600 * 1000L,
            nfcSigningKey = "hex-key-abc",
            kraPin       = "P123456789A"
        )
        assertEquals("jwt.abc.def",   resp.token)
        assertEquals("mid-123",       resp.merchantId)
        assertEquals("Baridi Café",   resp.merchantName)
        assertEquals("hex-key-abc",   resp.nfcSigningKey)
        assertEquals("P123456789A",   resp.kraPin)
    }

    @Test
    fun `AuthResponse nfcSigningKey and kraPin are nullable`() {
        val resp = AuthResponse(
            token        = "t",
            merchantId   = "m",
            merchantName = "M",
            expiresAt    = 9999999L,
            nfcSigningKey = null,
            kraPin       = null
        )
        assertNull(resp.nfcSigningKey)
        assertNull(resp.kraPin)
    }
}

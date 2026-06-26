package com.orchestratepay.consumer.api

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.argThat
import org.mockito.kotlin.eq
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever

/**
 * Unit tests for ConsumerApiClientInstance.
 *
 * Tests inject a mock ConsumerService via the open `svc` property to verify
 * that each public method correctly delegates to the underlying Retrofit service
 * with the right arguments.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ConsumerApiClientTest {

    private lateinit var client: ConsumerApiClientInstance
    private val mockSvc: ConsumerService = mock()

    @Before
    fun setup() {
        client = ConsumerApiClientInstance()
        client.svc = mockSvc
    }

    // ── service() guard ────────────────────────────────────────────────────────

    @Test(expected = IllegalStateException::class)
    fun `calling login before init throws IllegalStateException`() = runTest {
        val uninit = ConsumerApiClientInstance()
        uninit.login("a@b.com", "pass")
    }

    // ── login ─────────────────────────────────────────────────────────────────

    @Test
    fun `login delegates to service with email and password`() = runTest {
        val expected = AuthResponse("tok", "c1", "254700", "Alice", 9999L)
        whenever(mockSvc.login(mapOf("email" to "a@b.com", "password" to "pass")))
            .thenReturn(expected)

        val result = client.login("a@b.com", "pass")
        assertEquals(expected, result)
    }

    // ── register ──────────────────────────────────────────────────────────────

    @Test
    fun `register delegates with email, password, phone`() = runTest {
        val expected = AuthResponse("tok2", "c2", "254712345678", "Bob", 9999L)
        whenever(mockSvc.register(mapOf("email" to "b@b.com", "password" to "secret1", "phone" to "254712345678")))
            .thenReturn(expected)

        val result = client.register("b@b.com", "secret1", "254712345678")
        assertEquals(expected, result)
    }

    // ── getProfile ────────────────────────────────────────────────────────────

    @Test
    fun `getProfile delegates to service`() = runTest {
        val profile = ConsumerProfile("c1", "254700", "a@b.com", "Alice", true, "2024-01-01")
        whenever(mockSvc.getProfile(any())).thenReturn(profile)

        val result = client.getProfile()
        assertEquals(profile, result)
    }

    // ── updateProfile ─────────────────────────────────────────────────────────

    @Test
    fun `updateProfile with displayName includes it in body`() = runTest {
        whenever(mockSvc.updateProfile(any(), argThat { containsKey("displayName") }))
            .thenReturn(mapOf("success" to true))

        client.updateProfile(displayName = "Alice")
        verify(mockSvc).updateProfile(any(), argThat { this["displayName"] == "Alice" })
    }

    @Test
    fun `updateProfile with smsOptIn includes it in body`() = runTest {
        whenever(mockSvc.updateProfile(any(), argThat { containsKey("smsOptIn") }))
            .thenReturn(mapOf("success" to true))

        client.updateProfile(smsOptIn = true)
        verify(mockSvc).updateProfile(any(), argThat { this["smsOptIn"] == true })
    }

    @Test
    fun `updateProfile with null args sends empty body`() = runTest {
        whenever(mockSvc.updateProfile(any(), eq(emptyMap())))
            .thenReturn(mapOf("success" to true))

        client.updateProfile()
        verify(mockSvc).updateProfile(any(), eq(emptyMap()))
    }

    // ── getTransactions ───────────────────────────────────────────────────────

    @Test
    fun `getTransactions delegates with limit and offset`() = runTest {
        val expected = TransactionsResponse(emptyList(), 20, 40)
        whenever(mockSvc.getTransactions(any(), eq(20), eq(40))).thenReturn(expected)

        val result = client.getTransactions(20, 40)
        assertEquals(expected, result)
    }

    @Test
    fun `getTransactions default limit is 50 and offset is 0`() = runTest {
        val expected = TransactionsResponse(emptyList(), 50, 0)
        whenever(mockSvc.getTransactions(any(), eq(50), eq(0))).thenReturn(expected)

        client.getTransactions()
        verify(mockSvc).getTransactions(any(), eq(50), eq(0))
    }

    // ── getLoyalty ────────────────────────────────────────────────────────────

    @Test
    fun `getLoyalty delegates to service`() = runTest {
        val resp = LoyaltyResponse(emptyList())
        whenever(mockSvc.getLoyalty(any())).thenReturn(resp)

        val result = client.getLoyalty()
        assertEquals(resp, result)
    }

    // ── requestQrToken ────────────────────────────────────────────────────────

    @Test
    fun `requestQrToken delegates to service`() = runTest {
        val resp = QrTokenResponse("qr-tok", System.currentTimeMillis() + 90_000)
        whenever(mockSvc.requestQrToken(any())).thenReturn(resp)

        val result = client.requestQrToken()
        assertEquals(resp, result)
    }

    // ── updateFcmToken ────────────────────────────────────────────────────────

    @Test
    fun `updateFcmToken wraps token in fcmToken key`() = runTest {
        whenever(mockSvc.updateFcmToken(any(), eq(mapOf("fcmToken" to "fcm-abc"))))
            .thenReturn(mapOf("success" to true))

        client.updateFcmToken("fcm-abc")
        verify(mockSvc).updateFcmToken(any(), eq(mapOf("fcmToken" to "fcm-abc")))
    }

    // ── getTransactionStatus ──────────────────────────────────────────────────

    @Test
    fun `getTransactionStatus delegates with txnId`() = runTest {
        val resp = TxnStatusResponse("CONFIRMED", "txn-1", "REF", 5000, "Shop", null)
        whenever(mockSvc.getTransactionStatus(any(), eq("txn-1"))).thenReturn(resp)

        val result = client.getTransactionStatus("txn-1")
        assertEquals(resp, result)
    }

    // ── getMerchantInfo ───────────────────────────────────────────────────────

    @Test
    fun `getMerchantInfo delegates with merchantId`() = runTest {
        val resp = MerchantInfoResponse("mid1", "Acme", "KES")
        whenever(mockSvc.getMerchantInfo(eq("mid1"))).thenReturn(resp)

        val result = client.getMerchantInfo("mid1")
        assertEquals(resp, result)
    }

    // ── payMerchant ───────────────────────────────────────────────────────────

    @Test
    fun `payMerchant builds PayMerchantRequest correctly`() = runTest {
        val resp = PayMerchantResponse("txn-2", "PENDING")
        whenever(mockSvc.payMerchant(any(), eq("mid1"), any())).thenReturn(resp)

        val result = client.payMerchant("mid1", 50000, "idem-key", 1_700_000_000_000L)
        assertEquals("txn-2", result.transactionId)
    }

    // ── payMerchantViaHce ─────────────────────────────────────────────────────

    @Test
    fun `payMerchantViaHce includes merchantHceToken in request`() = runTest {
        val resp = PayMerchantResponse("txn-3", "PENDING")
        whenever(mockSvc.payMerchantViaHce(any(), eq("mid2"), argThat {
            merchantHceToken == "hce-token-abc" && source == "MERCHANT_HCE"
        })).thenReturn(resp)

        val result = client.payMerchantViaHce("mid2", 75000, "key", 1_700_000_000_000L, "hce-token-abc")
        assertEquals("txn-3", result.transactionId)
    }

    // ── requestP2pToken ───────────────────────────────────────────────────────

    @Test
    fun `requestP2pToken with amountCents includes it in body`() = runTest {
        val resp = P2pTokenResponse("p2p-tok", System.currentTimeMillis() + 90_000, "Alice")
        whenever(mockSvc.requestP2pToken(any(), argThat { this["amountCents"] == 10000 }))
            .thenReturn(resp)

        client.requestP2pToken(10000)
        verify(mockSvc).requestP2pToken(any(), argThat { this["amountCents"] == 10000 })
    }

    @Test
    fun `requestP2pToken without amountCents sends empty body`() = runTest {
        val resp = P2pTokenResponse("p2p-tok", System.currentTimeMillis() + 90_000, null)
        whenever(mockSvc.requestP2pToken(any(), eq(emptyMap<String, Any?>()))).thenReturn(resp)

        client.requestP2pToken(null)
        verify(mockSvc).requestP2pToken(any(), eq(emptyMap()))
    }

    // ── p2pPay ────────────────────────────────────────────────────────────────

    @Test
    fun `p2pPay builds P2pPayRequest with NFC source`() = runTest {
        val resp = P2pPayResponse("CONFIRMED", "txn-4", "p2p-4", null)
        whenever(mockSvc.p2pPay(any(), argThat { source == "P2P_NFC" && amountCents == 20000 }))
            .thenReturn(resp)

        val result = client.p2pPay("tok", null, 20000, "idem", 1_700_000_000L, "P2P_NFC")
        assertEquals("txn-4", result.txnId)
    }

    @Test
    fun `p2pPay builds P2pPayRequest with QR source`() = runTest {
        val resp = P2pPayResponse("CONFIRMED", "txn-5", "p2p-5", null)
        whenever(mockSvc.p2pPay(any(), argThat { source == "P2P_QR" })).thenReturn(resp)

        client.p2pPay(null, "cid-123", 10000, "idem", 1_700_000_000L, "P2P_QR")
        verify(mockSvc).p2pPay(any(), argThat { source == "P2P_QR" && payeeConsumerId == "cid-123" })
    }

    // ── redeemLoyalty ─────────────────────────────────────────────────────────

    @Test
    fun `redeemLoyalty sends merchantId and rewardId`() = runTest {
        whenever(mockSvc.redeemLoyalty(any(), eq(mapOf("merchantId" to "m1", "rewardId" to "r1"))))
            .thenReturn(mapOf("success" to true))

        client.redeemLoyalty("m1", "r1")
        verify(mockSvc).redeemLoyalty(any(), eq(mapOf("merchantId" to "m1", "rewardId" to "r1")))
    }

    // ── fileDispute ───────────────────────────────────────────────────────────

    @Test
    fun `fileDispute sends transactionId and reason`() = runTest {
        whenever(mockSvc.fileDispute(any(),
            eq(mapOf("transactionId" to "txn-9", "reason" to "Wrong amount"))))
            .thenReturn(mapOf("success" to true))

        client.fileDispute("txn-9", "Wrong amount")
        verify(mockSvc).fileDispute(any(),
            eq(mapOf("transactionId" to "txn-9", "reason" to "Wrong amount")))
    }
}

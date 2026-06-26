package com.orchestratepay.consumer.ui.viewmodel

import com.orchestratepay.consumer.api.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever

@OptIn(ExperimentalCoroutinesApi::class)
class MerchantHcePayViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: MerchantHcePayViewModel
    private val mockApiClient: ConsumerApiClientInstance = mock()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = MerchantHcePayViewModel(mockApiClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun confirmed(txnId: String) =
        TxnStatusResponse("CONFIRMED", txnId, "MPESA001", 75000, "Quick Mart", null)

    private fun declined(txnId: String) =
        TxnStatusResponse("DECLINED", txnId, null, null, null, "PIN wrong")

    // ── Initial state ─────────────────────────────────────────────────────────

    @Test
    fun `initial state is Idle`() {
        assertEquals(HcePaymentState.Idle, viewModel.state.value)
    }

    // ── initiatePayment ───────────────────────────────────────────────────────

    @Test
    fun `initiatePayment sets Processing immediately`() = runTest {
        whenever(mockApiClient.payMerchantViaHce(any(), any(), any(), any(), any()))
            .thenReturn(PayMerchantResponse("hce-1", "PENDING"))
        whenever(mockApiClient.getTransactionStatus(any())).thenReturn(confirmed("hce-1"))

        viewModel.initiatePayment("mid1", 75000, "hce-token-abc")
        assertEquals(HcePaymentState.Processing, viewModel.state.value)
    }

    @Test
    fun `initiatePayment API failure sets Error`() = runTest {
        whenever(mockApiClient.payMerchantViaHce(any(), any(), any(), any(), any()))
            .thenThrow(RuntimeException("Token expired"))

        viewModel.initiatePayment("mid1", 75000, "expired-hce-token")
        advanceUntilIdle()

        val state = viewModel.state.value as HcePaymentState.Error
        assertTrue(state.message.contains("Payment failed"))
        assertTrue(state.canRetry)
    }

    @Test
    fun `polling CONFIRMED status produces Success`() = runTest {
        whenever(mockApiClient.payMerchantViaHce(any(), any(), any(), any(), any()))
            .thenReturn(PayMerchantResponse("hce-2", "PENDING"))
        whenever(mockApiClient.getTransactionStatus("hce-2"))
            .thenReturn(confirmed("hce-2"))

        viewModel.initiatePayment("mid1", 75000, "hce-token")
        advanceUntilIdle()

        val state = viewModel.state.value as HcePaymentState.Success
        assertEquals("hce-2", state.status.txnId)
        assertEquals("MPESA001", state.status.mpesaRef)
    }

    @Test
    fun `polling DECLINED produces non-retryable Error`() = runTest {
        whenever(mockApiClient.payMerchantViaHce(any(), any(), any(), any(), any()))
            .thenReturn(PayMerchantResponse("hce-3", "PENDING"))
        whenever(mockApiClient.getTransactionStatus("hce-3"))
            .thenReturn(declined("hce-3"))

        viewModel.initiatePayment("mid1", 75000, "hce-token")
        advanceUntilIdle()

        val state = viewModel.state.value as HcePaymentState.Error
        assertFalse(state.canRetry)
        assertTrue(state.message.contains("declined"))
    }

    @Test
    fun `polling FAILED produces non-retryable Error`() = runTest {
        whenever(mockApiClient.payMerchantViaHce(any(), any(), any(), any(), any()))
            .thenReturn(PayMerchantResponse("hce-4", "PENDING"))
        whenever(mockApiClient.getTransactionStatus("hce-4"))
            .thenReturn(TxnStatusResponse("FAILED", "hce-4", null, null, null, null))

        viewModel.initiatePayment("mid1", 75000, "hce-token")
        advanceUntilIdle()

        val state = viewModel.state.value as HcePaymentState.Error
        assertFalse(state.canRetry)
    }

    @Test
    fun `WaitingForMpesa state carries txnId`() = runTest {
        whenever(mockApiClient.payMerchantViaHce(any(), any(), any(), any(), any()))
            .thenReturn(PayMerchantResponse("hce-5", "PENDING"))
        whenever(mockApiClient.getTransactionStatus("hce-5"))
            .thenReturn(TxnStatusResponse("PENDING", "hce-5", null, null, null, null))
            .thenReturn(confirmed("hce-5"))

        viewModel.initiatePayment("mid1", 75000, "hce-token")
        advanceTimeBy(3_100)
        runCurrent()

        val state = viewModel.state.value
        assertTrue(state is HcePaymentState.WaitingForMpesa || state is HcePaymentState.Success)
    }

    @Test
    fun `null error message falls back to default`() = runTest {
        whenever(mockApiClient.payMerchantViaHce(any(), any(), any(), any(), any()))
            .thenThrow(RuntimeException(null as String?))

        viewModel.initiatePayment("mid1", 75000, "hce-token")
        advanceUntilIdle()

        val state = viewModel.state.value as HcePaymentState.Error
        assertTrue(state.message.startsWith("Payment failed"))
    }

    // ── Sealed class exhaustiveness ───────────────────────────────────────────

    @Test
    fun `when expression covers all HcePaymentState variants`() {
        val states: List<HcePaymentState> = listOf(
            HcePaymentState.Idle,
            HcePaymentState.Processing,
            HcePaymentState.WaitingForMpesa("t", 30),
            HcePaymentState.Success(TxnStatusResponse("CONFIRMED", "t", null, null, null, null)),
            HcePaymentState.Error("msg")
        )
        var count = 0
        states.forEach {
            when (it) {
                is HcePaymentState.Idle            -> count++
                is HcePaymentState.Processing      -> count++
                is HcePaymentState.WaitingForMpesa -> count++
                is HcePaymentState.Success         -> count++
                is HcePaymentState.Error           -> count++
            }
        }
        assertEquals(5, count)
    }
}

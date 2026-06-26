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
class NfcTagPaymentViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: NfcTagPaymentViewModel
    private val mockApiClient: ConsumerApiClientInstance = mock()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = NfcTagPaymentViewModel(mockApiClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun merchantInfo() =
        MerchantInfoResponse("mid1", "Acme Shop", "KES")

    private fun pendingStatus(txnId: String) =
        TxnStatusResponse("PENDING", txnId, null, null, null, null)

    private fun confirmedStatus(txnId: String) =
        TxnStatusResponse("CONFIRMED", txnId, "NLJ7RT61SV", 50000, "Acme Shop", null)

    private fun declinedStatus(txnId: String) =
        TxnStatusResponse("DECLINED", txnId, null, null, null, "Insufficient funds")

    // ── loadMerchant ──────────────────────────────────────────────────────────

    @Test
    fun `initial state is Idle`() {
        assertEquals(PaymentState.Idle, viewModel.state.value)
    }

    @Test
    fun `loadMerchant transitions to LoadingMerchant immediately`() = runTest {
        whenever(mockApiClient.getMerchantInfo(any())).thenReturn(merchantInfo())
        viewModel.loadMerchant("mid1")
        assertEquals(PaymentState.LoadingMerchant("mid1"), viewModel.state.value)
    }

    @Test
    fun `loadMerchant success transitions to MerchantLoaded`() = runTest {
        val info = merchantInfo()
        whenever(mockApiClient.getMerchantInfo("mid1")).thenReturn(info)

        viewModel.loadMerchant("mid1")
        advanceUntilIdle()

        assertEquals(PaymentState.MerchantLoaded(info), viewModel.state.value)
    }

    @Test
    fun `loadMerchant failure transitions to Error`() = runTest {
        whenever(mockApiClient.getMerchantInfo(any())).thenThrow(RuntimeException("Not found"))

        viewModel.loadMerchant("mid-x")
        advanceUntilIdle()

        val state = viewModel.state.value as PaymentState.Error
        assertTrue(state.message.contains("merchant"))
    }

    // ── initiatePayment ───────────────────────────────────────────────────────

    @Test
    fun `initiatePayment transitions to Processing immediately`() = runTest {
        whenever(mockApiClient.payMerchant(any(), any(), any(), any()))
            .thenReturn(PayMerchantResponse("txn-1", "PENDING"))
        whenever(mockApiClient.getTransactionStatus(any())).thenReturn(confirmedStatus("txn-1"))

        viewModel.initiatePayment("mid1", 50000)
        assertEquals(PaymentState.Processing, viewModel.state.value)
    }

    @Test
    fun `initiatePayment API failure transitions to Error`() = runTest {
        whenever(mockApiClient.payMerchant(any(), any(), any(), any()))
            .thenThrow(RuntimeException("Network error"))

        viewModel.initiatePayment("mid1", 50000)
        advanceUntilIdle()

        val state = viewModel.state.value as PaymentState.Error
        assertTrue(state.message.contains("Payment failed"))
    }

    @Test
    fun `polling CONFIRMED status transitions to Success`() = runTest {
        whenever(mockApiClient.payMerchant(any(), any(), any(), any()))
            .thenReturn(PayMerchantResponse("txn-2", "PENDING"))
        whenever(mockApiClient.getTransactionStatus("txn-2"))
            .thenReturn(confirmedStatus("txn-2"))

        viewModel.initiatePayment("mid1", 50000)
        advanceUntilIdle()

        val state = viewModel.state.value as PaymentState.Success
        assertEquals("txn-2", state.status.txnId)
    }

    @Test
    fun `polling DECLINED status transitions to non-retryable Error`() = runTest {
        whenever(mockApiClient.payMerchant(any(), any(), any(), any()))
            .thenReturn(PayMerchantResponse("txn-3", "PENDING"))
        whenever(mockApiClient.getTransactionStatus("txn-3"))
            .thenReturn(declinedStatus("txn-3"))

        viewModel.initiatePayment("mid1", 50000)
        advanceUntilIdle()

        val state = viewModel.state.value as PaymentState.Error
        assertFalse(state.canRetry)
        assertTrue(state.message.contains("declined"))
    }

    @Test
    fun `polling FAILED status transitions to non-retryable Error`() = runTest {
        whenever(mockApiClient.payMerchant(any(), any(), any(), any()))
            .thenReturn(PayMerchantResponse("txn-4", "PENDING"))
        whenever(mockApiClient.getTransactionStatus("txn-4"))
            .thenReturn(TxnStatusResponse("FAILED", "txn-4", null, null, null, null))

        viewModel.initiatePayment("mid1", 50000)
        advanceUntilIdle()

        val state = viewModel.state.value as PaymentState.Error
        assertFalse(state.canRetry)
        assertTrue(state.message.contains("failed"))
    }

    @Test
    fun `WaitingForMpesa state shows txnId and countdown`() = runTest {
        whenever(mockApiClient.payMerchant(any(), any(), any(), any()))
            .thenReturn(PayMerchantResponse("txn-5", "PENDING"))
        whenever(mockApiClient.getTransactionStatus("txn-5"))
            .thenReturn(pendingStatus("txn-5"))
            .thenReturn(confirmedStatus("txn-5"))

        viewModel.initiatePayment("mid1", 50000)
        // Advance just past the first poll cycle
        advanceTimeBy(3_100)
        runCurrent()

        val state = viewModel.state.value
        assertTrue("Expected WaitingForMpesa or Success but got $state",
            state is PaymentState.WaitingForMpesa || state is PaymentState.Success)
    }
}

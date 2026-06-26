package com.orchestratepay.consumer.ui.viewmodel

import com.orchestratepay.consumer.api.ConsumerApiClientInstance
import com.orchestratepay.consumer.api.Transaction
import com.orchestratepay.consumer.api.TransactionsResponse
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
class TransactionHistoryViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: TransactionHistoryViewModel
    private val mockApiClient: ConsumerApiClientInstance = mock()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = TransactionHistoryViewModel(mockApiClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `loadTransactions success updates state with transactions`() = runTest {
        val txns = listOf(
            Transaction("1", "CONFIRMED", 1000, "KES", 1000, "REF1", "NFC_TAG", "2024-01-01", null, "Merchant 1")
        )
        val response = TransactionsResponse(txns, 20, 0)
        whenever(mockApiClient.getTransactions(any(), any())).thenReturn(response)

        viewModel.loadTransactions(refresh = true)
        advanceUntilIdle()

        assertEquals(txns, viewModel.state.value.transactions)
        assertFalse(viewModel.state.value.isLoading)
        assertFalse(viewModel.state.value.hasMore) // because txns.size < limit (20)
    }

    @Test
    fun `loadTransactions failure updates error state`() = runTest {
        whenever(mockApiClient.getTransactions(any(), any())).thenThrow(RuntimeException("API Error"))

        viewModel.loadTransactions(refresh = true)
        advanceUntilIdle()

        assertEquals("API Error", viewModel.state.value.error)
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `fileDispute success updates disputeSuccess state`() = runTest {
        whenever(mockApiClient.fileDispute(any(), any())).thenReturn(mapOf("success" to true))

        viewModel.fileDispute("1", "Wrong amount")
        advanceUntilIdle()

        assertEquals("Dispute filed successfully", viewModel.state.value.disputeSuccess)
    }
}

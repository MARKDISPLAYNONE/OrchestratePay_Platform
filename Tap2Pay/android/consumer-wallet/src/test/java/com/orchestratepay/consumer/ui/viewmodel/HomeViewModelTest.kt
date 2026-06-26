package com.orchestratepay.consumer.ui.viewmodel

import com.orchestratepay.consumer.api.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: HomeViewModel
    private val mockApiClient: ConsumerApiClientInstance = mock()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = HomeViewModel(mockApiClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun makeTxn(id: String) =
        Transaction(id, "CONFIRMED", 1000, "KES", 1000, null, "NFC_TAG", "2024-01-01", null, "Shop")

    private fun makeBalance(merchantId: String, points: Int) =
        LoyaltyBalance(merchantId, "Shop $merchantId", "POINTS", points, 0, points, 100)

    @Test
    fun `initial state has empty transactions and zero points`() {
        assertEquals(emptyList<Transaction>(), viewModel.state.value.recentTransactions)
        assertEquals(0, viewModel.state.value.totalPoints)
        assertFalse(viewModel.state.value.isLoadingTransactions)
        assertFalse(viewModel.state.value.isLoadingLoyalty)
    }

    @Test
    fun `loadData sets loading flags immediately`() = runTest {
        whenever(mockApiClient.getTransactions(3, 0))
            .thenReturn(TransactionsResponse(emptyList(), 3, 0))
        whenever(mockApiClient.getLoyalty())
            .thenReturn(LoyaltyResponse(emptyList()))

        viewModel.loadData()

        assertTrue(viewModel.state.value.isLoadingTransactions)
        assertTrue(viewModel.state.value.isLoadingLoyalty)
    }

    @Test
    fun `loadData success populates transactions`() = runTest {
        val txns = listOf(makeTxn("1"), makeTxn("2"), makeTxn("3"))
        whenever(mockApiClient.getTransactions(3, 0))
            .thenReturn(TransactionsResponse(txns, 3, 0))
        whenever(mockApiClient.getLoyalty())
            .thenReturn(LoyaltyResponse(emptyList()))

        viewModel.loadData()
        advanceUntilIdle()

        assertEquals(txns, viewModel.state.value.recentTransactions)
        assertFalse(viewModel.state.value.isLoadingTransactions)
    }

    @Test
    fun `loadData success sums loyalty points across merchants`() = runTest {
        whenever(mockApiClient.getTransactions(3, 0))
            .thenReturn(TransactionsResponse(emptyList(), 3, 0))
        val balances = listOf(makeBalance("m1", 100), makeBalance("m2", 250), makeBalance("m3", 50))
        whenever(mockApiClient.getLoyalty())
            .thenReturn(LoyaltyResponse(balances))

        viewModel.loadData()
        advanceUntilIdle()

        assertEquals(400, viewModel.state.value.totalPoints)
        assertFalse(viewModel.state.value.isLoadingLoyalty)
    }

    @Test
    fun `loadData with zero loyalty balances gives zero total points`() = runTest {
        whenever(mockApiClient.getTransactions(3, 0))
            .thenReturn(TransactionsResponse(emptyList(), 3, 0))
        whenever(mockApiClient.getLoyalty())
            .thenReturn(LoyaltyResponse(emptyList()))

        viewModel.loadData()
        advanceUntilIdle()

        assertEquals(0, viewModel.state.value.totalPoints)
    }

    @Test
    fun `transaction API failure sets error and clears loading`() = runTest {
        whenever(mockApiClient.getTransactions(3, 0))
            .thenThrow(RuntimeException("Server down"))
        whenever(mockApiClient.getLoyalty())
            .thenReturn(LoyaltyResponse(emptyList()))

        viewModel.loadData()
        advanceUntilIdle()

        assertEquals("Server down", viewModel.state.value.error)
        assertFalse(viewModel.state.value.isLoadingTransactions)
    }

    @Test
    fun `loyalty API failure sets error and clears loading`() = runTest {
        whenever(mockApiClient.getTransactions(3, 0))
            .thenReturn(TransactionsResponse(emptyList(), 3, 0))
        whenever(mockApiClient.getLoyalty())
            .thenThrow(RuntimeException("Loyalty unavailable"))

        viewModel.loadData()
        advanceUntilIdle()

        assertEquals("Loyalty unavailable", viewModel.state.value.error)
        assertFalse(viewModel.state.value.isLoadingLoyalty)
    }

    @Test
    fun `error in one call does not block result from other call`() = runTest {
        val txns = listOf(makeTxn("tx1"))
        whenever(mockApiClient.getTransactions(3, 0))
            .thenReturn(TransactionsResponse(txns, 3, 0))
        whenever(mockApiClient.getLoyalty())
            .thenThrow(RuntimeException("Loyalty failed"))

        viewModel.loadData()
        advanceUntilIdle()

        // Transactions loaded successfully despite loyalty failure
        assertEquals(txns, viewModel.state.value.recentTransactions)
        assertFalse(viewModel.state.value.isLoadingTransactions)
        assertNotNull(viewModel.state.value.error)
    }

    @Test
    fun `null message in exception falls back to default`() = runTest {
        whenever(mockApiClient.getTransactions(3, 0))
            .thenThrow(RuntimeException(null as String?))
        whenever(mockApiClient.getLoyalty())
            .thenReturn(LoyaltyResponse(emptyList()))

        viewModel.loadData()
        advanceUntilIdle()

        assertEquals("Failed to load transactions", viewModel.state.value.error)
    }
}

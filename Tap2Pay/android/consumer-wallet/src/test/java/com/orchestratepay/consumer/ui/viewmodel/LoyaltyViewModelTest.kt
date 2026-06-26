package com.orchestratepay.consumer.ui.viewmodel

import com.orchestratepay.consumer.api.ConsumerApiClientInstance
import com.orchestratepay.consumer.api.LoyaltyBalance
import com.orchestratepay.consumer.api.LoyaltyResponse
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
class LoyaltyViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: LoyaltyViewModel
    private val mockApiClient: ConsumerApiClientInstance = mock()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = LoyaltyViewModel(mockApiClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun balance(mid: String, points: Int = 100, stamps: Int = 5) = LoyaltyBalance(
        merchantId = mid,
        merchantName = "Shop $mid",
        rewardType = "POINTS",
        pointsBalance = points,
        stampsBalance = stamps,
        lifetimePoints = points * 2,
        redeemThreshold = 500
    )

    @Test
    fun `initial state has empty balances`() {
        assertEquals(emptyList<LoyaltyBalance>(), viewModel.state.value.balances)
        assertFalse(viewModel.state.value.isLoading)
        assertNull(viewModel.state.value.error)
        assertNull(viewModel.state.value.redemptionSuccess)
    }

    // ── loadLoyalty ───────────────────────────────────────────────────────────

    @Test
    fun `loadLoyalty sets isLoading immediately`() = runTest {
        whenever(mockApiClient.getLoyalty()).thenReturn(LoyaltyResponse(emptyList()))

        viewModel.loadLoyalty()
        assertTrue(viewModel.state.value.isLoading)
    }

    @Test
    fun `loadLoyalty success populates balances`() = runTest {
        val balances = listOf(balance("m1"), balance("m2", 200))
        whenever(mockApiClient.getLoyalty()).thenReturn(LoyaltyResponse(balances))

        viewModel.loadLoyalty()
        advanceUntilIdle()

        assertEquals(balances, viewModel.state.value.balances)
        assertFalse(viewModel.state.value.isLoading)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `loadLoyalty with empty list clears balances`() = runTest {
        whenever(mockApiClient.getLoyalty()).thenReturn(LoyaltyResponse(emptyList()))

        viewModel.loadLoyalty()
        advanceUntilIdle()

        assertEquals(emptyList<LoyaltyBalance>(), viewModel.state.value.balances)
    }

    @Test
    fun `loadLoyalty failure sets error`() = runTest {
        whenever(mockApiClient.getLoyalty()).thenThrow(RuntimeException("Network error"))

        viewModel.loadLoyalty()
        advanceUntilIdle()

        assertEquals("Network error", viewModel.state.value.error)
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `loadLoyalty null error falls back to default`() = runTest {
        whenever(mockApiClient.getLoyalty()).thenThrow(RuntimeException(null as String?))

        viewModel.loadLoyalty()
        advanceUntilIdle()

        assertEquals("Failed to load loyalty", viewModel.state.value.error)
    }

    // ── redeem ────────────────────────────────────────────────────────────────

    @Test
    fun `redeem success sets redemptionSuccess message`() = runTest {
        whenever(mockApiClient.redeemLoyalty(any(), any())).thenReturn(mapOf("success" to true))
        whenever(mockApiClient.getLoyalty()).thenReturn(LoyaltyResponse(emptyList()))

        viewModel.redeem("m1", "reward-123")
        advanceUntilIdle()

        assertEquals("Reward redeemed successfully!", viewModel.state.value.redemptionSuccess)
    }

    @Test
    fun `redeem success refreshes loyalty list`() = runTest {
        val refreshed = listOf(balance("m1", 0))
        whenever(mockApiClient.redeemLoyalty(any(), any())).thenReturn(mapOf("success" to true))
        whenever(mockApiClient.getLoyalty()).thenReturn(LoyaltyResponse(refreshed))

        viewModel.redeem("m1", "reward-123")
        advanceUntilIdle()

        assertEquals(refreshed, viewModel.state.value.balances)
    }

    @Test
    fun `redeem failure sets error`() = runTest {
        whenever(mockApiClient.redeemLoyalty(any(), any()))
            .thenThrow(RuntimeException("Insufficient points"))

        viewModel.redeem("m1", "reward-123")
        advanceUntilIdle()

        assertEquals("Insufficient points", viewModel.state.value.error)
        assertNull(viewModel.state.value.redemptionSuccess)
    }

    @Test
    fun `redeem null error falls back to default`() = runTest {
        whenever(mockApiClient.redeemLoyalty(any(), any()))
            .thenThrow(RuntimeException(null as String?))

        viewModel.redeem("m1", "reward-123")
        advanceUntilIdle()

        assertEquals("Redemption failed", viewModel.state.value.error)
    }

    // ── clearRedemptionState ──────────────────────────────────────────────────

    @Test
    fun `clearRedemptionState nulls out redemptionSuccess`() = runTest {
        whenever(mockApiClient.redeemLoyalty(any(), any())).thenReturn(mapOf("success" to true))
        whenever(mockApiClient.getLoyalty()).thenReturn(LoyaltyResponse(emptyList()))

        viewModel.redeem("m1", "r1")
        advanceUntilIdle()
        assertNotNull(viewModel.state.value.redemptionSuccess)

        viewModel.clearRedemptionState()
        assertNull(viewModel.state.value.redemptionSuccess)
    }
}

package com.orchestratepay.consumer.ui.viewmodel

import com.orchestratepay.consumer.api.ConsumerApiClientInstance
import com.orchestratepay.consumer.api.P2pTokenResponse
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
class P2PPayViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: P2PPayViewModel
    private val mockApiClient: ConsumerApiClientInstance = mock()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = P2PPayViewModel(mockApiClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun tokenResponse() = P2pTokenResponse(
        token = "p2p-token-xyz",
        expiresAt = System.currentTimeMillis() + 90_000,
        displayName = "Alice"
    )

    @Test
    fun `initial tokenState is Idle`() {
        assertEquals(P2pTokenState.Idle, viewModel.tokenState.value)
    }

    @Test
    fun `requestP2pToken sets Loading immediately`() = runTest {
        whenever(mockApiClient.requestP2pToken(any())).thenReturn(tokenResponse())

        viewModel.requestP2pToken()
        assertEquals(P2pTokenState.Loading, viewModel.tokenState.value)
    }

    @Test
    fun `requestP2pToken success transitions to Success`() = runTest {
        val resp = tokenResponse()
        whenever(mockApiClient.requestP2pToken(null)).thenReturn(resp)

        viewModel.requestP2pToken()
        advanceUntilIdle()

        val state = viewModel.tokenState.value as P2pTokenState.Success
        assertEquals("p2p-token-xyz", state.response.token)
        assertEquals("Alice", state.response.displayName)
    }

    @Test
    fun `requestP2pToken with amountCents passes it to API`() = runTest {
        val resp = tokenResponse()
        whenever(mockApiClient.requestP2pToken(5000)).thenReturn(resp)

        viewModel.requestP2pToken(amountCents = 5000)
        advanceUntilIdle()

        assertEquals(P2pTokenState.Success(resp), viewModel.tokenState.value)
    }

    @Test
    fun `requestP2pToken API failure transitions to Error`() = runTest {
        whenever(mockApiClient.requestP2pToken(any()))
            .thenThrow(RuntimeException("Session expired"))

        viewModel.requestP2pToken()
        advanceUntilIdle()

        val state = viewModel.tokenState.value as P2pTokenState.Error
        assertEquals("Session expired", state.message)
    }

    @Test
    fun `null error message falls back to default`() = runTest {
        whenever(mockApiClient.requestP2pToken(any()))
            .thenThrow(RuntimeException(null as String?))

        viewModel.requestP2pToken()
        advanceUntilIdle()

        val state = viewModel.tokenState.value as P2pTokenState.Error
        assertEquals("Failed to generate P2P token", state.message)
    }

    @Test
    fun `P2pTokenState sealed class covers all variants`() {
        val states: List<P2pTokenState> = listOf(
            P2pTokenState.Idle,
            P2pTokenState.Loading,
            P2pTokenState.Success(tokenResponse()),
            P2pTokenState.Error("msg")
        )
        var count = 0
        states.forEach {
            when (it) {
                is P2pTokenState.Idle    -> count++
                is P2pTokenState.Loading -> count++
                is P2pTokenState.Success -> count++
                is P2pTokenState.Error   -> count++
            }
        }
        assertEquals(4, count)
    }
}

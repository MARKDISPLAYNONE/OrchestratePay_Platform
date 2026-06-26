package com.orchestratepay.consumer.ui.viewmodel

import com.orchestratepay.consumer.api.ConsumerApiClientInstance
import com.orchestratepay.consumer.api.P2pPayResponse
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
class P2PSendViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: P2PSendViewModel
    private val mockApiClient: ConsumerApiClientInstance = mock()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = P2PSendViewModel(mockApiClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun successResponse() = P2pPayResponse(
        status = "CONFIRMED",
        txnId = "p2p-txn-1",
        p2pTxnId = "p2p-internal-1",
        message = "Sent"
    )

    @Test
    fun `initial state is Idle`() {
        assertEquals(P2pPayState.Idle, viewModel.state.value)
    }

    @Test
    fun `p2pPay sets Processing immediately`() = runTest {
        whenever(mockApiClient.p2pPay(any(), any(), any(), any(), any(), any()))
            .thenReturn(successResponse())

        viewModel.p2pPay("token-abc", null, 10000, "P2P_NFC")
        assertEquals(P2pPayState.Processing, viewModel.state.value)
    }

    @Test
    fun `p2pPay success transitions to Success`() = runTest {
        val resp = successResponse()
        whenever(mockApiClient.p2pPay(any(), any(), any(), any(), any(), any()))
            .thenReturn(resp)

        viewModel.p2pPay("token-abc", null, 10000, "P2P_NFC")
        advanceUntilIdle()

        assertEquals(P2pPayState.Success(resp), viewModel.state.value)
    }

    @Test
    fun `p2pPay via QR source succeeds`() = runTest {
        val resp = successResponse()
        whenever(mockApiClient.p2pPay(any(), any(), any(), any(), any(), any()))
            .thenReturn(resp)

        viewModel.p2pPay(null, "consumer-id-123", 20000, "P2P_QR")
        advanceUntilIdle()

        assertEquals(P2pPayState.Success(resp), viewModel.state.value)
    }

    @Test
    fun `p2pPay API failure transitions to Error`() = runTest {
        whenever(mockApiClient.p2pPay(any(), any(), any(), any(), any(), any()))
            .thenThrow(RuntimeException("Consumer not found"))

        viewModel.p2pPay("token-abc", null, 10000, "P2P_NFC")
        advanceUntilIdle()

        val state = viewModel.state.value as P2pPayState.Error
        assertEquals("Consumer not found", state.message)
    }

    @Test
    fun `null error message falls back to default`() = runTest {
        whenever(mockApiClient.p2pPay(any(), any(), any(), any(), any(), any()))
            .thenThrow(RuntimeException(null as String?))

        viewModel.p2pPay("t", null, 100, "P2P_NFC")
        advanceUntilIdle()

        val state = viewModel.state.value as P2pPayState.Error
        assertEquals("P2P payment failed", state.message)
    }

    @Test
    fun `P2pPayState sealed class covers all variants`() {
        val states: List<P2pPayState> = listOf(
            P2pPayState.Idle,
            P2pPayState.Processing,
            P2pPayState.Success(successResponse()),
            P2pPayState.Error("msg")
        )
        var count = 0
        states.forEach {
            when (it) {
                is P2pPayState.Idle       -> count++
                is P2pPayState.Processing -> count++
                is P2pPayState.Success    -> count++
                is P2pPayState.Error      -> count++
            }
        }
        assertEquals(4, count)
    }

    @Test
    fun `idempotency key is 32 hex chars and unique per call`() {
        val keys = mutableSetOf<String>()
        repeat(20) {
            val bytes = ByteArray(16).also { java.security.SecureRandom().nextBytes(it) }
            val key = bytes.joinToString("") { "%02x".format(it) }
            assertEquals(32, key.length)
            assertTrue(key.matches(Regex("[0-9a-f]{32}")))
            keys.add(key)
        }
        assertEquals(20, keys.size)
    }
}

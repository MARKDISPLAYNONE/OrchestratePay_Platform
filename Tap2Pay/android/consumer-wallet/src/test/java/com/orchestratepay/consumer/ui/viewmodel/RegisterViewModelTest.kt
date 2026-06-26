package com.orchestratepay.consumer.ui.viewmodel

import com.orchestratepay.consumer.api.AuthResponse
import com.orchestratepay.consumer.api.ConsumerApiClientInstance
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
class RegisterViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: RegisterViewModel
    private val mockApiClient: ConsumerApiClientInstance = mock()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = RegisterViewModel(mockApiClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `initial state is Idle`() {
        assertEquals(RegisterState.Idle, viewModel.state.value)
    }

    @Test
    fun `blank email returns validation error`() = runTest {
        viewModel.register("", "password1", "254700000001")
        assertTrue(viewModel.state.value is RegisterState.Error)
    }

    @Test
    fun `password shorter than 8 chars returns validation error`() = runTest {
        viewModel.register("a@b.com", "short", "254700000001")
        val state = viewModel.state.value
        assertTrue(state is RegisterState.Error)
        assertTrue((state as RegisterState.Error).message.contains("8"))
    }

    @Test
    fun `phone not matching 254XXXXXXXXX returns format error`() = runTest {
        viewModel.register("a@b.com", "password1", "0700000001")
        val state = viewModel.state.value
        assertTrue(state is RegisterState.Error)
        assertTrue((state as RegisterState.Error).message.contains("254"))
    }

    @Test
    fun `phone with too few digits after 254 returns error`() = runTest {
        viewModel.register("a@b.com", "password1", "25412345")
        assertTrue(viewModel.state.value is RegisterState.Error)
    }

    @Test
    fun `phone with exactly 12 digits but wrong prefix returns error`() = runTest {
        viewModel.register("a@b.com", "password1", "255700000001")
        assertTrue(viewModel.state.value is RegisterState.Error)
    }

    @Test
    fun `valid 254XXXXXXXXX phone passes validation`() = runTest {
        val auth = AuthResponse("tok", "cid", "254700000001", "Name", 9999999999L)
        whenever(mockApiClient.register(any(), any(), any())).thenReturn(auth)

        viewModel.register("user@example.com", "securepassword", "254700000001")
        advanceUntilIdle()

        assertEquals(RegisterState.Success(auth), viewModel.state.value)
    }

    @Test
    fun `successful registration transitions Loading then Success`() = runTest {
        val auth = AuthResponse("tok", "cid", "254712345678", "Alice", 9999999999L)
        whenever(mockApiClient.register(any(), any(), any())).thenReturn(auth)

        viewModel.register("alice@example.com", "password123", "254712345678")
        assertEquals(RegisterState.Loading, viewModel.state.value)

        advanceUntilIdle()
        assertEquals(RegisterState.Success(auth), viewModel.state.value)
    }

    @Test
    fun `API error transitions to Error state`() = runTest {
        whenever(mockApiClient.register(any(), any(), any()))
            .thenThrow(RuntimeException("Email already registered"))

        viewModel.register("taken@example.com", "password123", "254700000001")
        advanceUntilIdle()

        val state = viewModel.state.value
        assertTrue(state is RegisterState.Error)
        assertEquals("Email already registered", (state as RegisterState.Error).message)
    }

    @Test
    fun `API failure with null message falls back to generic message`() = runTest {
        whenever(mockApiClient.register(any(), any(), any()))
            .thenThrow(RuntimeException(null as String?))

        viewModel.register("a@b.com", "password123", "254700000001")
        advanceUntilIdle()

        val state = viewModel.state.value as RegisterState.Error
        assertEquals("Registration failed", state.message)
    }
}

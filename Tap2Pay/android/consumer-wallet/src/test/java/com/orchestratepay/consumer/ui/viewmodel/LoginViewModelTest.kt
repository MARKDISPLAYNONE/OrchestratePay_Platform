package com.orchestratepay.consumer.ui.viewmodel

import com.orchestratepay.consumer.api.AuthResponse
import com.orchestratepay.consumer.api.ConsumerApiClientInstance
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever

@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: LoginViewModel
    private val mockApiClient: ConsumerApiClientInstance = mock()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = LoginViewModel(mockApiClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `initial state is Idle`() {
        assertEquals(LoginState.Idle, viewModel.state.value)
    }

    @Test
    fun `login with empty fields returns error`() = runTest {
        viewModel.login("", "")
        assertEquals(LoginState.Error("Email and password are required"), viewModel.state.value)
    }

    @Test
    fun `login success transitions to Success state`() = runTest {
        val auth = AuthResponse("token", "c1", "254700", "Name", 123456)
        whenever(mockApiClient.login(any(), any())).thenReturn(auth)

        viewModel.login("test@example.com", "password")
        
        assertEquals(LoginState.Loading, viewModel.state.value)
        
        advanceUntilIdle()
        
        assertEquals(LoginState.Success(auth), viewModel.state.value)
    }

    @Test
    fun `login failure transitions to Error state`() = runTest {
        whenever(mockApiClient.login(any(), any())).thenThrow(RuntimeException("Invalid credentials"))

        viewModel.login("test@example.com", "wrong")
        
        advanceUntilIdle()
        
        assertEquals(LoginState.Error("Invalid credentials"), viewModel.state.value)
    }
}

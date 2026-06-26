package com.orchestratepay.consumer.ui.viewmodel

import com.orchestratepay.consumer.api.AuthResponse
import com.orchestratepay.consumer.api.ConsumerApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.mockito.Mockito.`when`
import org.mockito.kotlin.mock

@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: LoginViewModel

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = LoginViewModel()
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

    // Note: Mocking singleton objects with Mockito is complex.
    // In a real project, we'd use MockK or a Service Locator/DI pattern.
    // These tests demonstrate the StateFlow flow.
}

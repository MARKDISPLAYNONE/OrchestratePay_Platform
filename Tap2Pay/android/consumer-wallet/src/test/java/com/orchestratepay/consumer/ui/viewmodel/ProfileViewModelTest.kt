package com.orchestratepay.consumer.ui.viewmodel

import com.orchestratepay.consumer.api.ConsumerApiClientInstance
import com.orchestratepay.consumer.api.ConsumerProfile
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
class ProfileViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: ProfileViewModel
    private val mockApiClient: ConsumerApiClientInstance = mock()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        // ConsumerSessionManager.prefs is null in JVM tests — getPhone/getDisplayName return null
        viewModel = ProfileViewModel(mockApiClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun profile() = ConsumerProfile(
        id = "c1",
        phone = "254700000001",
        email = "alice@example.com",
        displayName = "Alice",
        smsOptIn = true,
        createdAt = "2024-01-01"
    )

    // ── Initial state ─────────────────────────────────────────────────────────

    @Test
    fun `initial state has empty phone and displayName (session not init in JVM)`() {
        assertEquals("", viewModel.state.value.phone)
        assertEquals("", viewModel.state.value.displayName)
        assertFalse(viewModel.state.value.isLoading)
        assertFalse(viewModel.state.value.isSaving)
        assertFalse(viewModel.state.value.loggedOut)
        assertNull(viewModel.state.value.error)
    }

    // ── loadProfile ───────────────────────────────────────────────────────────

    @Test
    fun `loadProfile sets isLoading immediately`() = runTest {
        whenever(mockApiClient.getProfile()).thenReturn(profile())

        viewModel.loadProfile()
        assertTrue(viewModel.state.value.isLoading)
    }

    @Test
    fun `loadProfile success updates displayName and smsOptIn`() = runTest {
        whenever(mockApiClient.getProfile()).thenReturn(profile())

        viewModel.loadProfile()
        advanceUntilIdle()

        val state = viewModel.state.value
        assertEquals("Alice", state.displayName)
        assertTrue(state.smsOptIn)
        assertFalse(state.isLoading)
        assertNull(state.error)
    }

    @Test
    fun `loadProfile with null displayName sets empty string`() = runTest {
        whenever(mockApiClient.getProfile()).thenReturn(profile().copy(displayName = null))

        viewModel.loadProfile()
        advanceUntilIdle()

        assertEquals("", viewModel.state.value.displayName)
    }

    @Test
    fun `loadProfile failure sets error and clears loading`() = runTest {
        whenever(mockApiClient.getProfile()).thenThrow(RuntimeException("Unauthorised"))

        viewModel.loadProfile()
        advanceUntilIdle()

        assertEquals("Unauthorised", viewModel.state.value.error)
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `loadProfile null error message falls back to default`() = runTest {
        whenever(mockApiClient.getProfile()).thenThrow(RuntimeException(null as String?))

        viewModel.loadProfile()
        advanceUntilIdle()

        assertEquals("Failed to load profile", viewModel.state.value.error)
    }

    // ── updateProfile ─────────────────────────────────────────────────────────

    @Test
    fun `updateProfile sets isSaving immediately`() = runTest {
        whenever(mockApiClient.updateProfile(any(), any())).thenReturn(mapOf("success" to true))

        viewModel.updateProfile("Bob", true)
        assertTrue(viewModel.state.value.isSaving)
    }

    @Test
    fun `updateProfile success sets updateSuccess flag`() = runTest {
        whenever(mockApiClient.updateProfile("Bob", false)).thenReturn(mapOf("success" to true))

        viewModel.updateProfile("Bob", false)
        advanceUntilIdle()

        val state = viewModel.state.value
        assertTrue(state.updateSuccess)
        assertFalse(state.isSaving)
    }

    @Test
    fun `updateProfile failure sets error and clears isSaving`() = runTest {
        whenever(mockApiClient.updateProfile(any(), any())).thenThrow(RuntimeException("Validation failed"))

        viewModel.updateProfile("Bad Name", true)
        advanceUntilIdle()

        assertEquals("Validation failed", viewModel.state.value.error)
        assertFalse(viewModel.state.value.isSaving)
        assertFalse(viewModel.state.value.updateSuccess)
    }

    // ── logout ────────────────────────────────────────────────────────────────

    @Test
    fun `logout sets loggedOut flag`() {
        viewModel.logout()
        assertTrue(viewModel.state.value.loggedOut)
    }
}

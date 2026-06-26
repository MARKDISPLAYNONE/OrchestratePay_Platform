package com.orchestratepay.consumer.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.realtime.ConsumerWebSocketClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ProfileState(
    val phone: String = "",
    val displayName: String = "",
    val smsOptIn: Boolean = false,
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val updateSuccess: Boolean = false,
    val loggedOut: Boolean = false,
    val error: String? = null
)

class ProfileViewModel(
    private val apiClient: ConsumerApiClientInstance = ConsumerApiClient
) : ViewModel() {

    private val _state = MutableStateFlow(ProfileState())
    val state: StateFlow<ProfileState> = _state.asStateFlow()

    init {
        _state.value = _state.value.copy(
            phone = ConsumerSessionManager.getPhone() ?: "",
            displayName = ConsumerSessionManager.getDisplayName() ?: ""
        )
    }

    fun loadProfile() {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            runCatching { apiClient.getProfile() }
                .onSuccess { profile ->
                    _state.value = _state.value.copy(
                        displayName = profile.displayName ?: "",
                        smsOptIn = profile.smsOptIn,
                        isLoading = false
                    )
                }
                .onFailure { err ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = err.message ?: "Failed to load profile"
                    )
                }
        }
    }

    fun updateProfile(displayName: String?, smsOptIn: Boolean) {
        _state.value = _state.value.copy(isSaving = true, error = null, updateSuccess = false)
        viewModelScope.launch {
            runCatching { apiClient.updateProfile(displayName, smsOptIn) }
                .onSuccess {
                    _state.value = _state.value.copy(isSaving = false, updateSuccess = true)
                }
                .onFailure { err ->
                    _state.value = _state.value.copy(
                        isSaving = false,
                        error = err.message ?: "Failed to update profile"
                    )
                }
        }
    }

    fun logout() {
        ConsumerWebSocketClient.shared?.disconnect()
        ConsumerSessionManager.clearSession()
        _state.value = _state.value.copy(loggedOut = true)
    }
}

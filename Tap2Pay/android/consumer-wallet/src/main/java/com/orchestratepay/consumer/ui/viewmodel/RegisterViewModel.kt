package com.orchestratepay.consumer.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.orchestratepay.consumer.api.AuthResponse
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.realtime.ConsumerWebSocketClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class RegisterState {
    object Idle : RegisterState()
    object Loading : RegisterState()
    data class Success(val auth: AuthResponse) : RegisterState()
    data class Error(val message: String) : RegisterState()
}

class RegisterViewModel(
    private val apiClient: ConsumerApiClientInstance = ConsumerApiClient
) : ViewModel() {

    private val _state = MutableStateFlow<RegisterState>(RegisterState.Idle)
    val state: StateFlow<RegisterState> = _state.asStateFlow()

    fun register(email: String, password: String, phone: String) {
        if (email.isBlank() || password.length < 8 || phone.isBlank()) {
            _state.value = RegisterState.Error("All fields required. Password must be at least 8 characters.")
            return
        }
        if (!phone.matches(Regex("^254[0-9]{9}$"))) {
            _state.value = RegisterState.Error("Phone must be in format 254XXXXXXXXX")
            return
        }

        _state.value = RegisterState.Loading

        viewModelScope.launch {
            runCatching { apiClient.register(email, password, phone) }
                .onSuccess { auth ->
                    ConsumerSessionManager.saveSession(
                        token = auth.token,
                        consumerId = auth.consumerId,
                        phone = auth.phone,
                        displayName = auth.displayName,
                        expiresAt = auth.expiresAt
                    )
                    ConsumerSessionManager.getFcmToken()?.let { fcm ->
                        runCatching { apiClient.updateFcmToken(fcm) }
                    }
                    ConsumerWebSocketClient.shared?.connect()
                    _state.value = RegisterState.Success(auth)
                }
                .onFailure { err ->
                    _state.value = RegisterState.Error(err.message ?: "Registration failed")
                }
        }
    }
}

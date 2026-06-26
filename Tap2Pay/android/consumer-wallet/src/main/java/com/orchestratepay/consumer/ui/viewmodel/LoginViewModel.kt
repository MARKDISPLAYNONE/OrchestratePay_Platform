package com.orchestratepay.consumer.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.orchestratepay.consumer.api.AuthResponse
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.api.ConsumerApiClientInstance
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.realtime.ConsumerWebSocketClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class LoginState {
    object Idle : LoginState()
    object Loading : LoginState()
    data class Success(val auth: AuthResponse) : LoginState()
    data class Error(val message: String) : LoginState()
}

class LoginViewModel(
    private val apiClient: ConsumerApiClientInstance = ConsumerApiClient
) : ViewModel() {

    private val _state = MutableStateFlow<LoginState>(LoginState.Idle)
    val state: StateFlow<LoginState> = _state.asStateFlow()

    fun login(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) {
            _state.value = LoginState.Error("Email and password are required")
            return
        }

        _state.value = LoginState.Loading

        viewModelScope.launch {
            runCatching { apiClient.login(email, password) }
                .onSuccess { auth ->
                    ConsumerSessionManager.saveSession(
                        token = auth.token,
                        consumerId = auth.consumerId,
                        phone = auth.phone,
                        displayName = auth.displayName,
                        expiresAt = auth.expiresAt
                    )
                    
                    // Persist FCM token to backend now that we have a valid JWT
                    ConsumerSessionManager.getFcmToken()?.let { fcm ->
                        runCatching { apiClient.updateFcmToken(fcm) }
                    }
                    
                    ConsumerWebSocketClient.shared?.connect()
                    _state.value = LoginState.Success(auth)
                }
                .onFailure { err ->
                    _state.value = LoginState.Error(err.message ?: "Login failed")
                }
        }
    }
}

package com.orchestratepay.consumer.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.api.P2pTokenResponse
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class P2pTokenState {
    object Idle : P2pTokenState()
    object Loading : P2pTokenState()
    data class Success(val response: P2pTokenResponse) : P2pTokenState()
    data class Error(val message: String) : P2pTokenState()
}

class P2PPayViewModel : ViewModel() {

    private val _tokenState = MutableStateFlow<P2pTokenState>(P2pTokenState.Idle)
    val tokenState: StateFlow<P2pTokenState> = _tokenState.asStateFlow()

    fun requestP2pToken(amountCents: Int? = null) {
        _tokenState.value = P2pTokenState.Loading
        viewModelScope.launch {
            runCatching { ConsumerApiClient.requestP2pToken(amountCents) }
                .onSuccess { resp -> _tokenState.value = P2pTokenState.Success(resp) }
                .onFailure { err -> _tokenState.value = P2pTokenState.Error(err.message ?: "Failed to generate P2P token") }
        }
    }
}

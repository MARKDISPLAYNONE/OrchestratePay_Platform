package com.orchestratepay.consumer.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.api.P2pPayResponse
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.security.SecureRandom

sealed class P2pPayState {
    object Idle : P2pPayState()
    object Processing : P2pPayState()
    data class Success(val response: P2pPayResponse) : P2pPayState()
    data class Error(val message: String) : P2pPayState()
}

class P2PSendViewModel : ViewModel() {

    private val _state = MutableStateFlow<P2pPayState>(P2pPayState.Idle)
    val state: StateFlow<P2pPayState> = _state.asStateFlow()

    fun p2pPay(
        p2pToken: String?,
        payeeConsumerId: String?,
        amountCents: Int,
        source: String
    ) {
        _state.value = P2pPayState.Processing
        val idempotencyKey = buildIdempotencyKey()
        
        viewModelScope.launch {
            runCatching {
                ConsumerApiClient.p2pPay(
                    p2pToken = p2pToken,
                    payeeConsumerId = payeeConsumerId,
                    amountCents = amountCents,
                    idempotencyKey = idempotencyKey,
                    timestamp = System.currentTimeMillis(),
                    source = source
                )
            }.onSuccess { resp ->
                _state.value = P2pPayState.Success(resp)
            }.onFailure { err ->
                _state.value = P2pPayState.Error(err.message ?: "P2P payment failed")
            }
        }
    }

    private fun buildIdempotencyKey(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

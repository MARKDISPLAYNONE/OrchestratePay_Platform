package com.orchestratepay.consumer.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.api.TxnStatusResponse
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.security.SecureRandom
import com.orchestratepay.consumer.api.ConsumerApiClientInstance

sealed class HcePaymentState {
    object Idle : HcePaymentState()
    object Processing : HcePaymentState()
    data class WaitingForMpesa(val txnId: String, val secondsRemaining: Int) : HcePaymentState()
    data class Success(val status: TxnStatusResponse) : HcePaymentState()
    data class Error(val message: String, val canRetry: Boolean = true) : HcePaymentState()
}

class MerchantHcePayViewModel(
    private val apiClient: ConsumerApiClientInstance = ConsumerApiClient
) : ViewModel() {

    private val _state = MutableStateFlow<HcePaymentState>(HcePaymentState.Idle)
    val state: StateFlow<HcePaymentState> = _state.asStateFlow()

    private var pollingJob: Job? = null

    fun initiatePayment(merchantId: String, amountCents: Int, merchantHceToken: String) {
        _state.value = HcePaymentState.Processing
        val idempotencyKey = buildIdempotencyKey()

        viewModelScope.launch {
            runCatching {
                apiClient.payMerchantViaHce(
                    merchantId = merchantId,
                    amountCents = amountCents,
                    idempotencyKey = idempotencyKey,
                    timestamp = System.currentTimeMillis(),
                    merchantHceToken = merchantHceToken
                )
            }.onSuccess { resp ->
                startPolling(resp.transactionId)
            }.onFailure { e ->
                _state.value = HcePaymentState.Error("Payment failed: ${e.message}")
            }
        }
    }

    private fun startPolling(txnId: String) {
        pollingJob?.cancel()
        pollingJob = viewModelScope.launch {
            var secondsRemaining = 90
            while (secondsRemaining > 0) {
                _state.value = HcePaymentState.WaitingForMpesa(txnId, secondsRemaining)
                
                runCatching { apiClient.getTransactionStatus(txnId) }
                    .onSuccess { status ->
                        when (status.status) {
                            "CONFIRMED" -> {
                                _state.value = HcePaymentState.Success(status)
                                return@launch
                            }
                            "DECLINED", "FAILED" -> {
                                _state.value = HcePaymentState.Error("Payment ${status.status.lowercase()}", false)
                                return@launch
                            }
                        }
                    }
                
                delay(3000)
                secondsRemaining -= 3
            }
            _state.value = HcePaymentState.Error("Timed out waiting for confirmation", true)
        }
    }

    private fun buildIdempotencyKey(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    override fun onCleared() {
        super.onCleared()
        pollingJob?.cancel()
    }
}

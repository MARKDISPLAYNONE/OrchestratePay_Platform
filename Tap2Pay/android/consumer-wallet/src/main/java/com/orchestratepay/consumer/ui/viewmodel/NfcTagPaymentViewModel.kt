package com.orchestratepay.consumer.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.api.MerchantInfoResponse
import com.orchestratepay.consumer.api.TxnStatusResponse
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.security.SecureRandom

sealed class PaymentState {
    object Idle : PaymentState()
    data class LoadingMerchant(val mid: String) : PaymentState()
    data class MerchantLoaded(val info: MerchantInfoResponse) : PaymentState()
    object Processing : PaymentState()
    data class WaitingForMpesa(val txnId: String, val secondsRemaining: Int) : PaymentState()
    data class Success(val status: TxnStatusResponse) : PaymentState()
    data class Error(val message: String, val canRetry: Boolean = true) : PaymentState()
}

class NfcTagPaymentViewModel(
    private val apiClient: ConsumerApiClientInstance = ConsumerApiClient
) : ViewModel() {

    private val _state = MutableStateFlow<PaymentState>(PaymentState.Idle)
    val state: StateFlow<PaymentState> = _state.asStateFlow()

    private var pollingJob: Job? = null

    fun loadMerchant(mid: String) {
        _state.value = PaymentState.LoadingMerchant(mid)
        viewModelScope.launch {
            runCatching { apiClient.getMerchantInfo(mid) }
                .onSuccess { info -> _state.value = PaymentState.MerchantLoaded(info) }
                .onFailure { _state.value = PaymentState.Error("Could not load merchant info") }
        }
    }

    fun initiatePayment(mid: String, amountCents: Int) {
        _state.value = PaymentState.Processing
        val idempotencyKey = buildIdempotencyKey()

        viewModelScope.launch {
            runCatching {
                apiClient.payMerchant(
                    merchantId = mid,
                    amountCents = amountCents,
                    idempotencyKey = idempotencyKey,
                    timestamp = System.currentTimeMillis()
                )
            }.onSuccess { resp ->
                startPolling(resp.transactionId)
            }.onFailure { e ->
                _state.value = PaymentState.Error("Payment failed: ${e.message}")
            }
        }
    }

    private fun startPolling(txnId: String) {
        pollingJob?.cancel()
        pollingJob = viewModelScope.launch {
            var secondsRemaining = 90
            while (secondsRemaining > 0) {
                _state.value = PaymentState.WaitingForMpesa(txnId, secondsRemaining)
                
                runCatching { apiClient.getTransactionStatus(txnId) }
                    .onSuccess { status ->
                        when (status.status) {
                            "CONFIRMED" -> {
                                _state.value = PaymentState.Success(status)
                                return@launch
                            }
                            "DECLINED", "FAILED" -> {
                                _state.value = PaymentState.Error("Payment ${status.status.lowercase()}", false)
                                return@launch
                            }
                        }
                    }
                
                delay(3000)
                secondsRemaining -= 3
            }
            _state.value = PaymentState.Error("Timed out waiting for confirmation", true)
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

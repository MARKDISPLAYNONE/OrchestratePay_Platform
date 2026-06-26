package com.orchestratepay.consumer.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.api.ConsumerApiClientInstance
import com.orchestratepay.consumer.api.Transaction
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class TransactionHistoryState(
    val transactions: List<Transaction> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val hasMore: Boolean = true,
    val disputeSuccess: String? = null
)

class TransactionHistoryViewModel(
    private val apiClient: ConsumerApiClientInstance = ConsumerApiClient
) : ViewModel() {

    private val _state = MutableStateFlow(TransactionHistoryState())
    val state: StateFlow<TransactionHistoryState> = _state.asStateFlow()

    private var offset = 0
    private val limit = 20

    fun loadTransactions(refresh: Boolean = false) {
        if (refresh) {
            offset = 0
            _state.value = _state.value.copy(transactions = emptyList(), hasMore = true)
        }
        
        if (!_state.value.hasMore || _state.value.isLoading) return

        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            runCatching { apiClient.getTransactions(limit, offset) }
                .onSuccess { resp ->
                    val newList = _state.value.transactions + resp.transactions
                    _state.value = _state.value.copy(
                        transactions = newList,
                        isLoading = false,
                        hasMore = resp.transactions.size >= limit
                    )
                    offset += resp.transactions.size
                }
                .onFailure { err ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = err.message ?: "Failed to load transactions"
                    )
                }
        }
    }

    fun fileDispute(transactionId: String, reason: String) {
        viewModelScope.launch {
            runCatching { apiClient.fileDispute(transactionId, reason) }
                .onSuccess {
                    _state.value = _state.value.copy(disputeSuccess = "Dispute filed successfully")
                }
                .onFailure { err ->
                    _state.value = _state.value.copy(error = err.message ?: "Failed to file dispute")
                }
        }
    }
    
    fun clearDisputeState() {
        _state.value = _state.value.copy(disputeSuccess = null)
    }
}

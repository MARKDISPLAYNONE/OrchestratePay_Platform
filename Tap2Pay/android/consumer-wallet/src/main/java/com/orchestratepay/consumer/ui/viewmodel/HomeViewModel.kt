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

data class HomeState(
    val recentTransactions: List<Transaction> = emptyList(),
    val totalPoints: Int = 0,
    val isLoadingTransactions: Boolean = false,
    val isLoadingLoyalty: Boolean = false,
    val error: String? = null
)

class HomeViewModel(
    private val apiClient: ConsumerApiClientInstance = ConsumerApiClient
) : ViewModel() {

    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()

    fun loadData() {
        _state.value = _state.value.copy(isLoadingTransactions = true, isLoadingLoyalty = true, error = null)

        viewModelScope.launch {
            runCatching { apiClient.getTransactions(limit = 3) }
                .onSuccess { resp ->
                    _state.value = _state.value.copy(
                        recentTransactions = resp.transactions,
                        isLoadingTransactions = false
                    )
                }
                .onFailure { err ->
                    _state.value = _state.value.copy(
                        isLoadingTransactions = false,
                        error = err.message ?: "Failed to load transactions"
                    )
                }
        }

        viewModelScope.launch {
            runCatching { apiClient.getLoyalty() }
                .onSuccess { resp ->
                    val total = resp.balances.sumOf { it.pointsBalance }
                    _state.value = _state.value.copy(
                        totalPoints = total,
                        isLoadingLoyalty = false
                    )
                }
                .onFailure { err ->
                    _state.value = _state.value.copy(
                        isLoadingLoyalty = false,
                        error = err.message ?: "Failed to load loyalty data"
                    )
                }
        }
    }
}

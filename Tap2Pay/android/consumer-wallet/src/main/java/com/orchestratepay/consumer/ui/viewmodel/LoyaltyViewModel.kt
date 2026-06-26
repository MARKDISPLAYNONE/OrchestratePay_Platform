package com.orchestratepay.consumer.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.api.LoyaltyBalance
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LoyaltyState(
    val balances: List<LoyaltyBalance> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val redemptionSuccess: String? = null
)

class LoyaltyViewModel : ViewModel() {

    private val _state = MutableStateFlow(LoyaltyState())
    val state: StateFlow<LoyaltyState> = _state.asStateFlow()

    fun loadLoyalty() {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            runCatching { ConsumerApiClient.getLoyalty() }
                .onSuccess { resp ->
                    _state.value = _state.value.copy(balances = resp.balances, isLoading = false)
                }
                .onFailure { err ->
                    _state.value = _state.value.copy(isLoading = false, error = err.message ?: "Failed to load loyalty")
                }
        }
    }

    fun redeem(merchantId: String, rewardId: String) {
        viewModelScope.launch {
            runCatching { ConsumerApiClient.redeemLoyalty(merchantId, rewardId) }
                .onSuccess {
                    _state.value = _state.value.copy(redemptionSuccess = "Reward redeemed successfully!")
                    loadLoyalty() // Refresh
                }
                .onFailure { err ->
                    _state.value = _state.value.copy(error = err.message ?: "Redemption failed")
                }
        }
    }
    
    fun clearRedemptionState() {
        _state.value = _state.value.copy(redemptionSuccess = null)
    }
}

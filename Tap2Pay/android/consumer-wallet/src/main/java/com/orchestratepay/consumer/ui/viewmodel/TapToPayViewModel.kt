package com.orchestratepay.consumer.ui.viewmodel

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.orchestratepay.consumer.payment.QrTokenManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class TapToPayState(
    val qrBitmap: Bitmap? = null,
    val secondsRemaining: Int = 0,
    val isLoadingQr: Boolean = false,
    val qrError: String? = null
)

class TapToPayViewModel(
    private val qrManager: QrTokenManager = QrTokenManager()
) : ViewModel() {

    private val _state = MutableStateFlow(TapToPayState())
    val state: StateFlow<TapToPayState> = _state.asStateFlow()
    private var countdownJob: Job? = null

    fun loadQr() {
        _state.value = _state.value.copy(isLoadingQr = true, qrError = null)
        viewModelScope.launch {
            runCatching { qrManager.getQrState() }
                .onSuccess { state ->
                    _state.value = _state.value.copy(
                        qrBitmap = state.bitmap,
                        isLoadingQr = false
                    )
                    startCountdown(state.expiresAt)
                }
                .onFailure { err ->
                    _state.value = _state.value.copy(
                        isLoadingQr = false,
                        qrError = err.message ?: "Failed to load QR"
                    )
                }
        }
    }

    private fun startCountdown(expiresAt: Long) {
        countdownJob?.cancel()
        countdownJob = viewModelScope.launch {
            while (true) {
                val remaining = ((expiresAt - System.currentTimeMillis()) / 1000).toInt()
                if (remaining <= 0) {
                    loadQr() // Auto-refresh
                    break
                }
                _state.value = _state.value.copy(secondsRemaining = remaining)
                delay(1000)
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        qrManager.cancel()
        countdownJob?.cancel()
    }
}

package com.orchestratepay.nfccore

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.content.getSystemService

/**
 * TapFeedback — haptic and audio feedback for NFC tap events.
 *
 * Used by both the terminal app and the SoftPOS app.
 * Abstracts the deprecated Vibrator API (pre-API 31) vs. VibratorManager (API 31+).
 */
object TapFeedback {

    /** Short buzz to confirm a successful tag read. */
    fun success(context: Context) = vibrate(context, longArrayOf(0, 60, 40, 80), -1)

    /** Double buzz for errors (wrong tag, expired token). */
    fun error(context: Context) = vibrate(context, longArrayOf(0, 80, 80, 80), -1)

    /** Single longer buzz when the antenna detection area is tapped during SoftPOS mode. */
    fun detected(context: Context) = vibrate(context, longArrayOf(0, 100), -1)

    @Suppress("DEPRECATION")
    private fun vibrate(context: Context, pattern: LongArray, repeat: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = context.getSystemService(VibratorManager::class.java)
            vm?.defaultVibrator?.vibrate(
                VibrationEffect.createWaveform(pattern, repeat)
            )
        } else {
            val v = context.getSystemService<Vibrator>()
            v?.vibrate(pattern, repeat)
        }
    }
}

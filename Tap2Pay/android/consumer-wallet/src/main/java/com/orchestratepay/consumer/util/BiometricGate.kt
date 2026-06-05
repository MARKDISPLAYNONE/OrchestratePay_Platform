package com.orchestratepay.consumer.util

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * BiometricGate — pre-payment biometric authorization using AndroidX BiometricPrompt.
 *
 * Called by payment activities (NfcTagPaymentActivity, MerchantHcePayActivity,
 * P2PPayActivity, P2PQrScannerActivity) before dispatching the payment API call.
 *
 * Authenticator policy: BIOMETRIC_STRONG OR DEVICE_CREDENTIAL.
 * This means the prompt always works — it falls back to PIN/pattern/password if
 * the device has no biometric enrolled. The app never blocks payment purely due
 * to missing biometric hardware.
 *
 * Threading: must be called from the main (UI) thread.
 *
 * Usage:
 *   BiometricGate.prompt(activity,
 *     onSuccess = { initiatePayment() },
 *     onFailure = { msg -> showError(msg) },
 *     onCancel  = { /* stay on screen */ }
 *   )
 */
object BiometricGate {

    /**
     * Returns true if the device can authenticate with biometric or device credential.
     * When false, proceed with payment directly (M-Pesa PIN is still required).
     */
    fun isAvailable(context: Context): Boolean {
        val bm = BiometricManager.from(context)
        return bm.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        ) == BiometricManager.BIOMETRIC_SUCCESS
    }

    /**
     * Shows the biometric prompt. Must be called from the main thread.
     *
     * @param activity  The calling FragmentActivity
     * @param title     Title shown in the prompt dialog
     * @param subtitle  Subtitle shown below the title (include amount and merchant name)
     * @param onSuccess Called when authentication succeeds — proceed with payment here
     * @param onFailure Called when all retries are exhausted — show error to user
     * @param onCancel  Called when user dismisses the prompt — do nothing (stay on screen)
     */
    fun prompt(
        activity:  FragmentActivity,
        title:     String  = "Confirm Payment",
        subtitle:  String  = "Use fingerprint, face, or PIN to authorize this payment",
        onSuccess: () -> Unit,
        onFailure: (String) -> Unit,
        onCancel:  () -> Unit,
    ) {
        val executor = ContextCompat.getMainExecutor(activity)

        val callback = object : BiometricPrompt.AuthenticationCallback() {

            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                super.onAuthenticationSucceeded(result)
                onSuccess()
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                super.onAuthenticationError(errorCode, errString)
                // User pressed "Cancel" or "Use password" was dismissed — not a failure
                if (errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                    errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON) {
                    onCancel()
                } else {
                    onFailure(errString.toString())
                }
            }

            override fun onAuthenticationFailed() {
                super.onAuthenticationFailed()
                // A single failed attempt — BiometricPrompt manages retry UI natively.
                // Do NOT call onFailure here; the prompt stays visible for more attempts.
            }
        }

        val biometricPrompt = BiometricPrompt(activity, executor, callback)

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
            )
            .build()

        biometricPrompt.authenticate(promptInfo)
    }
}

package com.orchestratepay.softpos.integrity

import android.content.Context
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * PlayIntegrityChecker — obtains a Google Play Integrity token for SoftPOS device attestation.
 *
 * The backend's /api/v1/attestation endpoint verifies this token with Google's servers
 * and confirms that:
 *   1. The app is genuine (not repackaged/tampered)
 *   2. The device passed Android's basic integrity checks
 *   3. The app is distributed via Google Play (not sideloaded)
 *
 * The nonce must be unique per-session and bound to the merchant ID to prevent
 * replay attacks across different accounts.
 *
 * Token verification happens server-side — the client only obtains the token.
 *
 * Reference: https://developer.android.com/google/play/integrity/overview
 */
object PlayIntegrityChecker {

    /**
     * Obtains an integrity token for the given [nonce].
     * The nonce should be: SHA-256(merchantId + sessionTimestamp), base64url-encoded.
     *
     * Returns the token string on success, null on failure.
     * Failure is non-fatal for sandbox/development builds — the backend checks
     * PLAY_INTEGRITY_REQUIRED env var before rejecting requests without a token.
     */
    suspend fun getIntegrityToken(context: Context, nonce: String): String? {
        return try {
            val integrityManager = IntegrityManagerFactory.create(context)

            suspendCancellableCoroutine { cont ->
                integrityManager
                    .requestIntegrityToken(
                        IntegrityTokenRequest.builder()
                            .setNonce(nonce)
                            .build()
                    )
                    .addOnSuccessListener { response ->
                        cont.resume(response.token())
                    }
                    .addOnFailureListener { e ->
                        android.util.Log.w("PlayIntegrity", "Integrity check failed: ${e.message}")
                        cont.resume(null)
                    }
            }
        } catch (e: Exception) {
            android.util.Log.e("PlayIntegrity", "Integrity check threw: ${e.message}")
            null
        }
    }
}

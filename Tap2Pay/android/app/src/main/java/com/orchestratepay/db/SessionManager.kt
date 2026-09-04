package com.orchestratepay.db

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * SessionManager — secure storage for the merchant's JWT token.
 *
 * WHY ENCRYPTED SHARED PREFERENCES:
 * Regular SharedPreferences stores plain text on the filesystem.
 * On non-rooted devices this is fine (files are app-sandboxed), but if the
 * device is rooted or physically stolen and analysed, plain tokens are trivially
 * extracted. EncryptedSharedPreferences uses AES-256-GCM via Android Keystore —
 * the encryption key never leaves the secure hardware enclave.
 *
 * This is a CBK compliance requirement for financial apps.
 */
object SessionManager {

    private var prefs: android.content.SharedPreferences? = null
    private var sessionId: String? = null

    private const val KEY_TOKEN = "jwt_token"
    private const val KEY_MERCHANT_ID = "merchant_id"
    private const val KEY_MERCHANT_NAME = "merchant_name"
    private const val KEY_EXPIRES_AT = "expires_at"
    private const val KEY_NFC_SIGNING_KEY = "nfc_signing_key"
    private const val KEY_KRA_PIN = "kra_pin"
    private const val KEY_DEVICE_ID = "device_id"
    // Bug #17 fix — refresh token was issued by the backend at login but never persisted.
    private const val KEY_REFRESH_TOKEN = "refresh_token"

    // Consumer wallet keys (used by OrchestrateHceService)
    private const val KEY_CONSUMER_PHONE = "consumer_phone"
    private const val KEY_CONSUMER_TOKEN = "consumer_hce_token"

    fun init(context: Context) {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        prefs = EncryptedSharedPreferences.create(
            context,
            "orchestrate_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /**
     * Bug #17 fix: added `refreshToken` parameter (nullable — older/degraded
     * login responses without it should not crash the login flow, they just
     * mean this session cannot silently refresh later and will force re-login
     * on expiry instead).
     *
     * Bug #32: added `deviceId`. The backend now binds the refresh token to the
     * deviceId sent at login and rejects /auth/refresh from any other value, so
     * the stored deviceId MUST be byte-identical to what went in LoginRequest.
     * Persisting it here — atomically with the token pair, from the same value
     * the caller just sent — is the only way to guarantee that. Nullable so
     * other call sites don't break; when null we leave any existing stored
     * value alone rather than clobbering it.
     */
    fun saveSession(
        token: String,
        merchantId: String,
        merchantName: String,
        expiresAt: Long,
        nfcSigningKey: String? = null,
        kraPin: String? = null,
        refreshToken: String? = null,
        deviceId: String? = null
    ) {
        val editor = prefs?.edit()
            ?.putString(KEY_TOKEN, token)
            ?.putString(KEY_MERCHANT_ID, merchantId)
            ?.putString(KEY_MERCHANT_NAME, merchantName)
            ?.putLong(KEY_EXPIRES_AT, expiresAt)
            ?.putString(KEY_NFC_SIGNING_KEY, nfcSigningKey)
            ?.putString(KEY_KRA_PIN, kraPin)
            ?.putString(KEY_REFRESH_TOKEN, refreshToken)

        if (deviceId != null) {
            editor?.putString(KEY_DEVICE_ID, deviceId)
        }

        editor?.apply()

        // Generate a new session ID for audit log correlation
        sessionId = java.util.UUID.randomUUID().toString()
    }

    /**
     * Bug #17 fix: called by TokenAuthenticator after a successful /auth/refresh.
     * Updates ONLY the rotating fields (token, refreshToken, expiresAt) — leaves
     * merchantId/merchantName/nfcSigningKey/kraPin/deviceId untouched, since the
     * refresh endpoint's response doesn't include them (confirmed from auth.ts).
     */
    fun updateTokens(token: String, refreshToken: String, expiresAt: Long) {
        prefs?.edit()
            ?.putString(KEY_TOKEN, token)
            ?.putString(KEY_REFRESH_TOKEN, refreshToken)
            ?.putLong(KEY_EXPIRES_AT, expiresAt)
            ?.apply()
    }

    fun getToken(): String? {
        val token = prefs?.getString(KEY_TOKEN, null) ?: return null
        val expiresAt = prefs?.getLong(KEY_EXPIRES_AT, 0L) ?: 0L
        // Return null if token is expired — caller will redirect to login
        return if (System.currentTimeMillis() < expiresAt) token else null
    }

    /**
     * Bug #17 fix: unlike getToken(), this deliberately does NOT check expiry —
     * refresh tokens have their own much longer TTL (30d) tracked server-side.
     * The client has no reliable way to know the refresh token's expiry locally,
     * so it always returns whatever is stored; the server is the source of truth
     * and will 401 the refresh call itself if the refresh token is actually dead.
     */
    fun getRefreshToken(): String? = prefs?.getString(KEY_REFRESH_TOKEN, null)

    fun getMerchantId(): String? = prefs?.getString(KEY_MERCHANT_ID, null)
    fun getMerchantName(): String? = prefs?.getString(KEY_MERCHANT_NAME, null)
    fun getSessionId(): String? = sessionId
    fun getNfcSigningKey(): String? = prefs?.getString(KEY_NFC_SIGNING_KEY, null)
    fun getKraPin(): String? = prefs?.getString(KEY_KRA_PIN, null)

    fun saveDeviceId(deviceId: String) {
        prefs?.edit()?.putString(KEY_DEVICE_ID, deviceId)?.apply()
    }

    /**
     * Bug #32: read by TokenAuthenticator to prove device identity on
     * /auth/refresh. Null means "no session was ever saved on this install
     * (or clearSession() ran)" — the Authenticator treats that as a hard
     * force-logout, same as a missing refresh token.
     */
    fun getDeviceId(): String? = prefs?.getString(KEY_DEVICE_ID, null)

    fun isLoggedIn(): Boolean = getToken() != null

    // ─── Consumer wallet session (for HCE) ───────────────────────────────────

    fun saveConsumerSession(phone: String, hceToken: String) {
        prefs?.edit()
            ?.putString(KEY_CONSUMER_PHONE, phone)
            ?.putString(KEY_CONSUMER_TOKEN, hceToken)
            ?.apply()
    }

    fun getConsumerPhone(): String? = prefs?.getString(KEY_CONSUMER_PHONE, null)
    fun getConsumerHceToken(): String? = prefs?.getString(KEY_CONSUMER_TOKEN, null)

    fun clearConsumerSession() {
        prefs?.edit()
            ?.remove(KEY_CONSUMER_PHONE)
            ?.remove(KEY_CONSUMER_TOKEN)
            ?.apply()
    }

    fun clearSession() {
        prefs?.edit()?.clear()?.apply()
        sessionId = null
    }
}
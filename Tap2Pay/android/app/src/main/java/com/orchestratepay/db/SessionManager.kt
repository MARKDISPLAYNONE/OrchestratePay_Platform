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

    private const val KEY_TOKEN           = "jwt_token"
    private const val KEY_MERCHANT_ID     = "merchant_id"
    private const val KEY_MERCHANT_NAME   = "merchant_name"
    private const val KEY_EXPIRES_AT      = "expires_at"
    private const val KEY_NFC_SIGNING_KEY = "nfc_signing_key"
    private const val KEY_KRA_PIN         = "kra_pin"
    private const val KEY_DEVICE_ID       = "device_id"
    // Consumer wallet keys (used by OrchestrateHceService)
    private const val KEY_CONSUMER_PHONE  = "consumer_phone"
    private const val KEY_CONSUMER_TOKEN  = "consumer_hce_token"

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

    fun saveSession(
        token: String,
        merchantId: String,
        merchantName: String,
        expiresAt: Long,
        nfcSigningKey: String? = null,
        kraPin: String? = null
    ) {
        prefs?.edit()
            ?.putString(KEY_TOKEN, token)
            ?.putString(KEY_MERCHANT_ID, merchantId)
            ?.putString(KEY_MERCHANT_NAME, merchantName)
            ?.putLong(KEY_EXPIRES_AT, expiresAt)
            ?.putString(KEY_NFC_SIGNING_KEY, nfcSigningKey)
            ?.putString(KEY_KRA_PIN, kraPin)
            ?.apply()
        // Generate a new session ID for audit log correlation
        sessionId = java.util.UUID.randomUUID().toString()
    }

    fun getToken(): String? {
        val token = prefs?.getString(KEY_TOKEN, null) ?: return null
        val expiresAt = prefs?.getLong(KEY_EXPIRES_AT, 0L) ?: 0L
        // Return null if token is expired — caller will redirect to login
        return if (System.currentTimeMillis() < expiresAt) token else null
    }

    fun getMerchantId(): String? = prefs?.getString(KEY_MERCHANT_ID, null)
    fun getMerchantName(): String? = prefs?.getString(KEY_MERCHANT_NAME, null)
    fun getSessionId(): String? = sessionId
    fun getNfcSigningKey(): String? = prefs?.getString(KEY_NFC_SIGNING_KEY, null)
    fun getKraPin(): String? = prefs?.getString(KEY_KRA_PIN, null)

    fun saveDeviceId(deviceId: String) {
        prefs?.edit()?.putString(KEY_DEVICE_ID, deviceId)?.apply()
    }

    fun getDeviceId(): String? = prefs?.getString(KEY_DEVICE_ID, null)

    fun isLoggedIn(): Boolean = getToken() != null

    // ─── Consumer wallet session (for HCE) ───────────────────────────────────

    fun saveConsumerSession(phone: String, hceToken: String) {
        prefs?.edit()
            ?.putString(KEY_CONSUMER_PHONE, phone)
            ?.putString(KEY_CONSUMER_TOKEN, hceToken)
            ?.apply()
    }

    fun getConsumerPhone():    String? = prefs?.getString(KEY_CONSUMER_PHONE, null)
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

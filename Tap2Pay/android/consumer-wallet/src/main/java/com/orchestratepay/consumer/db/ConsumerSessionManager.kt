package com.orchestratepay.consumer.db

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * ConsumerSessionManager — AES-256-GCM encrypted storage for the consumer JWT
 * and associated identity fields.
 *
 * Stored in a separate file ("consumer_secure_prefs") from the merchant app's
 * SessionManager so the two apps never share key material.
 */
object ConsumerSessionManager {

    private var prefs: SharedPreferences? = null

    private const val KEY_TOKEN        = "consumer_jwt"
    private const val KEY_CONSUMER_ID  = "consumer_id"
    private const val KEY_PHONE        = "consumer_phone"
    private const val KEY_DISPLAY_NAME = "consumer_display_name"
    private const val KEY_EXPIRES_AT   = "consumer_expires_at"
    private const val KEY_HCE_TOKEN    = "consumer_hce_token"
    private const val KEY_FCM_TOKEN    = "consumer_fcm_token"

    fun init(context: Context) {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        prefs = EncryptedSharedPreferences.create(
            context,
            "consumer_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun saveSession(
        token:       String,
        consumerId:  String,
        phone:       String,
        displayName: String?,
        expiresAt:   Long
    ) {
        prefs?.edit()
            ?.putString(KEY_TOKEN,        token)
            ?.putString(KEY_CONSUMER_ID,  consumerId)
            ?.putString(KEY_PHONE,        phone)
            ?.putString(KEY_DISPLAY_NAME, displayName)
            ?.putLong(KEY_EXPIRES_AT,     expiresAt)
            ?.apply()
    }

    fun saveHceToken(token: String) { prefs?.edit()?.putString(KEY_HCE_TOKEN, token)?.apply() }
    fun saveFcmToken(token: String) { prefs?.edit()?.putString(KEY_FCM_TOKEN, token)?.apply() }

    fun getToken(): String? {
        val token     = prefs?.getString(KEY_TOKEN, null) ?: return null
        val expiresAt = prefs?.getLong(KEY_EXPIRES_AT, 0L) ?: 0L
        return if (System.currentTimeMillis() < expiresAt) token else null
    }

    fun getConsumerId():   String? = prefs?.getString(KEY_CONSUMER_ID,  null)
    fun getPhone():        String? = prefs?.getString(KEY_PHONE,        null)
    fun getDisplayName():  String? = prefs?.getString(KEY_DISPLAY_NAME, null)
    fun getHceToken():     String? = prefs?.getString(KEY_HCE_TOKEN,    null)
    fun getFcmToken():     String? = prefs?.getString(KEY_FCM_TOKEN,    null)
    fun isLoggedIn():      Boolean = getToken() != null

    fun clearSession() { prefs?.edit()?.clear()?.apply() }
}

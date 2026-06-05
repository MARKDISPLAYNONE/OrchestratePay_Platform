package com.orchestratepay.wallet.api

import com.google.gson.annotations.SerializedName
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.POST
import java.util.concurrent.TimeUnit

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

interface WalletService {

    /**
     * Request a one-time HCE session token from the backend.
     * The backend returns: { token: <32-hex HMAC>, exp: <epoch ms> }
     * Token is valid for 60 seconds.
     */
    @POST("api/v1/wallet/session")
    suspend fun requestSession(@Body request: SessionRequest): Response<SessionResponse>
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST / RESPONSE
// ─────────────────────────────────────────────────────────────────────────────

data class SessionRequest(
    @SerializedName("phone") val phone: String
)

data class SessionResponse(
    @SerializedName("token") val token: String,
    @SerializedName("exp") val exp: Long
)

// ─────────────────────────────────────────────────────────────────────────────
// RESULT WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

sealed class SessionResult {
    data class Ready(val token: String, val exp: Long) : SessionResult()
    data class Error(val message: String) : SessionResult()
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WalletApiClient — lightweight Retrofit singleton for the customer wallet.
 *
 * Does NOT inject a JWT header because the wallet session endpoint is
 * intentionally open (the customer is not a merchant and has no auth token).
 * OTP will gate this endpoint before production.
 */
class WalletApiClient private constructor(baseUrl: String) {

    private val service: WalletService

    init {
        val logging = HttpLoggingInterceptor().apply {
            level = if (com.orchestratepay.wallet.BuildConfig.DEBUG)
                HttpLoggingInterceptor.Level.BODY
            else
                HttpLoggingInterceptor.Level.NONE
        }

        val okHttp = OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()

        service = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttp)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(WalletService::class.java)
    }

    suspend fun requestSession(phone: String): SessionResult {
        return try {
            val response = service.requestSession(SessionRequest(phone))
            val body = response.body()
            when {
                response.isSuccessful && body != null ->
                    SessionResult.Ready(body.token, body.exp)
                response.code() == 429 ->
                    SessionResult.Error("Too many requests — wait a moment and try again")
                else ->
                    SessionResult.Error("Server error (${response.code()})")
            }
        } catch (e: java.io.IOException) {
            SessionResult.Error("No connection — check your data and try again")
        } catch (e: Exception) {
            SessionResult.Error("Unexpected error: ${e.message}")
        }
    }

    companion object {
        @Volatile private var instance: WalletApiClient? = null

        fun init(baseUrl: String) {
            instance = WalletApiClient(baseUrl)
        }

        val current: WalletApiClient
            get() = instance ?: error("WalletApiClient not initialised — call init() in Application.onCreate()")
    }
}

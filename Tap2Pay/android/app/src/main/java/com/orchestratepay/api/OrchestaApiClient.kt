package com.orchestratepay.api

import com.google.gson.annotations.SerializedName
import com.orchestratepay.db.SessionManager
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.util.concurrent.TimeUnit

// ─────────────────────────────────────────────────────────────────────────────
// API INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

interface OrchestrateService {

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<AuthResponse>

    /**
     * Bug #17 fix: rotates the merchant's access + refresh token pair.
     * Backend confirmed (auth.ts ~line 205): single-use rotation — the old
     * refresh token is revoked the moment this succeeds. Never call this twice
     * with the same refreshToken concurrently (see TokenAuthenticator's
     * synchronized guard below).
     */
    @POST("auth/refresh")
    suspend fun refresh(@Body request: RefreshRequest): Response<RefreshResponse>

    @POST("devices/telemetry")
    suspend fun sendTelemetry(@Body telemetry: TelemetryRequest): Response<TelemetryResponse>

    @POST("tags/sign")
    suspend fun getSignedTagUri(@Body body: TagSignRequest): Response<TagSignResponse>

    @GET("loyalty/balance")
    suspend fun getLoyaltyBalance(@Query("consumerId") consumerId: String): Response<LoyaltyBalanceResponse>

    @POST("transactions")
    suspend fun submitTransaction(
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body request: TransactionRequest
    ): Response<TransactionResponse>

    @POST("transactions")
    suspend fun initiatePayment(
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body request: TransactionRequest
    ): Response<TransactionResponse>

    @GET("transactions/{txnId}/status")
    suspend fun getTransactionStatus(@Path("txnId") txnId: String): Response<TransactionResponse>

    @GET("merchants/me")
    suspend fun getMerchantProfile(): Response<MerchantResponse>

    @GET("merchants/me/z-report")
    suspend fun getZReport(@Query("date") date: String? = null): Response<ZReportResponse>

    @POST("transactions/merchant-hce-token")
    suspend fun issueMerchantHceToken(
        @Body request: MerchantHceTokenRequest
    ): Response<MerchantHceTokenResponse>
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST / RESPONSE MODELS
// ─────────────────────────────────────────────────────────────────────────────

data class LoginRequest(
    @SerializedName("email") val email: String,
    @SerializedName("password") val password: String,
    @SerializedName("deviceId") val deviceId: String
)

data class AuthResponse(
    @SerializedName("token") val token: String,
    @SerializedName("merchantId") val merchantId: String,
    @SerializedName("merchantName") val merchantName: String,
    @SerializedName("expiresAt") val expiresAt: Long,
    @SerializedName("nfcSigningKey") val nfcSigningKey: String?,
    @SerializedName("kraPin") val kraPin: String?,
    // Bug #17 fix: backend has always sent this (auth.ts login response), the
    // Android client silently dropped it. Nullable — Gson sets null on missing
    // field rather than crashing, and we treat null as "cannot refresh, force
    // re-login when this token expires."
    @SerializedName("refreshToken") val refreshToken: String? = null
)

/** Bug #17 fix: request body for POST /auth/refresh — confirmed from auth.ts. */
data class RefreshRequest(
    @SerializedName("refreshToken") val refreshToken: String
)

/**
 * Bug #17 fix: response shape for POST /auth/refresh — confirmed field-for-field
 * from auth.ts (~line 205). Deliberately NOT reusing AuthResponse: the refresh
 * endpoint does not return merchantName, nfcSigningKey, or kraPin — only the
 * rotated token pair + merchantId + expiresAt. Session fields not present here
 * are preserved from the existing stored session (see SessionManager.updateTokens).
 */
data class RefreshResponse(
    @SerializedName("token") val token: String,
    @SerializedName("refreshToken") val refreshToken: String,
    @SerializedName("role") val role: String?,
    @SerializedName("merchantId") val merchantId: String?,
    @SerializedName("expiresAt") val expiresAt: Long
)

data class TransactionRequest(
    @SerializedName("merchantId") val merchantId: String,
    @SerializedName("amountCents") val amountCents: Long,
    @SerializedName("source") val source: String,
    @SerializedName("tagId") val tagId: String?,
    @SerializedName("nfcUid") val nfcUid: String?,
    @SerializedName("idempotencyKey") val idempotencyKey: String,
    @SerializedName("timestamp") val timestamp: Long,
    @SerializedName("consumerPhone") val consumerPhone: String? = null,
    @SerializedName("hceToken") val hceToken: String? = null,
    @SerializedName("hceExp") val hceExp: Long? = null,
    @SerializedName("consumerTagId") val consumerTagId: String? = null,
    @SerializedName("consumerQrToken") val consumerQrToken: String? = null
)

data class TransactionResponse(
    @SerializedName("status") val status: String,
    @SerializedName("txnId") val txnId: String?,
    @SerializedName("mpesaRef") val mpesaRef: String?,
    @SerializedName("amountCents") val amountCents: Long?,
    @SerializedName("merchantName") val merchantName: String?,
    @SerializedName("consumerPhone") val consumerPhone: String?,
    @SerializedName("reason") val reason: String?,
    @SerializedName("message") val message: String?
)

data class MerchantResponse(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("phone") val phone: String,
    @SerializedName("active") val active: Boolean
)

data class ZReportBucket(
    @SerializedName("count") val count: Int,
    @SerializedName("totalCents") val totalCents: Long
)

data class ZReportTransactions(
    @SerializedName("confirmed") val confirmed: ZReportBucket,
    @SerializedName("declined") val declined: ZReportBucket,
    @SerializedName("failed") val failed: ZReportBucket,
    @SerializedName("total") val total: ZReportBucket
)

data class ZReportResponse(
    @SerializedName("date") val date: String,
    @SerializedName("merchantName") val merchantName: String,
    @SerializedName("transactions") val transactions: ZReportTransactions,
    @SerializedName("firstTxnAt") val firstTxnAt: String?,
    @SerializedName("lastTxnAt") val lastTxnAt: String?,
    @SerializedName("generatedAt") val generatedAt: String
)

data class TelemetryRequest(
    @SerializedName("deviceSerial") val deviceSerial: String,
    @SerializedName("appVersionCode") val appVersionCode: Int,
    @SerializedName("batteryPct") val batteryPct: Int,
    @SerializedName("batteryHealth") val batteryHealth: String,
    @SerializedName("isCharging") val isCharging: Boolean,
    @SerializedName("printerStatus") val printerStatus: Int,
    @SerializedName("storageFreeBytes") val storageFreeBytes: Long,
    @SerializedName("nfcAvailable") val nfcAvailable: Boolean,
)

data class TelemetryResponse(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("config") val config: Map<String, Any>?
)

data class TagSignRequest(
    @SerializedName("merchantId") val merchantId: String,
    @SerializedName("tagId") val tagId: String
)

data class TagSignResponse(
    @SerializedName("uri") val uri: String
)

data class LoyaltyBalanceResponse(
    @SerializedName("programme_type") val programmeType: String?,
    @SerializedName("points_balance") val pointsBalance: Long,
    @SerializedName("stamps_balance") val stampsBalance: Int,
    @SerializedName("stamps_for_reward") val stampsForReward: Int?,
    @SerializedName("reward_description") val rewardDescription: String?,
    @SerializedName("lifetime_spent_cents") val lifetimeSpentCents: Long
)

data class MerchantHceTokenRequest(
    @SerializedName("amountCents") val amountCents: Long
)

data class MerchantHceTokenResponse(
    @SerializedName("token") val token: String,
    @SerializedName("merchantName") val merchantName: String,
    @SerializedName("amountCents") val amountCents: Long,
    @SerializedName("expiresAt") val expiresAt: Long
)

// ─────────────────────────────────────────────────────────────────────────────
// SEALED RESPONSE WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

sealed class ApiResponse {
    data class Success(
        val txnId: String,
        val mpesaRef: String?,
        val amountCents: Long?,
        val merchantName: String?,
        val consumerPhone: String?
    ) : ApiResponse()

    data class Pending(val txnId: String) : ApiResponse()
    data class Declined(val reason: String) : ApiResponse()
    data class NetworkError(val message: String) : ApiResponse()
    data class ServerError(val message: String) : ApiResponse()
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug #17 fix: force-logout signal.
// The Authenticator runs on an OkHttp background thread — it cannot navigate
// to an Activity directly. It publishes this event; register a listener in
// OrchestaPayApp.onCreate() (or the current top Activity) that clears the back
// stack and launches LoginActivity. Not wired to an Activity yet — needs
// OrchestaPayApp.kt to complete. Flagged, not blocking this fix.
// ─────────────────────────────────────────────────────────────────────────────
object AuthEventBus {
    var onForceLogout: (() -> Unit)? = null
    fun notifyForceLogout() {
        onForceLogout?.invoke()
    }
}

/**
 * Bug #17 fix — TokenAuthenticator.
 *
 * Fires automatically whenever any request gets a 401. Refreshes the access
 * token using the stored refresh token, retries the original request once.
 *
 * CRITICAL: the backend rotates refresh tokens on every use (single-use —
 * confirmed from auth.ts: old token is revoked in the same transaction that
 * issues the new one). If two requests 401 at nearly the same moment, both
 * must NOT independently call /auth/refresh with the same refresh token — the
 * second call would arrive after the first already revoked it, and get rejected,
 * forcing an unnecessary logout on a session that's actually still valid.
 * The `synchronized` block + "did someone else already refresh" check exists
 * specifically to prevent that race.
 */
class TokenAuthenticator(
    private val refreshService: OrchestrateService
) : Authenticator {

    override fun authenticate(route: okhttp3.Route?, response: okhttp3.Response): okhttp3.Request? {
        // Never retry more than once — prevents infinite retry loops if the
        // server keeps 401ing even after a "successful" refresh.
        if (responseCount(response) >= 2) return null

        val failedToken = response.request.header("Authorization")?.removePrefix("Bearer ")

        synchronized(this) {
            // Another thread may have already refreshed while we waited for this lock.
            val currentToken = SessionManager.getToken()
            if (currentToken != null && currentToken != failedToken) {
                return response.request.newBuilder()
                    .header("Authorization", "Bearer $currentToken")
                    .build()
            }

            val storedRefreshToken = SessionManager.getRefreshToken()
            if (storedRefreshToken == null) {
                // No refresh token was ever stored (old session predating this fix,
                // or login response omitted it) — nothing we can do but log out.
                SessionManager.clearSession()
                AuthEventBus.notifyForceLogout()
                return null
            }

            val newTokens: RefreshResponse? = try {
                runBlocking {
                    val refreshResponse = refreshService.refresh(RefreshRequest(storedRefreshToken))
                    if (refreshResponse.isSuccessful) refreshResponse.body() else null
                }
            } catch (e: Exception) {
                null
            }

            if (newTokens == null) {
                // Refresh token itself is dead (expired at 30d, or was already
                // used/revoked) — no recovery possible, force re-login.
                SessionManager.clearSession()
                AuthEventBus.notifyForceLogout()
                return null
            }

            SessionManager.updateTokens(
                token = newTokens.token,
                refreshToken = newTokens.refreshToken,
                expiresAt = newTokens.expiresAt
            )

            return response.request.newBuilder()
                .header("Authorization", "Bearer ${newTokens.token}")
                .build()
        }
    }

    private fun responseCount(response: okhttp3.Response): Int {
        var result = 1
        var prior = response.priorResponse
        while (prior != null) {
            result++
            prior = prior.priorResponse
        }
        return result
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

class OrchestrateApiClient private constructor(baseUrl: String) {

    private val service: OrchestrateService

    init {
        val logging = HttpLoggingInterceptor().apply {
            level = if (com.orchestratepay.BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY else HttpLoggingInterceptor.Level.NONE
        }

        val auth = Interceptor { chain ->
            val token = SessionManager.getToken()
            val request = if (token != null) {
                chain.request().newBuilder()
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("Accept", "application/json")
                    .addHeader("Content-Type", "application/json")
                    .build()
            } else {
                chain.request()
            }
            chain.proceed(request)
        }

        // Bug #17 fix: a SEPARATE Retrofit/OkHttp instance for the refresh call
        // itself — no auth interceptor (refresh doesn't need a Bearer token, it
        // authenticates via the refresh token in the body) and NO Authenticator
        // attached (attaching the same Authenticator here would cause infinite
        // recursion if the refresh endpoint itself ever returned a 401).
        val refreshOkHttp = OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()

        val refreshRetrofitService = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(refreshOkHttp)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(OrchestrateService::class.java)

        val okHttp = OkHttpClient.Builder()
            .addInterceptor(auth)
            .addInterceptor(logging)
            .authenticator(TokenAuthenticator(refreshRetrofitService))
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build()

        service = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttp)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(OrchestrateService::class.java)
    }

    // ─── Public API methods ───────────────────────────────────────────

    suspend fun login(email: String, password: String, deviceId: String): ApiResponse {
        return try {
            val response = service.login(LoginRequest(email, password, deviceId))
            val body = response.body()
            when {
                response.isSuccessful && body != null -> {
                    SessionManager.saveSession(
                        token = body.token,
                        merchantId = body.merchantId,
                        merchantName = body.merchantName,
                        expiresAt = body.expiresAt,
                        nfcSigningKey = body.nfcSigningKey,
                        kraPin = body.kraPin,
                        refreshToken = body.refreshToken
                    )
                    ApiResponse.Success(
                        txnId = body.merchantId,
                        mpesaRef = null,
                        amountCents = null,
                        merchantName = body.merchantName,
                        consumerPhone = null
                    )
                }
                response.code() == 401 -> ApiResponse.Declined("Invalid credentials")
                response.code() == 403 -> ApiResponse.Declined("Account deactivated — contact support")
                else -> ApiResponse.ServerError("Login failed (${response.code()})")
            }
        } catch (e: java.io.IOException) {
            ApiResponse.NetworkError(e.message ?: "Network unavailable")
        } catch (e: Exception) {
            ApiResponse.NetworkError("Unexpected error: ${e.message}")
        }
    }

    suspend fun initiatePayment(request: TransactionRequest): ApiResponse {
        return safeCall { service.initiatePayment(request.idempotencyKey, request) }
    }

    suspend fun getTransactionStatus(txnId: String): ApiResponse {
        return safeCall { service.getTransactionStatus(txnId) }
    }

    suspend fun sendTelemetry(telemetry: com.orchestratepay.telemetry.DeviceTelemetry): Response<TelemetryResponse> {
        return service.sendTelemetry(TelemetryRequest(
            deviceSerial = telemetry.deviceSerial,
            appVersionCode = telemetry.appVersionCode,
            batteryPct = telemetry.batteryPct,
            batteryHealth = telemetry.batteryHealth,
            isCharging = telemetry.isCharging,
            printerStatus = telemetry.printerStatus,
            storageFreeBytes = telemetry.storageFreeBytes,
            nfcAvailable = telemetry.nfcAvailable,
        ))
    }

    suspend fun getSignedTagUri(merchantId: String, tagId: String): String? {
        return try {
            val response = service.getSignedTagUri(TagSignRequest(merchantId, tagId))
            if (response.isSuccessful) response.body()?.uri else null
        } catch (e: Exception) {
            null
        }
    }

    suspend fun submitTransaction(request: TransactionRequest): Response<TransactionResponse> {
        return service.submitTransaction(request.idempotencyKey, request)
    }

    suspend fun getZReport(date: String? = null): ZReportResponse? {
        return try {
            val response = service.getZReport(date)
            if (response.isSuccessful) response.body() else null
        } catch (e: Exception) {
            null
        }
    }

    suspend fun issueMerchantHceToken(amountCents: Long): MerchantHceTokenResponse {
        val response = service.issueMerchantHceToken(MerchantHceTokenRequest(amountCents))
        return response.body() ?: throw java.io.IOException(
            "HCE token request failed — HTTP ${response.code()}"
        )
    }

    // ─── Response mapping ───────────────────────────────────────────

    private suspend fun safeCall(
        call: suspend () -> Response<TransactionResponse>
    ): ApiResponse {
        return try {
            val response = call()
            val body = response.body()
            when {
                response.isSuccessful && body != null -> {
                    when (body.status) {
                        "CONFIRMED" -> ApiResponse.Success(
                            txnId = body.txnId ?: "",
                            mpesaRef = body.mpesaRef,
                            amountCents = body.amountCents,
                            merchantName = body.merchantName,
                            consumerPhone = body.consumerPhone
                        )
                        "PENDING", "STK_SENT" -> ApiResponse.Pending(body.txnId ?: "")
                        "DECLINED", "FAILED" -> ApiResponse.Declined(
                            body.reason ?: "Payment was not completed"
                        )
                        else -> ApiResponse.ServerError("Unknown status: ${body.status}")
                    }
                }
                response.code() in 400..499 -> {
                    ApiResponse.Declined(body?.reason ?: "Request error ${response.code()}")
                }
                else -> {
                    ApiResponse.ServerError("Server error ${response.code()}")
                }
            }
        } catch (e: java.io.IOException) {
            ApiResponse.NetworkError(e.message ?: "Network unavailable")
        } catch (e: Exception) {
            ApiResponse.NetworkError("Unexpected error: ${e.message}")
        }
    }

    // ─── Singleton ────────────────────────────────────────────────────

    companion object {
        @Volatile
        private var instance: OrchestrateApiClient? = null

        fun init(baseUrl: String) {
            instance = OrchestrateApiClient(baseUrl)
        }

        val current: OrchestrateApiClient
            get() = instance ?: error("OrchestrateApiClient not initialised — call init() in Application.onCreate()")
    }
}
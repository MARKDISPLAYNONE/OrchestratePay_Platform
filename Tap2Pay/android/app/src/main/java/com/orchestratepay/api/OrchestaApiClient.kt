package com.orchestratepay.api

import com.google.gson.annotations.SerializedName
import com.orchestratepay.db.SessionManager
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

/**
 * OrchestrateService — Retrofit interface declaring every backend endpoint.
 *
 * Retrofit turns these function signatures into HTTP calls at runtime.
 * Each function is a suspend function — Retrofit's coroutine adapter
 * runs it on a background thread automatically.
 */
interface OrchestrateService {

    /** Authenticate merchant — returns JWT token */
    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<AuthResponse>

    /** Fleet telemetry heartbeat — response carries remote config */
    @POST("devices/telemetry")
    suspend fun sendTelemetry(@Body telemetry: TelemetryRequest): Response<TelemetryResponse>

    /** Fetch a signed tag URI for NFC sticker programming at onboarding */
    @POST("tags/sign")
    suspend fun getSignedTagUri(@Body body: TagSignRequest): Response<TagSignResponse>

    /** Consumer loyalty balance at this merchant */
    @GET("loyalty/balance")
    suspend fun getLoyaltyBalance(@Query("consumerId") consumerId: String): Response<LoyaltyBalanceResponse>

    /** Generic submit (used by offline queue flush) */
    @POST("transactions")
    suspend fun submitTransaction(
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body request: TransactionRequest
    ): Response<TransactionResponse>

    /**
     * Create a new transaction.
     * The backend validates, creates a DB record, and fires the M-Pesa STK Push.
     * Returns immediately with status=PENDING (don't wait for consumer PIN entry).
     */
    @POST("transactions")
    suspend fun initiatePayment(
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body request: TransactionRequest
    ): Response<TransactionResponse>

    /** Poll for transaction status after STK Push */
    @GET("transactions/{txnId}/status")
    suspend fun getTransactionStatus(@Path("txnId") txnId: String): Response<TransactionResponse>

    /** Get merchant profile (name, settlement account, active status) */
    @GET("merchants/me")
    suspend fun getMerchantProfile(): Response<MerchantResponse>

    /**
     * Daily Z-Report — transaction totals for a single calendar day.
     * @param date ISO date string "YYYY-MM-DD"; omit for today (Nairobi time).
     */
    @GET("merchants/me/z-report")
    suspend fun getZReport(@Query("date") date: String? = null): Response<ZReportResponse>

    /**
     * Issue a single-use HCE token for merchant phone-as-card mode (Scenario 5).
     * Returns a 60-second UUID token; consumer wallet reads it via NFC APDU and
     * posts to /consumers/pay/{merchantId} to trigger the STK Push.
     */
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
    @SerializedName("deviceId") val deviceId: String  // MDM device identifier
)

data class AuthResponse(
    @SerializedName("token") val token: String,
    @SerializedName("merchantId") val merchantId: String,
    @SerializedName("merchantName") val merchantName: String,
    @SerializedName("expiresAt") val expiresAt: Long,
    @SerializedName("nfcSigningKey") val nfcSigningKey: String?,  // null if server not configured
    @SerializedName("kraPin") val kraPin: String?                 // KRA PIN for receipt (CBK)
)

data class TransactionRequest(
    @SerializedName("merchantId") val merchantId: String,
    @SerializedName("amountCents") val amountCents: Long,
    @SerializedName("source") val source: String,          // "NFC_TAG", "QR_CODE", "HCE_PHONE", "CONSUMER_QR"
    @SerializedName("tagId") val tagId: String?,
    @SerializedName("nfcUid") val nfcUid: String?,         // raw tag UID for audit
    @SerializedName("idempotencyKey") val idempotencyKey: String,
    @SerializedName("timestamp") val timestamp: Long,
    // HCE_PHONE only — backend verifies token before trusting the phone number
    @SerializedName("consumerPhone") val consumerPhone: String? = null,
    @SerializedName("hceToken") val hceToken: String? = null,
    @SerializedName("hceExp") val hceExp: Long? = null,
    // CONSUMER_TAG only — consumerId from https://orchestratepay.co.ke/c/{id}
    @SerializedName("consumerTagId") val consumerTagId: String? = null,
    // CONSUMER_QR only — UUID token from consumer wallet QR (90-second TTL)
    @SerializedName("consumerQrToken") val consumerQrToken: String? = null
)

data class TransactionResponse(
    @SerializedName("status") val status: String,          // PENDING, CONFIRMED, DECLINED, FAILED
    @SerializedName("txnId") val txnId: String?,
    @SerializedName("mpesaRef") val mpesaRef: String?,     // M-Pesa receipt number
    @SerializedName("amountCents") val amountCents: Long?,
    @SerializedName("merchantName") val merchantName: String?,
    @SerializedName("consumerPhone") val consumerPhone: String?,
    @SerializedName("reason") val reason: String?,         // decline reason
    @SerializedName("message") val message: String?        // error message
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
    @SerializedName("declined")  val declined:  ZReportBucket,
    @SerializedName("failed")    val failed:    ZReportBucket,
    @SerializedName("total")     val total:     ZReportBucket
)

data class ZReportResponse(
    @SerializedName("date")         val date:         String,
    @SerializedName("merchantName") val merchantName: String,
    @SerializedName("transactions") val transactions: ZReportTransactions,
    @SerializedName("firstTxnAt")   val firstTxnAt:  String?,
    @SerializedName("lastTxnAt")    val lastTxnAt:   String?,
    @SerializedName("generatedAt")  val generatedAt: String
)

data class TelemetryRequest(
    @SerializedName("deviceSerial")      val deviceSerial:      String,
    @SerializedName("appVersionCode")    val appVersionCode:    Int,
    @SerializedName("batteryPct")        val batteryPct:        Int,
    @SerializedName("batteryHealth")     val batteryHealth:     String,
    @SerializedName("isCharging")        val isCharging:        Boolean,
    @SerializedName("printerStatus")     val printerStatus:     Int,
    @SerializedName("storageFreeBytes")  val storageFreeBytes:  Long,
    @SerializedName("nfcAvailable")      val nfcAvailable:      Boolean,
)

data class TelemetryResponse(
    @SerializedName("ok")     val ok:     Boolean,
    @SerializedName("config") val config: Map<String, Any>?
)

data class TagSignRequest(
    @SerializedName("merchantId") val merchantId: String,
    @SerializedName("tagId")      val tagId:      String
)

data class TagSignResponse(
    @SerializedName("uri") val uri: String
)

data class LoyaltyBalanceResponse(
    @SerializedName("programme_type")        val programmeType:       String?,
    @SerializedName("points_balance")        val pointsBalance:       Long,
    @SerializedName("stamps_balance")        val stampsBalance:       Int,
    @SerializedName("stamps_for_reward")     val stampsForReward:     Int?,
    @SerializedName("reward_description")    val rewardDescription:   String?,
    @SerializedName("lifetime_spent_cents")  val lifetimeSpentCents:  Long
)

data class MerchantHceTokenRequest(
    @SerializedName("amountCents") val amountCents: Long
)

data class MerchantHceTokenResponse(
    @SerializedName("token")        val token:        String,
    @SerializedName("merchantName") val merchantName: String,
    @SerializedName("amountCents")  val amountCents:  Long,
    @SerializedName("expiresAt")    val expiresAt:    Long
)

// ─────────────────────────────────────────────────────────────────────────────
// SEALED RESPONSE WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ApiResponse — wraps raw HTTP responses into sealed types the orchestrator can pattern-match.
 *
 * This prevents the orchestrator from dealing with HTTP status codes.
 * The orchestrator only knows Success, Pending, Declined, NetworkError, ServerError.
 */
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
// CLIENT SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OrchestrateApiClient — singleton wrapper around the Retrofit service.
 *
 * Responsibilities:
 *   - Construct Retrofit once (expensive — don't do it per-request)
 *   - Inject JWT auth header automatically via OkHttp interceptor
 *   - Translate HTTP responses into ApiResponse sealed types
 *   - Handle network exceptions (no internet, DNS failure, etc.)
 */
class OrchestrateApiClient private constructor(baseUrl: String) {

    private val service: OrchestrateService

    init {
        // Logging interceptor: prints request/response bodies in debug builds.
        // CRITICAL: set to NONE in release builds — request bodies contain PII.
        val logging = HttpLoggingInterceptor().apply {
            level = if (com.orchestratepay.BuildConfig.DEBUG)
                HttpLoggingInterceptor.Level.BODY
            else
                HttpLoggingInterceptor.Level.NONE
        }

        // Auth interceptor: adds "Authorization: Bearer <token>" to every request.
        // The token is stored in encrypted SharedPreferences via SessionManager.
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

        val okHttp = OkHttpClient.Builder()
            .addInterceptor(auth)
            .addInterceptor(logging)
            .connectTimeout(10, TimeUnit.SECONDS)  // time to establish TCP connection
            .readTimeout(30, TimeUnit.SECONDS)     // time to receive response body
            .writeTimeout(15, TimeUnit.SECONDS)    // time to send request body
            .build()

        service = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttp)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(OrchestrateService::class.java)
    }

    // ─── Public API methods ───────────────────────────────────────────

    /**
     * Authenticates the merchant and saves the session to EncryptedSharedPreferences.
     *
     * Returns ApiResponse.Success on successful login (txnId field holds merchantId).
     * Calling code should redirect to the dashboard on Success.
     *
     * NOTE: This method intentionally does NOT use safeCall() because login returns
     * AuthResponse, not TransactionResponse. Using safeCall() here would silently drop
     * the token, expiresAt, and nfcSigningKey fields.
     */
    suspend fun login(email: String, password: String, deviceId: String): ApiResponse {
        return try {
            val response = service.login(LoginRequest(email, password, deviceId))
            val body = response.body()

            when {
                response.isSuccessful && body != null -> {
                    // Persist session — token, merchantId, merchantName, expiresAt, keys
                    SessionManager.saveSession(
                        token         = body.token,
                        merchantId    = body.merchantId,
                        merchantName  = body.merchantName,
                        expiresAt     = body.expiresAt,
                        nfcSigningKey = body.nfcSigningKey,
                        kraPin        = body.kraPin
                    )
                    // Re-use ApiResponse.Success with merchantId in the txnId slot —
                    // LoginActivity only checks is-success, doesn't read these fields
                    ApiResponse.Success(
                        txnId         = body.merchantId,
                        mpesaRef      = null,
                        amountCents   = null,
                        merchantName  = body.merchantName,
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
        return safeCall {
            service.initiatePayment(request.idempotencyKey, request)
        }
    }

    suspend fun getTransactionStatus(txnId: String): ApiResponse {
        return safeCall {
            service.getTransactionStatus(txnId)
        }
    }

    /** Sends a device telemetry heartbeat. Returns the TelemetryResponse (carries remote config). */
    suspend fun sendTelemetry(telemetry: com.orchestratepay.telemetry.DeviceTelemetry): Response<TelemetryResponse> {
        return service.sendTelemetry(TelemetryRequest(
            deviceSerial     = telemetry.deviceSerial,
            appVersionCode   = telemetry.appVersionCode,
            batteryPct       = telemetry.batteryPct,
            batteryHealth    = telemetry.batteryHealth,
            isCharging       = telemetry.isCharging,
            printerStatus    = telemetry.printerStatus,
            storageFreeBytes = telemetry.storageFreeBytes,
            nfcAvailable     = telemetry.nfcAvailable,
        ))
    }

    /** Returns the signed orchestratepay:// URI for programming an NFC sticker, or null on error. */
    suspend fun getSignedTagUri(merchantId: String, tagId: String): String? {
        return try {
            val response = service.getSignedTagUri(TagSignRequest(merchantId, tagId))
            if (response.isSuccessful) response.body()?.uri else null
        } catch (e: Exception) { null }
    }

    /** Submits a transaction (used by the offline queue sync). */
    suspend fun submitTransaction(request: TransactionRequest): Response<TransactionResponse> {
        return service.submitTransaction(request.idempotencyKey, request)
    }

    /** Returns null on any network or server error — callers should show a retry option. */
    suspend fun getZReport(date: String? = null): ZReportResponse? {
        return try {
            val response = service.getZReport(date)
            if (response.isSuccessful) response.body() else null
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Issues a single-use 60-second HCE token for merchant phone-as-card mode.
     *
     * Throws IOException on network failure so the caller's runCatching block
     * can show an appropriate error message. Never silently returns null — the
     * merchant must know if HCE activation failed so they can fall back to QR.
     */
    suspend fun issueMerchantHceToken(amountCents: Long): MerchantHceTokenResponse {
        val response = service.issueMerchantHceToken(MerchantHceTokenRequest(amountCents))
        return response.body()
            ?: throw java.io.IOException(
                "HCE token request failed — HTTP ${response.code()}"
            )
    }

    // ─── Response mapping ─────────────────────────────────────────────

    /**
     * safeCall wraps every network call in a try/catch and maps the result.
     *
     * Catches:
     *   - IOException: no internet, DNS failure, connection reset
     *   - Any other exception: unexpected errors
     *
     * Maps HTTP status codes to ApiResponse variants:
     *   200 + status=CONFIRMED  → Success
     *   200 + status=PENDING    → Pending
     *   200 + status=DECLINED   → Declined
     *   400 / 404               → Declined (client error, don't retry)
     *   500+                    → ServerError (retry possible)
     */
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
                            txnId         = body.txnId ?: "",
                            mpesaRef      = body.mpesaRef,
                            amountCents   = body.amountCents,
                            merchantName  = body.merchantName,
                            consumerPhone = body.consumerPhone
                        )
                        // STK_SENT = prompt delivered to consumer's phone; treat same as PENDING for polling
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
        @Volatile private var instance: OrchestrateApiClient? = null

        fun init(baseUrl: String) {
            instance = OrchestrateApiClient(baseUrl)
        }

        val current: OrchestrateApiClient
            get() = instance ?: error("OrchestrateApiClient not initialised — call init() in Application.onCreate()")
    }
}

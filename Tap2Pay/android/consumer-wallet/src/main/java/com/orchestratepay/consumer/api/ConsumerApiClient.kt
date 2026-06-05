package com.orchestratepay.consumer.api

import com.google.gson.annotations.SerializedName
import com.orchestratepay.consumer.db.ConsumerSessionManager
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*

// ─── Response / request models ───────────────────────────────────────────────

data class AuthResponse(
    val token:      String,
    val consumerId: String,
    val phone:      String,
    @SerializedName("displayName") val displayName: String?,
    val expiresAt:  Long
)

data class ConsumerProfile(
    val id:          String,
    val phone:       String,
    val email:       String?,
    @SerializedName("display_name") val displayName: String?,
    @SerializedName("sms_opt_in")   val smsOptIn:    Boolean,
    @SerializedName("created_at")   val createdAt:   String
)

data class Transaction(
    val id:                                  String,
    val status:                              String,
    @SerializedName("amount_cents")          val amountCents:         Int,
    @SerializedName("original_currency")     val originalCurrency:    String?,
    @SerializedName("original_amount_cents") val originalAmountCents: Int?,
    @SerializedName("mpesa_receipt")         val mpesaReceipt:        String?,
    val source:                              String,
    @SerializedName("created_at")            val createdAt:           String,
    @SerializedName("confirmed_at")          val confirmedAt:         String?,
    @SerializedName("merchant_name")         val merchantName:        String
)

data class TransactionsResponse(val transactions: List<Transaction>, val limit: Int, val offset: Int)

data class LoyaltyBalance(
    @SerializedName("merchant_id")      val merchantId:      String,
    @SerializedName("merchant_name")    val merchantName:    String,
    @SerializedName("reward_type")      val rewardType:      String?,
    @SerializedName("points_balance")   val pointsBalance:   Int,
    @SerializedName("stamps_balance")   val stampsBalance:   Int,
    @SerializedName("lifetime_points")  val lifetimePoints:  Int,
    @SerializedName("redeem_threshold") val redeemThreshold: Int?
)

data class LoyaltyResponse(val balances: List<LoyaltyBalance>)

data class QrTokenResponse(val token: String, val expiresAt: Long)

data class TxnStatusResponse(
    val status:      String,
    val txnId:       String,
    val mpesaRef:    String?,
    val amountCents: Int?,
    @SerializedName("merchantName") val merchantName: String?,
    val reason:      String?
)

data class MerchantInfoResponse(
    @SerializedName("merchant_id")   val merchantId:   String,
    @SerializedName("business_name") val businessName: String,
    val currency:                    String?
)

data class PayMerchantRequest(
    val amountCents:    Int,
    val idempotencyKey: String,
    val timestamp:      Long,
    val currency:       String = "KES"
)

data class PayMerchantResponse(
    val transactionId: String,
    val status:        String
)

data class PayMerchantViaHceRequest(
    val amountCents:      Int,
    val idempotencyKey:   String,
    val timestamp:        Long,
    val merchantHceToken: String,
    val source:           String = "MERCHANT_HCE",
    val currency:         String = "KES"
)

data class P2pTokenRequest(
    val amountCents: Int?
)

data class P2pTokenResponse(
    val token:       String,
    val expiresAt:   Long,
    @SerializedName("displayName") val displayName: String?
)

data class P2pPayRequest(
    val p2pToken:       String?,
    val payeeConsumerId: String?,
    val amountCents:    Int,
    val idempotencyKey: String,
    val timestamp:      Long,
    val source:         String,   // "P2P_NFC" or "P2P_QR"
    val currency:       String = "KES"
)

data class P2pPayResponse(
    val status:    String,
    val txnId:     String,
    val p2pTxnId:  String,
    val message:   String?
)

// ─── Retrofit service ─────────────────────────────────────────────────────────

private interface ConsumerService {
    @POST("api/v1/auth/consumer/login")
    suspend fun login(@Body body: Map<String, String>): AuthResponse

    @POST("api/v1/auth/consumer/register")
    suspend fun register(@Body body: Map<String, String>): AuthResponse

    @GET("api/v1/consumers/me")
    suspend fun getProfile(@Header("Authorization") auth: String): ConsumerProfile

    @PUT("api/v1/consumers/me")
    suspend fun updateProfile(@Header("Authorization") auth: String, @Body body: Map<String, Any>): Map<String, Boolean>

    @GET("api/v1/consumers/me/transactions")
    suspend fun getTransactions(@Header("Authorization") auth: String, @Query("limit") limit: Int, @Query("offset") offset: Int): TransactionsResponse

    @GET("api/v1/consumers/me/loyalty")
    suspend fun getLoyalty(@Header("Authorization") auth: String): LoyaltyResponse

    @POST("api/v1/consumers/qr-token")
    suspend fun requestQrToken(@Header("Authorization") auth: String): QrTokenResponse

    @POST("api/v1/consumers/me/fcm-token")
    suspend fun updateFcmToken(@Header("Authorization") auth: String, @Body body: Map<String, String>): Map<String, Boolean>

    @GET("api/v1/consumers/transactions/{txnId}/status")
    suspend fun getTransactionStatus(@Header("Authorization") auth: String, @Path("txnId") txnId: String): TxnStatusResponse

    // Public — no auth header; returns merchant name for the payment confirmation screen
    @GET("api/v1/consumers/pay/{merchantId}")
    suspend fun getMerchantInfo(@Path("merchantId") merchantId: String): MerchantInfoResponse

    @POST("api/v1/consumers/pay/{merchantId}")
    suspend fun payMerchant(
        @Header("Authorization") auth: String,
        @Path("merchantId") merchantId: String,
        @Body body: PayMerchantRequest
    ): PayMerchantResponse

    // Scenario 5: consumer wallet read merchant HCE — sends source=MERCHANT_HCE
    // The merchantId here is the URL segment for /consumers/pay/:merchantId
    @POST("api/v1/consumers/pay/{merchantId}")
    suspend fun payMerchantViaHce(
        @Header("Authorization") auth: String,
        @Path("merchantId") merchantId: String,
        @Body body: PayMerchantViaHceRequest
    ): PayMerchantResponse

    // P2P: payee issues token (scenarios 6/7/10/11)
    @POST("api/v1/consumers/p2p-token")
    suspend fun requestP2pToken(
        @Header("Authorization") auth: String,
        @Body body: Map<String, Any?>
    ): P2pTokenResponse

    // P2P: payer initiates payment (scenarios 6/7/10/11)
    @POST("api/v1/consumers/p2p-pay")
    suspend fun p2pPay(
        @Header("Authorization") auth: String,
        @Body body: P2pPayRequest
    ): P2pPayResponse
}

// ─── Public API singleton ─────────────────────────────────────────────────────

object ConsumerApiClient {

    private lateinit var svc: ConsumerService

    fun init(baseUrl: String) {
        val logging = HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC }
        val client  = OkHttpClient.Builder().addInterceptor(logging).build()
        svc = Retrofit.Builder()
            .baseUrl(if (baseUrl.endsWith('/')) baseUrl else "$baseUrl/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ConsumerService::class.java)
    }

    private fun bearer() = "Bearer ${ConsumerSessionManager.getToken()}"

    suspend fun login(email: String, password: String): AuthResponse =
        svc.login(mapOf("email" to email, "password" to password))

    suspend fun register(email: String, password: String, phone: String): AuthResponse =
        svc.register(mapOf("email" to email, "password" to password, "phone" to phone))

    suspend fun getProfile(): ConsumerProfile = svc.getProfile(bearer())

    suspend fun updateProfile(displayName: String? = null, smsOptIn: Boolean? = null): Map<String, Boolean> {
        val body = mutableMapOf<String, Any>()
        displayName?.let { body["displayName"] = it }
        smsOptIn?.let    { body["smsOptIn"]    = it }
        return svc.updateProfile(bearer(), body)
    }

    suspend fun getTransactions(limit: Int = 50, offset: Int = 0): TransactionsResponse =
        svc.getTransactions(bearer(), limit, offset)

    suspend fun getLoyalty(): LoyaltyResponse = svc.getLoyalty(bearer())

    suspend fun requestQrToken(): QrTokenResponse = svc.requestQrToken(bearer())

    suspend fun updateFcmToken(token: String) =
        svc.updateFcmToken(bearer(), mapOf("fcmToken" to token))

    suspend fun getTransactionStatus(txnId: String): TxnStatusResponse =
        svc.getTransactionStatus(bearer(), txnId)

    suspend fun getMerchantInfo(merchantId: String): MerchantInfoResponse =
        svc.getMerchantInfo(merchantId)

    suspend fun payMerchant(
        merchantId:     String,
        amountCents:    Int,
        idempotencyKey: String,
        timestamp:      Long
    ): PayMerchantResponse =
        svc.payMerchant(bearer(), merchantId, PayMerchantRequest(amountCents, idempotencyKey, timestamp))

    suspend fun payMerchantViaHce(
        merchantId:       String,
        amountCents:      Int,
        idempotencyKey:   String,
        timestamp:        Long,
        merchantHceToken: String,
    ): PayMerchantResponse =
        svc.payMerchantViaHce(bearer(), merchantId,
            PayMerchantViaHceRequest(amountCents, idempotencyKey, timestamp, merchantHceToken))

    suspend fun requestP2pToken(amountCents: Int? = null): P2pTokenResponse {
        val body = mutableMapOf<String, Any?>()
        amountCents?.let { body["amountCents"] = it }
        return svc.requestP2pToken(bearer(), body)
    }

    suspend fun p2pPay(
        p2pToken:        String?,
        payeeConsumerId: String?,
        amountCents:     Int,
        idempotencyKey:  String,
        timestamp:       Long,
        source:          String,
    ): P2pPayResponse =
        svc.p2pPay(bearer(), P2pPayRequest(p2pToken, payeeConsumerId, amountCents, idempotencyKey, timestamp, source))
}

# OrchestratePay Consumer Wallet ProGuard rules

# Retrofit
-keepattributes Signature, *Annotation*, EnclosingMethod
-keep class com.orchestratepay.consumer.api.** { *; }

# Gson models
-keep class com.orchestratepay.consumer.api.AuthResponse { *; }
-keep class com.orchestratepay.consumer.api.ConsumerProfile { *; }
-keep class com.orchestratepay.consumer.api.Transaction { *; }
-keep class com.orchestratepay.consumer.api.TransactionsResponse { *; }
-keep class com.orchestratepay.consumer.api.LoyaltyBalance { *; }
-keep class com.orchestratepay.consumer.api.LoyaltyResponse { *; }
-keep class com.orchestratepay.consumer.api.QrTokenResponse { *; }
-keep class com.orchestratepay.consumer.api.TxnStatusResponse { *; }
-keep class com.orchestratepay.consumer.api.MerchantInfoResponse { *; }
-keep class com.orchestratepay.consumer.api.P2pTokenResponse { *; }
-keep class com.orchestratepay.consumer.api.P2pPayResponse { *; }

# Firebase
-keep class com.google.firebase.** { *; }

# ViewBinding
-keep class com.orchestratepay.consumer.databinding.** { *; }

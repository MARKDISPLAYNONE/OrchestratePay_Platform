# ── Kotlin / reflection ──────────────────────────────────────────────────────
-keepattributes Signature
-keepattributes Exceptions
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses

# ── Retrofit ─────────────────────────────────────────────────────────────────
# Keep all interfaces used as Retrofit service definitions
-keep,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# ── Gson / JSON models ───────────────────────────────────────────────────────
-keep class com.orchestratepay.api.** { *; }
# Prevent Gson from stripping fields it uses via reflection
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# ── OkHttp ───────────────────────────────────────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# ── Room ─────────────────────────────────────────────────────────────────────
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-keep @androidx.room.Dao interface * { *; }
-keep class com.orchestratepay.db.AuditEntry { *; }
-keep class com.orchestratepay.offline.QueuedIntent { *; }
-dontwarn androidx.room.**

# ── Payment sealed classes (must not be renamed — referenced by tests) ───────
-keep class com.orchestratepay.payment.PaymentResult { *; }
-keep class com.orchestratepay.payment.PaymentResult$* { *; }
-keep class com.orchestratepay.payment.PaymentIntent { *; }
-keep class com.orchestratepay.payment.PaymentSource { *; }

# ── Sentry ───────────────────────────────────────────────────────────────────
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**
# Sentry needs stack-trace line numbers
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── NFC / HCE ────────────────────────────────────────────────────────────────
-keep class com.orchestratepay.hce.** { *; }
-keep class com.orchestratepay.nfc.** { *; }

# ── Android standard suppressions ────────────────────────────────────────────
-dontwarn javax.annotation.**
-dontwarn kotlin.reflect.jvm.internal.**

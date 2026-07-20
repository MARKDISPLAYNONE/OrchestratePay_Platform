# Shared ProGuard/R8 rules for the OrchestratePay Android modules.
# Included by app/proguard-rules.pro and consumer-wallet/proguard-rules.pro via `-include`.
# Module-specific keep rules (own model packages, feature classes, SDKs unique
# to that module) stay in the module's own proguard-rules.pro.

# ── Kotlin / reflection ──────────────────────────────────────────────────────
-keepattributes Signature
-keepattributes Exceptions
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Retrofit ─────────────────────────────────────────────────────────────────
# Keep all interfaces used as Retrofit service definitions
-keep,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# ── Gson ─────────────────────────────────────────────────────────────────────
# Prevent Gson from stripping fields it uses via reflection
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# ── OkHttp ───────────────────────────────────────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# ── Android standard suppressions ────────────────────────────────────────────
-dontwarn javax.annotation.**
-dontwarn kotlin.reflect.jvm.internal.**

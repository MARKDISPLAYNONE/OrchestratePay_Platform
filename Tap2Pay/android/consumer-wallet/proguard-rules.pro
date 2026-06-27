# ── Kotlin / reflection ──────────────────────────────────────────────────────
-keepattributes Signature
-keepattributes Exceptions
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Retrofit ─────────────────────────────────────────────────────────────────
-keep,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# ── Gson / JSON models ───────────────────────────────────────────────────────
-keep class com.orchestratepay.consumer.api.** { *; }
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# ── OkHttp ───────────────────────────────────────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# ── Firebase / FCM ───────────────────────────────────────────────────────────
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# ── ML Kit barcode scanning ──────────────────────────────────────────────────
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# ── ZXing QR generation ──────────────────────────────────────────────────────
-keep class com.google.zxing.** { *; }
-dontwarn com.google.zxing.**

# ── ViewModel sealed state classes ───────────────────────────────────────────
-keep class com.orchestratepay.consumer.ui.viewmodel.** { *; }

# ── HCE / NFC ────────────────────────────────────────────────────────────────
-keep class com.orchestratepay.consumer.hce.** { *; }
-keep class com.orchestratepay.consumer.nfc.** { *; }

# ── ViewBinding ──────────────────────────────────────────────────────────────
-keep class com.orchestratepay.consumer.databinding.** { *; }

# ── Android standard suppressions ────────────────────────────────────────────
-dontwarn javax.annotation.**
-dontwarn kotlin.reflect.jvm.internal.**

-include ../common-proguard-rules.pro

# ── Gson / JSON models ───────────────────────────────────────────────────────
-keep class com.orchestratepay.consumer.api.** { *; }

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

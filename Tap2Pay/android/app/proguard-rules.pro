-include ../common-proguard-rules.pro

# ── Gson / JSON models ───────────────────────────────────────────────────────
-keep class com.orchestratepay.api.** { *; }

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

# ── NFC / HCE ────────────────────────────────────────────────────────────────
-keep class com.orchestratepay.hce.** { *; }
-keep class com.orchestratepay.nfc.** { *; }

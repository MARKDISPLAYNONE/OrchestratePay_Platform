# OrchestratePay ProGuard rules
# Keep Retrofit interface methods (annotation-driven reflection)
-keepattributes Signature
-keepattributes Exceptions
-keep class com.orchestratepay.api.** { *; }
# Keep Gson model classes
-keep class com.orchestratepay.api.*Request { *; }
-keep class com.orchestratepay.api.*Response { *; }
# Keep Room entity classes
-keep class com.orchestratepay.db.AuditEntry { *; }

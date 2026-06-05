package com.orchestratepay

import android.app.Application
import com.orchestratepay.api.OrchestrateApiClient
import com.orchestratepay.db.AuditDatabase
import com.orchestratepay.db.ReceiptDatabase
import com.orchestratepay.db.SessionManager
import com.orchestratepay.offline.OfflineQueueDatabase
import com.orchestratepay.offline.QueueSyncService
import com.orchestratepay.realtime.PaymentWebSocketSingleton
import com.orchestratepay.telemetry.TelemetryWorker
import io.sentry.android.core.SentryAndroid
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * OrchestratePayApp — Application subclass.
 *
 * Android calls this before any Activity or Service. All singletons are
 * initialised here exactly once, in dependency order:
 *   1. SessionManager      — EncryptedSharedPreferences (no dependencies)
 *   2. AuditDatabase       — Room append-only compliance log
 *   3. ReceiptDatabase     — Room offline receipt cache (reprinting without internet)
 *   4. Sentry              — crash and error reporting
 *   5. OrchestrateApiClient — Retrofit (needs API_BASE_URL from BuildConfig)
 *   6. PaymentWebSocketClient — needs shared OkHttpClient + WS_BASE_URL
 *
 * The WebSocket OkHttpClient is separate from Retrofit's client so the two
 * transports have independent connection pools and timeouts. The WS read timeout
 * must be longer than the server-side idle timeout (70s server → 75s client).
 */
class OrchestratePayApp : Application() {

    override fun onCreate() {
        super.onCreate()

        // 1. Secure session storage — must come first so subsequent inits can read the token
        SessionManager.init(this)

        // 2. On-device audit log (CBK compliance — 7-year retention via cloud backup)
        AuditDatabase.init(this)

        // 3. Offline receipt cache — powers the reprint button without internet
        ReceiptDatabase.init(this)

        // 4. Sentry — captures unhandled exceptions and payment-flow errors.
        //    DSN is injected at build time from BuildConfig. Disabled in debug builds.
        //    Set SENTRY_DSN in your CI/local environment before building.
        if (!BuildConfig.DEBUG) {
            SentryAndroid.init(this) { options ->
                options.dsn = BuildConfig.SENTRY_DSN
                options.environment = if (BuildConfig.DEBUG) "development" else "production"
                options.release = "orchestratepay@${BuildConfig.VERSION_NAME}"
                // Never send personal data to Sentry — phone numbers, merchant names
                options.isSendDefaultPii = false
            }
        }

        // 5. Retrofit API client
        OrchestrateApiClient.init(BuildConfig.API_BASE_URL)

        // 6. WebSocket client — dedicated OkHttpClient with WS-appropriate timeouts.
        //    Read timeout must exceed the server's 70s idle timeout so the connection
        //    stays open while waiting for the M-Pesa callback.
        val wsOkHttp = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(75, TimeUnit.SECONDS)   // > server 70s idle timeout
            .writeTimeout(15, TimeUnit.SECONDS)
            .build()
        PaymentWebSocketSingleton.init(wsOkHttp, BuildConfig.WS_BASE_URL)

        // 7. Offline queue DB — Room database for PaymentIntents that failed to send
        OfflineQueueDatabase.get(this)

        // 8. Queue sync service — flushes the offline queue on connectivity restore
        QueueSyncService(this).start()

        // 9. Periodic telemetry heartbeat — sends device health every 5 minutes
        TelemetryWorker.schedule(this)
    }
}

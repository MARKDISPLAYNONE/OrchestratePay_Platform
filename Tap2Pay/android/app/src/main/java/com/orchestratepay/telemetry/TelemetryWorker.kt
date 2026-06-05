package com.orchestratepay.telemetry

import android.content.Context
import android.util.Log
import androidx.work.*
import com.orchestratepay.api.OrchestaApiClient
import java.util.concurrent.TimeUnit

private const val TAG = "TelemetryWorker"

/**
 * TelemetryWorker — sends a device health heartbeat every 5 minutes via WorkManager.
 *
 * WorkManager survives app backgrounding and device restarts. If a heartbeat
 * fails, it retries automatically — telemetry failures never block payments.
 *
 * The backend response carries a `config` field; the worker stores it in
 * SharedPreferences so the next Activity read picks up remote config changes.
 */
class TelemetryWorker(
    ctx:    Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val telemetry = DeviceTelemetryCollector(applicationContext).collect()
        return try {
            val response = OrchestaApiClient.current.sendTelemetry(telemetry)
            if (response.isSuccessful) {
                // Persist remote config for next app resume
                response.body()?.config?.let { config ->
                    applyRemoteConfig(config)
                }
                Result.success()
            } else {
                Log.w(TAG, "Telemetry upload returned HTTP ${response.code()}")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Telemetry upload failed: ${e.message}")
            Result.retry()
        }
    }

    private fun applyRemoteConfig(config: Map<String, Any>) {
        val prefs = applicationContext
            .getSharedPreferences("remote_config", Context.MODE_PRIVATE)
            .edit()
        (config["minAppVersionCode"] as? Number)?.let {
            prefs.putInt("minAppVersionCode", it.toInt())
        }
        (config["pollIntervalMs"] as? Number)?.let {
            prefs.putInt("pollIntervalMs", it.toInt())
        }
        (config["wsEnabled"] as? Boolean)?.let {
            prefs.putBoolean("wsEnabled", it)
        }
        prefs.apply()
    }

    companion object {
        private const val WORK_NAME = "device-telemetry"

        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<TelemetryWorker>(5, TimeUnit.MINUTES)
                    .setConstraints(
                        Constraints.Builder()
                            .setRequiredNetworkType(NetworkType.CONNECTED)
                            .build()
                    )
                    .build()
            )
        }
    }
}

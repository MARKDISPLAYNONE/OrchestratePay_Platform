package com.orchestratepay.telemetry

import android.content.Context
import android.content.IntentFilter
import android.nfc.NfcAdapter
import android.os.BatteryManager
import android.os.Environment
import android.os.StatFs
import com.orchestratepay.db.SessionManager

data class DeviceTelemetry(
    val deviceSerial:      String,
    val merchantId:        String,
    val appVersion:        String,
    val appVersionCode:    Int,
    val batteryPct:        Int,
    val batteryHealth:     String,
    val isCharging:        Boolean,
    val printerStatus:     Int,
    val storageFreeBytes:  Long,
    val nfcAvailable:      Boolean,
    val timestampMs:       Long = System.currentTimeMillis()
)

/**
 * DeviceTelemetryCollector — reads current Sunmi P2 Pro health signals.
 *
 * printerStatus Sunmi AIDL codes:
 *   1 = Ready, 4 = Out of paper, 5 = Overheating
 *
 * batteryHealth strings match what the backend evaluateAlerts expects:
 *   GOOD | OVERHEAT | DEAD | COLD | UNKNOWN
 */
class DeviceTelemetryCollector(private val context: Context) {

    fun collect(): DeviceTelemetry {
        val battery = context.registerReceiver(
            null, IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED)
        )

        val battPct = battery?.let {
            val level = it.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = it.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            if (level >= 0 && scale > 0) (level * 100 / scale) else -1
        } ?: -1

        val battHealth = when (battery?.getIntExtra(BatteryManager.EXTRA_HEALTH, 0)) {
            BatteryManager.BATTERY_HEALTH_GOOD     -> "GOOD"
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> "OVERHEAT"
            BatteryManager.BATTERY_HEALTH_DEAD     -> "DEAD"
            BatteryManager.BATTERY_HEALTH_COLD     -> "COLD"
            else                                   -> "UNKNOWN"
        }

        val isCharging = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ==
                         BatteryManager.BATTERY_STATUS_CHARGING

        val statFs     = StatFs(Environment.getDataDirectory().path)
        val freeBytes  = statFs.availableBlocksLong * statFs.blockSizeLong

        return DeviceTelemetry(
            deviceSerial     = SessionManager.getDeviceId() ?: "unknown",
            merchantId       = SessionManager.getMerchantId() ?: "unknown",
            appVersion       = com.orchestratepay.BuildConfig.VERSION_NAME,
            appVersionCode   = com.orchestratepay.BuildConfig.VERSION_CODE,
            batteryPct       = battPct,
            batteryHealth    = battHealth,
            isCharging       = isCharging,
            printerStatus    = getSunmiPrinterStatus(),
            storageFreeBytes = freeBytes,
            nfcAvailable     = NfcAdapter.getDefaultAdapter(context) != null
        )
    }

    private fun getSunmiPrinterStatus(): Int {
        // Sunmi AIDL binding is managed by SunmiPrinterManager.
        // We read the last cached status here to avoid binding overhead every 5 min.
        return com.orchestratepay.printer.SunmiPrinterManager.lastPrinterStatus
    }
}

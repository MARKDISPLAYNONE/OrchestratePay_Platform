---
name: orchestratepay-fleet-mdm
description: >
  Build OrchestratePay's fleet telemetry and remote device management layer.
  Covers Sunmi P2 Pro health telemetry (battery, printer, storage, app version),
  the telemetry backend (ingest API, time-series storage), the admin fleet dashboard,
  proactive alerts (low paper, low battery, outdated app), remote config push,
  and OTA app version enforcement.
  Use this skill for: device health monitoring, fleet dashboard, low paper alerts,
  battery wear tracking, app version enforcement, remote config, Sunmi SDK health
  checks, and proactive support workflows.
---

# OrchestratePay — Remote Device Management (Fleet Telemetry)

## What to monitor on a Sunmi P2 Pro

| Signal | Source | Alert threshold |
|--------|--------|----------------|
| Battery level | `BatteryManager` | < 15% |
| Battery health | `BatteryManager.EXTRA_HEALTH` | DEAD or OVERHEAT |
| Printer paper status | Sunmi AIDL `getPrinterStatus()` | status=4 (out of paper) |
| Printer head temp | Sunmi AIDL `getPrinterStatus()` | status=5 (overheat) |
| Internal storage | `StatFs` | < 500 MB free |
| App version | `BuildConfig.VERSION_CODE` | < minimum enforced version |
| Last heartbeat | Backend tracks `last_seen_at` | > 30 min ago |
| NFC availability | `NfcAdapter.getDefaultAdapter()` | null |

## Android — telemetry collector

```kotlin
// telemetry/DeviceTelemetryCollector.kt
data class DeviceTelemetry(
    val deviceId:       String,
    val merchantId:     String,
    val appVersion:     String,      // BuildConfig.VERSION_NAME
    val appVersionCode: Int,         // BuildConfig.VERSION_CODE
    val batteryPct:     Int,         // 0–100
    val batteryHealth:  String,      // GOOD | OVERHEAT | DEAD | COLD | etc.
    val isCharging:     Boolean,
    val printerStatus:  Int,         // Sunmi AIDL status code (1=Ready, 4=NoPaper, 5=Overheat)
    val storageFreeBytes: Long,
    val nfcAvailable:   Boolean,
    val timestampMs:    Long = System.currentTimeMillis()
)

class DeviceTelemetryCollector(private val context: Context) {

    fun collect(): DeviceTelemetry {
        val battery   = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val battPct   = battery?.let {
            val level = it.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = it.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            if (level >= 0 && scale > 0) (level * 100 / scale) else -1
        } ?: -1

        val battHealth = when (battery?.getIntExtra(BatteryManager.EXTRA_HEALTH, 0)) {
            BatteryManager.BATTERY_HEALTH_GOOD     -> "GOOD"
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> "OVERHEAT"
            BatteryManager.BATTERY_HEALTH_DEAD     -> "DEAD"
            BatteryManager.BATTERY_HEALTH_COLD     -> "COLD"
            else -> "UNKNOWN"
        }

        val statFs = StatFs(Environment.getDataDirectory().path)
        val freeBytes = statFs.availableBlocksLong * statFs.blockSizeLong

        return DeviceTelemetry(
            deviceId        = SessionManager.getDeviceId() ?: "unknown",
            merchantId      = SessionManager.getMerchantId() ?: "unknown",
            appVersion      = BuildConfig.VERSION_NAME,
            appVersionCode  = BuildConfig.VERSION_CODE,
            batteryPct      = battPct,
            batteryHealth   = battHealth,
            isCharging      = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ==
                              BatteryManager.BATTERY_STATUS_CHARGING,
            printerStatus   = getPrinterStatusCode(),   // Sunmi AIDL
            storageFreeBytes = freeBytes,
            nfcAvailable    = NfcAdapter.getDefaultAdapter(context) != null
        )
    }
}
```

## Android — periodic heartbeat

```kotlin
// Send telemetry every 5 minutes using WorkManager (survives app backgrounding)
class TelemetryWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val telemetry = DeviceTelemetryCollector(applicationContext).collect()
        return try {
            OrchestrateApiClient.current.sendTelemetry(telemetry)
            Result.success()
        } catch (e: Exception) {
            Result.retry()  // WorkManager retries automatically
        }
    }
}

// Register in Application.onCreate():
WorkManager.getInstance(this).enqueueUniquePeriodicWork(
    "device-telemetry",
    ExistingPeriodicWorkPolicy.KEEP,
    PeriodicWorkRequestBuilder<TelemetryWorker>(5, TimeUnit.MINUTES).build()
)
```

## Backend — telemetry ingest

```typescript
// POST /api/v1/devices/telemetry  (authenticated — merchant JWT)
router.post('/telemetry', requireAuth, async (req, res) => {
  const { deviceId, appVersionCode, batteryPct, printerStatus,
          storageFreeBytes, nfcAvailable } = req.body

  await db.query(`
    INSERT INTO device_telemetry
      (device_id, merchant_id, app_version_code, battery_pct, printer_status,
       storage_free_bytes, nfc_available, recorded_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
  `, [deviceId, req.merchant!.sub, appVersionCode, batteryPct,
      printerStatus, storageFreeBytes, nfcAvailable])

  await db.query(`
    UPDATE devices SET last_seen_at=NOW(), app_version_code=$1
    WHERE id=$2 AND merchant_id=$3
  `, [appVersionCode, deviceId, req.merchant!.sub])

  // Check alert conditions
  await evaluateAlerts(deviceId, req.merchant!.sub, req.body)

  res.json({ ok: true })
})
```

## Backend — alert rules

```typescript
async function evaluateAlerts(deviceId: string, merchantId: string, t: any) {
  const alerts: string[] = []

  if (t.batteryPct < 15 && !t.isCharging)
    alerts.push(`Battery critical (${t.batteryPct}%) — please plug in`)

  if (t.printerStatus === 4)
    alerts.push('Printer is out of paper — reload before next customer')

  if (t.printerStatus === 5)
    alerts.push('Printer overheating — wait 2 minutes before printing')

  if (t.storageFreeBytes < 500_000_000)
    alerts.push(`Storage low (${Math.round(t.storageFreeBytes/1e6)} MB free)`)

  const minVersion = parseInt(process.env.MIN_APP_VERSION_CODE || '0')
  if (t.appVersionCode < minVersion)
    alerts.push(`App update required (current: ${t.appVersionCode}, required: ${minVersion})`)

  for (const message of alerts) {
    await db.query(`
      INSERT INTO device_alerts (device_id, merchant_id, message, created_at)
      VALUES ($1,$2,$3,NOW())
      ON CONFLICT DO NOTHING   -- deduplicate same alert within 1 hour
    `, [deviceId, merchantId, message])
    // TODO: send push notification to merchant's registered number via Africa's Talking
  }
}
```

## Admin fleet dashboard

```
GET /api/v1/admin/fleet                    — all devices, last heartbeat, alert count
GET /api/v1/admin/fleet/:deviceId          — single device health history
GET /api/v1/admin/fleet/alerts?unresolved  — all unresolved alerts across fleet
POST /api/v1/admin/fleet/:deviceId/config  — push remote config (min app version, etc.)
```

## Remote config push

```typescript
// When the POS sends its heartbeat, the response can carry config overrides:
res.json({
  ok: true,
  config: {
    minAppVersionCode:  42,       // force update if below this
    pollIntervalMs:    2500,      // tune polling without an app release
    wsEnabled:         true,
    debugLogging:      false
  }
})

// Android reads the config from the telemetry response and applies it:
if (config.appVersionCode < response.config.minAppVersionCode) {
    showForceUpdateDialog()  // blocks payment until app is updated
}
```

## Key invariants

1. Telemetry is sent every 5 minutes via WorkManager — survives app backgrounding
2. `last_seen_at` on the device record is the source of truth for online/offline
3. Alert deduplication: same alert type for same device within 1 hour = 1 alert row
4. Telemetry failures never block the payment flow — WorkManager retries silently
5. `minAppVersionCode` enforcement happens on the next heartbeat response, not mid-payment
6. Printer status code 4 (out of paper) and 5 (overheat) are the critical fleet signals

/**
 * devices.ts — Fleet telemetry ingest (merchant) + admin fleet dashboard.
 *
 * Merchant routes:   POST /api/v1/devices/telemetry
 * Admin routes:      GET  /api/v1/admin/fleet
 *                    GET  /api/v1/admin/fleet/:deviceId
 *                    GET  /api/v1/admin/fleet/alerts
 *                    POST /api/v1/admin/fleet/:deviceId/config
 */
import { Router, Request, Response, NextFunction } from 'express'
import { db } from '../db/index'
import { requireAuth } from '../middleware/auth'
import { logger } from '../util/logger'
import { sendSms, SmsTemplate } from '../integrations/africas-talking'
import { writeAuditLog } from '../util/audit'

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const secret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    logger.warn('Unauthorised admin fleet access', { ip: req.ip, path: req.path })
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

const router = Router()

// POST /api/v1/devices/telemetry — authenticated by merchant JWT
router.post('/telemetry', requireAuth, async (req, res) => {
    const merchantId = (req as any).merchant.sub
    const {
        deviceSerial, appVersionCode, batteryPct, batteryHealth,
        isCharging, printerStatus, storageFreeBytes, nfcAvailable,
    } = req.body

    if (!deviceSerial) return res.status(400).json({ error: 'deviceSerial required' })

    // Upsert the device record (auto-register on first heartbeat)
    const { rows: devRows } = await db.query(`
        INSERT INTO devices (merchant_id, device_serial, app_version_code, last_seen_at)
        VALUES ($1,$2,$3,NOW())
        ON CONFLICT (device_serial) DO UPDATE SET
          app_version_code = EXCLUDED.app_version_code,
          last_seen_at     = NOW()
        RETURNING id
    `, [merchantId, deviceSerial, appVersionCode ?? null])

    const deviceId = devRows[0].id

    // Store telemetry snapshot
    await db.query(`
        INSERT INTO device_telemetry
          (device_id, merchant_id, app_version_code, battery_pct, battery_health,
           is_charging, printer_status, storage_free_bytes, nfc_available)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [deviceId, merchantId, appVersionCode ?? null, batteryPct ?? null,
        batteryHealth ?? null, isCharging ?? null, printerStatus ?? null,
        storageFreeBytes ?? null, nfcAvailable ?? null])

    // Evaluate alert conditions
    await evaluateAlerts(deviceId, merchantId, req.body)

    // Remote config response — Android reads and applies these values
    const minVersionCode = parseInt(process.env.MIN_APP_VERSION_CODE ?? '0', 10)
    res.json({
        ok: true,
        config: {
            minAppVersionCode: minVersionCode,
            pollIntervalMs:    parseInt(process.env.POLL_INTERVAL_MS ?? '2500', 10),
            wsEnabled:         process.env.WS_ENABLED !== 'false',
            debugLogging:      process.env.DEBUG_LOGGING === 'true',
        },
    })
})

async function evaluateAlerts(deviceId: string, merchantId: string, t: any) {
    const alerts: string[] = []

    if (typeof t.batteryPct === 'number' && t.batteryPct < 15 && !t.isCharging)
        alerts.push(`Battery critical (${t.batteryPct}%) — please plug in`)

    if (t.printerStatus === 4)
        alerts.push('Printer is out of paper — reload before next customer')

    if (t.printerStatus === 5)
        alerts.push('Printer overheating — wait 2 minutes before printing')

    if (typeof t.storageFreeBytes === 'number' && t.storageFreeBytes < 500_000_000)
        alerts.push(`Storage low (${Math.round(t.storageFreeBytes / 1e6)} MB free)`)

    const minVersion = parseInt(process.env.MIN_APP_VERSION_CODE ?? '0', 10)
    if (typeof t.appVersionCode === 'number' && t.appVersionCode < minVersion)
        alerts.push(`App update required (current: ${t.appVersionCode}, required: ${minVersion})`)

    if (alerts.length === 0) return

    // Fetch merchant phone once for SMS delivery
    const { rows: mRows } = await db.query(
        'SELECT phone FROM merchants WHERE id=$1', [merchantId]
    )
    const merchantPhone = mRows[0]?.phone as string | undefined

    for (const message of alerts) {
        try {
            const { rowCount } = await db.query(`
                INSERT INTO device_alerts (device_id, merchant_id, message)
                VALUES ($1,$2,$3)
                ON CONFLICT (device_id, message, (date_trunc('hour', created_at))) DO NOTHING
            `, [deviceId, merchantId, message])

            // Only send SMS when a NEW alert row was inserted (rowCount > 0).
            // The ON CONFLICT DO NOTHING deduplication prevents repeat SMSes within the hour.
            if ((rowCount ?? 0) > 0 && merchantPhone) {
                sendSms(merchantPhone, SmsTemplate.deviceAlert(message)).catch(() => {})
            }
        } catch (err) {
            logger.error('Alert insert failed', { deviceId, message, err })
        }
    }
}

// ─── Admin routes ─────────────────────────────────────────────────────────────
// These share the /admin/fleet prefix, defined in admin.ts router mount.
// Export a separate adminFleetRouter for clarity.

export const adminFleetRouter = Router()

adminFleetRouter.use(requireAdmin)

adminFleetRouter.get('/', async (_req, res) => {
    const { rows } = await db.query(`
        SELECT
          d.id, d.merchant_id, d.device_serial, d.model,
          d.app_version_code, d.last_seen_at, d.active,
          COUNT(a.id) FILTER (WHERE a.resolved = FALSE) AS unresolved_alerts
        FROM devices d
        LEFT JOIN device_alerts a ON a.device_id = d.id
        GROUP BY d.id
        ORDER BY d.last_seen_at DESC NULLS LAST
    `)
    res.json(rows)
})

adminFleetRouter.get('/alerts', async (req, res) => {
    const unresolvedOnly = 'unresolved' in req.query
    const { rows } = await db.query(`
        SELECT a.*, d.device_serial, d.merchant_id
        FROM device_alerts a
        JOIN devices d ON d.id = a.device_id
        ${unresolvedOnly ? 'WHERE a.resolved = FALSE' : ''}
        ORDER BY a.created_at DESC
        LIMIT 200
    `)
    res.json(rows)
})

adminFleetRouter.get('/:deviceId', async (req, res) => {
    const { deviceId } = req.params

    const [devRes, telRes, alertRes] = await Promise.all([
        db.query(`SELECT * FROM devices WHERE id=$1`, [deviceId]),
        db.query(`
            SELECT * FROM device_telemetry
            WHERE device_id=$1
            ORDER BY recorded_at DESC LIMIT 48
        `, [deviceId]),
        db.query(`
            SELECT * FROM device_alerts WHERE device_id=$1 ORDER BY created_at DESC LIMIT 50
        `, [deviceId]),
    ])

    if (devRes.rows.length === 0) return res.status(404).json({ error: 'Device not found' })

    res.json({
        device:    devRes.rows[0],
        telemetry: telRes.rows,
        alerts:    alertRes.rows,
    })
})

adminFleetRouter.post('/:deviceId/config', async (req: Request, res: Response) => {
    const { deviceId } = req.params
    const { minAppVersionCode, pollIntervalMs, wsEnabled, debugLogging } = req.body

    logger.info('Remote config pushed', { deviceId, minAppVersionCode, pollIntervalMs, wsEnabled, debugLogging })

    await writeAuditLog({
      event:      'ADMIN_ACTION',
      entityType: 'device',
      entityId:   deviceId,
      detail:     { action: 'remote_config_push', minAppVersionCode, pollIntervalMs, wsEnabled, debugLogging },
      ip:         req.ip,
    })

    res.json({ ok: true })
})

export default router

/**
 * Integration tests for routes/devices.ts + admin fleet router.
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET   = 'test-secret'
process.env.ADMIN_SECRET = 'test-admin'
process.env.NODE_ENV     = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockRedisGet = jest.fn()
jest.mock('../db/redis', () => ({
  redis: { get: (...args: any[]) => mockRedisGet(...args) },
}))

const mockSendSms = jest.fn()
jest.mock('../integrations/africas-talking', () => ({
  sendSms:     (...args: any[]) => mockSendSms(...args),
  SmsTemplate: { deviceAlert: jest.fn().mockReturnValue('alert sms') },
}))

jest.mock('../util/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('key'),
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'
const ADMIN_HDR   = { 'X-Admin-Secret': 'test-admin' }

function merchantToken(id = MERCHANT_ID, deviceId = 'device-serial-001') {
  return jwt.sign({ sub: id, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret', { expiresIn: '1h' })
}

function buildApp() {
  const app = express()
  app.use(express.json())
  const devRoute  = require('../routes/devices')
  app.use('/api/v1/devices', devRoute.default)
  app.use('/api/v1/admin/fleet', devRoute.adminFleetRouter)
  return app
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('device-serial-001')
    return Promise.resolve(null)
  })
  mockSendSms.mockResolvedValue({ success: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/devices/telemetry
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/devices/telemetry', () => {
  it('returns 400 when deviceSerial is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/devices/telemetry')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ appVersionCode: 10 })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/deviceSerial/i)
  })

  it('upserts device + inserts telemetry and returns config', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'device-uuid-1' }] })  // upsert device
      .mockResolvedValueOnce({ rows: [] })                          // insert telemetry

    const res = await request(buildApp())
      .post('/api/v1/devices/telemetry')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({
        deviceSerial:     'SN-001',
        appVersionCode:   10,
        batteryPct:       80,
        isCharging:       false,
        printerStatus:    1,
        storageFreeBytes: 2_000_000_000,
      })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.config).toBeDefined()
    expect(res.body.config.pollIntervalMs).toBeGreaterThan(0)
  })

  it('triggers battery alert when battery is critically low', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'device-uuid-1' }] })  // upsert device
      .mockResolvedValueOnce({ rows: [] })                          // insert telemetry
      .mockResolvedValueOnce({ rows: [{ phone: '254700000001' }] }) // merchant phone
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })             // insert alert

    const res = await request(buildApp())
      .post('/api/v1/devices/telemetry')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ deviceSerial: 'SN-001', batteryPct: 10, isCharging: false })

    expect(res.status).toBe(200)
    expect(mockSendSms).toHaveBeenCalled()
  })

  it('triggers printer-out-of-paper alert', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'device-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ phone: '254700000001' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const res = await request(buildApp())
      .post('/api/v1/devices/telemetry')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ deviceSerial: 'SN-001', printerStatus: 4 })

    expect(res.status).toBe(200)
    expect(mockSendSms).toHaveBeenCalled()
  })

  it('does not send SMS when alert already exists (rowCount=0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'device-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ phone: '254700000001' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // duplicate alert ignored

    await request(buildApp())
      .post('/api/v1/devices/telemetry')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ deviceSerial: 'SN-001', batteryPct: 5, isCharging: false })

    expect(mockSendSms).not.toHaveBeenCalled()
  })

  it('returns 401 without auth token', async () => {
    const res = await request(buildApp())
      .post('/api/v1/devices/telemetry')
      .send({ deviceSerial: 'SN-001' })
    expect(res.status).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/admin/fleet
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/fleet', () => {
  it('returns 403 without admin secret', async () => {
    const res = await request(buildApp()).get('/api/v1/admin/fleet')
    expect(res.status).toBe(403)
  })

  it('returns device list', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'dev-1', merchant_id: MERCHANT_ID, device_serial: 'SN-001', app_version_code: 10, last_seen_at: new Date(), active: true, unresolved_alerts: 0 },
      ],
    })

    const res = await request(buildApp())
      .get('/api/v1/admin/fleet')
      .set(ADMIN_HDR)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.devices)).toBe(true)
    expect(res.body.devices).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/admin/fleet/alerts
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/fleet/alerts', () => {
  it('returns all alerts', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'alert-1', message: 'Battery critical', device_serial: 'SN-001', resolved: false }],
    })

    const res = await request(buildApp())
      .get('/api/v1/admin/fleet/alerts')
      .set(ADMIN_HDR)

    expect(res.status).toBe(200)
    expect(res.body.alerts).toHaveLength(1)
  })

  it('filters to unresolved alerts when ?unresolved is set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp())
      .get('/api/v1/admin/fleet/alerts?unresolved')
      .set(ADMIN_HDR)

    expect(res.status).toBe(200)
    // Query should include WHERE clause — we can verify the call contained it
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE a\.resolved = FALSE/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/admin/fleet/:deviceId
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/fleet/:deviceId', () => {
  it('returns 404 when device not found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // device
      .mockResolvedValueOnce({ rows: [] })  // telemetry
      .mockResolvedValueOnce({ rows: [] })  // alerts

    const res = await request(buildApp())
      .get('/api/v1/admin/fleet/nonexistent')
      .set(ADMIN_HDR)

    expect(res.status).toBe(404)
  })

  it('returns device detail with telemetry and alerts', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'dev-1', device_serial: 'SN-001' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tel-1', battery_pct: 80 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'alt-1', message: 'Low battery' }] })

    const res = await request(buildApp())
      .get('/api/v1/admin/fleet/dev-1')
      .set(ADMIN_HDR)

    expect(res.status).toBe(200)
    expect(res.body.device).toBeDefined()
    expect(res.body.telemetry).toHaveLength(1)
    expect(res.body.alerts).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/admin/fleet/:deviceId/config
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/admin/fleet/:deviceId/config', () => {
  it('pushes remote config and returns ok', async () => {
    const res = await request(buildApp())
      .post('/api/v1/admin/fleet/dev-1/config')
      .set(ADMIN_HDR)
      .send({ minAppVersionCode: 12, pollIntervalMs: 3000, wsEnabled: true })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

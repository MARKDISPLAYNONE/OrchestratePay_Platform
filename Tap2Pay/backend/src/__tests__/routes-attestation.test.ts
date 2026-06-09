/**
 * Integration tests for routes/attestation.ts — Play Integrity device attestation.
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

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('key'),
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockFetch = jest.fn()
global.fetch = mockFetch as any

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'

function merchantToken(deviceId = 'softpos-device-001') {
  return jwt.sign(
    { sub: MERCHANT_ID, name: 'Test Merchant', role: 'MERCHANT', deviceId },
    'test-secret', { expiresIn: '1h' }
  )
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/attestation', require('../routes/attestation').default)
  return app
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockFetch.mockReset()
  mockRedisGet.mockImplementation((key: string) => {
    if (key.startsWith('merchant:device:')) return Promise.resolve('softpos-device-001')
    return Promise.resolve(null)
  })
  delete process.env.PLAY_INTEGRITY_REQUIRED
  delete process.env.PLAY_INTEGRITY_DECRYPTION_KEY
  delete process.env.PLAY_INTEGRITY_VERIFICATION_KEY
  delete process.env.GOOGLE_ACCESS_TOKEN
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/attestation/verify
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/attestation/verify', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/v1/attestation/verify')
      .send({ integrityToken: 'tok' })
    expect(res.status).toBe(401)
  })

  it('returns 400 when integrityToken is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/attestation/verify')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ deviceSerial: 'SN-001' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/integrityToken required/i)
  })

  it('sandbox mode: skips Google API and marks device attested', async () => {
    process.env.PLAY_INTEGRITY_REQUIRED = 'false'
    mockQuery.mockResolvedValue({ rows: [] })  // UPDATE devices (fire-and-forget)

    const res = await request(buildApp())
      .post('/api/v1/attestation/verify')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ integrityToken: 'sandbox-tok', deviceSerial: 'SN-001' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.sandbox).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sandbox mode: works without deviceSerial (markDeviceAttested skips on undefined)', async () => {
    process.env.PLAY_INTEGRITY_REQUIRED = 'false'

    const res = await request(buildApp())
      .post('/api/v1/attestation/verify')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ integrityToken: 'tok' })  // no deviceSerial

    expect(res.status).toBe(200)
    expect(res.body.sandbox).toBe(true)
  })

  it('returns 403 when Play Integrity keys are not configured', async () => {
    // Keys not set → verifyWithGoogle returns { passed: false }
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: jest.fn().mockResolvedValue({ error: 'not configured' }),
    })

    const res = await request(buildApp())
      .post('/api/v1/attestation/verify')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ integrityToken: 'some-token', nonce: 'nonce-1' })

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/integrity/i)
  })

  it('returns 200 ok when Google Play Integrity verification passes', async () => {
    process.env.PLAY_INTEGRITY_DECRYPTION_KEY  = 'decryption-key'
    process.env.PLAY_INTEGRITY_VERIFICATION_KEY = 'verification-key'
    process.env.GOOGLE_ACCESS_TOKEN = 'gcp-access-token'

    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        tokenPayloadExternal: {
          deviceIntegrity: {
            deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'],
          },
          appIntegrity: {
            appRecognitionVerdict: 'PLAY_RECOGNIZED',
          },
        },
      }),
    })
    mockQuery.mockResolvedValue({ rows: [] })

    const res = await request(buildApp())
      .post('/api/v1/attestation/verify')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ integrityToken: 'valid-token', deviceSerial: 'SN-001' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.attested).toBe(true)
  })

  it('returns 403 when device does not meet basic integrity', async () => {
    process.env.PLAY_INTEGRITY_DECRYPTION_KEY  = 'dk'
    process.env.PLAY_INTEGRITY_VERIFICATION_KEY = 'vk'

    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        tokenPayloadExternal: {
          deviceIntegrity: { deviceRecognitionVerdict: [] },  // empty — no integrity
          appIntegrity:    { appRecognitionVerdict: 'PLAY_RECOGNIZED' },
        },
      }),
    })

    const res = await request(buildApp())
      .post('/api/v1/attestation/verify')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ integrityToken: 'bad-device-token' })

    expect(res.status).toBe(403)
    expect(res.body.reason).toMatch(/basic integrity/i)
  })

  it('returns 403 when app is not recognized by Play', async () => {
    process.env.PLAY_INTEGRITY_DECRYPTION_KEY  = 'dk'
    process.env.PLAY_INTEGRITY_VERIFICATION_KEY = 'vk'

    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        tokenPayloadExternal: {
          deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] },
          appIntegrity:    { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' },
        },
      }),
    })

    const res = await request(buildApp())
      .post('/api/v1/attestation/verify')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ integrityToken: 'bad-app-token' })

    expect(res.status).toBe(403)
    expect(res.body.reason).toMatch(/app not recognized/i)
  })

  it('returns 403 when Google API returns non-OK HTTP', async () => {
    process.env.PLAY_INTEGRITY_DECRYPTION_KEY  = 'dk'
    process.env.PLAY_INTEGRITY_VERIFICATION_KEY = 'vk'

    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: jest.fn().mockResolvedValue({}),
    })

    const res = await request(buildApp())
      .post('/api/v1/attestation/verify')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ integrityToken: 'some-token' })

    expect(res.status).toBe(403)
    expect(res.body.reason).toMatch(/HTTP 429/i)
  })

  it('returns 403 when Google API returns empty verdict', async () => {
    process.env.PLAY_INTEGRITY_DECRYPTION_KEY  = 'dk'
    process.env.PLAY_INTEGRITY_VERIFICATION_KEY = 'vk'

    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),  // no tokenPayloadExternal
    })

    const res = await request(buildApp())
      .post('/api/v1/attestation/verify')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ integrityToken: 'some-token' })

    expect(res.status).toBe(403)
    expect(res.body.reason).toMatch(/empty verdict/i)
  })

  it('returns 500 when fetch throws', async () => {
    process.env.PLAY_INTEGRITY_DECRYPTION_KEY  = 'dk'
    process.env.PLAY_INTEGRITY_VERIFICATION_KEY = 'vk'

    mockFetch.mockRejectedValue(new Error('network timeout'))

    const res = await request(buildApp())
      .post('/api/v1/attestation/verify')
      .set('Authorization', `Bearer ${merchantToken()}`)
      .send({ integrityToken: 'tok' })

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/attestation service unavailable/i)
  })
})

/**
 * routes/attestation.ts — Google Play Integrity device attestation for SoftPOS.
 *
 * POST /api/v1/attestation/verify
 *   Receives an integrity token from the SoftPOS Android app, verifies it with
 *   Google's Play Integrity API, and marks the device as attested in the DB.
 *
 * The SoftPOS transaction route checks `device_integrity_verified_at` before
 * accepting SOFTPOS_MOBILE transactions. Attestation must be fresh (< 24h).
 *
 * Reference: https://developer.android.com/google/play/integrity/standard
 *
 * Environment variables:
 *   PLAY_INTEGRITY_DECRYPTION_KEY  — base64 decryption key from Play Console
 *   PLAY_INTEGRITY_VERIFICATION_KEY — base64 verification key from Play Console
 *   PLAY_INTEGRITY_REQUIRED        — set to 'false' to skip in sandbox/dev
 */
import { Router, Request, Response } from 'express'
import { db }          from '../db/index'
import { requireAuth } from '../middleware/auth'
import { logger }      from '../util/logger'

const router = Router()

// POST /api/v1/attestation/verify
router.post('/verify', requireAuth, async (req: Request, res: Response) => {
  const merchantId     = req.merchant!.sub
  const { integrityToken, deviceSerial, nonce } = req.body

  if (!integrityToken) {
    return res.status(400).json({ error: 'integrityToken required' })
  }

  // Skip verification in sandbox mode
  if (process.env.PLAY_INTEGRITY_REQUIRED === 'false') {
    await markDeviceAttested(merchantId, deviceSerial)
    logger.info('Attestation skipped (sandbox mode)', { merchantId })
    return res.json({ ok: true, attested: true, sandbox: true })
  }

  try {
    const verified = await verifyWithGoogle(integrityToken, nonce)

    if (!verified.passed) {
      logger.warn('Play Integrity verification failed', { merchantId, reason: verified.reason })
      return res.status(403).json({
        error: 'Device integrity check failed — use an approved device',
        reason: verified.reason,
      })
    }

    await markDeviceAttested(merchantId, deviceSerial)
    logger.info('Device attested via Play Integrity', { merchantId, deviceSerial })
    res.json({ ok: true, attested: true })

  } catch (err: any) {
    logger.error('Attestation verification threw', { error: err.message })
    res.status(500).json({ error: 'Attestation service unavailable' })
  }
})

async function verifyWithGoogle(
  integrityToken: string,
  _nonce: string
): Promise<{ passed: boolean; reason?: string }> {
  const decryptionKey   = process.env.PLAY_INTEGRITY_DECRYPTION_KEY
  const verificationKey = process.env.PLAY_INTEGRITY_VERIFICATION_KEY

  if (!decryptionKey || !verificationKey) {
    logger.warn('Play Integrity keys not configured')
    return { passed: false, reason: 'Integrity API not configured' }
  }

  // Google Play Integrity API — decrypt and verify
  // In production use the Google API client library or REST endpoint:
  //   POST https://playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken
  const url = `https://playintegrity.googleapis.com/v1/com.orchestratepay.softpos:decodeIntegrityToken`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${await getGoogleAccessToken()}`,
    },
    body: JSON.stringify({ integrity_token: integrityToken }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    return { passed: false, reason: `Google API HTTP ${res.status}` }
  }

  const json = await res.json() as any
  const verdict = json?.tokenPayloadExternal

  if (!verdict) return { passed: false, reason: 'Empty verdict' }

  // Check device integrity
  const deviceRecognized = verdict?.deviceIntegrity?.deviceRecognitionVerdict?.includes('MEETS_BASIC_INTEGRITY')
  if (!deviceRecognized) {
    return { passed: false, reason: 'Device does not meet basic integrity' }
  }

  // Check app integrity
  const appRecognized = verdict?.appIntegrity?.appRecognitionVerdict === 'PLAY_RECOGNIZED'
  if (!appRecognized) {
    return { passed: false, reason: 'App not recognized by Google Play' }
  }

  return { passed: true }
}

async function markDeviceAttested(merchantId: string, deviceSerial?: string): Promise<void> {
  if (!deviceSerial) return

  await db.query(
    `UPDATE devices
     SET device_type = 'SOFTPOS_MOBILE',
         device_integrity_verified_at = NOW()
     WHERE device_serial = $1 AND merchant_id = $2`,
    [deviceSerial, merchantId]
  ).catch(() => {})
}

async function getGoogleAccessToken(): Promise<string> {
  // In production: use google-auth-library or Application Default Credentials
  // For the scaffold, return an empty string — the real token is obtained via
  // the Google OAuth 2.0 service account flow
  return process.env.GOOGLE_ACCESS_TOKEN ?? ''
}

export default router

/**
 * routes/wallet.ts — Customer wallet endpoints.
 *
 * POST /api/v1/wallet/session
 *   Issues a short-lived (60s) HMAC-signed session token for HCE tap-to-pay.
 *   The customer calls this when they open the wallet app and tap "Ready to Pay".
 *   The token is embedded in the NFC APDU payload, which the Sunmi POS reads
 *   and forwards to POST /api/v1/transactions for verification.
 *
 * AUTHENTICATION
 *   Currently: phone number only.
 *   Production upgrade: add OTP (send a 6-digit code via M-Pesa USSDpush or SMS,
 *   verify it before issuing the token). OTP is out of scope for Phase 1.
 *   The HMAC signature still protects against phone spoofing without OTP —
 *   an attacker cannot forge a valid token without knowing HCE_TOKEN_SECRET.
 */
import { Router, Request, Response } from 'express'
import Joi from 'joi'
import { issueHceToken } from '../util/hce-token'
import { validate } from '../middleware/validate'
import { logger } from '../util/logger'

const router = Router()

const sessionSchema = Joi.object({
  // Safaricom 254XXXXXXXXX format — 12 digits starting with 254
  phone: Joi.string().pattern(/^254[0-9]{9}$/).required()
    .messages({ 'string.pattern.base': 'Phone must be in 254XXXXXXXXX format' })
})

// POST /api/v1/wallet/session
router.post('/session', validate(sessionSchema), async (req: Request, res: Response) => {
  const { phone } = req.body

  try {
    const { token, exp } = issueHceToken(phone)
    const maskedPhone = phone.slice(0, 5) + '****' + phone.slice(-2)
    logger.info('HCE session issued', { maskedPhone, exp })
    res.json({ token, exp })
  } catch (err: unknown) {
    // issueHceToken throws if HCE_TOKEN_SECRET is not set
    logger.error('Failed to issue HCE session', { error: (err as Error).message })
    res.status(503).json({ error: 'Session service temporarily unavailable' })
  }
})

export default router

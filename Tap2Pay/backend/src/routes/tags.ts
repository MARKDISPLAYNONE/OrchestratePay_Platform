/**
 * routes/tags.ts — NFC tag management endpoints.
 *
 * POST /api/v1/tags/sign
 *   Generates a signed NDEF URI for a merchant+tag pair.
 *   Used by the onboarding tool when programming a fresh NTAG215 sticker.
 *   The sign param in the URI allows the terminal to verify the tag on every tap.
 *
 * GET /api/v1/tags/signing-key
 *   Returns the merchant's signing key.
 *   Called at login time so the terminal can cache the key for offline verification.
 *   (Merchants also receive it in the login response — this is the refresh endpoint.)
 */
import { Router, Request, Response } from 'express'
import Joi from 'joi'
import { db } from '../db/index'
import { logger } from '../util/logger'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { buildSignedUri, deriveMerchantSigningKey, verifyTagSignature } from '../util/nfc-signing'

const router = Router()

const signTagSchema = Joi.object({
  merchantId: Joi.string().uuid().required(),
  tagId:      Joi.string().uuid().required()
})

// POST /api/v1/tags/sign
// Returns a signed URI ready to write to an NTAG215 sticker.
// Only the authenticated merchant can sign their own tags.
router.post('/sign', requireAuth, validate(signTagSchema), async (req: Request, res: Response) => {
  const { merchantId, tagId } = req.body

  // Enforce: merchant can only sign their own tags
  if (req.merchant!.sub !== merchantId) {
    return res.status(403).json({ error: 'You can only sign tags for your own merchant account' })
  }

  try {
    // Verify the tagId exists in our DB and belongs to this merchant's consumers
    const tagResult = await db.query(
      `SELECT t.id, t.tag_id, c.phone
       FROM nfc_tags t
       JOIN consumers c ON c.id = t.consumer_id
       WHERE t.tag_id = $1 AND t.active = true`,
      [tagId]
    )

    if (tagResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found or not active' })
    }

    const uri = buildSignedUri(merchantId, tagId)

    logger.info('Signed NFC tag URI generated', {
      merchantId,
      tagId: tagId.slice(0, 8) + '...'
    })

    res.json({ uri, tagId, merchantId })

  } catch (err: unknown) {
    if ((err as Error).message?.includes('NFC_SIGNING_SECRET')) {
      logger.error('NFC signing secret not configured')
      return res.status(503).json({ error: 'NFC signing not configured on this server' })
    }
    logger.error('Tag sign error', { error: (err as Error).message })
    res.status(500).json({ error: 'Failed to sign tag' })
  }
})

// GET /api/v1/tags/signing-key
// Returns the merchant's NFC signing key for caching on the terminal.
// This is also returned at login — this endpoint is the refresh path.
router.get('/signing-key', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub

  try {
    const signingKey = deriveMerchantSigningKey(merchantId)
    res.json({ signingKey, merchantId })
  } catch (err: unknown) {
    if ((err as Error).message?.includes('NFC_SIGNING_SECRET')) {
      return res.status(503).json({ error: 'NFC signing not configured on this server' })
    }
    res.status(500).json({ error: 'Failed to derive signing key' })
  }
})

// POST /api/v1/tags/verify  (dev/debug endpoint — disable in production if desired)
// Verifies a signature without requiring auth — useful for tag programmer tool testing.
router.post('/verify', async (req: Request, res: Response) => {
  const { merchantId, tagId, sign } = req.body

  if (!merchantId || !tagId || !sign) {
    return res.status(400).json({ error: 'merchantId, tagId, and sign are required' })
  }

  try {
    const valid = verifyTagSignature(merchantId, tagId, sign)
    res.json({ valid })
  } catch {
    res.json({ valid: false })
  }
})

export default router

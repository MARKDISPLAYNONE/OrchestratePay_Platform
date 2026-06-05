/**
 * routes/auth.ts — authentication endpoints for merchants and consumers.
 *
 * Merchant (terminal) endpoints:
 *   POST /api/v1/auth/login           — validate credentials, return JWT
 *   POST /api/v1/auth/logout          — clear device binding
 *   POST /api/v1/auth/register        — merchant self-service registration
 *                                       (starts approval_status = PENDING_REVIEW)
 *
 * Consumer (web/app) endpoints:
 *   POST /api/v1/auth/consumer/register — phone + optional email/password
 *   POST /api/v1/auth/consumer/login    — email+password or phone+OTP (stub)
 *
 * Admin endpoints:
 *   POST /api/v1/auth/admin/approve   — approve or reject a merchant registration
 *   GET  /api/v1/auth/admin/pending   — list PENDING_REVIEW merchants
 *
 * SINGLE-DEVICE ENFORCEMENT (merchants only):
 * The backend stores device_id per merchant. If a login comes from a different
 * device, the previous session's JWT becomes invalid on the next request.
 *
 * JWT roles:
 *   { sub, name, role: 'MERCHANT'|'CONSUMER', deviceId?, iat, exp }
 */
import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { db }          from '../db/index'
import { redis }       from '../db/redis'
import { logger }      from '../util/logger'
import { validate, loginSchema } from '../middleware/validate'
import { requireAuth, DEVICE_CACHE_TTL_S } from '../middleware/auth'
import { deriveMerchantSigningKey } from '../util/nfc-signing'

const router = Router()
const BCRYPT_ROUNDS = 12

// ─── POST /api/v1/auth/login (merchant terminal) ─────────────────────────────

router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  const { email, password, deviceId } = req.body

  try {
    const result = await db.query(
      `SELECT id, name, password_hash, active, device_id, kra_pin, approval_status
       FROM merchants WHERE email = $1`,
      [email.toLowerCase()]
    )

    const merchant = result.rows[0]

    const passwordMatch = merchant
      ? await bcrypt.compare(password, merchant.password_hash)
      : await bcrypt.compare(password, '$2b$10$invalidhashfortimingprotection')

    if (!merchant || !passwordMatch) {
      logger.warn('Failed merchant login attempt', { email, ip: req.ip })
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    if (!merchant.active) {
      return res.status(403).json({ error: 'Account is deactivated — contact support' })
    }

    // Approval gate — terminal login is blocked until ops approves the registration
    if (merchant.approval_status === 'PENDING_REVIEW') {
      return res.status(403).json({
        error:  'Account is pending review — you will be notified once approved',
        status: 'PENDING_REVIEW',
      })
    }
    if (merchant.approval_status === 'REJECTED') {
      return res.status(403).json({
        error:  'Account registration was not approved — contact support',
        status: 'REJECTED',
      })
    }
    if (merchant.approval_status === 'SUSPENDED') {
      return res.status(403).json({
        error:  'Account is suspended — contact support',
        status: 'SUSPENDED',
      })
    }

    await db.query(
      'UPDATE merchants SET device_id = $1, updated_at = NOW() WHERE id = $2',
      [deviceId, merchant.id]
    )

    const expiresIn = 8 * 60 * 60
    const expiresAt = Date.now() + expiresIn * 1000

    const token = jwt.sign(
      { sub: merchant.id, name: merchant.name, role: 'MERCHANT', deviceId },
      process.env.JWT_SECRET!,
      { expiresIn }
    )

    // Write the authoritative deviceId to Redis so the auth middleware can
    // enforce single-device binding on every subsequent request. TTL slightly
    // exceeds the JWT lifetime so the cache is warm for the token's full life.
    await redis.setex(`merchant:device:${merchant.id}`, DEVICE_CACHE_TTL_S, deviceId)

    let nfcSigningKey: string | null = null
    try {
      nfcSigningKey = deriveMerchantSigningKey(merchant.id)
    } catch {
      logger.warn('NFC_SIGNING_SECRET not set — signing key omitted from login response')
    }

    logger.info('Merchant logged in', { merchantId: merchant.id, deviceId })

    res.json({
      token,
      role:          'MERCHANT',
      merchantId:    merchant.id,
      merchantName:  merchant.name,
      expiresAt,
      nfcSigningKey,
      kraPin:        merchant.kra_pin ?? null,
    })

  } catch (err: any) {
    logger.error('Merchant login error', { error: err.message })
    res.status(500).json({ error: 'Login failed — please try again' })
  }
})

// ─── POST /api/v1/auth/register (merchant self-service) ──────────────────────

router.post('/register', async (req: Request, res: Response) => {
  const {
    name, email, password, phone,
    businessRegNumber, idNumber,
    mpesaShortcode, mpesaAccountRef, kraPin,
  } = req.body

  if (!name || !email || !password || !phone) {
    return res.status(400).json({ error: 'name, email, password, and phone are required' })
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  try {
    const existing = await db.query(
      'SELECT id FROM merchants WHERE email = $1',
      [email.toLowerCase()]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' })
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

    const { rows } = await db.query(
      `INSERT INTO merchants
         (name, email, password_hash, phone, mpesa_shortcode, mpesa_account_ref,
          kra_pin, business_reg_number, id_number, approval_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING_REVIEW')
       RETURNING id, name, email, approval_status`,
      [
        name, email.toLowerCase(), passwordHash, phone,
        mpesaShortcode ?? null, mpesaAccountRef ?? null,
        kraPin ?? null, businessRegNumber ?? null, idNumber ?? null,
      ]
    )

    logger.info('Merchant self-registered (PENDING_REVIEW)', {
      merchantId: rows[0].id, email: email.toLowerCase()
    })

    res.status(201).json({
      message:    'Registration received — your account is pending review. You will be contacted within 1-2 business days.',
      merchantId: rows[0].id,
      status:     'PENDING_REVIEW',
    })

  } catch (err: any) {
    logger.error('Merchant registration error', { error: err.message })
    res.status(500).json({ error: 'Registration failed — please try again' })
  }
})

// ─── POST /api/v1/auth/logout (merchant terminal) ────────────────────────────

router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  try {
    const merchantId = req.merchant!.sub
    await db.query(
      'UPDATE merchants SET device_id = NULL, updated_at = NOW() WHERE id = $1',
      [merchantId]
    )
    // Remove the device binding key so any in-flight JWT from this device is
    // rejected immediately on the next request, without waiting for expiry.
    await redis.del(`merchant:device:${merchantId}`)
    logger.info('Merchant logged out', { merchantId })
    res.json({ message: 'Logged out successfully' })
  } catch (err: any) {
    res.status(500).json({ error: 'Logout failed' })
  }
})

// ─── POST /api/v1/auth/consumer/register ─────────────────────────────────────

router.post('/consumer/register', async (req: Request, res: Response) => {
  const { phone, email, password, displayName } = req.body

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' })
  }

  if (!/^254[0-9]{9}$/.test(phone)) {
    return res.status(400).json({ error: 'phone must be in format 254XXXXXXXXX' })
  }

  try {
    const existing = await db.query(
      'SELECT id FROM consumers WHERE phone = $1 OR (email IS NOT NULL AND email = $2)',
      [phone, email ?? null]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Phone or email already registered' })
    }

    let passwordHash: string | null = null
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' })
      }
      passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    }

    const crypto = await import('crypto')
    const phoneHash = crypto.createHash('sha256').update(phone).digest('hex')

    const { rows } = await db.query(
      `INSERT INTO consumers
         (phone, phone_hash, email, password_hash, display_name)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, phone, email, display_name`,
      [phone, phoneHash, email ?? null, passwordHash, displayName ?? null]
    )

    const consumer = rows[0]
    const token        = issueConsumerToken(consumer.id, consumer.display_name ?? consumer.phone)
    const refreshToken = await issueRefreshToken(consumer.id, req.headers['user-agent'])

    logger.info('Consumer registered', { consumerId: consumer.id })

    res.status(201).json({
      token,
      refreshToken,
      role:         'CONSUMER',
      consumerId:   consumer.id,
      expiresAt:    Date.now() + CONSUMER_ACCESS_TTL_S * 1000,
    })

  } catch (err: any) {
    logger.error('Consumer registration error', { error: err.message })
    res.status(500).json({ error: 'Registration failed — please try again' })
  }
})

// ─── POST /api/v1/auth/consumer/login ────────────────────────────────────────

router.post('/consumer/login', async (req: Request, res: Response) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }

  try {
    const result = await db.query(
      'SELECT id, display_name, phone, password_hash, active FROM consumers WHERE email = $1',
      [email.toLowerCase()]
    )

    const consumer = result.rows[0]

    const passwordMatch = consumer && consumer.password_hash
      ? await bcrypt.compare(password, consumer.password_hash)
      : await bcrypt.compare(password, '$2b$10$invalidhashfortimingprotection')

    if (!consumer || !passwordMatch) {
      logger.warn('Failed consumer login', { email, ip: req.ip })
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    if (!consumer.active) {
      return res.status(403).json({ error: 'Account is deactivated' })
    }

    const token        = issueConsumerToken(consumer.id, consumer.display_name ?? consumer.phone)
    const refreshToken = await issueRefreshToken(consumer.id, req.headers['user-agent'])

    logger.info('Consumer logged in', { consumerId: consumer.id })

    res.json({
      token,
      refreshToken,
      role:         'CONSUMER',
      consumerId:   consumer.id,
      expiresAt:    Date.now() + CONSUMER_ACCESS_TTL_S * 1000,
    })

  } catch (err: any) {
    logger.error('Consumer login error', { error: err.message })
    res.status(500).json({ error: 'Login failed — please try again' })
  }
})

// ─── POST /api/v1/auth/consumer/refresh ──────────────────────────────────────
// Exchanges a valid refresh token for a new access token + rotated refresh token.
// The old refresh token is revoked immediately (one-time use — rotation on every call).

router.post('/consumer/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body
  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ error: 'refreshToken is required' })
  }

  try {
    const { createHash } = await import('crypto')
    const hash = createHash('sha256').update(refreshToken).digest('hex')

    const result = await db.query(
      `SELECT rt.id, rt.consumer_id, c.display_name, c.phone, c.active
       FROM consumer_refresh_tokens rt
       JOIN consumers c ON rt.consumer_id = c.id
       WHERE rt.token_hash = $1
         AND rt.revoked_at IS NULL
         AND rt.expires_at > NOW()`,
      [hash]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' })
    }

    const { id: tokenId, consumer_id, display_name, phone, active } = result.rows[0]

    if (!active) {
      return res.status(403).json({ error: 'Account is deactivated' })
    }

    // Revoke the used token (rotation — prevents refresh token reuse)
    await db.query(
      'UPDATE consumer_refresh_tokens SET revoked_at = NOW() WHERE id = $1',
      [tokenId]
    )

    const newAccessToken  = issueConsumerToken(consumer_id, display_name ?? phone)
    const newRefreshToken = await issueRefreshToken(consumer_id, req.headers['user-agent'])

    logger.info('Consumer token refreshed', { consumerId: consumer_id })

    res.json({
      token:        newAccessToken,
      refreshToken: newRefreshToken,
      role:         'CONSUMER',
      consumerId:   consumer_id,
      expiresAt:    Date.now() + CONSUMER_ACCESS_TTL_S * 1000,
    })

  } catch (err: any) {
    logger.error('Consumer token refresh error', { error: err.message })
    res.status(500).json({ error: 'Token refresh failed — please log in again' })
  }
})

// ─── POST /api/v1/auth/consumer/logout ───────────────────────────────────────
// Revokes the refresh token so it cannot be used to issue new access tokens.

router.post('/consumer/logout', async (req: Request, res: Response) => {
  const { refreshToken } = req.body
  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ error: 'refreshToken is required' })
  }

  try {
    const { createHash } = await import('crypto')
    const hash = createHash('sha256').update(refreshToken).digest('hex')
    await db.query(
      'UPDATE consumer_refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
      [hash]
    )
    res.json({ message: 'Logged out successfully' })
  } catch (err: any) {
    res.status(500).json({ error: 'Logout failed' })
  }
})

// ─── Admin: merchant approval ─────────────────────────────────────────────────

function requireAdminSecret(req: Request, res: Response, next: Function) {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

router.get('/admin/pending', requireAdminSecret, async (_req: Request, res: Response) => {
  const { rows } = await db.query(
    `SELECT id, name, email, phone, business_reg_number, id_number, created_at
     FROM merchants
     WHERE approval_status = 'PENDING_REVIEW'
     ORDER BY created_at ASC`
  )
  res.json({ merchants: rows })
})

router.post('/admin/approve/:merchantId', requireAdminSecret, async (req: Request, res: Response) => {
  const { merchantId } = req.params
  const { action, notes } = req.body  // action: 'approve' | 'reject' | 'suspend'

  const statusMap: Record<string, string> = {
    approve: 'APPROVED',
    reject:  'REJECTED',
    suspend: 'SUSPENDED',
  }

  const newStatus = statusMap[action]
  if (!newStatus) {
    return res.status(400).json({ error: 'action must be approve, reject, or suspend' })
  }

  const { rowCount } = await db.query(
    `UPDATE merchants
     SET approval_status = $1, review_notes = $2, reviewed_at = NOW(), updated_at = NOW()
     WHERE id = $3`,
    [newStatus, notes ?? null, merchantId]
  )

  if ((rowCount ?? 0) === 0) {
    return res.status(404).json({ error: 'Merchant not found' })
  }

  logger.info('Merchant approval decision', { merchantId, action: newStatus })
  res.json({ ok: true, merchantId, status: newStatus })
})

// ─── Consumer token helpers ───────────────────────────────────────────────────

const CONSUMER_ACCESS_TTL_S  = 24 * 60 * 60      // 24 h — short-lived access token
const CONSUMER_REFRESH_TTL_S = 30 * 24 * 60 * 60 // 30 d — long-lived refresh token

function issueConsumerToken(consumerId: string, name: string): string {
  return jwt.sign(
    { sub: consumerId, name, role: 'CONSUMER' },
    process.env.JWT_SECRET!,
    { expiresIn: CONSUMER_ACCESS_TTL_S }
  )
}

async function issueRefreshToken(consumerId: string, deviceHint?: string): Promise<string> {
  const { createHash, randomBytes } = await import('crypto')
  const raw  = randomBytes(32).toString('hex')          // 64-char hex — never stored
  const hash = createHash('sha256').update(raw).digest('hex')

  await db.query(
    `INSERT INTO consumer_refresh_tokens
       (consumer_id, token_hash, expires_at, device_hint)
     VALUES ($1, $2, NOW() + INTERVAL '30 days', $3)`,
    [consumerId, hash, deviceHint ?? null]
  )
  return raw
}

export default router

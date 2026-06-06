/**
 * routes/auth.ts — authentication for merchants, consumers, and admin.
 *
 * Merchant endpoints:
 *   POST /api/v1/auth/login             — validate credentials, return JWT + refresh token
 *   POST /api/v1/auth/logout            — revoke refresh token + clear device binding
 *   POST /api/v1/auth/refresh           — rotate merchant refresh token
 *   POST /api/v1/auth/register          — self-service registration (PENDING_REVIEW)
 *
 * Consumer endpoints:
 *   POST /api/v1/auth/consumer/register    — phone + optional email/password
 *   POST /api/v1/auth/consumer/login       — email + password
 *   POST /api/v1/auth/consumer/otp/request — send 6-digit OTP to phone via SMS
 *   POST /api/v1/auth/consumer/otp/verify  — verify OTP, return JWT + refresh token
 *   POST /api/v1/auth/consumer/refresh     — rotate consumer refresh token
 *   POST /api/v1/auth/consumer/logout      — revoke refresh token
 *
 * Admin endpoints:
 *   POST /api/v1/auth/admin/approve/:merchantId — approve, reject, or suspend
 *   GET  /api/v1/auth/admin/pending             — list PENDING_REVIEW merchants
 *
 * Security:
 *   - Account lockout: 5 failed logins → 15-minute lockout (per email, tracked in Redis)
 *   - Constant-time password compare (bcrypt dummy hash prevents user enumeration)
 *   - JWT: merchants 8 h access + 30 d refresh (rotated on every use)
 *   - Single-device enforcement for merchants (device_id in JWT + Redis cache)
 *   - All auth events written to server_audit_log (CBK compliance)
 */
import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { db }             from '../db/index'
import { redis }          from '../db/redis'
import { logger }         from '../util/logger'
import { validate, loginSchema } from '../middleware/validate'
import { requireAuth, DEVICE_CACHE_TTL_S } from '../middleware/auth'
import { deriveMerchantSigningKey } from '../util/nfc-signing'
import { sendSms, SmsTemplate } from '../integrations/africas-talking'
import { writeAuditLog } from '../util/audit'

const router = Router()
const BCRYPT_ROUNDS = 12

// ─── ACCOUNT LOCKOUT ─────────────────────────────────────────────────────────
// After MAX_ATTEMPTS failed logins the account is locked for LOCKOUT_TTL_S.
// Tracked per email in Redis: key = auth:lockout:{email}

const MAX_ATTEMPTS   = 5
const LOCKOUT_TTL_S  = 15 * 60   // 15 minutes

async function checkLockout(email: string): Promise<boolean> {
  const key    = `auth:lockout:${email}`
  const locked = await redis.get(key).catch(() => null)
  return locked !== null
}

async function recordFailedAttempt(email: string, ip: string): Promise<void> {
  const attemptsKey = `auth:attempts:${email}`
  const count = await redis.incr(attemptsKey).catch(() => 0)
  await redis.expire(attemptsKey, LOCKOUT_TTL_S).catch(() => {})

  if (count >= MAX_ATTEMPTS) {
    const lockKey = `auth:lockout:${email}`
    await redis.setex(lockKey, LOCKOUT_TTL_S, '1').catch(() => {})
    await writeAuditLog({ event: 'MERCHANT_LOCKED_OUT', detail: { email, ip, count } })
    logger.warn('Account locked out after failed attempts', { email, ip, count })
  }
}

async function clearFailedAttempts(email: string): Promise<void> {
  await redis.del(`auth:attempts:${email}`).catch(() => {})
}

// ─── POST /api/v1/auth/login (merchant terminal) ─────────────────────────────

router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  const { email, password, deviceId } = req.body

  try {
    if (await checkLockout(email.toLowerCase())) {
      return res.status(429).json({
        error: 'Account temporarily locked — too many failed login attempts. Try again in 15 minutes.',
      })
    }

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
      await recordFailedAttempt(email.toLowerCase(), req.ip ?? '')
      await writeAuditLog({
        event: 'MERCHANT_LOGIN_FAILED',
        detail: { email: email.toLowerCase() },
        ip: req.ip,
      })
      logger.warn('Failed merchant login attempt', { email, ip: req.ip })
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    if (!merchant.active) {
      return res.status(403).json({ error: 'Account is deactivated — contact support' })
    }
    if (merchant.approval_status === 'PENDING_REVIEW') {
      return res.status(403).json({ error: 'Account is pending review', status: 'PENDING_REVIEW' })
    }
    if (merchant.approval_status === 'REJECTED') {
      return res.status(403).json({ error: 'Account registration was not approved', status: 'REJECTED' })
    }
    if (merchant.approval_status === 'SUSPENDED') {
      return res.status(403).json({ error: 'Account is suspended — contact support', status: 'SUSPENDED' })
    }

    await clearFailedAttempts(email.toLowerCase())

    await db.query(
      'UPDATE merchants SET device_id = $1, updated_at = NOW() WHERE id = $2',
      [deviceId, merchant.id]
    )

    const accessToken  = issueMerchantAccessToken(merchant.id, merchant.name, deviceId)
    const refreshToken = await issueMerchantRefreshToken(merchant.id, req.headers['user-agent'])
    const expiresAt    = Date.now() + MERCHANT_ACCESS_TTL_S * 1000

    await redis.setex(`merchant:device:${merchant.id}`, DEVICE_CACHE_TTL_S, deviceId)

    let nfcSigningKey: string | null = null
    try {
      nfcSigningKey = deriveMerchantSigningKey(merchant.id)
    } catch {
      logger.warn('NFC_SIGNING_SECRET not set — signing key omitted from login response')
    }

    await writeAuditLog({
      event: 'MERCHANT_LOGIN', entityType: 'merchant', entityId: merchant.id,
      detail: { deviceId }, ip: req.ip,
    })
    logger.info('Merchant logged in', { merchantId: merchant.id, deviceId })

    res.json({
      token: accessToken, refreshToken, role: 'MERCHANT',
      merchantId: merchant.id, merchantName: merchant.name,
      expiresAt, nfcSigningKey, kraPin: merchant.kra_pin ?? null,
    })

  } catch (err: any) {
    logger.error('Merchant login error', { error: err.message })
    res.status(500).json({ error: 'Login failed — please try again' })
  }
})

// ─── POST /api/v1/auth/refresh (merchant token rotation) ─────────────────────

router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body
  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ error: 'refreshToken is required' })
  }

  try {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex')

    const result = await db.query(
      `SELECT rt.id, rt.merchant_id, m.name, m.active, m.device_id, m.approval_status
       FROM merchant_refresh_tokens rt
       JOIN merchants m ON rt.merchant_id = m.id
       WHERE rt.token_hash = $1
         AND rt.revoked_at IS NULL
         AND rt.expires_at > NOW()`,
      [hash]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' })
    }

    const { id: tokenId, merchant_id, name, active, device_id, approval_status } = result.rows[0]

    if (!active || approval_status !== 'APPROVED') {
      return res.status(403).json({ error: 'Account not active or approved' })
    }

    await db.query(
      'UPDATE merchant_refresh_tokens SET revoked_at = NOW() WHERE id = $1',
      [tokenId]
    )

    const newAccessToken  = issueMerchantAccessToken(merchant_id, name, device_id ?? '')
    const newRefreshToken = await issueMerchantRefreshToken(merchant_id, req.headers['user-agent'])

    await writeAuditLog({
      event: 'MERCHANT_REFRESH_TOKEN_ISSUED', entityType: 'merchant', entityId: merchant_id,
      ip: req.ip,
    })

    res.json({
      token: newAccessToken, refreshToken: newRefreshToken,
      role: 'MERCHANT', merchantId: merchant_id,
      expiresAt: Date.now() + MERCHANT_ACCESS_TTL_S * 1000,
    })

  } catch (err: any) {
    logger.error('Merchant token refresh error', { error: err.message })
    res.status(500).json({ error: 'Token refresh failed — please log in again' })
  }
})

// ─── POST /api/v1/auth/register (merchant self-service) ──────────────────────

router.post('/register', async (req: Request, res: Response) => {
  const { name, email, password, phone, businessRegNumber, idNumber,
          mpesaShortcode, mpesaAccountRef, kraPin } = req.body

  if (!name || !email || !password || !phone) {
    return res.status(400).json({ error: 'name, email, password, and phone are required' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  try {
    const existing = await db.query(
      'SELECT id FROM merchants WHERE email = $1', [email.toLowerCase()]
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
      [name, email.toLowerCase(), passwordHash, phone,
       mpesaShortcode ?? null, mpesaAccountRef ?? null,
       kraPin ?? null, businessRegNumber ?? null, idNumber ?? null]
    )

    await writeAuditLog({
      event: 'MERCHANT_REGISTERED', entityType: 'merchant', entityId: rows[0].id,
      detail: { email: email.toLowerCase() }, ip: req.ip,
    })
    logger.info('Merchant self-registered (PENDING_REVIEW)', { merchantId: rows[0].id })

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
    const { refreshToken } = req.body

    if (refreshToken) {
      const hash = crypto.createHash('sha256').update(refreshToken).digest('hex')
      await db.query(
        'UPDATE merchant_refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
        [hash]
      )
    }

    await db.query('UPDATE merchants SET device_id = NULL, updated_at = NOW() WHERE id = $1', [merchantId])
    await redis.del(`merchant:device:${merchantId}`)

    await writeAuditLog({ event: 'MERCHANT_LOGOUT', entityType: 'merchant', entityId: merchantId, ip: req.ip })
    logger.info('Merchant logged out', { merchantId })
    res.json({ message: 'Logged out successfully' })
  } catch (err: any) {
    res.status(500).json({ error: 'Logout failed' })
  }
})

// ─── POST /api/v1/auth/consumer/register ─────────────────────────────────────

router.post('/consumer/register', async (req: Request, res: Response) => {
  const { phone, email, password, displayName } = req.body

  if (!phone) return res.status(400).json({ error: 'phone is required' })
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
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
      passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    }

    const phoneHash = crypto.createHash('sha256').update(phone).digest('hex')

    const { rows } = await db.query(
      `INSERT INTO consumers (phone, phone_hash, email, password_hash, display_name)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, phone, email, display_name`,
      [phone, phoneHash, email ?? null, passwordHash, displayName ?? null]
    )

    const consumer     = rows[0]
    const token        = issueConsumerToken(consumer.id, consumer.display_name ?? consumer.phone)
    const refreshToken = await issueRefreshToken(consumer.id, req.headers['user-agent'])

    await writeAuditLog({ event: 'CONSUMER_REGISTERED', entityType: 'consumer', entityId: consumer.id, ip: req.ip })
    logger.info('Consumer registered', { consumerId: consumer.id })

    res.status(201).json({
      token, refreshToken, role: 'CONSUMER',
      consumerId: consumer.id, expiresAt: Date.now() + CONSUMER_ACCESS_TTL_S * 1000,
    })

  } catch (err: any) {
    logger.error('Consumer registration error', { error: err.message })
    res.status(500).json({ error: 'Registration failed — please try again' })
  }
})

// ─── POST /api/v1/auth/consumer/login (email + password) ─────────────────────

router.post('/consumer/login', async (req: Request, res: Response) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }

  try {
    if (await checkLockout(email.toLowerCase())) {
      return res.status(429).json({ error: 'Account temporarily locked — too many failed attempts. Try again in 15 minutes.' })
    }

    const result = await db.query(
      'SELECT id, display_name, phone, password_hash, active FROM consumers WHERE email = $1',
      [email.toLowerCase()]
    )

    const consumer = result.rows[0]
    const passwordMatch = consumer && consumer.password_hash
      ? await bcrypt.compare(password, consumer.password_hash)
      : await bcrypt.compare(password, '$2b$10$invalidhashfortimingprotection')

    if (!consumer || !passwordMatch) {
      await recordFailedAttempt(email.toLowerCase(), req.ip ?? '')
      await writeAuditLog({ event: 'CONSUMER_LOGIN_FAILED', detail: { email: email.toLowerCase() }, ip: req.ip })
      logger.warn('Failed consumer login', { email, ip: req.ip })
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    if (!consumer.active) return res.status(403).json({ error: 'Account is deactivated' })

    await clearFailedAttempts(email.toLowerCase())

    const token        = issueConsumerToken(consumer.id, consumer.display_name ?? consumer.phone)
    const refreshToken = await issueRefreshToken(consumer.id, req.headers['user-agent'])

    await writeAuditLog({ event: 'CONSUMER_LOGIN', entityType: 'consumer', entityId: consumer.id, ip: req.ip })
    logger.info('Consumer logged in', { consumerId: consumer.id })

    res.json({
      token, refreshToken, role: 'CONSUMER',
      consumerId: consumer.id, expiresAt: Date.now() + CONSUMER_ACCESS_TTL_S * 1000,
    })

  } catch (err: any) {
    logger.error('Consumer login error', { error: err.message })
    res.status(500).json({ error: 'Login failed — please try again' })
  }
})

// ─── POST /api/v1/auth/consumer/otp/request ──────────────────────────────────
// Sends a 6-digit OTP to the consumer's registered phone via Africa's Talking SMS.
// Rate-limited: one OTP per phone per 60 seconds.

const OTP_TTL_S       = 5 * 60   // 5 minutes to enter
const OTP_RATE_TTL_S  = 60       // minimum gap between requests

router.post('/consumer/otp/request', async (req: Request, res: Response) => {
  const { phone } = req.body
  if (!phone) return res.status(400).json({ error: 'phone is required' })
  if (!/^254[0-9]{9}$/.test(phone)) {
    return res.status(400).json({ error: 'phone must be in format 254XXXXXXXXX' })
  }

  try {
    // Rate-limit: one OTP per phone per minute
    const rateKey = `otp:rate:${phone}`
    const recentRequest = await redis.get(rateKey).catch(() => null)
    if (recentRequest) {
      return res.status(429).json({ error: 'OTP already sent — please wait 60 seconds before requesting again' })
    }

    // Verify the phone is registered
    const { rows } = await db.query(
      'SELECT id, display_name, active FROM consumers WHERE phone = $1',
      [phone]
    )
    if (rows.length === 0) {
      // Don't reveal whether phone is registered — respond OK regardless
      return res.json({ message: 'If this number is registered, an OTP has been sent.' })
    }

    const consumer = rows[0]
    if (!consumer.active) return res.status(403).json({ error: 'Account is deactivated' })

    // Generate 6-digit OTP
    const otp     = String(Math.floor(100000 + Math.random() * 900000))
    const otpKey  = `otp:${phone}`
    await redis.setex(otpKey, OTP_TTL_S, otp)
    await redis.setex(rateKey, OTP_RATE_TTL_S, '1')

    // Send via Africa's Talking
    const message = `Your OrchestratePay verification code is: ${otp}. Valid for 5 minutes. Do not share.`
    await sendSms(phone, message)

    await writeAuditLog({
      event: 'CONSUMER_OTP_REQUESTED', entityType: 'consumer', entityId: consumer.id,
      ip: req.ip,
    })

    res.json({ message: 'If this number is registered, an OTP has been sent.' })

  } catch (err: any) {
    logger.error('OTP request error', { error: err.message })
    res.status(500).json({ error: 'Failed to send OTP — please try again' })
  }
})

// ─── POST /api/v1/auth/consumer/otp/verify ───────────────────────────────────
// Verifies the OTP and returns a JWT + refresh token.

router.post('/consumer/otp/verify', async (req: Request, res: Response) => {
  const { phone, otp } = req.body
  if (!phone || !otp) return res.status(400).json({ error: 'phone and otp are required' })

  try {
    const otpKey    = `otp:${phone}`
    const storedOtp = await redis.get(otpKey).catch(() => null)

    if (!storedOtp) {
      return res.status(401).json({ error: 'OTP expired or not found — please request a new one' })
    }

    // Constant-time comparison to prevent timing oracle
    const expected = Buffer.from(storedOtp.padEnd(64, '\0'))
    const received = Buffer.from(String(otp).padEnd(64, '\0'))
    if (!crypto.timingSafeEqual(expected, received)) {
      return res.status(401).json({ error: 'Invalid OTP' })
    }

    // OTP is single-use — delete immediately after success
    await redis.del(otpKey)

    const { rows } = await db.query(
      'SELECT id, display_name, phone, active FROM consumers WHERE phone = $1',
      [phone]
    )
    if (rows.length === 0 || !rows[0].active) {
      return res.status(403).json({ error: 'Account not found or deactivated' })
    }

    const consumer     = rows[0]
    const token        = issueConsumerToken(consumer.id, consumer.display_name ?? consumer.phone)
    const refreshToken = await issueRefreshToken(consumer.id, req.headers['user-agent'])

    await writeAuditLog({
      event: 'CONSUMER_OTP_VERIFIED', entityType: 'consumer', entityId: consumer.id,
      ip: req.ip,
    })

    res.json({
      token, refreshToken, role: 'CONSUMER',
      consumerId: consumer.id, expiresAt: Date.now() + CONSUMER_ACCESS_TTL_S * 1000,
    })

  } catch (err: any) {
    logger.error('OTP verify error', { error: err.message })
    res.status(500).json({ error: 'OTP verification failed — please try again' })
  }
})

// ─── POST /api/v1/auth/consumer/refresh ──────────────────────────────────────

router.post('/consumer/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body
  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ error: 'refreshToken is required' })
  }

  try {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex')

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

    if (!active) return res.status(403).json({ error: 'Account is deactivated' })

    await db.query('UPDATE consumer_refresh_tokens SET revoked_at = NOW() WHERE id = $1', [tokenId])

    const newAccessToken  = issueConsumerToken(consumer_id, display_name ?? phone)
    const newRefreshToken = await issueRefreshToken(consumer_id, req.headers['user-agent'])

    logger.info('Consumer token refreshed', { consumerId: consumer_id })

    res.json({
      token: newAccessToken, refreshToken: newRefreshToken,
      role: 'CONSUMER', consumerId: consumer_id,
      expiresAt: Date.now() + CONSUMER_ACCESS_TTL_S * 1000,
    })

  } catch (err: any) {
    logger.error('Consumer token refresh error', { error: err.message })
    res.status(500).json({ error: 'Token refresh failed — please log in again' })
  }
})

// ─── POST /api/v1/auth/consumer/logout ───────────────────────────────────────

router.post('/consumer/logout', async (req: Request, res: Response) => {
  const { refreshToken } = req.body
  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ error: 'refreshToken is required' })
  }

  try {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex')
    await db.query(
      'UPDATE consumer_refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
      [hash]
    )
    await writeAuditLog({ event: 'CONSUMER_LOGOUT', ip: req.ip })
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
     FROM merchants WHERE approval_status = 'PENDING_REVIEW' ORDER BY created_at ASC`
  )
  res.json({ merchants: rows })
})

router.post('/admin/approve/:merchantId', requireAdminSecret, async (req: Request, res: Response) => {
  const { merchantId } = req.params
  const { action, notes } = req.body

  const statusMap: Record<string, string> = {
    approve: 'APPROVED', reject: 'REJECTED', suspend: 'SUSPENDED',
  }
  const newStatus = statusMap[action]
  if (!newStatus) {
    return res.status(400).json({ error: 'action must be approve, reject, or suspend' })
  }

  const { rowCount } = await db.query(
    `UPDATE merchants SET approval_status = $1, review_notes = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3`,
    [newStatus, notes ?? null, merchantId]
  )

  if ((rowCount ?? 0) === 0) return res.status(404).json({ error: 'Merchant not found' })

  const auditEvent = action === 'approve'
    ? 'MERCHANT_APPROVED'
    : action === 'suspend'
    ? 'MERCHANT_SUSPENDED'
    : 'MERCHANT_REJECTED'

  await writeAuditLog({
    event: auditEvent as any,
    entityType: 'merchant', entityId: merchantId,
    detail: { action: newStatus, notes: notes ?? null },
    ip: req.ip,
  })

  logger.info('Merchant approval decision', { merchantId, action: newStatus })
  res.json({ ok: true, merchantId, status: newStatus })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MERCHANT_ACCESS_TTL_S  = 8  * 60 * 60   // 8 h
const MERCHANT_REFRESH_TTL_S = 30 * 24 * 60 * 60  // 30 d
const CONSUMER_ACCESS_TTL_S  = 24 * 60 * 60   // 24 h
const CONSUMER_REFRESH_TTL_S = 30 * 24 * 60 * 60  // 30 d

function issueMerchantAccessToken(merchantId: string, name: string, deviceId: string): string {
  return jwt.sign(
    { sub: merchantId, name, role: 'MERCHANT', deviceId },
    process.env.JWT_SECRET!,
    { expiresIn: MERCHANT_ACCESS_TTL_S }
  )
}

async function issueMerchantRefreshToken(merchantId: string, deviceHint?: string): Promise<string> {
  const raw  = crypto.randomBytes(32).toString('hex')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  await db.query(
    `INSERT INTO merchant_refresh_tokens (merchant_id, token_hash, expires_at, device_hint)
     VALUES ($1, $2, NOW() + INTERVAL '30 days', $3)`,
    [merchantId, hash, deviceHint ?? null]
  )
  return raw
}

function issueConsumerToken(consumerId: string, name: string): string {
  return jwt.sign(
    { sub: consumerId, name, role: 'CONSUMER' },
    process.env.JWT_SECRET!,
    { expiresIn: CONSUMER_ACCESS_TTL_S }
  )
}

async function issueRefreshToken(consumerId: string, deviceHint?: string): Promise<string> {
  const raw  = crypto.randomBytes(32).toString('hex')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  await db.query(
    `INSERT INTO consumer_refresh_tokens (consumer_id, token_hash, expires_at, device_hint)
     VALUES ($1, $2, NOW() + INTERVAL '30 days', $3)`,
    [consumerId, hash, deviceHint ?? null]
  )
  return raw
}

export default router

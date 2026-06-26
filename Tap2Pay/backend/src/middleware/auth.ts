/**
 * middleware/auth.ts — JWT authentication middleware.
 *
 * Supports three principal types via the `role` claim in the JWT payload:
 *   MERCHANT  — Android terminal or merchant web session
 *   CONSUMER  — consumer web/mobile session
 *   ADMIN     — internal ops (also accepts X-Admin-Secret header)
 *
 * Backwards compatibility:
 *   Legacy merchant JWTs issued before the role field was added have no `role`.
 *   These are treated as MERCHANT to avoid breaking existing terminals in the field.
 *
 * Token format:
 *   { sub: <entityId>, name: string, role: 'MERCHANT'|'CONSUMER'|'ADMIN', ... }
 *
 * The decoded payload is attached to req.merchant (MERCHANT) or req.consumer (CONSUMER)
 * so route handlers can access it without re-decoding.
 */
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { logger } from '../util/logger'
import { redis }  from '../db/redis'
import { db }     from '../db/index'

// Redis key that holds the current authoritative deviceId for a merchant session.
// Written on login, deleted on logout, TTL slightly exceeds the JWT lifetime.
const DEVICE_KEY = (merchantId: string) => `merchant:device:${merchantId}`
export const DEVICE_CACHE_TTL_S = 9 * 60 * 60  // 9 h — covers the 8 h JWT lifetime

export type Role = 'MERCHANT' | 'CONSUMER' | 'ADMIN'

export interface MerchantPayload {
  sub:             string   // merchantId (UUID)
  name:            string
  role:            Role
  deviceId:        string
  approvalStatus?: string   // present in tokens issued after approval-gate was added
  iat:             number
  exp:             number
}

export interface ConsumerPayload {
  sub:  string   // consumerId (UUID)
  name: string
  role: Role
  iat:  number
  exp:  number
}

// Extend Express Request to carry decoded principals
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      merchant?: MerchantPayload
      consumer?: ConsumerPayload
    }
  }
}

// ─── requireAuth ─────────────────────────────────────────────────────────────
// Requires a valid MERCHANT JWT (or legacy token with no role field).
// After signature/expiry verification, checks that the JWT's deviceId still
// matches the authoritative device stored in Redis (written at login, cleared
// at logout). This makes single-device enforcement real: a new login from
// device B immediately invalidates device A's session without waiting for expiry.

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const payload = extractJwt(req, res)
  if (!payload) return

  const role = payload.role
  if (role && role !== 'MERCHANT') {
    return res.status(403).json({ error: 'Merchant credentials required' })
  }

  req.merchant = payload as MerchantPayload
  checkDeviceBinding(req.merchant, res)
    .then(valid => { if (valid) next() })
    .catch(next)
}

// ─── requireConsumerAuth ─────────────────────────────────────────────────────
// Requires a valid CONSUMER JWT.

export function requireConsumerAuth(req: Request, res: Response, next: NextFunction) {
  const payload = extractJwt(req, res)
  if (!payload) return

  if (payload.role !== 'CONSUMER') {
    return res.status(403).json({ error: 'Consumer credentials required' })
  }

  req.consumer = payload as ConsumerPayload
  next()
}

// ─── requireApprovedMerchant ─────────────────────────────────────────────────
// Must run after requireAuth (which populates req.merchant).
// Blocks PENDING_REVIEW / REJECTED / SUSPENDED merchants from payment-initiating
// routes while still allowing them to reach KYC upload routes.
// Tokens issued before this field was added have approvalStatus === undefined;
// those were issued only to APPROVED merchants (the refresh path already checked),
// so undefined is treated as APPROVED for backwards compatibility.

export function requireApprovedMerchant(req: Request, res: Response, next: NextFunction) {
  const status = req.merchant!.approvalStatus
  if (status && status !== 'APPROVED') {
    return res.status(403).json({
      error: 'Account not yet approved — complete KYC to start accepting payments',
      status,
    })
  }
  next()
}

// ─── requireRole ─────────────────────────────────────────────────────────────
// Flexible role check — accepts any of the listed roles.
// Usage: router.use(requireRole('ADMIN', 'MERCHANT'))

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const payload = extractJwt(req, res)
    if (!payload) return

    const role = payload.role
    // Legacy merchant tokens have no role — default to MERCHANT
    const effective: Role = role ?? 'MERCHANT'

    if (!roles.includes(effective)) {
      return res.status(403).json({ error: `One of [${roles.join(', ')}] role required` })
    }

    if (effective === 'MERCHANT') req.merchant = payload as MerchantPayload
    if (effective === 'CONSUMER') req.consumer = payload as ConsumerPayload

    next()
  }
}

// ─── Device binding check ─────────────────────────────────────────────────────
// Verifies that the deviceId embedded in the JWT still matches the authoritative
// value in Redis. On a cache miss it falls back to the DB and backfills the cache.
// On any Redis/DB error it fails open — a payment terminal must not go dark
// because of a transient infrastructure blip.

async function checkDeviceBinding(payload: MerchantPayload, res: Response): Promise<boolean> {
  // Legacy tokens issued before deviceId was added carry no deviceId claim.
  // Pass them through so existing terminals in the field keep working.
  if (!payload.deviceId) return true

  try {
    let current = await redis.get(DEVICE_KEY(payload.sub))

    if (current === null) {
      // Cache miss — query the DB and backfill so the next request is fast.
      const { rows } = await db.query(
        'SELECT device_id FROM merchants WHERE id = $1',
        [payload.sub]
      )
      current = rows[0]?.device_id ?? null
      if (current) {
        await redis.setex(DEVICE_KEY(payload.sub), DEVICE_CACHE_TTL_S, current)
      }
    }

    if (current === null) {
      // device_id is NULL in DB — merchant has explicitly logged out.
      res.status(401).json({ error: 'Session revoked — please log in again' })
      return false
    }

    if (payload.deviceId !== current) {
      // A newer login from a different device has overwritten the key.
      res.status(401).json({ error: 'Session invalidated — another device has logged in' })
      return false
    }

    return true
  } catch (err: unknown) {
    logger.warn('Device binding check failed — failing open', {
      merchantId: payload.sub,
      error: (err as Error).message,
    })
    return true
  }
}

// ─── requireApiKey ────────────────────────────────────────────────────────────
// Accepts X-API-Key: op_<hex64> header as an alternative to Bearer JWT.
// Looks up the SHA-256 hash of the key in merchant_api_keys; on match attaches
// req.merchant and calls next(). On any DB error, fails closed (401).

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string | undefined
  if (!apiKey || !apiKey.startsWith('op_')) {
    return res.status(401).json({ error: 'Missing or invalid X-API-Key header' })
  }

  const crypto = await import('crypto')
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex')

  try {
    const { rows } = await db.query(
      `SELECT k.id, k.merchant_id, m.name, k.expires_at
         FROM merchant_api_keys k
         JOIN merchants m ON m.id = k.merchant_id
        WHERE k.key_hash = $1 AND k.active = TRUE AND m.active = TRUE`,
      [keyHash]
    )

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or revoked API key' })
    }

    const row = rows[0]
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'API key has expired' })
    }

    // Update last_used_at fire-and-forget — never block the request on this
    db.query(
      `UPDATE merchant_api_keys SET last_used_at = NOW() WHERE id = $1`,
      [row.id]
    ).catch(() => {})

    req.merchant = {
      sub:      row.merchant_id,
      name:     row.name,
      role:     'MERCHANT',
      deviceId: '',
      iat:      0,
      exp:      0,
    }
    next()
  } catch (err: unknown) {
    logger.error('API key lookup failed', { error: (err as Error).message })
    res.status(401).json({ error: 'Authentication failed' })
  }
}

// ─── requireAuthOrApiKey ──────────────────────────────────────────────────────
// Accepts either a Bearer JWT or an X-API-Key header. Useful for endpoints that
// merchants can call from both their Android terminal and server-to-server.

export function requireAuthOrApiKey(req: Request, res: Response, next: NextFunction) {
  if (req.headers['x-api-key']) {
    return requireApiKey(req, res, next)
  }
  return requireAuth(req, res, next)
}

// ─── Internal helper ─────────────────────────────────────────────────────────

/** Minimal shape of the decoded JWT payload. */
interface JwtPayloadWithRole {
  role?: Role
  sub?: string
  name?: string
  deviceId?: string
  iat?: number
  exp?: number
}

function extractJwt(req: Request, res: Response): JwtPayloadWithRole | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authentication token' })
    return null
  }

  const token = header.slice(7)

  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as JwtPayloadWithRole
  } catch (err: unknown) {
    const e = err as Error & { name?: string }
    logger.warn('JWT verification failed', { error: e.message, ip: req.ip })
    if (e.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Session expired — please log in again' })
    } else {
      res.status(401).json({ error: 'Invalid authentication token' })
    }
    return null
  }
}

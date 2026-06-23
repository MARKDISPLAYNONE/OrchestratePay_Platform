/**
 * routes/api-keys.ts — Merchant API key management.
 *
 * API keys are an alternative to Bearer JWT for server-to-server integrations.
 * Key management (create / list / revoke / view) always requires a valid Merchant
 * JWT — you cannot use an API key to create or revoke other API keys.
 *
 * Key format: op_<64 hex chars>  (67 chars total, prefix "op_")
 * Storage:    SHA-256 hash stored in merchant_api_keys.key_hash
 * Visibility: the full key is returned ONCE on creation; never again
 *
 * POST   /api/v1/api-keys          — create a new key (max 10 active per merchant)
 * GET    /api/v1/api-keys          — list active keys (no secrets)
 * DELETE /api/v1/api-keys/:id      — revoke (soft-delete) a key
 * GET    /api/v1/api-keys/:id      — get single key metadata
 */
import crypto from 'crypto'
import { Router, Request, Response } from 'express'
import Joi from 'joi'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { logger } from '../util/logger'

const router = Router()

const MAX_ACTIVE_KEYS = 10

const createKeySchema = Joi.object({
  name:          Joi.string().max(100).required(),
  expiresInDays: Joi.number().integer().min(1).max(365).optional(),
})

// ─── POST /api/v1/api-keys ────────────────────────────────────────────────────

router.post('/', requireAuth, validate(createKeySchema), async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { name, expiresInDays } = req.body

  try {
    // Enforce hard cap of 10 active keys per merchant
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS cnt
         FROM merchant_api_keys
        WHERE merchant_id = $1 AND active = TRUE`,
      [merchantId]
    )
    if (countResult.rows[0].cnt >= MAX_ACTIVE_KEYS) {
      return res.status(409).json({
        error: `Maximum of ${MAX_ACTIVE_KEYS} active API keys reached. Revoke an existing key before creating a new one.`,
      })
    }

    // Generate key: 'op_' + 64 hex chars = 67 chars total
    const fullKey  = 'op_' + crypto.randomBytes(32).toString('hex')
    const keyPrefix = fullKey.slice(0, 12)   // e.g. "op_a1b2c3d4e5"
    const keyHash  = crypto.createHash('sha256').update(fullKey).digest('hex')
    const id       = uuidv4()

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null

    const insertResult = await db.query(
      `INSERT INTO merchant_api_keys
         (id, merchant_id, key_hash, key_prefix, name, expires_at, active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id, name, key_prefix, expires_at, created_at`,
      [id, merchantId, keyHash, keyPrefix, name, expiresAt]
    )

    const row = insertResult.rows[0]

    logger.info('API key created', { merchantId, keyPrefix, id })

    return res.status(201).json({
      id:        row.id,
      name:      row.name,
      keyPrefix: row.key_prefix,
      fullKey,                       // only returned here — never stored in plaintext
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })
  } catch (err: unknown) {
    logger.error('Failed to create API key', { error: (err as Error).message, merchantId })
    return res.status(500).json({ error: 'Failed to create API key' })
  }
})

// ─── GET /api/v1/api-keys ─────────────────────────────────────────────────────

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub

  try {
    const result = await db.query(
      `SELECT id, name, key_prefix, last_used_at, expires_at, created_at
         FROM merchant_api_keys
        WHERE merchant_id = $1 AND active = TRUE
        ORDER BY created_at DESC`,
      [merchantId]
    )

    return res.json({
      keys: result.rows.map(r => ({
        id:         r.id,
        name:       r.name,
        keyPrefix:  r.key_prefix,
        lastUsedAt: r.last_used_at,
        expiresAt:  r.expires_at,
        createdAt:  r.created_at,
      })),
    })
  } catch (err: unknown) {
    logger.error('Failed to list API keys', { error: (err as Error).message, merchantId })
    return res.status(500).json({ error: 'Failed to list API keys' })
  }
})

// ─── DELETE /api/v1/api-keys/:id ─────────────────────────────────────────────

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const keyId      = req.params.id

  try {
    const result = await db.query(
      `UPDATE merchant_api_keys
          SET active = FALSE
        WHERE id = $1 AND merchant_id = $2 AND active = TRUE
        RETURNING id`,
      [keyId, merchantId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'API key not found or already revoked' })
    }

    logger.info('API key revoked', { merchantId, keyId })
    return res.json({ revoked: true })
  } catch (err: unknown) {
    logger.error('Failed to revoke API key', { error: (err as Error).message, merchantId, keyId })
    return res.status(500).json({ error: 'Failed to revoke API key' })
  }
})

// ─── GET /api/v1/api-keys/:id ────────────────────────────────────────────────

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const keyId      = req.params.id

  try {
    const result = await db.query(
      `SELECT id, name, key_prefix, last_used_at, expires_at, created_at
         FROM merchant_api_keys
        WHERE id = $1 AND merchant_id = $2 AND active = TRUE`,
      [keyId, merchantId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'API key not found' })
    }

    const r = result.rows[0]
    return res.json({
      id:         r.id,
      name:       r.name,
      keyPrefix:  r.key_prefix,
      lastUsedAt: r.last_used_at,
      expiresAt:  r.expires_at,
      createdAt:  r.created_at,
    })
  } catch (err: unknown) {
    logger.error('Failed to fetch API key', { error: (err as Error).message, merchantId, keyId })
    return res.status(500).json({ error: 'Failed to fetch API key' })
  }
})

export default router

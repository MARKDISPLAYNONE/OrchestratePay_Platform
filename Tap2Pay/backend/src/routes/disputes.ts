/**
 * routes/disputes.ts — Disputes / Chargebacks endpoints.
 *
 * Disputes can be raised by either a MERCHANT or a CONSUMER.  A single
 * custom middleware (requireMerchantOrConsumer) tries the JWT first as
 * MERCHANT, then as CONSUMER, and rejects any other role.
 *
 * State machine:
 *   OPEN → UNDER_REVIEW → RESOLVED_MERCHANT_FAVOR
 *                       → RESOLVED_CONSUMER_FAVOR
 *                       → CLOSED
 *
 * One active dispute per transaction — a 409 is returned if an OPEN or
 * UNDER_REVIEW dispute already exists for the same transaction_id.
 *
 * Admin actions live at PATCH /api/v1/admin/disputes/:id via adminDisputeRouter.
 */
import { Router, Request, Response, NextFunction } from 'express'
import Joi from 'joi'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index'
import { requireRole, MerchantPayload, ConsumerPayload } from '../middleware/auth'
import { requireAdmin } from './admin'
import { validate } from '../middleware/validate'
import { logger } from '../util/logger'

const router = Router()

// ─── Validation schemas ────────────────────────────────────────────────────────

const REASON_CODES = [
  'DUPLICATE_CHARGE',
  'GOODS_NOT_DELIVERED',
  'AMOUNT_INCORRECT',
  'UNAUTHORIZED_TRANSACTION',
  'FRAUD',
  'OTHER',
] as const

const createDisputeSchema = Joi.object({
  transactionId: Joi.string().uuid().required(),
  reasonCode:    Joi.string().valid(...REASON_CODES).required(),
  description:   Joi.string().min(10).max(1000).required(),
  evidenceUrl:   Joi.string().uri().optional(),
})

const RESOLUTION_STATUSES = [
  'UNDER_REVIEW',
  'RESOLVED_MERCHANT_FAVOR',
  'RESOLVED_CONSUMER_FAVOR',
  'CLOSED',
] as const

const adminUpdateSchema = Joi.object({
  status:          Joi.string().valid(...RESOLUTION_STATUSES).required(),
  resolutionNotes: Joi.string().max(2000).optional(),
})

// ─── Custom auth: merchant OR consumer ─────────────────────────────────────────

function requireMerchantOrConsumer(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authentication token' })
  }

  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as { role?: string; sub: string }
    if (payload.role === 'MERCHANT') {
      req.merchant = payload as unknown as MerchantPayload
    } else if (payload.role === 'CONSUMER') {
      req.consumer = payload as unknown as ConsumerPayload
    } else {
      return res.status(403).json({ error: 'Invalid role for disputes' })
    }
    next()
  } catch (err: unknown) {
    if ((err as Error).name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired — please log in again' })
    }
    return res.status(401).json({ error: 'Invalid authentication token' })
  }
}

// ─── POST /api/v1/disputes ─────────────────────────────────────────────────────
// Raises a new dispute.  Works for both MERCHANT and CONSUMER principals.

router.post(
  '/',
  requireMerchantOrConsumer,
  validate(createDisputeSchema),
  async (req: Request, res: Response) => {
    const { transactionId, reasonCode, description, evidenceUrl } = req.body

    const isMerchant = !!req.merchant
    const principalId = isMerchant ? req.merchant!.sub : req.consumer!.sub
    const raisedBy    = isMerchant ? 'MERCHANT' : 'CONSUMER'

    try {
      // 1. Verify transaction exists
      const { rows: txnRows } = await db.query(
        `SELECT id, merchant_id, consumer_id, consumer_phone
           FROM transactions
          WHERE id = $1`,
        [transactionId]
      )

      if (txnRows.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' })
      }

      const txn = txnRows[0]

      // 2. Authorization check
      if (isMerchant) {
        if (txn.merchant_id !== principalId) {
          return res.status(403).json({ error: 'Transaction does not belong to this merchant' })
        }
      } else {
        // Consumer: must be the consumer linked to the transaction
        const consumerMatch =
          txn.consumer_id === principalId ||
          txn.consumer_phone === req.consumer!.sub  // fallback: sub may be phone for legacy tokens
        if (!consumerMatch) {
          return res.status(403).json({ error: 'Transaction does not belong to this consumer' })
        }
      }

      // 3. One active dispute per transaction
      const { rows: dupRows } = await db.query(
        `SELECT id FROM disputes
          WHERE transaction_id = $1
            AND status IN ('OPEN', 'UNDER_REVIEW')`,
        [transactionId]
      )

      if (dupRows.length > 0) {
        return res.status(409).json({
          error: 'An active dispute already exists for this transaction',
          disputeId: dupRows[0].id,
        })
      }

      // 4. Insert
      const disputeId = uuidv4()

      await db.query(
        `INSERT INTO disputes
           (id, transaction_id, raised_by, reason_code, description, evidence_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')`,
        [disputeId, transactionId, raisedBy, reasonCode, description, evidenceUrl ?? null]
      )

      logger.info('Dispute created', {
        disputeId,
        transactionId,
        raisedBy,
        reasonCode,
        principalId,
      })

      return res.status(201).json({
        disputeId,
        transactionId,
        status:    'OPEN',
        reasonCode,
        createdAt: new Date().toISOString(),
      })
    } catch (err: unknown) {
      logger.error('Failed to create dispute', { error: (err as Error).message, transactionId, principalId })
      return res.status(500).json({ error: 'Failed to create dispute' })
    }
  }
)

// ─── GET /api/v1/disputes ──────────────────────────────────────────────────────
// List disputes.  Merchant sees disputes on their transactions; consumer sees
// disputes they raised.  Optional ?status= filter.

router.get('/', requireMerchantOrConsumer, async (req: Request, res: Response) => {
  const isMerchant = !!req.merchant
  const principalId = isMerchant ? req.merchant!.sub : req.consumer!.sub
  const statusFilter = req.query.status as string | undefined

  const VALID_STATUSES = [
    'OPEN',
    'UNDER_REVIEW',
    'RESOLVED_MERCHANT_FAVOR',
    'RESOLVED_CONSUMER_FAVOR',
    'CLOSED',
  ]

  if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
    return res.status(400).json({ error: `Invalid status filter. Valid values: ${VALID_STATUSES.join(', ')}` })
  }

  try {
    let query: string
    let params: unknown[]

    if (isMerchant) {
      query = `
        SELECT d.id, d.transaction_id, d.raised_by, d.reason_code, d.description,
               d.status, d.evidence_url, d.resolved_by, d.resolved_at,
               d.resolution_notes, d.created_at, d.updated_at
          FROM disputes d
          JOIN transactions t ON t.id = d.transaction_id
         WHERE t.merchant_id = $1
           ${statusFilter ? 'AND d.status = $2' : ''}
         ORDER BY d.created_at DESC`
      params = statusFilter ? [principalId, statusFilter] : [principalId]
    } else {
      query = `
        SELECT d.id, d.transaction_id, d.raised_by, d.reason_code, d.description,
               d.status, d.evidence_url, d.resolved_by, d.resolved_at,
               d.resolution_notes, d.created_at, d.updated_at
          FROM disputes d
         WHERE d.raised_by = 'CONSUMER'
           AND EXISTS (
             SELECT 1 FROM transactions t
              WHERE t.id = d.transaction_id
                AND t.consumer_id = $1
           )
           ${statusFilter ? 'AND d.status = $2' : ''}
         ORDER BY d.created_at DESC`
      params = statusFilter ? [principalId, statusFilter] : [principalId]
    }

    const { rows } = await db.query(query, params)

    return res.json({ disputes: rows, total: rows.length })
  } catch (err: unknown) {
    logger.error('Failed to list disputes', { error: (err as Error).message, principalId, isMerchant })
    return res.status(500).json({ error: 'Failed to list disputes' })
  }
})

// ─── GET /api/v1/disputes/:id ─────────────────────────────────────────────────
// Fetch a single dispute with a transaction summary.

router.get('/:id', requireMerchantOrConsumer, async (req: Request, res: Response) => {
  const { id } = req.params
  const isMerchant  = !!req.merchant
  const principalId = isMerchant ? req.merchant!.sub : req.consumer!.sub

  try {
    const { rows } = await db.query(
      `SELECT d.id, d.transaction_id, d.raised_by, d.reason_code, d.description,
              d.status, d.evidence_url, d.resolved_by, d.resolved_at,
              d.resolution_notes, d.created_at, d.updated_at,
              t.amount_cents, t.status AS transaction_status,
              t.merchant_id, t.consumer_id
         FROM disputes d
         JOIN transactions t ON t.id = d.transaction_id
        WHERE d.id = $1`,
      [id]
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Dispute not found' })
    }

    const dispute = rows[0]

    // Enforce scoped access
    const authorized = isMerchant
      ? dispute.merchant_id === principalId
      : dispute.consumer_id === principalId || dispute.raised_by === 'CONSUMER'

    if (!authorized) {
      return res.status(404).json({ error: 'Dispute not found' })
    }

    // Strip internal FK columns before returning
    const { merchant_id: _merchantId, consumer_id: _consumerId, ...publicDispute } = dispute
    return res.json(publicDispute)
  } catch (err: unknown) {
    logger.error('Failed to fetch dispute', { error: (err as Error).message, id, principalId })
    return res.status(500).json({ error: 'Failed to fetch dispute' })
  }
})

// ─── PATCH /api/v1/admin/disputes/:id ─────────────────────────────────────────
// ─── Admin: PATCH /api/v1/admin/disputes/:id ──────────────────────────────────
// Separate router mounted at /api/v1/admin/disputes in index.ts.
// Uses X-Admin-Secret auth, not a JWT role claim (no ADMIN JWT issuer exists).

const RESOLVED_STATUSES = new Set([
  'RESOLVED_MERCHANT_FAVOR',
  'RESOLVED_CONSUMER_FAVOR',
  'CLOSED',
])

export const adminDisputeRouter = Router()

adminDisputeRouter.patch(
  '/:id',
  requireAdmin,
  validate(adminUpdateSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params
    const { status, resolutionNotes } = req.body

    // requireAdmin uses X-Admin-Secret, not JWT, so there may be no Authorization header.
    const authHeader = req.headers.authorization
    const payload = authHeader?.startsWith('Bearer ')
      ? (jwt.decode(authHeader.slice(7)) as { sub?: string } | null)
      : null
    const adminSub = payload?.sub ?? null

    const isResolution = RESOLVED_STATUSES.has(status)

    try {
      const { rows: existing } = await db.query(
        `SELECT id FROM disputes WHERE id = $1`,
        [id]
      )

      if (existing.length === 0) {
        return res.status(404).json({ error: 'Dispute not found' })
      }

      const { rows: updated } = await db.query(
        `UPDATE disputes
            SET status           = $2,
                resolution_notes = COALESCE($3, resolution_notes),
                resolved_by      = CASE WHEN $4 THEN $5 ELSE resolved_by END,
                resolved_at      = CASE WHEN $4 THEN NOW() ELSE resolved_at END,
                updated_at       = NOW()
          WHERE id = $1
          RETURNING *`,
        [id, status, resolutionNotes ?? null, isResolution, adminSub]
      )

      logger.info('Dispute updated by admin', { disputeId: id, status, adminSub })

      return res.json(updated[0])
    } catch (err: unknown) {
      logger.error('Failed to update dispute', { error: (err as Error).message, id, status })
      return res.status(500).json({ error: 'Failed to update dispute' })
    }
  }
)

export default router

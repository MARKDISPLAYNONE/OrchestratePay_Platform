import { Router, Request, Response } from 'express'
import Joi from 'joi'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { logger } from '../util/logger'
import { initiateB2cPayout } from '../integrations/daraja'

const router = Router()

const createRefundSchema = Joi.object({
  transactionId: Joi.string().uuid().required(),
  amountCents:   Joi.number().integer().min(100).max(10_000_000).required(),
  reason:        Joi.string().max(500).required(),
})

const adminRefundSchema = Joi.object({
  action: Joi.string().valid('APPROVE', 'REJECT').required(),
  notes:  Joi.string().max(500).optional(),
})

// POST /api/v1/refunds
router.post('/', requireAuth, validate(createRefundSchema), async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { transactionId, amountCents, reason } = req.body

  try {
    const { rows: txnRows } = await db.query(
      `SELECT id, merchant_id, amount_cents, status FROM transactions WHERE id = $1`,
      [transactionId]
    )

    if (txnRows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' })
    }

    const txn = txnRows[0]

    if (txn.merchant_id !== merchantId) {
      return res.status(404).json({ error: 'Transaction not found' })
    }

    if (txn.status !== 'CONFIRMED') {
      return res.status(422).json({ error: 'Only CONFIRMED transactions can be refunded' })
    }

    if (amountCents > txn.amount_cents) {
      return res.status(422).json({ error: 'Refund amount exceeds transaction amount' })
    }

    const { rows: dupRows } = await db.query(
      `SELECT id FROM refunds
        WHERE transaction_id = $1
          AND status NOT IN ('REJECTED', 'FAILED')`,
      [transactionId]
    )

    if (dupRows.length > 0) {
      return res.status(409).json({ error: 'A refund already exists for this transaction' })
    }

    const refundId = uuidv4()

    await db.query(
      `INSERT INTO refunds
         (id, transaction_id, merchant_id, amount_cents, reason, status, initiated_by)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', 'MERCHANT')`,
      [refundId, transactionId, merchantId, amountCents, reason]
    )

    logger.info('Refund created', { refundId, transactionId, merchantId, amountCents })

    return res.status(201).json({
      refundId,
      status: 'PENDING',
      amountCents,
      transactionId,
    })
  } catch (err: unknown) {
    logger.error('Failed to create refund', { error: (err as Error).message, transactionId, merchantId })
    return res.status(500).json({ error: 'Failed to create refund' })
  }
})

// GET /api/v1/refunds
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const page  = Math.max(1, parseInt(req.query.page  as string, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20))
  const offset = (page - 1) * limit

  try {
    const { rows } = await db.query(
      `SELECT r.id, r.transaction_id, r.amount_cents, r.reason, r.status,
              r.initiated_by, r.b2c_request_id, r.b2c_receipt, r.notes,
              r.created_at, r.updated_at,
              t.mpesa_receipt
         FROM refunds r
         JOIN transactions t ON t.id = r.transaction_id
        WHERE r.merchant_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3`,
      [merchantId, limit, offset]
    )

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS total FROM refunds WHERE merchant_id = $1`,
      [merchantId]
    )

    return res.json({
      refunds: rows,
      total:   parseInt(countRows[0].total, 10),
      page,
      limit,
    })
  } catch (err: unknown) {
    logger.error('Failed to list refunds', { error: (err as Error).message, merchantId })
    return res.status(500).json({ error: 'Failed to list refunds' })
  }
})

// GET /api/v1/refunds/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { id } = req.params

  try {
    const { rows } = await db.query(
      `SELECT r.id, r.transaction_id, r.amount_cents, r.reason, r.status,
              r.initiated_by, r.b2c_request_id, r.b2c_receipt, r.approved_by,
              r.notes, r.created_at, r.updated_at,
              t.mpesa_receipt
         FROM refunds r
         JOIN transactions t ON t.id = r.transaction_id
        WHERE r.id = $1 AND r.merchant_id = $2`,
      [id, merchantId]
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Refund not found' })
    }

    return res.json(rows[0])
  } catch (err: unknown) {
    logger.error('Failed to fetch refund', { error: (err as Error).message, id, merchantId })
    return res.status(500).json({ error: 'Failed to fetch refund' })
  }
})

// PATCH /api/v1/admin/refunds/:id
router.patch('/refunds/:id', requireRole('ADMIN'), validate(adminRefundSchema), async (req: Request, res: Response) => {
  const { id } = req.params
  const { action, notes } = req.body

  try {
    const { rows } = await db.query(
      `SELECT * FROM refunds WHERE id = $1`,
      [id]
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Refund not found' })
    }

    const refund = rows[0]

    if (action === 'REJECT') {
      const { rows: updated } = await db.query(
        `UPDATE refunds
            SET status = 'REJECTED', notes = $2, updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [id, notes ?? null]
      )
      logger.info('Refund rejected', { refundId: id, notes })
      return res.json(updated[0])
    }

    // action === 'APPROVE'
    await db.query(
      `UPDATE refunds SET status = 'APPROVED', updated_at = NOW() WHERE id = $1`,
      [id]
    )

    // Look up the consumer's phone number from the original transaction.
    const { rows: txnRows } = await db.query(
      `SELECT c.phone
         FROM transactions t
         JOIN consumers c ON c.id = t.consumer_id
        WHERE t.id = $1`,
      [refund.transaction_id]
    )
    const consumerPhone = txnRows[0]?.phone

    try {
      const b2cResult = await initiateB2cPayout({
        refundId:       refund.id,
        merchantId:     refund.merchant_id,
        amountCents:    refund.amount_cents,
        recipientPhone: consumerPhone ?? '',
      })

      const { rows: updated } = await db.query(
        `UPDATE refunds
            SET status = 'PROCESSING', b2c_request_id = $2, updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [id, b2cResult.requestId]
      )
      logger.info('Refund B2C payout initiated', { refundId: id, requestId: b2cResult.requestId })
      return res.json(updated[0])
    } catch (b2cErr: unknown) {
      const { rows: failed } = await db.query(
        `UPDATE refunds
            SET status = 'FAILED', notes = $2, updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [id, `B2C payout failed: ${(b2cErr as Error).message}`]
      )
      logger.error('Refund B2C payout failed', { refundId: id, error: (b2cErr as Error).message })
      return res.status(502).json({ error: 'B2C payout failed', refund: failed[0] })
    }
  } catch (err: unknown) {
    logger.error('Failed to process refund action', { error: (err as Error).message, id, action })
    return res.status(500).json({ error: 'Failed to process refund' })
  }
})

export default router

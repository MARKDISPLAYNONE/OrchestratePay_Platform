/**
 * routes/settlement.ts — Merchant settlement endpoints.
 *
 * Merchants register where they want money sent (M-Pesa or bank account),
 * then view their settlement history. Settlement batches are created nightly
 * by jobs/settlement.ts.
 */
import { Router, Request, Response } from 'express'
import Joi from 'joi'
import { db } from '../db/index'
import { logger } from '../util/logger'
import { requireAuth } from '../middleware/auth'
import { requireAdmin } from './admin'
import { validate } from '../middleware/validate'

const router = Router()

const settlementAccountSchema = Joi.object({
  accountType:   Joi.string().valid('MPESA', 'BANK').required(),
  mpesaPhone:    Joi.when('accountType', {
    is:   'MPESA',
    then: Joi.string().pattern(/^(0|254|\+254)[17]\d{8}$/).required()
      .messages({ 'string.pattern.base': 'mpesaPhone must be a valid Safaricom number' }),
    otherwise: Joi.optional(),
  }),
  bankName:      Joi.when('accountType', { is: 'BANK', then: Joi.string().max(100).required() }),
  accountNumber: Joi.when('accountType', { is: 'BANK', then: Joi.string().max(50).required() }),
  accountName:   Joi.when('accountType', { is: 'BANK', then: Joi.string().max(100).required() }),
})

// ─── GET /api/v1/settlements ──────────────────────────────────────────────────
// Lists the authenticated merchant's settlement history.

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const page  = Math.max(1, parseInt(req.query.page  as string) || 1)
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20)
  const offset = (page - 1) * limit

  try {
    const { rows } = await db.query(
      `SELECT
          s.id, s.period_start, s.period_end,
          s.gross_amount_cents, s.fee_cents, s.net_amount_cents,
          s.transaction_count, s.status, s.payout_method,
          s.b2c_receipt, s.failure_reason, s.settled_at, s.created_at,
          sa.account_type, sa.mpesa_phone, sa.bank_name, sa.account_number
        FROM settlements s
        LEFT JOIN settlement_accounts sa ON sa.id = s.settlement_account_id
        WHERE s.merchant_id = $1
        ORDER BY s.created_at DESC
        LIMIT $2 OFFSET $3`,
      [merchantId, limit, offset]
    )

    const { rows: [{ total }] } = await db.query(
      `SELECT COUNT(*) AS total FROM settlements WHERE merchant_id = $1`,
      [merchantId]
    )

    res.json({ settlements: rows, total: parseInt(total), page, limit })
  } catch (err: unknown) {
    logger.error('Failed to fetch settlements', { error: (err as Error).message, merchantId })
    res.status(500).json({ error: 'Failed to fetch settlements' })
  }
})

// ─── GET /api/v1/settlements/account/me ──────────────────────────────────────
// Returns the merchant's primary settlement account.
// MUST be registered before GET /:id so Express doesn't swallow "account" as an id param.

router.get('/account/me', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  try {
    const { rows } = await db.query(
      `SELECT * FROM settlement_accounts
        WHERE merchant_id = $1 AND is_primary = true AND active = true
        LIMIT 1`,
      [merchantId]
    )
    res.json(rows[0] ?? null)
  } catch (_err: unknown) {
    res.status(500).json({ error: 'Failed to fetch settlement account' })
  }
})

// ─── GET /api/v1/settlements/:id ──────────────────────────────────────────────
// Single settlement with its constituent transactions.

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub

  try {
    const { rows } = await db.query(
      `SELECT s.*, sa.account_type, sa.mpesa_phone, sa.bank_name, sa.account_number
         FROM settlements s
         LEFT JOIN settlement_accounts sa ON sa.id = s.settlement_account_id
        WHERE s.id = $1 AND s.merchant_id = $2`,
      [req.params.id, merchantId]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Settlement not found' })

    const { rows: txns } = await db.query(
      `SELECT t.id, t.amount_cents, t.status, t.confirmed_at, t.source
         FROM settlement_transactions st
         JOIN transactions t ON t.id = st.transaction_id
        WHERE st.settlement_id = $1
        ORDER BY t.confirmed_at`,
      [req.params.id]
    )

    res.json({ ...rows[0], transactions: txns })
  } catch (err: unknown) {
    logger.error('Failed to fetch settlement', { error: (err as Error).message })
    res.status(500).json({ error: 'Failed to fetch settlement' })
  }
})

// ─── POST /api/v1/settlements/account ─────────────────────────────────────────
// Registers or replaces the merchant's primary settlement account.

router.post('/account', requireAuth, validate(settlementAccountSchema), async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { accountType, mpesaPhone, bankName, accountNumber, accountName } = req.body

  try {
    // Deactivate any existing primary account first.
    await db.query(
      `UPDATE settlement_accounts
          SET is_primary = false, active = false, updated_at = NOW()
        WHERE merchant_id = $1 AND is_primary = true`,
      [merchantId]
    )

    const { rows } = await db.query(
      `INSERT INTO settlement_accounts
         (merchant_id, account_type, mpesa_phone, bank_name, account_number, account_name, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,true)
       RETURNING *`,
      [merchantId, accountType, mpesaPhone ?? null, bankName ?? null,
       accountNumber ?? null, accountName ?? null]
    )

    logger.info('Settlement account registered', { merchantId, accountType })
    res.status(201).json(rows[0])
  } catch (err: unknown) {
    logger.error('Failed to save settlement account', { error: (err as Error).message, merchantId })
    res.status(500).json({ error: 'Failed to save settlement account' })
  }
})

// ─── Admin: GET /api/v1/admin/settlements ─────────────────────────────────────
export const adminSettlementRouter = Router()

adminSettlementRouter.use(requireAdmin)

adminSettlementRouter.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined
  const limit  = Math.min(200, parseInt(req.query.limit as string) || 50)
  const offset = Math.max(0,   parseInt(req.query.offset as string) || 0)

  try {
    const { rows } = await db.query(
      `SELECT s.*, m.name AS merchant_name, m.email AS merchant_email
         FROM settlements s
         JOIN merchants m ON m.id = s.merchant_id
        WHERE ($1::TEXT IS NULL OR s.status = $1)
        ORDER BY s.created_at DESC
        LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset]
    )
    res.json(rows)
  } catch (_err: unknown) {
    res.status(500).json({ error: 'Failed to fetch settlements' })
  }
})

export default router

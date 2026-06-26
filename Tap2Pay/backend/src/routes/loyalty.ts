import { Router, Request, Response } from 'express'
import { db } from '../db/index'
import { requireAuth } from '../middleware/auth'

const router = Router()

// GET /api/v1/loyalty/balance — consumer's balance at this merchant
router.get('/balance', requireAuth, async (req: Request, res: Response) => {
    const { consumerId } = req.query
    if (!consumerId || typeof consumerId !== 'string') {
        return res.status(400).json({ error: 'consumerId query param required' })
    }

    const { rows } = await db.query(`
        SELECT
          lb.points_balance,
          lb.stamps_balance,
          lb.lifetime_spent_cents,
          lp.programme_type,
          lp.stamps_for_reward,
          lp.reward_description
        FROM loyalty_balances lb
        JOIN loyalty_programmes lp
          ON lp.merchant_id = lb.merchant_id AND lp.active = TRUE
        WHERE lb.consumer_id = $1
          AND lb.merchant_id = $2
    `, [consumerId, req.merchant!.sub])

    if (rows.length === 0) {
        return res.json({
            points_balance: 0,
            stamps_balance: 0,
            lifetime_spent_cents: 0,
            programme_type: null,
        })
    }
    res.json(rows[0])
})

// GET /api/v1/merchants/me/loyalty — merchant's programme config
router.get('/programme', requireAuth, async (req: Request, res: Response) => {
    const { rows } = await db.query(
        `SELECT * FROM loyalty_programmes WHERE merchant_id=$1`,
        [req.merchant!.sub]
    )
    res.json(rows[0] ?? null)
})

// POST /api/v1/merchants/me/loyalty — create or update programme
router.post('/programme', requireAuth, async (req: Request, res: Response) => {
    const { programme_type, points_per_ksh, stamps_for_reward, reward_description } = req.body

    if (!['POINTS', 'STAMPS'].includes(programme_type)) {
        return res.status(400).json({ error: 'programme_type must be POINTS or STAMPS' })
    }
    if (programme_type === 'POINTS' && !points_per_ksh) {
        return res.status(400).json({ error: 'points_per_ksh required for POINTS programme' })
    }
    if (programme_type === 'STAMPS' && !stamps_for_reward) {
        return res.status(400).json({ error: 'stamps_for_reward required for STAMPS programme' })
    }

    const { rows } = await db.query(`
        INSERT INTO loyalty_programmes
          (merchant_id, programme_type, points_per_ksh, stamps_for_reward, reward_description)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (merchant_id) DO UPDATE SET
          programme_type    = EXCLUDED.programme_type,
          points_per_ksh    = EXCLUDED.points_per_ksh,
          stamps_for_reward = EXCLUDED.stamps_for_reward,
          reward_description = EXCLUDED.reward_description,
          active            = TRUE
        RETURNING *
    `, [req.merchant!.sub, programme_type,
        points_per_ksh ?? null, stamps_for_reward ?? null, reward_description ?? null])

    res.status(201).json(rows[0])
})

// POST /api/v1/loyalty/redeem
router.post('/redeem', requireAuth, async (req: Request, res: Response) => {
    const { consumerId, redeemPoints, redeemStamps } = req.body
    const merchantId = req.merchant!.sub

    if (!consumerId) return res.status(400).json({ error: 'consumerId required' })
    if (!redeemPoints && !redeemStamps) {
        return res.status(400).json({ error: 'redeemPoints or redeemStamps required' })
    }

    const points = parseInt(redeemPoints ?? '0', 10)
    const stamps = parseInt(redeemStamps ?? '0', 10)

    const client = await db.connect()
    try {
        await client.query('BEGIN')

        // Lock the row inside the transaction so concurrent redemptions can't both
        // pass the balance check against the same pre-deduction value (TOCTOU race).
        const { rows: balRows } = await client.query(
            `SELECT points_balance, stamps_balance FROM loyalty_balances
             WHERE consumer_id=$1 AND merchant_id=$2
             FOR UPDATE`,
            [consumerId, merchantId]
        )
        if (balRows.length === 0) {
            await client.query('ROLLBACK')
            client.release()
            return res.status(404).json({ error: 'No loyalty account found' })
        }

        const bal = balRows[0]
        if (points > bal.points_balance) {
            await client.query('ROLLBACK')
            client.release()
            return res.status(409).json({ error: 'Insufficient points' })
        }
        if (stamps > bal.stamps_balance) {
            await client.query('ROLLBACK')
            client.release()
            return res.status(409).json({ error: 'Insufficient stamps' })
        }

        await client.query(`
            UPDATE loyalty_balances SET
              points_balance = points_balance - $1,
              stamps_balance = stamps_balance - $2
            WHERE consumer_id=$3 AND merchant_id=$4
        `, [points, stamps, consumerId, merchantId])

        await client.query(`
            INSERT INTO loyalty_ledger
              (consumer_id, merchant_id, event_type, points_delta, stamps_delta, description)
            VALUES ($1,$2,'REDEEM',$3,$4,$5)
        `, [consumerId, merchantId, -points, -stamps,
            `Redemption: ${points > 0 ? `${points} points` : `${stamps} stamps`}`])

        await client.query('COMMIT')
        res.json({ ok: true })
    } catch (err) {
        await client.query('ROLLBACK')
        throw err
    } finally {
        client.release()
    }
})

export default router

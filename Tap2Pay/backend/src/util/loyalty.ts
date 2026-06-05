/**
 * loyalty.ts — Point and stamp accrual on CONFIRMED payments.
 *
 * Called from mpesa-callback.ts inside the same DB transaction that flips the
 * payment to CONFIRMED. If this throws, the caller must ROLLBACK — but per
 * skill invariant #2, we catch internally so a loyalty failure never rolls
 * back the payment itself.
 */
import { Pool } from 'pg'
import { logger } from './logger'

export async function awardLoyaltyPoints(
    txnId:       string,
    merchantId:  string,
    consumerId:  string,
    amountCents: number,
    db:          Pool
): Promise<{ pointsDelta: number; stampsDelta: number } | null> {
    const prog = await db.query(
        `SELECT * FROM loyalty_programmes WHERE merchant_id=$1 AND active=TRUE`,
        [merchantId]
    )
    if (prog.rows.length === 0) return null

    const programme = prog.rows[0]
    let pointsDelta = 0
    let stampsDelta = 0

    if (programme.programme_type === 'POINTS') {
        const kshSpent = amountCents / 100
        pointsDelta = Math.floor(kshSpent * Number(programme.points_per_ksh))
    } else if (programme.programme_type === 'STAMPS') {
        stampsDelta = 1
    }

    if (pointsDelta === 0 && stampsDelta === 0) return null

    try {
        await db.query(`
            INSERT INTO loyalty_balances
              (consumer_id, merchant_id, points_balance, stamps_balance, lifetime_spent_cents)
            VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (consumer_id, merchant_id) DO UPDATE SET
              points_balance       = loyalty_balances.points_balance       + EXCLUDED.points_balance,
              stamps_balance       = loyalty_balances.stamps_balance       + EXCLUDED.stamps_balance,
              lifetime_spent_cents = loyalty_balances.lifetime_spent_cents + EXCLUDED.lifetime_spent_cents
        `, [consumerId, merchantId, pointsDelta, stampsDelta, amountCents])

        await db.query(`
            INSERT INTO loyalty_ledger
              (consumer_id, merchant_id, transaction_id, event_type, points_delta, stamps_delta, description)
            VALUES ($1,$2,$3,'EARN',$4,$5,$6)
        `, [consumerId, merchantId, txnId, pointsDelta, stampsDelta,
            `Earned on KSh ${(amountCents / 100).toFixed(2)} payment`])

        return { pointsDelta, stampsDelta }
    } catch (err) {
        // Loyalty failure must not affect payment confirmation
        logger.error('Loyalty accrual failed', { txnId, consumerId, err })
        return null
    }
}

export async function isRepeatCustomer(
    consumerId: string,
    merchantId: string,
    db:         Pool
): Promise<boolean> {
    const { rows } = await db.query(`
        SELECT 1 FROM loyalty_balances
        WHERE consumer_id=$1 AND merchant_id=$2 AND lifetime_spent_cents > 0
        LIMIT 1
    `, [consumerId, merchantId])
    return rows.length > 0
}

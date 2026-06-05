/**
 * util/latency-tracker.ts — Tap-to-confirmation latency budget tracker.
 *
 * Persists per-transaction latency segments to the payment_latency table.
 * Exposes getLatencyStats() for the admin dashboard and parseTapTimestamp()
 * for route handlers to extract the X-Tap-Timestamp header sent by Android.
 *
 * Latency budget targets (world-class):
 *   API round trip:        < 500ms
 *   Daraja dispatch:       < 1,000ms
 *   STK confirmation:      < 3,500ms median
 *   Total tap-to-confirm:  < 5,000ms median, < 10,000ms p95
 *
 * All operations are fire-and-forget — a failure here never blocks a payment.
 */
import { db }     from '../db/index'
import { logger } from './logger'

export interface LatencyRecord {
  txnId:            string
  apiRoundTripMs:   number | null
  darajaDispatchMs: number | null
  stkConfirmMs:     number | null
  totalMs:          number | null
  source:           string
}

export async function recordLatency(record: LatencyRecord): Promise<void> {
  try {
    await db.query(
      `INSERT INTO payment_latency
         (txn_id, api_round_trip_ms, daraja_dispatch_ms, stk_confirm_ms, total_ms, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (txn_id) DO UPDATE SET
         stk_confirm_ms = EXCLUDED.stk_confirm_ms,
         total_ms       = EXCLUDED.total_ms`,
      [
        record.txnId,
        record.apiRoundTripMs,
        record.darajaDispatchMs,
        record.stkConfirmMs,
        record.totalMs,
        record.source,
      ]
    )
  } catch (err: any) {
    logger.warn('Latency record insert failed', { error: err.message, txnId: record.txnId })
  }
}

export async function getLatencyStats(windowHours = 24): Promise<{
  p50TotalMs:          number | null
  p95TotalMs:          number | null
  p99TotalMs:          number | null
  avgApiRoundTripMs:   number | null
  avgDarajaDispatchMs: number | null
  avgStkConfirmMs:     number | null
  sampleCount:         number
}> {
  try {
    const { rows } = await db.query(
      `SELECT
         PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY total_ms)::FLOAT AS p50,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_ms)::FLOAT AS p95,
         PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY total_ms)::FLOAT AS p99,
         AVG(api_round_trip_ms)::FLOAT                                  AS avg_api,
         AVG(daraja_dispatch_ms)::FLOAT                                 AS avg_daraja,
         AVG(stk_confirm_ms)::FLOAT                                     AS avg_stk,
         COUNT(*)::INT                                                   AS sample_count
       FROM payment_latency
       WHERE created_at > NOW() - ($1 || ' hours')::INTERVAL
         AND total_ms IS NOT NULL`,
      [windowHours]
    )
    const r = rows[0] ?? {}
    return {
      p50TotalMs:          r.p50         ? Math.round(r.p50)        : null,
      p95TotalMs:          r.p95         ? Math.round(r.p95)        : null,
      p99TotalMs:          r.p99         ? Math.round(r.p99)        : null,
      avgApiRoundTripMs:   r.avg_api     ? Math.round(r.avg_api)    : null,
      avgDarajaDispatchMs: r.avg_daraja  ? Math.round(r.avg_daraja) : null,
      avgStkConfirmMs:     r.avg_stk     ? Math.round(r.avg_stk)    : null,
      sampleCount:         r.sample_count ?? 0,
    }
  } catch (err: any) {
    logger.warn('Latency stats query failed', { error: err.message })
    return {
      p50TotalMs: null, p95TotalMs: null, p99TotalMs: null,
      avgApiRoundTripMs: null, avgDarajaDispatchMs: null, avgStkConfirmMs: null,
      sampleCount: 0,
    }
  }
}

/**
 * Parses the X-Tap-Timestamp header (ms since epoch) sent by the Android app.
 * Returns null if absent, non-numeric, or implausibly far in the future.
 */
export function parseTapTimestamp(header: string | undefined): number | null {
  if (!header) return null
  const ms = parseInt(header, 10)
  if (isNaN(ms)) return null
  const now = Date.now()
  // Reject timestamps more than 5 minutes old or in the future
  if (ms > now + 10_000 || ms < now - 300_000) return null
  return ms
}

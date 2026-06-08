/**
 * routes/fx.ts — Exchange rate endpoints.
 *
 * Public:
 *   GET  /api/v1/fx/rates           — current rates for all supported currencies
 *
 * Admin-only:
 *   POST /api/v1/admin/fx/rates/refresh  — force-refresh from OpenExchangeRates
 *
 * Rates are stored in exchange_rates (base=KES) and are refreshed automatically
 * by the hourly cron in index.ts. These endpoints exist for the web dashboard
 * to display current FX context and for ops to force an out-of-cycle refresh.
 */
import { Router, Request, Response, NextFunction } from 'express'
import { getAllRates, refreshAllRates, SUPPORTED_CURRENCIES } from '../util/fx'
import { logger } from '../util/logger'
import { writeAuditLog } from '../util/audit'

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

const router = Router()

// ─── GET /api/v1/fx/rates ────────────────────────────────────────────────────

router.get('/rates', async (_req: Request, res: Response) => {
  try {
    const rates = await getAllRates()

    // Annotate which currencies have no rate on record yet
    const ratesByCurrency = new Map(rates.map(r => [r.currency, r]))
    const supported = SUPPORTED_CURRENCIES.filter(c => c !== 'KES').map(ccy => {
      const r = ratesByCurrency.get(ccy)
      if (r) return r
      return { currency: ccy, rate: null, source: null, fetchedAt: null, ageMinutes: null }
    })

    res.json({
      base:       'KES',
      currencies: supported,
      kes:        { currency: 'KES', rate: 1, source: 'fixed', fetchedAt: null, ageMinutes: 0 },
    })
  } catch (err: any) {
    logger.error('GET /fx/rates failed', { error: err.message })
    res.status(500).json({ error: 'Could not retrieve exchange rates' })
  }
})

// ─── POST /api/v1/admin/fx/rates/refresh ─────────────────────────────────────
// Exported separately so index.ts can mount it under /api/v1/admin/fx

export const adminFxRouter = Router()

adminFxRouter.post('/rates/refresh', requireAdmin, async (req: Request, res: Response) => {
  try {
    const count = await refreshAllRates()
    logger.info('Admin-triggered FX rate refresh', { count })
    await writeAuditLog({
      event:  'ADMIN_ACTION',
      detail: { action: 'fx_rates_refresh', ratesRefreshed: count },
      ip:     req.ip,
    })
    res.json({ ok: true, ratesRefreshed: count })
  } catch (err: any) {
    logger.error('Admin FX refresh failed', { error: err.message })
    res.status(500).json({ error: 'Rate refresh failed' })
  }
})

export default router

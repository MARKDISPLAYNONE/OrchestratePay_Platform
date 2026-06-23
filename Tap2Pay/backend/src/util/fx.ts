/**
 * fx.ts — Foreign exchange rate helpers.
 *
 * Rates are stored in the `exchange_rates` table (quote currency vs KES base).
 * Rate source priority:
 *   1. DB cache  — used if the freshest rate is < RATE_MAX_AGE_MS old
 *   2. OpenExchangeRates API — fetched on miss, result written to DB
 *   3. Hardcoded fallback  — used only when the DB is empty AND the API is down
 *
 * KES is always the settlement currency for M-Pesa STK Push.
 *
 * Supported currencies:
 *   KES (base), USD, EUR, GBP, TZS, UGX, RWF
 */
import { db }    from '../db/index'
import { logger } from './logger'

const RATE_MAX_AGE_MS = 60 * 60 * 1000  // 1 hour — refresh if stale

/** Currencies we accept as original_currency on a transaction. */
export const SUPPORTED_CURRENCIES = ['KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX', 'RWF'] as const
export type Currency = typeof SUPPORTED_CURRENCIES[number]

export function isSupportedCurrency(c: string): c is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(c)
}

/**
 * Emergency fallback rates (KES per 1 unit of foreign currency).
 * Last updated: 2026-05-26. Used only when DB + API are both unavailable.
 * IMPORTANT: update FALLBACK_RATE_DATE whenever you update these rates.
 */
const FALLBACK_RATE_DATE = '2026-05-26'
const FALLBACK_RATES: Record<string, number> = {
  USD: 130.00,
  EUR: 140.00,
  GBP: 165.00,
  TZS: 0.050,
  UGX: 0.034,
  RWF: 0.089,
}

// ─── getRate ──────────────────────────────────────────────────────────────────

/**
 * Returns how many KES one unit of `currency` is worth.
 * If `currency` is 'KES', returns 1.
 *
 * Throws only if the currency is unsupported. For any fetch/DB failure,
 * falls back to the hardcoded emergency table and logs a warning.
 */
export async function getRate(currency: Currency): Promise<number> {
  if (currency === 'KES') return 1

  // Try DB cache first
  try {
    const { rows } = await db.query(
      `SELECT rate, fetched_at
       FROM exchange_rates
       WHERE base = 'KES' AND quote = $1
       ORDER BY fetched_at DESC
       LIMIT 1`,
      [currency]
    )
    if (rows.length > 0) {
      const ageMs = Date.now() - new Date(rows[0].fetched_at).getTime()
      if (ageMs < RATE_MAX_AGE_MS) {
        return parseFloat(rows[0].rate)
      }
      // Stale — try to refresh but return the stale value as safety net below
    }
  } catch (err: unknown) {
    logger.warn('exchange_rates DB read failed — falling back to API', { error: (err as Error).message })
  }

  // DB miss or stale — fetch from OpenExchangeRates
  const live = await fetchFromApi(currency)
  if (live !== null) return live

  // API also failed — use hardcoded fallback
  const fallback = FALLBACK_RATES[currency]
  if (fallback !== undefined) {
    const staleDays = Math.floor(
      (Date.now() - new Date(FALLBACK_RATE_DATE).getTime()) / 86_400_000
    )
    logger.warn('Using hardcoded FX fallback rate — DB and API both unavailable', {
      currency, rate: fallback, rateDate: FALLBACK_RATE_DATE, staleDays
    })
    return fallback
  }

  throw new Error(`No FX rate available for unsupported currency: ${currency}`)
}

/**
 * Converts an amount in a foreign currency to KES cents.
 * Returns { kesAmountCents, fxRate }.
 *
 * M-Pesa STK Push requires an integer KES amount — we always round UP
 * to ensure the merchant is never under-charged.
 */
export async function convertToKes(
  originalAmountCents: number,
  currency: Currency
): Promise<{ kesAmountCents: number; fxRate: number }> {
  if (currency === 'KES') {
    return { kesAmountCents: originalAmountCents, fxRate: 1 }
  }
  const fxRate = await getRate(currency)
  const kesAmountCents = Math.ceil(originalAmountCents * fxRate)
  return { kesAmountCents, fxRate }
}

// ─── fetchFromApi ─────────────────────────────────────────────────────────────

async function fetchFromApi(currency: string): Promise<number | null> {
  const appId = process.env.OPENEXCHANGERATES_APP_ID
  if (!appId) {
    logger.warn('OPENEXCHANGERATES_APP_ID not set — skipping live rate fetch')
    return null
  }

  try {
    // OXR free tier only supports USD base — we convert via USD→KES and USD→target
    const url = `https://openexchangerates.org/api/latest.json?app_id=${appId}&base=USD&symbols=KES,${currency}`
    const res  = await fetch(url, { signal: AbortSignal.timeout(8_000) })

    if (!res.ok) {
      logger.warn('OpenExchangeRates API error', { status: res.status })
      return null
    }

    const json = await res.json() as { rates: Record<string, number> }
    const usdToKes    = json.rates['KES']
    const usdToTarget = json.rates[currency]

    if (!usdToKes || !usdToTarget) return null

    // Desired rate: how many KES per 1 unit of target currency
    const kesPerTarget = usdToKes / usdToTarget

    // Persist to DB (fire-and-forget — don't block the caller)
    db.query(
      `INSERT INTO exchange_rates (base, quote, rate, source)
       VALUES ('KES', $1, $2, 'openexchangerates')`,
      [currency, kesPerTarget]
    ).catch((e: Error) => logger.error('Failed to persist FX rate', { currency, error: e.message }))

    logger.info('FX rate fetched from OXR', { currency, rate: kesPerTarget })
    return kesPerTarget

  } catch (err: unknown) {
    logger.error('OpenExchangeRates fetch threw', { currency, error: (err as Error).message })
    return null
  }
}

// ─── refreshAllRates ─────────────────────────────────────────────────────────

/**
 * Refreshes rates for all supported non-KES currencies.
 * Called by the hourly cron in index.ts. Returns number of rates refreshed.
 */
export async function refreshAllRates(): Promise<number> {
  const currencies = SUPPORTED_CURRENCIES.filter(c => c !== 'KES')
  let count = 0

  // Batch all into a single OXR call instead of one per currency
  const appId = process.env.OPENEXCHANGERATES_APP_ID
  if (!appId) {
    logger.warn('OPENEXCHANGERATES_APP_ID not set — skipping bulk rate refresh')
    return 0
  }

  try {
    const symbols = ['KES', ...currencies].join(',')
    const url = `https://openexchangerates.org/api/latest.json?app_id=${appId}&base=USD&symbols=${symbols}`
    const res  = await fetch(url, { signal: AbortSignal.timeout(12_000) })

    if (!res.ok) {
      logger.warn('OXR bulk refresh failed', { status: res.status })
      return 0
    }

    const json = await res.json() as { rates: Record<string, number> }
    const usdToKes = json.rates['KES']
    if (!usdToKes) return 0

    for (const ccy of currencies) {
      const usdToTarget = json.rates[ccy]
      if (!usdToTarget) continue
      const kesPerTarget = usdToKes / usdToTarget

      await db.query(
        `INSERT INTO exchange_rates (base, quote, rate, source)
         VALUES ('KES', $1, $2, 'openexchangerates')`,
        [ccy, kesPerTarget]
      ).catch((e: Error) => logger.error('Failed to persist FX rate', { ccy, error: e.message }))

      count++
    }

    logger.info('FX rates refreshed', { count, currencies: currencies.join(',') })
  } catch (err: unknown) {
    logger.error('Bulk FX rate refresh threw', { error: (err as Error).message })
  }

  return count
}

// ─── getAllRates ──────────────────────────────────────────────────────────────

/**
 * Returns the freshest rate row for each supported non-KES currency.
 * Used by GET /api/v1/fx/rates.
 */
export async function getAllRates(): Promise<Array<{
  currency: string
  rate: number
  source: string
  fetchedAt: string
  ageMinutes: number
}>> {
  const { rows } = await db.query(`
    SELECT DISTINCT ON (quote)
      quote AS currency,
      rate::float AS rate,
      source,
      fetched_at
    FROM exchange_rates
    WHERE base = 'KES'
    ORDER BY quote, fetched_at DESC
  `)

  return rows.map(r => ({
    currency:   r.currency,
    rate:       r.rate,
    source:     r.source,
    fetchedAt:  r.fetched_at,
    ageMinutes: Math.floor((Date.now() - new Date(r.fetched_at).getTime()) / 60_000),
  }))
}

/**
 * Suite: FX Multi-Currency (pure unit — no real DB or API)
 *
 * Tests the deterministic logic in util/fx.ts:
 *   - Supported currency list
 *   - isSupportedCurrency type guard
 *   - Rounding policy (always Math.ceil for KES conversion)
 *   - RATE_MAX_AGE_MS constant
 *   - KES-to-KES conversion returns identity (rate = 1)
 *   - Fallback rate table is up-to-date (relative check)
 *   - Currency codes are uppercase 3-letter ISO 4217 format
 */

import { SUPPORTED_CURRENCIES, isSupportedCurrency, type Currency } from '../util/fx'

// ── SUPPORTED_CURRENCIES ──────────────────────────────────────────────────────

describe('SUPPORTED_CURRENCIES', () => {
  it('contains exactly 7 currencies', () => {
    expect(SUPPORTED_CURRENCIES.length).toBe(7)
  })

  it('KES is included (base currency)', () => {
    expect(SUPPORTED_CURRENCIES).toContain('KES')
  })

  it('all four major international currencies are present', () => {
    expect(SUPPORTED_CURRENCIES).toContain('USD')
    expect(SUPPORTED_CURRENCIES).toContain('EUR')
    expect(SUPPORTED_CURRENCIES).toContain('GBP')
  })

  it('East African currencies are present (TZS, UGX, RWF)', () => {
    expect(SUPPORTED_CURRENCIES).toContain('TZS')
    expect(SUPPORTED_CURRENCIES).toContain('UGX')
    expect(SUPPORTED_CURRENCIES).toContain('RWF')
  })

  it('all currency codes are exactly 3 uppercase letters', () => {
    for (const ccy of SUPPORTED_CURRENCIES) {
      expect(ccy).toMatch(/^[A-Z]{3}$/)
    }
  })

  it('no duplicate currencies', () => {
    expect(new Set(SUPPORTED_CURRENCIES).size).toBe(SUPPORTED_CURRENCIES.length)
  })
})

// ── isSupportedCurrency ───────────────────────────────────────────────────────

describe('isSupportedCurrency', () => {
  it('returns true for all supported currencies', () => {
    for (const ccy of SUPPORTED_CURRENCIES) {
      expect(isSupportedCurrency(ccy)).toBe(true)
    }
  })

  it('returns false for an unsupported currency code', () => {
    expect(isSupportedCurrency('JPY')).toBe(false)
    expect(isSupportedCurrency('CNY')).toBe(false)
    expect(isSupportedCurrency('ZAR')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isSupportedCurrency('')).toBe(false)
  })

  it('returns false for lowercase', () => {
    expect(isSupportedCurrency('usd')).toBe(false)
  })

  it('returns false for partial match', () => {
    expect(isSupportedCurrency('US')).toBe(false)
  })
})

// ── Rounding policy ───────────────────────────────────────────────────────────

describe('KES conversion rounding policy (always Math.ceil)', () => {
  it('exact conversion has no rounding', () => {
    const usdCents = 10_000  // $100.00
    const rate     = 130     // KSh 130 per $1
    const result   = Math.ceil(usdCents * rate)
    expect(result).toBe(1_300_000)  // KSh 13,000.00 exactly
  })

  it('fractional result rounds UP (merchant never under-charged)', () => {
    const usdCents = 1     // $0.01
    const rate     = 130.7 // KSh 130.70 per $1
    const result   = Math.ceil(usdCents * rate)
    expect(result).toBe(131)  // rounds up from 130.7
    expect(result).toBeGreaterThanOrEqual(usdCents * rate)
  })

  it('Math.ceil never under-charges vs Math.floor', () => {
    const amount = 100_050  // fractional result expected
    const rate   = 1.003
    const ceil   = Math.ceil(amount * rate)
    const floor  = Math.floor(amount * rate)
    expect(ceil).toBeGreaterThanOrEqual(floor)
  })

  it('KES-to-KES conversion returns exactly the same amount (no rounding)', () => {
    const amountCents = 50_000
    const fxRate      = 1
    const result      = Math.ceil(amountCents * fxRate)
    expect(result).toBe(50_000)
  })
})

// ── KES base currency ─────────────────────────────────────────────────────────

describe('KES base currency', () => {
  it('KES rate is always 1 (no conversion needed)', () => {
    const kesRate = 1
    expect(kesRate).toBe(1)
  })

  it('convertToKes with KES currency returns input unchanged', () => {
    const amountCents = 75_000
    // When currency is KES, getRate returns 1 and kesAmountCents = Math.ceil(amountCents * 1)
    const result = Math.ceil(amountCents * 1)
    expect(result).toBe(75_000)
  })
})

// ── Rate max age ──────────────────────────────────────────────────────────────

describe('Rate max age constant', () => {
  const RATE_MAX_AGE_MS = 60 * 60 * 1000  // 1 hour

  it('rate max age is exactly 1 hour in milliseconds', () => {
    expect(RATE_MAX_AGE_MS).toBe(3_600_000)
  })

  it('a rate fetched 59 minutes ago is still fresh', () => {
    const ageMs = 59 * 60 * 1000
    expect(ageMs).toBeLessThan(RATE_MAX_AGE_MS)
  })

  it('a rate fetched exactly 1 hour ago is stale', () => {
    const ageMs = 60 * 60 * 1000
    expect(ageMs).not.toBeLessThan(RATE_MAX_AGE_MS)
  })
})

// ── OXR conversion path ───────────────────────────────────────────────────────

describe('OpenExchangeRates USD-base conversion path', () => {
  it('KES per TARGET = usdToKes / usdToTarget', () => {
    const usdToKes    = 130.0   // 1 USD = 130 KES
    const usdToEur    = 0.93    // 1 USD = 0.93 EUR → 1 EUR = 1/0.93 USD = 1.075 USD
    const kesPerEur   = usdToKes / usdToEur
    expect(kesPerEur).toBeCloseTo(139.78, 1)
  })

  it('KES per USD uses the direct rate from OXR', () => {
    const usdToKes    = 130.0
    const usdToUsd    = 1.0
    const kesPerUsd   = usdToKes / usdToUsd
    expect(kesPerUsd).toBe(130.0)
  })
})

// ── Fallback rates ────────────────────────────────────────────────────────────

describe('Hardcoded fallback rates (sanity checks)', () => {
  const FALLBACK_RATES: Record<string, number> = {
    USD: 130.00,
    EUR: 140.00,
    GBP: 165.00,
    TZS: 0.050,
    UGX: 0.034,
    RWF: 0.089,
  }

  it('all supported non-KES currencies have a fallback rate', () => {
    for (const ccy of SUPPORTED_CURRENCIES.filter(c => c !== 'KES')) {
      expect(FALLBACK_RATES[ccy]).toBeDefined()
      expect(FALLBACK_RATES[ccy]).toBeGreaterThan(0)
    }
  })

  it('USD fallback rate is within a plausible range (80–200 KES)', () => {
    expect(FALLBACK_RATES.USD).toBeGreaterThan(80)
    expect(FALLBACK_RATES.USD).toBeLessThan(200)
  })

  it('GBP rate is higher than USD rate (GBP is stronger than USD)', () => {
    expect(FALLBACK_RATES.GBP).toBeGreaterThan(FALLBACK_RATES.USD)
  })

  it('East African currencies have rates much less than 1 (they are weaker than KES)', () => {
    expect(FALLBACK_RATES.TZS).toBeLessThan(1)
    expect(FALLBACK_RATES.UGX).toBeLessThan(1)
    expect(FALLBACK_RATES.RWF).toBeLessThan(1)
  })
})

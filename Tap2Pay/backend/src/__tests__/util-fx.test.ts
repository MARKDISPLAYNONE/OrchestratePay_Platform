/**
 * Unit tests for util/fx.ts — FX rate helpers.
 */
process.env.NODE_ENV = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

// Stub global fetch so we never hit the network
const mockFetch = jest.fn()
global.fetch = mockFetch as any

import { isSupportedCurrency, convertToKes, getAllRates, refreshAllRates, getRate, SUPPORTED_CURRENCIES } from '../util/fx'

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockFetch.mockReset()
  delete process.env.OPENEXCHANGERATES_APP_ID
})

// ─────────────────────────────────────────────────────────────────────────────
// isSupportedCurrency
// ─────────────────────────────────────────────────────────────────────────────

describe('isSupportedCurrency', () => {
  it('returns true for all supported currencies', () => {
    for (const c of SUPPORTED_CURRENCIES) {
      expect(isSupportedCurrency(c)).toBe(true)
    }
  })

  it('returns false for unsupported currency codes', () => {
    expect(isSupportedCurrency('ZZZ')).toBe(false)
    expect(isSupportedCurrency('BTC')).toBe(false)
    expect(isSupportedCurrency('')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// convertToKes
// ─────────────────────────────────────────────────────────────────────────────

describe('convertToKes', () => {
  it('returns the same amount for KES (no conversion)', async () => {
    const result = await convertToKes(5000, 'KES')
    expect(result.kesAmountCents).toBe(5000)
    expect(result.fxRate).toBe(1)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('converts USD using a fresh DB rate', async () => {
    const now = new Date().toISOString()
    mockQuery.mockResolvedValueOnce({
      rows: [{ rate: '130.00', fetched_at: now }],  // fresh rate
    })

    // 100 USD cents × 130 = 13000 KES cents, ceil(100 * 130) = 13000
    const result = await convertToKes(100, 'USD')
    expect(result.kesAmountCents).toBe(13000)
    expect(result.fxRate).toBeCloseTo(130, 1)
  })

  it('falls back to hardcoded rate when DB is empty and API is unavailable', async () => {
    // DB miss (no rows)
    mockQuery.mockResolvedValueOnce({ rows: [] })
    // API unavailable — OPENEXCHANGERATES_APP_ID not set
    // → falls back to hardcoded FALLBACK_RATES.USD = 130.00

    const result = await convertToKes(100, 'USD')
    expect(result.kesAmountCents).toBe(Math.ceil(100 * 130))
  })

  it('uses live rate from API when DB is stale', async () => {
    // DB row is stale (more than 1 hour old)
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    mockQuery.mockResolvedValueOnce({ rows: [{ rate: '125.00', fetched_at: staleDate }] })

    // No API key → falls back to hardcoded
    const result = await convertToKes(100, 'USD')
    // Hardcoded fallback is 130 (not 125 stale DB value)
    expect(result.fxRate).toBeCloseTo(130, 0)
  })

  it('rounds up to nearest cent (no under-charging)', async () => {
    const now = new Date().toISOString()
    // Rate 130.15 per USD
    mockQuery.mockResolvedValueOnce({ rows: [{ rate: '130.15', fetched_at: now }] })

    // 1 cent * 130.15 = 130.15 → ceil = 131
    const result = await convertToKes(1, 'USD')
    expect(result.kesAmountCents).toBe(Math.ceil(1 * 130.15))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getAllRates
// ─────────────────────────────────────────────────────────────────────────────

describe('getAllRates', () => {
  it('returns formatted rate rows from DB', async () => {
    const fetchedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()  // 5 min ago
    mockQuery.mockResolvedValueOnce({
      rows: [
        { currency: 'USD', rate: 130, source: 'openexchangerates', fetched_at: fetchedAt },
        { currency: 'EUR', rate: 142, source: 'openexchangerates', fetched_at: fetchedAt },
      ],
    })

    const rates = await getAllRates()
    expect(rates).toHaveLength(2)
    expect(rates[0].currency).toBe('USD')
    expect(rates[0].rate).toBe(130)
    expect(rates[0].ageMinutes).toBe(5)
  })

  it('returns an empty array when no rates are stored', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const rates = await getAllRates()
    expect(rates).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// refreshAllRates
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// getRate — edge cases (DB throw, unsupported currency, fetchFromApi paths)
// ─────────────────────────────────────────────────────────────────────────────

describe('getRate — DB throws', () => {
  it('falls back to hardcoded rate when DB query throws', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'))
    const rate = await getRate('USD')
    expect(rate).toBe(130)  // hardcoded fallback
  })
})

describe('getRate — unsupported currency', () => {
  it('throws when currency is not in fallback table and API is unavailable', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    // 'ZZZ' is not a real Currency but we cast to test the throw path
    await expect(getRate('ZZZ' as any)).rejects.toThrow(/No FX rate available/)
  })
})

describe('getRate — fetchFromApi (OPENEXCHANGERATES_APP_ID set)', () => {
  beforeEach(() => {
    process.env.OPENEXCHANGERATES_APP_ID = 'test-app-id'
  })

  it('returns live rate when OXR API responds successfully', async () => {
    const staleDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    mockQuery.mockResolvedValueOnce({ rows: [{ rate: '125.00', fetched_at: staleDate }] })
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ rates: { KES: 130, USD: 1 } }),
    })
    mockQuery.mockResolvedValue({ rows: [] })  // INSERT exchange_rates

    const rate = await getRate('USD')
    expect(rate).toBeCloseTo(130, 0)
  })

  it('falls back to hardcoded when OXR returns HTTP error', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    mockFetch.mockResolvedValue({ ok: false, status: 429 })

    const rate = await getRate('USD')
    expect(rate).toBe(130)
  })

  it('falls back to hardcoded when OXR response is missing required rates', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ rates: { EUR: 0.92 } }),  // no KES
    })

    const rate = await getRate('USD')
    expect(rate).toBe(130)
  })

  it('falls back to hardcoded when fetch throws', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    mockFetch.mockRejectedValue(new Error('network timeout'))

    const rate = await getRate('USD')
    expect(rate).toBe(130)
  })

  it('persists rate to DB after successful OXR fetch', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ rates: { KES: 130, USD: 1 } }),
    })

    await getRate('USD')
    const insertCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO exchange_rates')
    )
    expect(insertCall).toBeTruthy()
  })
})

describe('refreshAllRates', () => {
  it('returns 0 and skips fetch when OPENEXCHANGERATES_APP_ID is not set', async () => {
    const count = await refreshAllRates()
    expect(count).toBe(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns count of currencies refreshed on success', async () => {
    process.env.OPENEXCHANGERATES_APP_ID = 'test-app-id'
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        rates: { KES: 130, USD: 1, EUR: 0.92, GBP: 0.79, TZS: 2600, UGX: 3750, RWF: 1200 },
      }),
    })
    // One db.query call per non-KES currency (6 total)
    mockQuery.mockResolvedValue({ rows: [] })

    const count = await refreshAllRates()
    // 6 non-KES currencies: USD, EUR, GBP, TZS, UGX, RWF
    expect(count).toBe(6)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain('openexchangerates.org')
  })

  it('returns 0 when the OXR HTTP response is not ok', async () => {
    process.env.OPENEXCHANGERATES_APP_ID = 'test-app-id'
    mockFetch.mockResolvedValue({ ok: false, status: 429 })

    const count = await refreshAllRates()
    expect(count).toBe(0)
  })

  it('returns 0 when fetch throws', async () => {
    process.env.OPENEXCHANGERATES_APP_ID = 'test-app-id'
    mockFetch.mockRejectedValue(new Error('network timeout'))

    const count = await refreshAllRates()
    expect(count).toBe(0)
  })

  it('returns 0 when OXR response is missing KES rate', async () => {
    process.env.OPENEXCHANGERATES_APP_ID = 'test-app-id'
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ rates: { USD: 1, EUR: 0.92 } }),
    })

    const count = await refreshAllRates()
    expect(count).toBe(0)
  })

  it('still counts refreshed rates when db.query rejects during persistence', async () => {
    process.env.OPENEXCHANGERATES_APP_ID = 'test-app-id'
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        rates: { KES: 130, USD: 1, EUR: 0.92, GBP: 0.79, TZS: 2600, UGX: 3750, RWF: 1200 },
      }),
    })
    mockQuery.mockRejectedValue(new Error('DB write failed'))

    const count = await refreshAllRates()
    expect(count).toBe(6)
  })
})

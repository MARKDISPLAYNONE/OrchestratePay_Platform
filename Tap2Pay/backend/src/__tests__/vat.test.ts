/**
 * Suite: KRA VAT calculations (util/vat.ts)
 *
 * Kenya standard VAT rate: 16%
 * All amounts in integer cents (KSh × 100) — no floating-point money.
 *
 * Formula for back-calculating VAT from a VAT-inclusive amount:
 *   vatCents = floor( totalCents × (rate / (1 + rate)) )
 *   netCents = totalCents - vatCents
 *
 * KRA prescribes floor (truncation) — not round, not ceil.
 */

import { vatFromInclusive, netFromInclusive, vatBreakdown, VAT_RATE } from '../util/vat'

// ── Constants ─────────────────────────────────────────────────────────────────

describe('VAT_RATE constant', () => {
  it('standard Kenya VAT rate is 16%', () => {
    expect(VAT_RATE).toBe(0.16)
  })

  it('rate is expressed as a decimal fraction, not a percentage', () => {
    expect(VAT_RATE).toBeLessThan(1)
  })
})

// ── vatFromInclusive ──────────────────────────────────────────────────────────

describe('vatFromInclusive', () => {
  it('KSh 116.00 inclusive → KSh 16.00 VAT', () => {
    // 11600 × (0.16 / 1.16) = 11600 × 0.13793... = 1600
    expect(vatFromInclusive(11_600)).toBe(1_600)
  })

  it('KSh 100.00 inclusive → KSh 13.79 VAT (floor truncation)', () => {
    // 10000 × (0.16 / 1.16) = 1379.31... → floor = 1379
    expect(vatFromInclusive(10_000)).toBe(1_379)
  })

  it('KSh 500.00 inclusive → correct VAT', () => {
    // 50000 × (0.16 / 1.16) = 6896.55... → floor = 6896
    expect(vatFromInclusive(50_000)).toBe(6_896)
  })

  it('KSh 1.00 (100 cents) inclusive → VAT is 13 cents (floor)', () => {
    // 100 × (0.16/1.16) = 13.79 → floor = 13
    expect(vatFromInclusive(100)).toBe(13)
  })

  it('KSh 0.00 → zero VAT', () => {
    expect(vatFromInclusive(0)).toBe(0)
  })

  it('uses floor (truncation) not round — KRA prescribed rule', () => {
    // For any amount where the fractional cent > 0, floor is strictly less than ceil
    const amount = 10_001
    const vat = vatFromInclusive(amount)
    const exact = amount * (VAT_RATE / (1 + VAT_RATE))
    expect(vat).toBe(Math.floor(exact))
    expect(vat).toBeLessThanOrEqual(Math.ceil(exact))
  })

  it('accepts a custom rate (e.g. 0% for exempt goods)', () => {
    expect(vatFromInclusive(10_000, 0)).toBe(0)
  })

  it('custom rate 8% (e.g. reduced rate)', () => {
    // 10000 × (0.08 / 1.08) = 740.74 → floor = 740
    expect(vatFromInclusive(10_000, 0.08)).toBe(740)
  })
})

// ── netFromInclusive ──────────────────────────────────────────────────────────

describe('netFromInclusive', () => {
  it('KSh 116.00 inclusive → KSh 100.00 net', () => {
    expect(netFromInclusive(11_600)).toBe(10_000)
  })

  it('KSh 100.00 inclusive → KSh 86.21 net', () => {
    // 10000 - 1379 = 8621
    expect(netFromInclusive(10_000)).toBe(8_621)
  })

  it('net + VAT always equals total (no missing cents)', () => {
    const amounts = [100, 999, 10_000, 50_000, 100_000, 1_234_567]
    for (const total of amounts) {
      const vat = vatFromInclusive(total)
      const net = netFromInclusive(total)
      expect(net + vat).toBe(total)
    }
  })

  it('zero total → zero net', () => {
    expect(netFromInclusive(0)).toBe(0)
  })

  it('net is always less than total for positive VAT rate', () => {
    expect(netFromInclusive(10_000)).toBeLessThan(10_000)
  })
})

// ── vatBreakdown ──────────────────────────────────────────────────────────────

describe('vatBreakdown', () => {
  it('returns all four fields', () => {
    const result = vatBreakdown(11_600)
    expect(result).toHaveProperty('totalCents')
    expect(result).toHaveProperty('vatCents')
    expect(result).toHaveProperty('netCents')
    expect(result).toHaveProperty('vatRate')
  })

  it('totalCents matches input', () => {
    expect(vatBreakdown(50_000).totalCents).toBe(50_000)
  })

  it('vatRate reflects the applied rate', () => {
    expect(vatBreakdown(50_000).vatRate).toBe(VAT_RATE)
    expect(vatBreakdown(50_000, 0.08).vatRate).toBe(0.08)
  })

  it('netCents + vatCents = totalCents', () => {
    const { totalCents, vatCents, netCents } = vatBreakdown(50_000)
    expect(netCents + vatCents).toBe(totalCents)
  })

  it('KSh 500.00 receipt breakdown is correct', () => {
    const b = vatBreakdown(50_000)
    expect(b.totalCents).toBe(50_000)
    expect(b.vatCents).toBe(6_896)
    expect(b.netCents).toBe(43_104)
    expect(b.vatRate).toBe(0.16)
  })

  it('zero-rate breakdown has no VAT', () => {
    const b = vatBreakdown(10_000, 0)
    expect(b.vatCents).toBe(0)
    expect(b.netCents).toBe(10_000)
  })
})

// ── Integer arithmetic (no floating-point errors) ─────────────────────────────

describe('Integer-only arithmetic', () => {
  it('all outputs are integers (no fractional cents)', () => {
    const amounts = [1, 99, 100, 1_001, 50_000, 999_999]
    for (const total of amounts) {
      expect(Number.isInteger(vatFromInclusive(total))).toBe(true)
      expect(Number.isInteger(netFromInclusive(total))).toBe(true)
      const b = vatBreakdown(total)
      expect(Number.isInteger(b.vatCents)).toBe(true)
      expect(Number.isInteger(b.netCents)).toBe(true)
    }
  })

  it('does not introduce floating-point drift at large amounts (KSh 10,000)', () => {
    const total = 1_000_000_00  // KSh 1,000,000 in cents
    const { vatCents, netCents, totalCents } = vatBreakdown(total)
    expect(netCents + vatCents).toBe(totalCents)
  })
})

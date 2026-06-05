/**
 * vat.ts — KRA VAT calculations for Kenya standard rate (16%).
 *
 * All amounts are in integer cents (KSh × 100) to avoid floating-point errors.
 * The platform collects VAT-inclusive amounts, so we back-calculate the VAT portion.
 */

export const VAT_RATE = 0.16  // 16% standard rate

/**
 * Back-calculate VAT from a VAT-inclusive amount.
 * Formula: vatCents = totalCents × (rate / (1 + rate))
 * Integer floor matches KRA's prescribed truncation rule.
 */
export function vatFromInclusive(totalCents: number, rate = VAT_RATE): number {
    return Math.floor(totalCents * (rate / (1 + rate)))
}

/**
 * Net (excl. VAT) from inclusive total.
 */
export function netFromInclusive(totalCents: number, rate = VAT_RATE): number {
    return totalCents - vatFromInclusive(totalCents, rate)
}

/**
 * Returns a breakdown object for receipt printing and fiscal log.
 */
export function vatBreakdown(totalCents: number, rate = VAT_RATE) {
    const vatCents = vatFromInclusive(totalCents, rate)
    return {
        totalCents,
        vatCents,
        netCents: totalCents - vatCents,
        vatRate:  rate,
    }
}

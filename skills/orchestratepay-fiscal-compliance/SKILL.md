---
name: orchestratepay-fiscal-compliance
description: >
  Build KRA (Kenya Revenue Authority) fiscal compliance into OrchestratePay.
  Covers VAT calculation (16% standard rate), KRA eTIMS/TIMS invoice signing,
  ETR (Electronic Tax Register) receipt format, KRA PIN validation, VSCU
  (Virtual Sales Control Unit) integration, and CBK audit retention.
  Use this skill for: VAT on receipts, KRA eTIMS API integration, ETR-compliant
  receipt printing, tax invoice generation, KRA PIN management, fiscal device
  registration, and VAT remittance reporting.
---

# OrchestratePay — Fiscal Compliance (KRA eTIMS / ETR)

## Kenya tax context

| Term | Meaning |
|------|---------|
| KRA | Kenya Revenue Authority — the tax collector |
| eTIMS | Electronic Tax Invoice Management System — KRA's cloud fiscal API |
| TIMS | Older hardware-based fiscal device standard (being replaced by eTIMS) |
| ETR | Electronic Tax Register — a device/software certified to issue tax invoices |
| VSCU | Virtual Sales Control Unit — software ETR (no physical device required) |
| VAT | 16% standard rate in Kenya (as of 2024) |
| KRA PIN | Merchant's unique tax identifier (format: PXXXXXXXXX) |

## VAT calculation

```typescript
const VAT_RATE = 0.16  // 16% Kenya standard rate

interface VatBreakdown {
  amountBeforeVat: number   // in cents
  vatAmountCents:  number
  totalCents:      number
  vatRate:         number   // 0.16
}

function calculateVat(totalCents: number): VatBreakdown {
  // M-Pesa charges VAT-inclusive — back-calculate the exclusive amount
  // Formula: exclusive = inclusive / (1 + rate)
  const amountBeforeVat = Math.round(totalCents / (1 + VAT_RATE))
  const vatAmountCents  = totalCents - amountBeforeVat
  return { amountBeforeVat, vatAmountCents, totalCents, vatRate: VAT_RATE }
}
```

## KRA eTIMS VSCU integration

KRA's eTIMS VSCU is a REST API that signs every invoice with a unique control unit number.

```typescript
// POST https://etims-api.kra.go.ke/etims-api/insertTrnsSaleRcptInfo
interface EtimsInvoice {
  invcNo:    string   // your internal invoice number
  trdrInvcNo: string  // trader's own invoice reference
  rcptTyCd:  'S'      // S = Sale, R = Refund
  pmtTyCd:   'MFS'   // Mobile Financial Service (M-Pesa)
  totTaxblAmt: number // VAT-exclusive amount in KSh (not cents)
  totTax:      number // VAT amount in KSh
  totAmt:      number // Total (inclusive) in KSh
  itemList: Array<{
    itemSeq:    number
    itemCd:     string  // item code from your product catalogue
    itemClsCd:  string  // KRA item classification code
    itemNm:     string
    qty:        number
    prc:        number  // unit price ex-VAT
    taxTyCd:    'A'     // A = 16% VAT
    totAmt:     number
  }>
}

async function signWithEtims(invoice: EtimsInvoice, kraPin: string): Promise<string> {
  const response = await fetch('https://etims-api.kra.go.ke/etims-api/insertTrnsSaleRcptInfo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'tin':   kraPin,
      'bhfId': process.env.KRA_BHF_ID!,  // Branch Head Office ID from KRA registration
      'cmcKey': process.env.KRA_CMC_KEY!, // Communication Management Console key
    },
    body: JSON.stringify(invoice)
  })
  const data = await response.json()
  if (data.resultCd !== '000') throw new Error(`eTIMS error: ${data.resultMsg}`)
  return data.data.rcptSign  // The control unit signature to print on the receipt
}
```

## ETR-compliant receipt format

A KRA-compliant receipt must include:

```
MAMA NGINA BUTCHERY
KRA PIN: P051234567X
eTIMS Serial: VSCU-00123

Date: 25 May 2026  14:32:07
Invoice #: INV-20260525-0042

ITEMS:
  Beef (1kg)      KSh  600.00

Taxable Amount:   KSh  517.24
VAT (16%):        KSh   82.76
                 ───────────
TOTAL:            KSh  600.00

M-Pesa Ref:       QHR7K2X4M9
Control Unit:     XXXXXXXXXXXXXXXX   ← eTIMS signature
QR Code:          [scannable for KRA verification]

Powered by OrchestratePay
```

## Android — ETR receipt printing

```kotlin
// Extend SunmiPrinterManager.printReceipt() to include VAT breakdown
data class VatBreakdown(
    val amountBeforeVatCents: Long,
    val vatCents: Long,
    val totalCents: Long
)

fun calculateVat(totalCents: Long): VatBreakdown {
    val beforeVat = (totalCents * 100 / 116).let { Math.round(it.toDouble()).toLong() }
    return VatBreakdown(beforeVat, totalCents - beforeVat, totalCents)
}

// In renderReceiptBitmap(): add vat breakdown lines between amount and M-Pesa ref
// Only render when kraPin != null (merchant has configured eTIMS)
```

## Backend — KRA PIN storage and validation

```typescript
// KRA PIN format: P + 9 alphanumeric characters (e.g. P051234567X)
const KRA_PIN_REGEX = /^P[0-9]{9}[A-Z]$/

// Stored in merchants.kra_pin (encrypted at rest via Postgres pgcrypto)
// Returned in AuthResponse.kraPin and stored in Android SessionManager

// Validation in merchant registration:
kraPin: Joi.string().pattern(KRA_PIN_REGEX).optional().allow(null)
```

## Backend — fiscal event logging

Every fiscalised invoice must produce a log entry:

```typescript
// New table: fiscal_log
CREATE TABLE fiscal_log (
  id              BIGSERIAL PRIMARY KEY,
  transaction_id  UUID NOT NULL REFERENCES transactions(id),
  kra_pin         VARCHAR(12) NOT NULL,
  invoice_number  VARCHAR(64) NOT NULL,
  etims_signature VARCHAR(256),          -- null if eTIMS call failed
  vat_amount_cents BIGINT NOT NULL,
  total_cents     BIGINT NOT NULL,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retain_until    TIMESTAMPTZ NOT NULL   -- 7 years (CBK + KRA requirement)
)
```

## Graceful degradation

eTIMS is a government API — it has planned and unplanned downtime.

```typescript
try {
  const signature = await signWithEtims(invoice, merchant.kraPin)
  await logFiscalEvent(txnId, signature, vat)
} catch (err) {
  // eTIMS failure MUST NOT block the payment or the receipt.
  // Log the failure for later retry — the transaction is confirmed.
  logger.error('eTIMS submission failed — queued for retry', { txnId, err })
  await queueEtimsRetry(txnId, invoice)
  // Print receipt WITHOUT the control unit signature.
  // KRA allows a grace period for connectivity failures.
}
```

## Key invariants

1. VAT calculation uses back-calculation from inclusive amount (M-Pesa is VAT-inclusive)
2. eTIMS failure never blocks payment confirmation or receipt printing
3. `fiscal_log` is append-only — 7-year retention (CBK + KRA dual requirement)
4. KRA PIN is stored encrypted; never log it in plaintext
5. `pmtTyCd: 'MFS'` is the correct M-Pesa payment type code for eTIMS
6. Only merchants with `kra_pin IS NOT NULL` get eTIMS submission + VAT breakdown on receipt

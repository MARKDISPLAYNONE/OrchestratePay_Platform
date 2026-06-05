---
name: orchestratepay-fx-multicurrency
description: >
  Implement and debug multi-currency FX for OrchestratePay — how foreign currency amounts
  are converted to KES cents for M-Pesa STK Push, the three-tier rate cascade (DB cache →
  OpenExchangeRates API → hardcoded fallback), rounding policy, the hourly refresh cron,
  and the GET /api/v1/fx/rates endpoint. Use this skill when adding a new currency, debugging
  FX rate mismatches, troubleshooting OXR API failures, updating hardcoded fallback rates,
  or implementing dynamic currency conversion at POS.
---

# OrchestratePay — FX & Multi-Currency (`util/fx.ts`, `routes/fx.ts`)

## Settlement currency
M-Pesa STK Push requires an **integer KES amount**. All FX conversion produces KES cents
(integer). The merchant always receives KES regardless of the consumer's payment currency.

## Supported currencies
```typescript
['KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX', 'RWF']
```
`KES` is the base — `getRate('KES')` always returns `1` with no DB or API call.

## Three-tier rate cascade
```
1. DB cache (exchange_rates table)
   └─ if freshest row for this currency is < 1 hour old → use it

2. OpenExchangeRates API (OXR)
   └─ fetched on cache miss or stale; result persisted to DB (fire-and-forget)
   └─ requires OPENEXCHANGERATES_APP_ID env var

3. Hardcoded fallback rates (FALLBACK_RATES in fx.ts)
   └─ only when DB is empty AND API is unavailable
   └─ MUST be updated manually before each major deployment
```

## Rounding policy — always round UP
```typescript
const kesAmountCents = Math.ceil(originalAmountCents * fxRate)
```
The merchant is never under-charged. M-Pesa minimum charge is 1 KSh (100 cents).

## OXR free tier conversion path
OXR free tier only supports USD as base. Conversion is:
```
KES per 1 unit of TARGET = (USD → KES rate) / (USD → TARGET rate)
```
Both rates come from a single API call — not two.

## Rate freshness constant
```typescript
const RATE_MAX_AGE_MS = 60 * 60 * 1000  // 1 hour
```

## Hourly refresh cron
`refreshAllRates()` in `util/fx.ts` is called by a cron in `index.ts`.
It fetches all non-KES currencies in a single OXR API call.

## `GET /api/v1/fx/rates` response shape
```json
[
  { "currency": "USD", "rate": 130.5, "source": "openexchangerates",
    "fetchedAt": "2026-05-28T10:00:00.000Z", "ageMinutes": 12 },
  ...
]
```

## Environment variables
| Variable | Purpose |
|---|---|
| `OPENEXCHANGERATES_APP_ID` | OXR API key; if absent, falls straight to hardcoded fallback |

## Adding a new currency
1. Add to `SUPPORTED_CURRENCIES` array in `util/fx.ts`
2. Add fallback rate to `FALLBACK_RATES`
3. Set `FALLBACK_RATE_DATE` to today
4. DB, OXR refresh, and `getAllRates()` pick it up automatically on next deploy

## Updating hardcoded fallback rates
```
1. Check live rates at xe.com
2. Update FALLBACK_RATES values in util/fx.ts
3. Update FALLBACK_RATE_DATE to today
4. git commit -m "chore: update FX fallback rates YYYY-MM-DD"
```

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| `No FX rate available for unsupported currency` | Currency not in `SUPPORTED_CURRENCIES` | Add to array and deploy |
| Stale fallback rates used indefinitely | `OPENEXCHANGERATES_APP_ID` not set | Set the env var; verify OXR API key is active |
| Merchant overcharged significantly | Using `Math.floor` instead of `Math.ceil` | Always use `Math.ceil` for KES conversion |
| OXR API 401 error | API key inactive or wrong plan | Check OXR dashboard; free tier allows 1,000 calls/month |

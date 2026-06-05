---
name: orchestratepay-accounting-integrations
description: >
  Implement and debug accounting integrations for OrchestratePay merchants — QuickBooks,
  Xero, Sage, Wave, the shared OAuth token refresh pattern, the GL posting job
  (jobs/gl-posting.ts), and how confirmed M-Pesa transactions become journal entries.
  Use this skill when a merchant reports transactions not appearing in their accounting
  software, when a GL posting is stuck in PENDING or FAILED, when OAuth tokens expire,
  when adding a new accounting platform, or when explaining the non-fatal posting design.
---

# OrchestratePay — Accounting Integrations

## Supported platforms
| Platform | File | OAuth | Notes |
|---|---|---|---|
| QuickBooks Online | `integrations/quickbooks.ts` | Yes | `postToQuickBooks`, `refreshQuickBooksToken` |
| Xero | `integrations/xero.ts` | Yes | `postToXero`, `refreshXeroToken` |
| Sage Business Cloud | `integrations/sage.ts` | Yes | `postToSage`, `refreshSageToken` |
| Wave Accounting | `integrations/wave.ts` | No (API key) | `postToWave` |

## GL posting flow
```
Safaricom callback arrives → transaction CONFIRMED
        │
        ▼
mpesa-callback.ts
  enqueueGlPosting(transactionId, merchantId, amountCents, currency, mpesaReceipt, date)
        │
        ▼
INSERT INTO gl_postings (status='PENDING') — one row per active integration
        │
        ▼
jobs/gl-posting.ts  (runs every 2 minutes)
  Drain PENDING rows → call platform-specific postTo*()
  On success: UPDATE gl_postings SET status='POSTED', external_id=...
  On failure: UPDATE gl_postings SET retry_count++
  After 5 failures: UPDATE gl_postings SET status='FAILED' + alert ops
```

## GL posting payload shape
```typescript
interface GlPostingPayload {
  transactionId:  string
  merchantId:     string
  amountCents:    number
  currency:       string
  description:    string   // "OrchestratePay M-Pesa ODE3K5Z8 — KSh 500.00"
  journalDate:    string   // "YYYY-MM-DD"
  mpesaReceipt?:  string
}
```

## Journal entry structure (all platforms)
| Account | Debit/Credit | Meaning |
|---|---|---|
| `MPESA_RECEIVABLE` | Debit | Money owed from Safaricom to the merchant |
| `SALES_REVENUE` | Credit | Revenue recognised from the sale |

VAT treatment uses `util/vat.ts` — check the ETR/eTIMS requirement for Kenyan merchants.

## OAuth token management (QuickBooks, Xero, Sage)
All three use the `refreshOAuthToken()` helper from `integrations/accounting-shared.ts`:
```typescript
const token = await refreshOAuthToken({
  tokenUrl, clientId, clientSecret, refreshToken, platform
})
```
- Tokens are stored in `accounting_integrations.access_token` + `refresh_token`
- If the access token is expired mid-posting, the job refreshes and retries once
- Refresh failure does NOT fail the payment — the posting is retried on the next job run

## Idempotency
The GL posting job is safe to run multiple times:
- `INSERT INTO gl_postings ... ON CONFLICT DO NOTHING` — duplicate enqueue is a no-op
- `external_id` from the accounting platform prevents double-posting the same row
- `status='POSTED'` rows are skipped on subsequent runs

## Max retries
```typescript
const MAX_RETRIES = 5
```
After 5 failures: `status = 'FAILED'`. Operations should:
1. Check the error in `gl_postings.error_message`
2. Rotate the OAuth refresh token if it has been revoked
3. Reset `status = 'PENDING'` and `retry_count = 0` to re-queue

## Adding a new accounting platform
1. Create `integrations/{platform}.ts` exporting `postTo{Platform}(payload): Promise<GlPostingResult>`
2. Add OAuth refresh function following the `refreshOAuthToken()` pattern
3. Import and add a case in the `gl-posting.ts` dispatch switch
4. Add `'{PLATFORM}'` to the `platform` check constraint in the DB migration
5. Add `{PLATFORM}_CLIENT_ID` and `{PLATFORM}_CLIENT_SECRET` to env vars

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| GL posting stuck `PENDING` | GL posting job not running | Check cron schedule in `index.ts` |
| GL posting `FAILED` with 401 | OAuth refresh token revoked | Re-connect integration from merchant dashboard |
| Duplicate journal entries | Platform de-dup by `external_id` failed | Check if same transaction was enqueued twice; `ON CONFLICT` should prevent this |
| No integrations for merchant | `accounting_integrations` has no `ACTIVE` row | Merchant must connect their accounting platform |
| Wave posting fails | API key missing | Wave uses API key, not OAuth — check `WAVE_API_KEY` env var |

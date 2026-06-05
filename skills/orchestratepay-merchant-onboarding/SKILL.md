---
name: orchestratepay-merchant-onboarding
description: >
  Use and maintain the OrchestratePay admin and operations endpoints (routes/admin.ts) —
  the X-Admin-Secret guard, GET /admin/stats (payment health metrics), GET /admin/pending
  (stuck PENDING transactions), GET /admin/circuit (Daraja circuit breaker state), and how
  to onboard a new merchant via the DB. Use this skill when monitoring payment health,
  investigating an outage, checking if Daraja is down, onboarding a merchant, or setting up
  the ADMIN_SECRET for a new deployment.
---

# OrchestratePay — Merchant Onboarding & Admin (`routes/admin.ts`)

## Admin endpoint guard
All `/api/v1/admin/*` routes require the `X-Admin-Secret` header.
Set the shared secret via the `ADMIN_SECRET` environment variable.
```bash
curl -H "X-Admin-Secret: $ADMIN_SECRET" https://api.orchestratepay.co.ke/api/v1/admin/stats
```
A missing or wrong secret returns `403 Forbidden` and logs the IP for audit.

## GET /api/v1/admin/stats
Primary dashboard for payment health. Returns:

| Field | Covers |
|---|---|
| `allTime` | Total transactions by status since DB inception |
| `last24h` | Same, last 24 hours + `successRate` + `timeoutRate` |
| `last7d` | Same, last 7 days |
| `timing` | `avgConfirmMs`, `medianConfirmMs`, `p95ConfirmMs` (CONFIRMED txns, last 7d) |
| `hourly` | Per-hour volume for last 24h (for sparkline charts) |
| `infrastructure` | `{ redis: "ok"|"down", darajaCircuit: "CLOSED"|"OPEN"|"HALF_OPEN" }` |

**Pre-deploy checklist:** run `/admin/stats` against staging and confirm `successRate > 95%`
and `darajaCircuit = CLOSED` before deploying to production.

## GET /api/v1/admin/pending
Lists all transactions currently in `PENDING` status. Useful for:
- Spotting an outage before the reconciliation job runs (every 15 minutes)
- Identifying transactions where STK Push was never sent (`stk_sent = false`)
- Measuring how far behind the reconciliation queue is

```json
{
  "count": 3,
  "transactions": [
    { "id": "...", "amount_cents": 50000, "age_seconds": 87, "merchant_name": "Wanjiku Shop", "stk_sent": true }
  ],
  "note": "Transactions pending > 300s will be picked up by the next reconciliation run"
}
```

## GET /api/v1/admin/circuit
```json
{
  "daraja": "CLOSED",
  "description": "CLOSED = healthy, OPEN = Daraja unreachable, HALF_OPEN = probing after cooldown"
}
```
Check this first when merchants report "payments not working" — if `OPEN`, it's a Daraja
outage, not an application bug.

## Onboarding a new merchant (DB procedure)
Merchants are not yet onboarded via API (Phase 2 feature). Currently done via SQL:
```sql
INSERT INTO merchants (id, name, mpesa_shortcode, mpesa_passkey, phone, email)
VALUES (
  gen_random_uuid(),
  'Merchant Name',
  '174379',              -- Safaricom business shortcode
  'bfb279f9aa9bdbcf...',  -- passkey from Daraja portal
  '254712345678',
  'merchant@example.com'
);
```
After inserting, provide the merchant's `id` so they can log in and generate their JWT.

## PLATFORM_MERCHANT_ID
P2P transactions (`POST /consumers/p2p-pay`) route the STK Push through the platform's
own M-Pesa shortcode (not the payee's). This requires a seeded platform merchant:
```sql
-- Must match PLATFORM_MERCHANT_ID env var
INSERT INTO merchants (id, name, mpesa_shortcode, ...)
VALUES ('00000000-0000-0000-0000-000000000001', 'OrchestratePay Platform', '123456', ...);
```

## Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `ADMIN_SECRET` | Yes | Shared secret for all admin endpoints |
| `PLATFORM_MERCHANT_ID` | Yes (for P2P) | UUID of the platform merchant record for P2P STK routing |

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| All admin endpoints `403` | `ADMIN_SECRET` not set or wrong | Set env var; match what's in request header |
| Stats show all zeros | DB is empty or wrong DB connected | Check `DATABASE_URL`; run migrations |
| Many transactions in `/pending` | Daraja down or circuit OPEN | Check `/admin/circuit`; wait for Daraja recovery |
| P2P payments fail with 503 | `PLATFORM_MERCHANT_ID` not set | Seed platform merchant and set env var |

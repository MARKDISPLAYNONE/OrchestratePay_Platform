# OrchestratePay Subscriptions

Authoritative reference for the recurring subscription subsystem. Covers plan creation, consumer enrollment, trial periods, the billing job cron logic, the state machine, STK Push per enrollee, `next_billing_at` advancement, the trial-expiry job, and the DB schema.

## Overview

Subscriptions let a merchant define a billing plan (amount + interval) and have consumers opt in with their phone number. On each billing cycle the subscription-billing job fires an M-Pesa STK Push to the consumer's phone, creates a `PENDING` transaction row, and advances the enrollment's `next_billing_at`. The reconciliation job (`src/jobs/reconciliation.ts`) handles STK callbacks and status transitions exactly as for one-off payments.

Key files:
- `Tap2Pay/backend/src/routes/subscriptions.ts` — REST API
- `Tap2Pay/backend/src/jobs/subscription-billing.ts` — billing + trial expiry jobs
- `Tap2Pay/backend/src/db/migrations/002_new_features.sql` — `subscription_plans` and `subscriber_enrollments` tables

## Enrollment State Machine

```
[enroll with trialDays=0] ──► ACTIVE
[enroll with trialDays>0] ──► TRIAL ──► ACTIVE  (runTrialExpiry flips at trial_ends_at)
                                          │
                                          ├──► PAUSED   (future — not yet implemented)
                                          │
                                          └──► CANCELLED  (consumer DELETE or merchant action)
```

| State | Billed? | Notes |
|---|---|---|
| `TRIAL` | No | `next_billing_at` is set to end of trial; billing job skips non-ACTIVE rows |
| `ACTIVE` | Yes | Billing job fires STK Push when `next_billing_at <= NOW()` |
| `PAUSED` | No | Schema supports it; no route or job logic implemented yet |
| `CANCELLED` | No | Terminal — consumer or merchant has ended the subscription |

## Database Tables

### `subscription_plans`

Created by `002_new_features.sql`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `uuid_generate_v4()` |
| `merchant_id` | UUID FK → `merchants.id` | Cascade delete |
| `name` | TEXT | Max 100 chars (route-layer Joi validation) |
| `amount_cents` | BIGINT | `> 0` CHECK; route allows 100–1,000,000 |
| `currency` | TEXT | Default `'KES'` |
| `interval` | TEXT | `DAILY\|WEEKLY\|MONTHLY\|QUARTERLY\|ANNUALLY` — CHECK constraint |
| `trial_days` | INTEGER | Default `0`; 0–90 (route validation) |
| `active` | BOOLEAN | Default `TRUE`; soft-delete sets to `FALSE` |
| `created_at` | TIMESTAMPTZ | DB default |

Index: `idx_subscription_plans_merchant ON subscription_plans(merchant_id)`

### `subscriber_enrollments`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `plan_id` | UUID FK → `subscription_plans.id` | `ON DELETE RESTRICT` — prevents plan deletion with enrollments |
| `consumer_phone` | TEXT | E.164 format, 254XXXXXXXXX |
| `status` | TEXT | `ACTIVE\|CANCELLED\|PAUSED\|TRIAL` — CHECK constraint |
| `next_billing_at` | TIMESTAMPTZ | Next time the billing job will charge this consumer |
| `trial_ends_at` | TIMESTAMPTZ | NULL when no trial; set to `NOW() + trialDays * 86400s` at enrollment |
| `enrolled_at` | TIMESTAMPTZ | DB default NOW() |
| `cancelled_at` | TIMESTAMPTZ | NULL until cancelled |

Indexes:
```sql
idx_enrollments_plan      ON subscriber_enrollments(plan_id)
idx_enrollments_next_bill ON subscriber_enrollments(next_billing_at) WHERE status = 'ACTIVE'
idx_enrollments_phone_plan UNIQUE ON subscriber_enrollments(plan_id, consumer_phone)
```

The partial index on `next_billing_at` is the performance-critical one: the billing job queries it on every run. The `UNIQUE` constraint on `(plan_id, consumer_phone)` prevents double-enrollment and surfaces as PostgreSQL error code `23505`.

## Interval → Days Mapping

```typescript
// src/jobs/subscription-billing.ts
const INTERVAL_DAYS: Record<string, number> = {
  DAILY:     1,
  WEEKLY:    7,
  MONTHLY:   30,   // fixed 30 days, not calendar month
  QUARTERLY: 90,
  ANNUALLY:  365,
}
```

MONTHLY uses 30 calendar days (not end-of-month) to keep billing arithmetic predictable — a consumer enrolled on Jan 31 gets billed March 2, not Feb 28.

## `next_billing_at` Calculation at Enrollment

```typescript
// src/routes/subscriptions.ts
function calcNextBillingAt(interval: string, trialDays: number): Date {
  const base = new Date()
  if (trialDays > 0) {
    // First billing fires when the trial ends
    base.setDate(base.getDate() + trialDays)
    return base
  }
  return addInterval(base, interval)   // immediate billing on first cycle
}
```

If `trialDays = 0`, the consumer's `next_billing_at` is set to `NOW() + interval_days`. Their first charge fires on the next billing job run after that date.

If `trialDays > 0`, the enrollment status is `TRIAL` and `next_billing_at` equals the trial end date. The billing job ignores `TRIAL` rows (it filters `WHERE e.status = 'ACTIVE'`). `runTrialExpiry` flips them to `ACTIVE` with `next_billing_at = NOW()`, causing the billing job to charge them on its very next run.

## API Endpoints

### POST /api/v1/subscriptions/plans

Auth: Merchant JWT (`requireAuth`).

Request body:
```json
{ "name": "Monthly Plan", "amountCents": 50000, "interval": "MONTHLY", "trialDays": 7 }
```

Validation (Joi):
- `name`: string, max 100 chars, required
- `amountCents`: integer, 100–1,000,000, required
- `interval`: one of `DAILY|WEEKLY|MONTHLY|QUARTERLY|ANNUALLY`, required
- `trialDays`: integer, 0–90, default 0

Success: 201
```json
{
  "id": "<uuid>",
  "merchantId": "<uuid>",
  "name": "Monthly Plan",
  "amountCents": 50000,
  "interval": "MONTHLY",
  "trialDays": 7,
  "active": true,
  "createdAt": "<iso>"
}
```

### GET /api/v1/subscriptions/plans

Auth: Merchant JWT. Returns all `active = TRUE` plans for the requesting merchant, with a live `subscriberCount` (ACTIVE enrollments only) via a LEFT JOIN + COUNT FILTER aggregate. Newest first.

### DELETE /api/v1/subscriptions/plans/:id

Auth: Merchant JWT. Soft-delete — sets `active = FALSE`. Blocked with 409 if any enrollment in `status = 'ACTIVE'` exists for the plan. The active subscriber count is returned in the 409 body so the merchant knows how many to cancel first.

### POST /api/v1/subscriptions/enroll

Auth: None (public endpoint — consumers self-enroll via QR or shared link).

Request body:
```json
{ "planId": "<uuid>", "consumerPhone": "254700123456" }
```

- `consumerPhone` must match `/^254[0-9]{9}$/`
- Duplicate enrollment (same `planId` + `consumerPhone`) returns 409
- Plan must be `active = TRUE` — returns 404 if not found or inactive

Response 201:
```json
{
  "enrollmentId": "<uuid>",
  "planId": "<uuid>",
  "status": "TRIAL",
  "nextBillingAt": "<iso>",
  "trialEndsAt": "<iso>"     // omitted when trialDays = 0
}
```

### DELETE /api/v1/subscriptions/enroll/:enrollmentId

Auth: None (consumer self-service). The request body must include `consumerPhone` — this is the ownership check (no JWT required but phone must match the enrollment row). Returns 409 if already cancelled.

### GET /api/v1/subscriptions/plans/:id/enrollments

Auth: Merchant JWT. Verifies plan belongs to merchant before returning enrollments. Consumer phones are masked (`254***3456`) in all API responses — the raw phone number never leaves the server.

## Billing Job (`runSubscriptionBillingJob`)

Cron schedule: `* * * * *` (every minute) — registered in `src/index.ts`.

```typescript
// Fetch up to 100 ACTIVE enrollments past their billing date
SELECT e.id, e.consumer_phone, e.next_billing_at,
       p.id, p.merchant_id, p.amount_cents, p.interval, p.name
FROM subscriber_enrollments e
JOIN subscription_plans p ON p.id = e.plan_id
WHERE e.status = 'ACTIVE'
  AND e.next_billing_at <= NOW()
ORDER BY e.next_billing_at ASC
LIMIT 100
```

For each enrollment, the job:

1. Constructs callback URL: `${DARAJA_CALLBACK_BASE_URL}/api/v1/mpesa-callback`
   (falls back to `DARAJA_CALLBACK_URL` if `DARAJA_CALLBACK_BASE_URL` is absent)
2. Calls `stkPush()` from `src/integrations/daraja.ts`
3. **On STK Push failure**: logs a warning, calls `advanceNextBilling()` anyway (to skip to the next cycle rather than hammering a bad phone), increments `failed` counter, continues to next enrollment
4. **On STK Push success**: inserts a `PENDING` transaction row with `source = 'QR_CODE'` (subscription payments piggyback the existing source enum), calls `advanceNextBilling()`, increments `succeeded` counter
5. Logs a summary on completion: `{ processed, succeeded, failed, durationMs }`

Per-enrollment errors are caught individually — one bad enrollment never aborts the whole batch.

### `advanceNextBilling` (internal)

```typescript
async function advanceNextBilling(enrollmentId: string, interval: string): Promise<void> {
  const days = INTERVAL_DAYS[interval] ?? 30
  await db.query(
    `UPDATE subscriber_enrollments
     SET next_billing_at = next_billing_at + ($1 || ' days')::interval
     WHERE id = $2`,
    [days, enrollmentId]
  )
}
```

This advances relative to the *current* `next_billing_at`, not `NOW()`. If the billing job is delayed (e.g., server restart), the next cycle is calculated from the *intended* billing date, not the actual run time — preventing billing drift.

### Amount conversion

STK Push requires the amount in whole KES: `Math.ceil(enrollment.amount_cents / 100)`. A plan for KSh 500.50 (50050 cents) will bill KSh 501.

### Idempotency key

Each billing attempt generates a fresh `uuidv4().replace(/-/g, '')` as the idempotency key. This is intentional — there is no deduplication across retry cycles. If a cycle advances `next_billing_at` but the STK Push was already sent (e.g., on a previous run that crashed before advancing), the consumer could receive two STK Pushes for the same cycle. This edge case is accepted in the current design.

## Trial Expiry Job (`runTrialExpiry`)

Cron schedule: `0 2 * * *` (daily at 02:00 local server time) — registered in `src/index.ts`.

```typescript
UPDATE subscriber_enrollments
SET status = 'ACTIVE',
    next_billing_at = NOW()
WHERE status = 'TRIAL'
  AND trial_ends_at <= NOW()
```

Sets `next_billing_at = NOW()` so the billing job (which runs every minute) picks up the now-active enrollment on its very next run. The consumer's first real charge fires within one minute of trial expiry.

## Phone Masking

All API responses and server logs mask consumer phone numbers:
```typescript
function maskPhone(phone: string): string {
  if (phone.length < 7) return '****'
  return phone.slice(0, 3) + '***' + phone.slice(-4)
  // 254700123456 → 254***3456
}
```

The raw phone number is stored in `subscriber_enrollments.consumer_phone` and used only for STK Push — it is never returned to the merchant.

## Common Failure Modes and Fixes

### 409 on enroll — "Phone number is already enrolled in this plan"

The `UNIQUE` index `idx_enrollments_phone_plan` on `(plan_id, consumer_phone)` prevents duplicate enrollments. PostgreSQL returns error code `23505` which the route maps to 409. A consumer who cancelled and re-enrolls will hit this if the cancelled row still exists — the current design does not reactivate cancelled enrollments. Delete the old row or update its status to `ACTIVE` manually if re-enrollment is needed.

### 409 on plan delete — "Cannot delete plan with active subscribers"

Cancel all active enrollments first (either via the consumer-facing DELETE endpoint or a direct DB update), then retry the plan delete.

### Billing job skips all enrollments

Check that the `status` filter is correct (`WHERE e.status = 'ACTIVE'`). Enrollments stuck in `TRIAL` are normal — verify `trial_ends_at` in the DB and confirm `runTrialExpiry` is scheduled and running.

### STK Push succeeds but transaction never confirms

This is handled by the reconciliation job (`src/jobs/reconciliation.ts`) identically to one-off payments. The `PENDING` transaction row written by the billing job will be queried via Daraja STK Query after 5 minutes and marked `CONFIRMED` or `DECLINED` appropriately.

### `next_billing_at` not advancing

If the server crashed between `stkPush()` and `advanceNextBilling()`, the enrollment's `next_billing_at` remains in the past. The billing job will fire another STK Push on its next run. This results in a double-charge attempt for that cycle. The STK idempotency key is fresh per attempt, so M-Pesa will present two separate prompts to the consumer.

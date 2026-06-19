---
name: orchestratepay-disputes
description: >
  Raise, track, and resolve payment disputes / chargebacks on OrchestratePay.
  Covers who can open a dispute (merchant AND consumer), the five-status state
  machine, all six reason codes, the admin resolution workflow, the one-active-
  dispute-per-transaction rule, and how disputes relate (or don't) to refunds.
  Use this skill when implementing dispute UI, debugging 409 conflicts, wiring
  up the admin review dashboard, or explaining the chargeback flow to support.
---

# OrchestratePay — Disputes / Chargebacks (`routes/disputes.ts`)

## Who can raise a dispute

| Principal | Condition |
|---|---|
| **MERCHANT** | Must hold a valid MERCHANT JWT. The disputed transaction must have `transactions.merchant_id = merchant.sub`. |
| **CONSUMER** | Must hold a valid CONSUMER JWT. The disputed transaction must have `transactions.consumer_id = consumer.sub`. |

Both paths share the `requireMerchantOrConsumer` middleware, which inspects the JWT `role` claim and routes appropriately. Any other role (e.g. ADMIN) is rejected with HTTP 403.

## Dispute state machine

```
                    ┌─────────────────────────┐
                    │           OPEN           │  ← created by merchant or consumer
                    └────────────┬────────────┘
                                 │ admin sets UNDER_REVIEW
                                 ▼
                    ┌─────────────────────────┐
                    │       UNDER_REVIEW       │  ← admin is actively investigating
                    └───────────┬─────────────┘
              ┌─────────────────┼────────────────┐
              ▼                 ▼                ▼
  RESOLVED_MERCHANT_FAVOR  RESOLVED_CONSUMER_FAVOR  CLOSED
  (merchant wins)          (consumer wins/refund)   (dismissed/withdrawn)
```

Valid transitions via `PATCH /api/v1/admin/disputes/:id`:

| From | To (allowed) |
|---|---|
| OPEN | UNDER_REVIEW, CLOSED |
| UNDER_REVIEW | RESOLVED_MERCHANT_FAVOR, RESOLVED_CONSUMER_FAVOR, CLOSED |

The API does not enforce transition guards at the DB level — the admin UI should
prevent illegal transitions; the backend stores whatever status the admin sends.

## Reason codes

| Code | When to use |
|---|---|
| `DUPLICATE_CHARGE` | Consumer or merchant was charged more than once for the same transaction |
| `GOODS_NOT_DELIVERED` | Payment completed but product/service was never delivered |
| `AMOUNT_INCORRECT` | The amount charged differed from the agreed price |
| `UNAUTHORIZED_TRANSACTION` | The transaction was not authorised by the account holder (possible account compromise) |
| `FRAUD` | Suspected fraudulent activity (cloned NFC tag, stolen credentials, etc.) |
| `OTHER` | Any other reason — description field is required to explain |

## One active dispute per transaction

Only one dispute in status `OPEN` or `UNDER_REVIEW` may exist for a given transaction at a time.

If a second dispute is submitted for the same `transaction_id` while one is already active the API returns:

```json
HTTP 409
{ "error": "An active dispute already exists for this transaction", "disputeId": "<existing-id>" }
```

Once the existing dispute reaches a terminal state (`RESOLVED_MERCHANT_FAVOR`, `RESOLVED_CONSUMER_FAVOR`, or `CLOSED`) a new dispute may be raised.

## API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/disputes` | Merchant JWT OR Consumer JWT | Open a new dispute |
| GET | `/api/v1/disputes` | Merchant JWT OR Consumer JWT | List own disputes (scoped by principal) |
| GET | `/api/v1/disputes/:id` | Merchant JWT OR Consumer JWT | Get a single dispute with transaction summary |
| PATCH | `/api/v1/admin/disputes/:id` | Admin JWT (ADMIN role) | Update status / add resolution notes |

## Request / response shapes

### POST /api/v1/disputes

Request body:
```json
{
  "transactionId": "UUID",
  "reasonCode":    "DUPLICATE_CHARGE | GOODS_NOT_DELIVERED | AMOUNT_INCORRECT | UNAUTHORIZED_TRANSACTION | FRAUD | OTHER",
  "description":   "string (10–1000 chars, required)",
  "evidenceUrl":   "https://... (optional)"
}
```

Success response (HTTP 201):
```json
{
  "disputeId":     "UUID",
  "transactionId": "UUID",
  "status":        "OPEN",
  "reasonCode":    "DUPLICATE_CHARGE",
  "createdAt":     "ISO-8601"
}
```

### PATCH /api/v1/admin/disputes/:id

Request body:
```json
{
  "status":          "UNDER_REVIEW | RESOLVED_MERCHANT_FAVOR | RESOLVED_CONSUMER_FAVOR | CLOSED",
  "resolutionNotes": "string (optional, max 2000 chars)"
}
```

When status is a resolution (`RESOLVED_*` or `CLOSED`), the server sets `resolved_by` to the admin's JWT `sub` and stamps `resolved_at = NOW()`.

## Admin resolution workflow

1. Consumer or merchant POSTs a dispute → status `OPEN`.
2. Support agent reviews the evidence (receipt scan, GPS data, STK push log).
3. Agent PATCHes status to `UNDER_REVIEW` — signals active investigation.
4. Agent determines outcome and PATCHes to one of the terminal statuses.
5. If `RESOLVED_CONSUMER_FAVOR` and a refund is warranted, the agent separately creates a refund via `POST /api/v1/refunds` and approves it via `PATCH /api/v1/admin/refunds/:id`.

## Disputes do NOT automatically trigger refunds

Disputes and refunds are separate resources:
- A dispute is a **claim** that something went wrong.
- A refund is a **financial action** (M-Pesa B2C payout).

Resolving a dispute in the consumer's favour (`RESOLVED_CONSUMER_FAVOR`) does **not** automatically initiate a payout. The admin must create and approve a refund explicitly. This separation ensures that:
- Disputes can be raised for investigation without committing to a payout.
- Multiple disputes on one transaction do not result in multiple payouts.
- Finance can approve the refund independently of the dispute outcome.

## DB columns (`disputes` table from migration 002)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Generated server-side (`uuidv4()`) |
| `transaction_id` | UUID FK | References `transactions.id` |
| `raised_by` | TEXT | `'MERCHANT'` or `'CONSUMER'` |
| `reason_code` | TEXT | One of the six reason codes above |
| `description` | TEXT | 10–1000 chars |
| `status` | TEXT | State machine value |
| `evidence_url` | TEXT NULL | Optional URL to uploaded evidence |
| `resolved_by` | TEXT NULL | Admin JWT `sub` set on resolution |
| `resolved_at` | TIMESTAMPTZ NULL | Set when status enters a terminal state |
| `resolution_notes` | TEXT NULL | Admin's closing notes |
| `created_at` | TIMESTAMPTZ | Set on INSERT |
| `updated_at` | TIMESTAMPTZ | Updated on every PATCH |

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| HTTP 403 "Transaction does not belong to this merchant" | merchantId in JWT doesn't match `transactions.merchant_id` | Verify the merchant is calling with their own token |
| HTTP 409 "An active dispute already exists" | OPEN or UNDER_REVIEW dispute already exists | Resolve the existing dispute before opening a new one |
| HTTP 403 "Invalid role for disputes" | ADMIN token used on `/api/v1/disputes` | Admin must use `/api/v1/admin/disputes/:id` to act on disputes |
| HTTP 400 "Validation failed" on description | Description is under 10 characters | Require at least 10 characters in UI validation |
| RESOLVED_* status does not trigger refund | By design — disputes and refunds are separate | Create refund via `POST /api/v1/refunds` after resolving |

---
name: orchestratepay-payment-links
description: >
  Generate, share, and redeem OrchestratePay payment links — how POST /api/v1/payment-links
  creates a shareable short URL, the Redis token storage (payment:link:{token}, 24h TTL),
  the GET resolve endpoint for consumer app deep-links, the POST /pay redemption flow, and
  single-use invalidation. Use this skill when implementing "pay by link" for merchants who
  need to accept remote payments via WhatsApp or SMS, when debugging link expiry, when
  configuring PAYMENT_LINK_BASE_URL, or when a consumer reports a payment link as expired.
---

# OrchestratePay — Payment Links (`routes/payment-links.ts`)

## Use case
A merchant wants to accept payment from a consumer who is not physically present.
They generate a payment link, share it via WhatsApp/SMS, and the consumer's wallet app
(or web browser) handles the rest.

## Flow
```
Merchant calls POST /api/v1/payment-links
  { amountCents: 50000, description: "Invoice #123", singleUse: true }
        │
        ▼
Server stores: Redis SETEX payment:link:{16-char token} 86400 {json}
Returns: { token, url: "https://pay.orchestratepay.co.ke/pay/{token}", expiresAt }
        │
        ▼
Merchant shares URL via WhatsApp
        │
        ▼
Consumer clicks link → wallet app deep-link or web browser
Consumer wallet calls GET /api/v1/payment-links/{token}
  → returns { merchantId, merchantName, amountCents, description, expiresAt }
        │
        ▼
Consumer confirms payment
Consumer wallet calls POST /api/v1/payment-links/{token}/pay
  { consumerPhone: "254712345678", idempotencyKey: "32-char-hex" }
        │
        ▼
If singleUse=true: Redis key deleted immediately (prevents double-pay race)
Transaction record inserted with source='PAYMENT_LINK'
STK Push dispatched to consumer's phone
```

## Token properties
- 16-character hex token (from `uuidv4().replace(/-/g,'').slice(0,16)`)
- Redis key: `payment:link:{token}`
- TTL: 86,400 seconds (24 hours)
- Single-use: token is deleted on first successful redemption when `singleUse=true`

## Idempotency on `/pay`
The pay endpoint accepts a 32-char hex `idempotencyKey`. The server caches the response
in Redis for 24h (`idempotency:{key}`). A retry with the same key returns the cached
`{ txnId, status }` without creating a second transaction.

## Environment variables
| Variable | Purpose |
|---|---|
| `PAYMENT_LINK_BASE_URL` | Base URL for generated links (default: `https://pay.orchestratepay.co.ke`) |

## API endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/payment-links` | Merchant JWT | Create a payment link |
| GET | `/api/v1/payment-links/:token` | None | Resolve link (consumer app) |
| POST | `/api/v1/payment-links/:token/pay` | None | Consumer pays the link |

## Validation rules
- `amountCents`: integer, min 100 (KSh 1), max 100,000,000 (KSh 1,000,000)
- `description`: max 100 characters
- `consumerPhone`: `^254[0-9]{9}$` format
- `idempotencyKey`: 32-char hex string

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| `Payment link not found or expired` (404) | Token expired (> 24h) or already redeemed | Merchant must generate a new link |
| Consumer double-charged | `singleUse=false` and consumer tapped twice | Use `singleUse=true` (default) for all invoice-style links |
| Wrong base URL in link | `PAYMENT_LINK_BASE_URL` not set | Set env var to production domain |
| Link resolves but pay returns 500 | `transactions` table insert failed | Check DB connectivity and schema |

# OrchestratePay Merchant Webhooks

Merchant-facing webhook delivery system. Webhooks let merchants receive real-time HTTP
notifications when payment events occur on their account.

---

## Supported Events

| Event | Trigger |
|---|---|
| `payment.confirmed` | M-Pesa STK Push confirmed by Safaricom callback |
| `payment.failed` | STK Push declined, cancelled, or timed out |
| `refund.completed` | B2C refund has been paid out to the consumer |
| `dispute.opened` | A consumer or merchant has raised a dispute |
| `subscription.charged` | A subscription plan billing cycle has been charged |

### Payload Shape

Every delivery body is a JSON object. The `event` field identifies the type; the
remaining fields vary by event.

```json
// payment.confirmed
{
  "event": "payment.confirmed",
  "txnId": "uuid",
  "amountCents": 150000,
  "currency": "KES",
  "consumerPhone": "254712345678",
  "mpesaReceiptNumber": "PLT7G4KM0P",
  "confirmedAt": "2026-06-15T10:34:00Z"
}

// payment.failed
{
  "event": "payment.failed",
  "txnId": "uuid",
  "amountCents": 150000,
  "currency": "KES",
  "resultCode": 1032,
  "resultDesc": "Request cancelled by user"
}

// refund.completed
{
  "event": "refund.completed",
  "refundId": "uuid",
  "txnId": "uuid",
  "amountCents": 50000,
  "b2cReceipt": "OEI2AK4FPJ"
}

// dispute.opened
{
  "event": "dispute.opened",
  "disputeId": "uuid",
  "txnId": "uuid",
  "raisedBy": "CONSUMER",
  "reasonCode": "DUPLICATE_CHARGE"
}

// subscription.charged
{
  "event": "subscription.charged",
  "enrollmentId": "uuid",
  "planId": "uuid",
  "amountCents": 29900,
  "nextBillingAt": "2026-07-15T00:00:00Z"
}

// ping (sent by POST /webhooks/:id/test)
{
  "event": "ping",
  "timestamp": "2026-06-15T10:00:00Z"
}
```

---

## HMAC-SHA256 Signature Verification

Every delivery includes an `X-Orchestratepay-Signature` header.

**Header format:**
```
X-Orchestratepay-Signature: sha256=<64-char hex digest>
```

**Verification algorithm (Node.js example):**

```typescript
import crypto from 'crypto'

function verifySignature(
  rawBody:   string,   // req.body as raw string — NOT already JSON.parsed
  header:    string,   // req.headers['x-orchestratepay-signature']
  secret:    string    // your webhook secret (saved at registration)
): boolean {
  const expected = 'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  // Constant-time comparison prevents timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(header,   'utf8'),
    Buffer.from(expected, 'utf8')
  )
}
```

**Important:** compute the HMAC over the **raw request body bytes**, not the
parsed/re-serialized object. Middleware that parses JSON before your handler
(e.g. `express.json()`) may reorder keys; capture the raw buffer first:

```typescript
app.post('/webhooks', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8')
  const sig     = req.headers['x-orchestratepay-signature'] as string
  if (!verifySignature(rawBody, sig, process.env.WEBHOOK_SECRET!)) {
    return res.status(401).send('Invalid signature')
  }
  const payload = JSON.parse(rawBody)
  // handle event...
  res.status(200).send('OK')
})
```

---

## Delivery Retry Policy

| Attempt | Outcome on failure | Next state |
|---|---|---|
| 1 (attempt=0→1) | Non-2xx or network error | PENDING, retried |
| 2 (attempt=1→2) | Non-2xx or network error | PENDING, retried |
| 3 (attempt=2→3) | Non-2xx or network error | PENDING, retried |
| 4 (attempt=3→4) | Non-2xx or network error | PENDING, retried |
| 5 (attempt=4→5) | Non-2xx or network error | **FAILED** (terminal) |

- Timeout per attempt: **10 seconds**
- The delivery job runs every 2 minutes (same schedule as GL posting), batch size 50
- On a 2xx response the row is updated to **DELIVERED** and `delivered_at` is recorded
- Non-2xx status codes and network errors (DNS failure, connection reset, timeout) are
  treated identically — the `last_error` column stores the message or `HTTP <status>`
- Failed deliveries are never automatically retried; rotate the webhook if the endpoint
  has been fixed and you want fresh deliveries

---

## How to Register and Test a Webhook

### 1. Register

```http
POST /api/v1/webhooks
Authorization: Bearer <merchant JWT>
Content-Type: application/json

{
  "name":   "Production Payments Hook",
  "url":    "https://yourapp.example.com/api/orchestratepay/events",
  "events": ["payment.confirmed", "payment.failed"]
}
```

**Response 201:**
```json
{
  "id":        "f1111111-...",
  "url":       "https://yourapp.example.com/api/orchestratepay/events",
  "events":    ["payment.confirmed", "payment.failed"],
  "name":      "Production Payments Hook",
  "secret":    "a9f3c2...",      // 64 hex chars — save this, shown ONCE
  "active":    true,
  "createdAt": "2026-06-15T10:00:00Z"
}
```

Store `secret` securely (environment variable or secrets manager). It will never be
returned again.

### 2. Test (send a ping)

```http
POST /api/v1/webhooks/{id}/test
Authorization: Bearer <merchant JWT>
```

**Response 202:**
```json
{ "queued": true }
```

The delivery job will POST `{ "event": "ping", "timestamp": "..." }` to your URL within
~2 minutes. Check delivery status via the deliveries list.

### 3. View delivery history

```http
GET /api/v1/webhooks/{id}/deliveries
Authorization: Bearer <merchant JWT>
```

Returns last 100 delivery attempts ordered newest-first:

```json
{
  "deliveries": [
    {
      "id":          1,
      "event":       "ping",
      "status":      "DELIVERED",
      "attempt":     1,
      "lastError":   null,
      "deliveredAt": "2026-06-15T10:02:05Z",
      "createdAt":   "2026-06-15T10:00:03Z"
    }
  ]
}
```

### 4. Deactivate

```http
DELETE /api/v1/webhooks/{id}
Authorization: Bearer <merchant JWT>
```

Soft-deletes the webhook (sets `active = false`). Returns `{ "id": "...", "active": false }`.

---

## Security

### Secrets are shown once

The `secret` field is returned **only in the 201 response** at creation time. It is
stored hashed server-side and is never returned by GET endpoints. If you lose it, delete
the webhook and re-create it with the same URL — events that were enqueued for the old
webhook will not be re-delivered.

### Rotation procedure

1. Register a new webhook pointing to the same (or a new) URL.
2. Update your application to accept signatures from both the old and new secret during
   the transition window (grace period is your choice).
3. Delete the old webhook.

### Replay protection

Deliveries include a `created_at` timestamp in the payload (via the `ping` event example
shown above) but do not include a nonce. To protect against replay attacks, record the
`id` of each received delivery and reject duplicates within your idempotency window
(recommended: 24 hours).

### IP allowlist

OrchestratePay does not publish a fixed set of egress IPs for webhook deliveries.
Validate deliveries using the HMAC-SHA256 signature instead of IP allowlisting.

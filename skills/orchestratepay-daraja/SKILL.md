---
name: orchestratepay-daraja
description: >
  Implement and debug M-Pesa Daraja integrations for the OrchestratePay platform.
  Covers the full STK Push lifecycle (OAuth token caching, password generation, STK
  Push request, STK Query), M-Pesa callback handling (the four golden rules, ResultCode
  mapping, amount verification, duplicate detection with STK_SENT guard, stkQuery
  post-success verification, raw callback archiving for CBK compliance, async-after-respond
  pattern), circuit breaker (3-state CLOSED/OPEN/HALF_OPEN wrapping all Daraja calls,
  getDarajaCircuitStatus), Safaricom IP allowlist middleware, reconciliation cron job
  (stuck PENDING/STK_SENT transactions, STK Query, EXPIRED state), phone number
  normalisation (254 format), and all known result codes with user-friendly messages.
  Use this skill for: M-Pesa integration, Daraja API calls, callback not arriving,
  transaction stuck in PENDING or STK_SENT, double STK Push, ResultCode handling,
  amount mismatch, stkQuery verification disputes, circuit breaker open, sandbox vs
  production setup, OAuth rate limiting, phone format errors, reconciliation job,
  ngrok callback URL setup, Safaricom IP whitelisting, or "consumer charged but still PENDING".
---

# OrchestratePay — M-Pesa Daraja Integration

## The 8-step STK Push flow

```
1. GET  OAuth token (cache in Redis 3500s)
2. GENERATE password: Base64(shortcode + passkey + YYYYMMDDHHmmss)
3. POST STK Push → Safaricom responds with CheckoutRequestID immediately
4. Consumer sees PIN prompt on phone (60-second window)
5. Consumer approves or cancels
6. Safaricom POSTs callback to your CallBackURL
7. Your server processes callback, updates DB, publishes to Redis pub/sub
8. Android app polling loop picks up the result (or WebSocket delivers it first)
```

Step 3 completing is when the backend sets `status = 'STK_SENT'`. This distinguishes "consumer saw the PIN prompt" from "we haven't sent the push yet" (`PENDING`).

## ╔═══ GOLDEN RULES — violating these causes production incidents ═══╗

### Rule 1: Respond to Safaricom FIRST
```typescript
router.post('/mpesa-callback', async (req, res) => {
    // RESPOND IMMEDIATELY — before any DB or Redis operations
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' })

    // Process asynchronously after response is sent
    try {
        await processCallback(req.body, req.ip)
    } catch (err) {
        logger.error('Callback processing error', { error: err.message })
    }
})
```
Safaricom expects a 200 within **5 seconds**. If you time out, Safaricom retries. Duplicate callbacks for the same `CheckoutRequestID` → duplicate processing → potential double-confirm.

### Rule 2: Archive the raw callback FIRST, before any business logic
```typescript
// In processCallback — first thing after extracting fields
const logRow = await db.query(
    `INSERT INTO daraja_callback_log (remote_ip, checkout_request_id, result_code, raw_body)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [remoteIp, CheckoutRequestID, ResultCode, JSON.stringify(body)]
)
const callbackLogId = logRow.rows[0]?.id ?? null
// Now proceed with business logic — the raw body is safe regardless of what happens next
```
This guarantees CBK compliance: even if downstream processing throws, the raw callback is preserved for the 7-year retention window.

### Rule 3: Check ResultCode BEFORE touching CallbackMetadata
```typescript
if (ResultCode === 0) {
    // CallbackMetadata is ONLY present when ResultCode === 0
    const mpesaReceipt = CallbackMetadata.Item.find(i => i.Name === 'MpesaReceiptNumber')?.Value
    // ...
} else {
    // CallbackMetadata does not exist when ResultCode !== 0
    // Accessing it here throws TypeError: Cannot read properties of undefined
}
```

### Rule 4: Verify amount before confirming
```typescript
const callbackAmount = getItem('Amount') as number
const expectedKsh = Math.ceil(txn.amount_cents / 100)
if (callbackAmount && callbackAmount !== expectedKsh) {
    logger.error('AMOUNT MISMATCH — possible fraud', { txnId, expectedKsh, callbackAmount, remoteIp })
    await markFailed(txn.id, 'Amount mismatch — possible fraud')
    return
}
```

### Rule 5: Idempotency-check the callback against BOTH non-terminal states
```typescript
const isProcessable = txn.status === 'PENDING' || txn.status === 'STK_SENT'
if (!isProcessable) {
    logger.info('Ignoring duplicate callback', { txnId: txn.id, status: txn.status })
    return
}
```
**Critical**: the old guard `txn.status !== 'PENDING'` silently dropped every legitimate callback once step 6 started setting `STK_SENT`. The guard must accept both non-terminal states.

### Rule 6: Verify a claimed-success callback with stkQuery
```typescript
if (ResultCode === 0) {
    const queryResult = await stkQuery(CheckoutRequestID)  // wrapped in circuit breaker

    if (queryResult.resultCode === -1) {
        // Circuit OPEN — cannot reach Daraja; trust IP-filtered callback and proceed
        await db.query(`UPDATE daraja_callback_log SET verified = NULL WHERE id = $1`, [callbackLogId])
    } else if (queryResult.resultCode !== 0) {
        // Daraja disputes the success — mark FAILED and log potential fraud
        logger.error('stkQuery disputes callback success', { txnId, queryResult, remoteIp })
        await markFailed(txn.id, `stkQuery: ${queryResult.resultDesc}`)
        await db.query(`UPDATE daraja_callback_log SET verified = false WHERE id = $1`, [callbackLogId])
        return
    } else {
        // stkQuery confirms — record the verification
        await db.query(`UPDATE daraja_callback_log SET verified = true WHERE id = $1`, [callbackLogId])
    }
}
```

## Circuit breaker — wraps all Daraja calls

All calls to Daraja (OAuth, STK Push, STK Query) go through a circuit breaker. After 3 consecutive failures, the circuit opens for 60 seconds, then moves to HALF_OPEN (one test call). If the test succeeds, it closes.

```typescript
// daraja.ts
export function getDarajaCircuitStatus(): { state: string; failureCount: number } {
    return { state: darajaCircuit.status, failureCount: darajaCircuit.failureCount }
}
```

When the circuit is OPEN:
- `stkQuery` returns `{ resultCode: -1, resultDesc: 'Circuit open' }`
- New STK Pushes are rejected immediately with a 503
- Reconciliation job skips Daraja calls until circuit closes

The circuit status is exposed via `GET /api/v1/admin/health` for monitoring.

## Safaricom IP allowlist middleware

M-Pesa callbacks must only be accepted from Safaricom's published IP ranges. Middleware runs before `processCallback` and rejects any request whose `req.ip` is not in the allowlist.

```typescript
// safaricom-ips.ts — full CIDR list
export const SAFARICOM_IP_RANGES = [
    '196.201.214.0/24',
    '196.201.214.200/24',
    // ... all official ranges
]

// In mpesa-callback route
if (!isFromSafaricom(req.ip)) {
    logger.warn('Callback rejected — not a Safaricom IP', { remoteIp: req.ip })
    return res.status(403).json({ error: 'Forbidden' })
}
```

The allowlist is the first line of defence against spoofed callbacks. The second line is stkQuery verification (Rule 6 above). Both must be present.

## OAuth token — caching is mandatory

```typescript
const REDIS_TOKEN_KEY = 'daraja:access_token'

async function getAccessToken(): Promise<string> {
    const cached = await redis.get(REDIS_TOKEN_KEY)
    if (cached) return cached

    const creds = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')
    const res = await axios.get(OAUTH_URL, {
        headers: { Authorization: `Basic ${creds}` }
    })
    const { access_token, expires_in } = res.data
    // Cache 100s shorter than actual TTL to avoid stale-token errors
    await redis.setex(REDIS_TOKEN_KEY, parseInt(expires_in) - 100, access_token)
    return access_token
}
```

Daraja rate-limits token requests. At 50 terminals × 1 token request each = easily hits the limit without caching.

## Password generation

```typescript
function generatePassword(): { password: string; timestamp: string } {
    const timestamp = new Date()
        .toISOString()
        .replace(/[^0-9]/g, '')
        .slice(0, 14)  // YYYYMMDDHHmmss

    const raw = `${SHORTCODE}${PASSKEY}${timestamp}`
    return { password: Buffer.from(raw).toString('base64'), timestamp }
}
```

Generate a fresh password for **every** STK Push request — the timestamp is baked in and cannot be replayed.

## STK Push request body

```typescript
{
    BusinessShortCode: SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.ceil(amountKsh),        // whole number — no decimals
    PartyA: phone,                        // consumer (254XXXXXXXXX)
    PartyB: SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: callbackUrl,             // must be HTTPS, publicly reachable
    AccountReference: txnId.slice(0, 12),
    TransactionDesc: `Pay ${name}`.slice(0, 13)
}
```

`ResponseCode: "0"` means Safaricom accepted the request — NOT that the consumer paid. The actual result comes via callback.

## Phone number normalisation

```typescript
export function normalisePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '')
    if (digits.startsWith('254') && digits.length === 12) return digits
    if (digits.startsWith('0')   && digits.length === 10) return '254' + digits.slice(1)
    if (digits.length === 9) return '254' + digits
    return digits  // Daraja will reject with a clear error message
}
```

Always normalise before storing in DB and before sending to Daraja. **Always mask before logging**: `phone.slice(0, 5) + '****' + phone.slice(-2)`.

## Result codes — complete map

| Code | Meaning | User message |
|---|---|---|
| 0 | Success | — |
| 1 | Insufficient funds | "Customer has insufficient M-Pesa balance" |
| 17 | Daily limit exceeded | "Customer has exceeded their daily transaction limit" |
| 1032 | Cancelled by user | "Customer cancelled the payment request" |
| 1037 | Timeout (no response in 60s) | "Payment timed out — customer did not respond" |
| 2001 | Wrong PIN | "Customer entered the wrong M-Pesa PIN" |
| 500 | Still processing | Leave as STK_SENT — don't finalise |
| -1 | Query failed (circuit open) | Leave as STK_SENT — try next reconciliation run |

**Never show raw codes to merchants or consumers.** Map them in `friendlyReason(code)`.

## STK Query — reconciliation tool

```typescript
export async function stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
    const token = await getAccessToken()
    const { password, timestamp } = generatePassword()

    const response = await axios.post(QUERY_URL, {
        BusinessShortCode: SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
    }, { headers: { Authorization: `Bearer ${token}` } })

    return {
        resultCode: parseInt(response.data.ResultCode),
        resultDesc: response.data.ResultDesc
    }
}
```

The STK Query response does **not** include `MpesaReceiptNumber` — only the original callback does. Reconciled-confirmed transactions won't have a receipt number.

## Reconciliation job

Runs every 5 minutes (cron: `*/5 * * * *`). Processes transactions that are:
- `status IN ('PENDING', 'STK_SENT')` — either pre-push or post-push stuck
- Have a `checkout_request_id` (STK Push was actually sent — PENDING without one is skipped)
- Older than 5 minutes (give the normal callback path time to work)
- Younger than 90 minutes (after 90 min, no callback is ever coming)

```sql
SELECT id, checkout_request_id, idempotency_key, amount_cents
FROM transactions
WHERE status IN ('PENDING', 'STK_SENT')
  AND checkout_request_id IS NOT NULL
  AND created_at < NOW() - INTERVAL '5 minutes'
  AND created_at > NOW() - INTERVAL '90 minutes'
LIMIT 100
```

For each stuck transaction: call `stkQuery()`. If `resultCode === 500` or `-1`, skip. Otherwise update status and notify via `redis.publish()`.

Expire after 90 minutes:
```sql
UPDATE transactions SET status = 'EXPIRED', updated_at = NOW()
WHERE status IN ('PENDING', 'STK_SENT')
  AND created_at < NOW() - INTERVAL '90 minutes'
```

Add a 200ms sleep between Daraja queries to avoid rate limiting.

## Testing locally with ngrok

```bash
ngrok http 3000
# Set in .env: DARAJA_CALLBACK_BASE_URL=https://abc123.ngrok.io
```

Full callback URL: `https://abc123.ngrok.io/api/v1/mpesa-callback`

Sandbox test phone: `254708374149` (always succeeds)
Sandbox test PIN: `1234`

## Sandbox vs production credentials

| | Sandbox | Production |
|---|---|---|
| Base URL | `https://sandbox.safaricom.co.ke` | `https://api.safaricom.co.ke` |
| Shortcode | `174379` | Your actual paybill/till |
| Passkey | Public sandbox passkey | Your live passkey (Daraja portal) |
| Credentials | developer.safaricom.co.ke | Safaricom Business Portal |

## Common bugs

- **"ResponseCode: 0" but no callback ever arrives**: `CallBackURL` is not publicly reachable (localhost, HTTP, wrong port, firewall blocking inbound)
- **All callbacks silently dropped**: idempotency guard used `status !== 'PENDING'`; now that step 6 sets `STK_SENT`, both states must be accepted as processable
- **Duplicate STK Pushes**: callback arrived, was processed, then Safaricom retried because the 200 was slow — fix with the Rule 1 pattern (respond first, process async)
- **"Invalid Access Token"**: cached token expired at the Redis boundary — verify TTL is `expires_in - 100`
- **Amount field error**: passing `amountCents / 100` as a float (e.g. 500.5) — always `Math.ceil(amountCents / 100)`
- **Timestamp rejected**: generated password uses UTC but Safaricom expects EAT (UTC+3) — verify with Safaricom docs for your production environment
- **AccountReference truncation breaks lookup**: if `txnId.slice(0, 12)` is AccountReference, it's not the full txnId — always use `CheckoutRequestID` as the primary lookup key
- **stkQuery never called**: circuit is OPEN — check `getDarajaCircuitStatus()` and wait for HALF_OPEN to proceed

## See also
- `orchestratepay-backend-api` skill — transaction state machine, idempotency, PostgreSQL schema, WebSockets
- `orchestratepay-android-nfc` skill — how PaymentIntent reaches the backend, NFC signing

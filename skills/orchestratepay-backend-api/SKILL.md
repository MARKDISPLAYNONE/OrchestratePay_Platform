---
name: orchestratepay-backend-api
description: >
  Build and extend the OrchestratePay backend API and Android PaymentOrchestrator.
  Covers transaction lifecycle (PENDING→STK_SENT→CONFIRMED|DECLINED|FAILED|EXPIRED),
  idempotency (SHA-256 32-hex keys, Redis+Postgres dual check), JWT auth with
  single-device enforcement, Joi validation, rate limiting, PostgreSQL schema,
  Redis caching, circuit breaker (wraps all Daraja calls), WebSocket real-time
  updates (ws package, Redis pub/sub bridge), the Android PaymentOrchestrator
  (retry with exponential backoff, STK Push polling, PaymentResult sealed class),
  IdempotencyKeyGen, SessionManager (EncryptedSharedPreferences), AuditLogger
  (Room/SQLite, CBK compliance), SunmiPrinterManager (thermal receipts + KRA PIN),
  and the React/Vite merchant dashboard.
  Use this skill for: transaction flow, new API endpoints, stuck PENDING/STK_SENT
  transactions, idempotency bugs, double-charges, merchant login/JWT, WebSocket
  subscription, DB schema changes, Redis strategy, audit logging, receipt printing,
  KRA PIN configuration, printer pre-flight checks, circuit breaker status,
  merchant dashboard, or wiring Android app to backend.
---

# OrchestratePay — Backend API & Android Orchestrator

## Transaction state machine
```
PENDING   → STK_SENT   (STK Push delivered to consumer's phone — step 6 of transaction flow)
STK_SENT  → CONFIRMED  (M-Pesa callback ResultCode=0, verified by stkQuery)
STK_SENT  → DECLINED   (ResultCode != 0, e.g. cancelled/insufficient funds/wrong PIN)
STK_SENT  → FAILED     (stkQuery disputes a claimed-success callback)
PENDING   → FAILED     (STK Push itself failed — network error, Daraja down)
PENDING   → EXPIRED    (reconciliation: no checkout_request_id after 90 minutes)
STK_SENT  → EXPIRED    (reconciliation: no callback after 90 minutes from creation)
```
Never move backwards. Never skip states. The DB is the source of truth.

`STK_SENT` distinguishes "we know the consumer saw the PIN prompt" from "STK Push not yet sent". This matters for diagnostics, UX copy, and the Android `onStkSent` callback.

## Idempotency — the most important invariant

**Key formula**: `SHA-256(merchantId : tagId : amountCents : minuteTimestamp)[0..32] as hex`

```kotlin
// Android — IdempotencyKeyGen.kt
val raw = "${intent.merchantId}:${tagId}:${amountCents}:${roundToMinute(timestamp)}"
return MessageDigest.getInstance("SHA-256")
    .digest(raw.toByteArray())
    .take(16)                           // 16 bytes → 32 hex chars
    .joinToString("") { "%02x".format(it) }

fun roundToMinute(ts: Long) = (ts / 60_000L) * 60_000L
```

The key is identical for every retry within 60 seconds of the original tap. After 60 seconds a new tap produces a new key — the consumer walked away. merchantId and tagId are always UUIDs (no colons), so the colon separator cannot be exploited for collision.

**Backend enforcement** (belt-and-suspenders — both Redis AND Postgres):
```typescript
// 1. Check Redis first (fast path — sub-ms)
const cached = await redis.get(`idempotency:${key}`)
if (cached) return res.json(JSON.parse(cached))

// 2. Check Postgres (survives Redis restart)
const existing = await db.query(
  'SELECT id, status FROM transactions WHERE idempotency_key = $1', [key])
if (existing.rows.length > 0) return res.json({ status: existing.rows[0].status, ... })

// 3. Now safe to create a new transaction
```

Database has `UNIQUE INDEX ON transactions(idempotency_key)` — the DB itself rejects duplicates as the last line of defence.

## POST /api/v1/transactions — 6-step flow

1. **Idempotency check** (Redis → DB)
2. **Validate merchant** (`active = true`)
3. **Resolve consumer** via `nfc_tags JOIN consumers` → get phone number
4. **Write PENDING to DB** ← BEFORE calling M-Pesa (order is critical)
5. **Fire STK Push** via Daraja
6. **Update with `checkout_request_id` and status = `STK_SENT`**, cache in Redis, return `{ status: 'STK_SENT', message: 'M-Pesa prompt sent — waiting for customer to enter PIN' }`

Why write to DB before M-Pesa? If M-Pesa succeeds but our DB write fails, the consumer is charged with no record. Writing first means we can always reconcile.

Why return `STK_SENT` from step 6? Android maps both `PENDING` and `STK_SENT` to `ApiResponse.Pending` and fires `onStkSent` only on the first `STK_SENT` response, so the UI shows "waiting for PIN" instead of a generic spinner.

## Android PaymentOrchestrator

### Entry point
```kotlin
fun process(
    intent: PaymentIntent,
    amountCents: Long,
    onStkSent: (() -> Unit)? = null,
    onResult: (PaymentResult) -> Unit
)
```
Called on Main thread. All network/DB work runs on IO thread via coroutines. `onResult` and `onStkSent` are delivered back on Main thread via `withContext(Dispatchers.Main)`.

### Retry config
```kotlin
MAX_RETRIES = 3           // network errors only
MAX_POLL_ATTEMPTS = 15    // 15 × 2500ms = 37.5 seconds
POLL_INTERVAL_MS = 2500   // poll every 2.5 seconds
```
Use the SAME idempotency key on every retry attempt. Exponential backoff: `delay(1000L * attempt)`.

Only retry on `NetworkError`. Never retry on `Declined` — the consumer made a deliberate choice.

### PaymentResult sealed class
```kotlin
sealed class PaymentResult {
    data class Success(val txnId: String, val mpesaRef: String, val amountCents: Long,
                       val merchantName: String, val consumerPhone: String)
    data class Declined(val reason: String, val mpesaCode: Int? = null)
    data class Failed(val reason: String, val retryable: Boolean = true)
    data class Pending(val txnId: String)
}
```
`Success.consumerPhone` is always the masked form (`25471****78`) — the raw 12-digit number must never appear in a `PaymentResult`. The UI exhaustively pattern-matches on this sealed class; no null checks, no `status` strings.

### ApiResponse sealed class (backend mapping)
```kotlin
sealed class ApiResponse {
    data class Success(val txnId: String, val mpesaRef: String?, val amountCents: Long?,
                       val merchantName: String?, val consumerPhone: String?)
    data class Pending(val txnId: String)
    data class Declined(val reason: String)
    data class NetworkError(val message: String)
    data class ServerError(val message: String)
}
```

```
HTTP 200 + status="PENDING" or "STK_SENT" → ApiResponse.Pending   (fires onStkSent on first STK_SENT)
HTTP 200 + status="CONFIRMED"             → ApiResponse.Success
HTTP 400–499                              → ApiResponse.Declined   (don't retry)
HTTP 500+                                 → ApiResponse.ServerError (may retry)
IOException                               → ApiResponse.NetworkError (retry)
```

## WebSocket — real-time payment result push

Endpoint: `ws://host/ws?txnId=<id>&token=<jwt>`

On connect: server subscribes to Redis channel `txn:{txnId}`. When the M-Pesa callback fires, the callback handler publishes `{ status, mpesaRef?, reason? }` to that channel. The WebSocket server forwards it to the connected Android client immediately.

Android `PaymentOrchestrator` uses HTTP polling as primary (simpler, survives background app kills) and the WebSocket as a speed-up — if the socket delivers the result before the next poll fires, the UI updates instantly.

```typescript
// Backend — subscribe on connect
const sub = redis.duplicate()
await sub.subscribe(`txn:${txnId}`)
sub.on('message', (channel, message) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message)
    sub.unsubscribe()
    sub.quit()
})
```

## Auth — single-device sessions

JWT payload: `{ sub: merchantId, name, deviceId, kraPin, iat, exp }`

On login: store `device_id` in `merchants` table. Token TTL: 8 hours (one full merchant shift). Android stores in `EncryptedSharedPreferences` (AES-256-GCM via Android Keystore).

`SessionManager.getKraPin()` reads `kraPin` from the decoded JWT so the receipt printer always has the right PIN without an extra API call.

```kotlin
fun getToken(): String? {
    val token = prefs?.getString(KEY_TOKEN, null) ?: return null
    val expiresAt = prefs?.getLong(KEY_EXPIRES_AT, 0L) ?: 0L
    return if (System.currentTimeMillis() < expiresAt) token else null
}
```

## Audit logging

**Android** (Room/SQLite — on-device, survives crashes):
```kotlin
fun record(event: AuditEvent, detail: String = "") {
    scope.launch { dao.insert(AuditEntry(event.name, detail, isoTimestamp, sessionId)) }
}
```
Log `PAYMENT_INTENT_RECEIVED` BEFORE the first network call. Log `STK_PUSH_SENT` when `onStkSent` fires.

**Backend** (PostgreSQL `server_audit_log` table): M-Pesa callbacks, reconciliation runs, auth events, circuit state changes. Index on `(entity_type, entity_id)`.

**CBK raw callback archive** (`daraja_callback_log` table): stores the full raw JSON of every Safaricom callback body. Archived *before* any business logic so no callback is ever lost. `retained_until = CURRENT_DATE + 7 years`.

CBK requires 7-year log retention. In production, ship logs to S3/GCS via a log forwarder.

## Printer pre-flight check

Always call `checkPrinterState()` when the merchant confirms the amount — before the NFC tap is requested — so the merchant knows about paper problems before charging the customer.

```kotlin
// MerchantDashboardActivity.kt
private fun onAmountConfirmed(amountCents: Long) {
    enteredAmountCents = amountCents
    lifecycleScope.launchWhenResumed {
        when (val state = printer.checkPrinterState()) {
            is PrinterState.OutOfPaper  -> showInfo("Printer is out of paper — replace before charging")
            is PrinterState.LowPaper    -> showInfo("Paper running low — consider replacing soon")
            is PrinterState.Overheating -> showInfo("Printer is overheating — wait before charging")
            is PrinterState.Disconnected -> showInfo("Printer not connected — check cable")
            is PrinterState.Error       -> showInfo("Printer error (${state.code})")
            is PrinterState.Ready       -> { /* proceed — show NFC tap prompt */ }
        }
    }
}
```

Print receipt in a fire-and-forget coroutine — never block the success screen:
```kotlin
lifecycleScope.launch { printer.printReceipt(result, kraPin = SessionManager.getKraPin()) }
```

## KRA PIN on receipts

`kraPin` is stored in the `merchants` DB table and returned in the JWT payload at login. `SunmiPrinterManager.printReceipt` accepts `kraPin: String? = null`. When non-null, it renders `KRA PIN: <pin>` on the receipt between the transaction ID and the footer separator. If `kraPin` is null or empty string, the line is omitted entirely.

## Redis keys and TTLs
| Key | Value | TTL | Purpose |
|---|---|---|---|
| `daraja:access_token` | Bearer token string | 3500s | Daraja OAuth cache |
| `idempotency:{key}` | JSON (status, txnId) | 120s PENDING/STK_SENT, 3600s CONFIRMED | Prevent duplicate STK Push |
| `txn:{txnId}` | JSON (txnId, idempotencyKey) | 120s | Pending transaction index |

Redis must have RDB or AOF persistence enabled in production — if Redis restarts without it, idempotency keys evaporate and the Postgres fallback becomes the sole guard until TTL would have expired.

## PostgreSQL schema — key constraints
```sql
-- Idempotency — DB-level guarantee (belt + suspenders with Redis)
CREATE UNIQUE INDEX ON transactions(idempotency_key);

-- Fast callback matching
CREATE INDEX ON transactions(checkout_request_id)
  WHERE checkout_request_id IS NOT NULL;

-- Fast reconciliation query (only indexes non-terminal rows)
CREATE INDEX ON transactions(created_at)
  WHERE status IN ('PENDING', 'STK_SENT');

-- CBK raw callback archive (7-year retention)
CREATE TABLE daraja_callback_log (
    id                   BIGSERIAL PRIMARY KEY,
    received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    remote_ip            TEXT,
    checkout_request_id  TEXT,
    result_code          INTEGER,
    raw_body             JSONB NOT NULL,
    verified             BOOLEAN,            -- true=stkQuery agreed, false=stkQuery disputed, null=circuit open
    retained_until       DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '7 years')
);
CREATE INDEX ON daraja_callback_log(checkout_request_id);
CREATE INDEX ON daraja_callback_log(received_at DESC);
CREATE INDEX ON daraja_callback_log(retained_until);
```

Phone numbers stored as plain text (254XXXXXXXXX) — needed for STK Push. Audit log and API responses always use the masked form. `maskPhone`: `phone.slice(0, 5) + '****' + phone.slice(-2)`.

## Joi validation schemas (backend)

```typescript
export const transactionSchema = Joi.object({
    merchantId:     Joi.string().uuid().required(),
    amountCents:    Joi.number().integer().min(100).max(10_000_000_00).required(),  // KES 1 – KES 10M
    source:         Joi.string().valid('NFC_TAG', 'QR_CODE', 'ISO_CARD').required(),
    tagId:          Joi.string().optional().allow(null),
    nfcUid:         Joi.string().optional().allow(null),
    idempotencyKey: Joi.string().length(32).hex().required(),
    timestamp:      Joi.number().integer().required()
})
```

Set `{ stripUnknown: true }` on all schemas — removes unexpected fields before they reach the DB.

## Merchant Dashboard (Vite + React + TypeScript)

Located in `Tap2Pay/dashboard/`. Vite proxies `/api` to `http://localhost:3000` so there are no CORS issues in development.

Pages:
- `LoginPage` — email + password, stores JWT in `localStorage` as `op_token`
- `DashboardPage` — stat cards (today revenue, confirmed count, in-flight), paginated `TransactionTable`
- `ReceiptPage` — full transaction detail, `window.print()` with `@media print` isolation on `#receipt-printable`

Status badge colours in `TransactionTable`:
- `STK_SENT` → blue (#3b82f6)
- `CONFIRMED` → green (#10b981)
- `DECLINED` / `FAILED` → red (#ef4444)
- `EXPIRED` / `PENDING` → gray

`ProtectedRoute` reads `localStorage.op_token` and redirects to `/login` if absent.

## Admin API

`GET /api/v1/admin/health` — returns circuit breaker status and Daraja connectivity:
```json
{ "circuit": { "state": "CLOSED", "failureCount": 0 }, "daraja": "ok" }
```
Requires JWT auth. Used by monitoring dashboards and on-call runbooks.

## Common bugs
- **Double charge**: missing idempotency check — always check Redis before hitting Postgres
- **All callbacks silently dropped**: idempotency guard checked `status !== 'PENDING'` — now that step 6 sets `STK_SENT`, the guard must be `status === 'PENDING' || status === 'STK_SENT'`
- **Stuck PENDING forever**: forgot the reconciliation job, or `checkout_request_id` was never saved (M-Pesa call succeeded but update failed)
- **JWT "expired" on first use**: `expiresAt` stored as seconds but compared against milliseconds (multiply by 1000)
- **Retrofit 415 Unsupported Media Type**: missing `Content-Type: application/json` header in auth interceptor
- **Room migration crash**: changed a field type without incrementing `version` in `@Database`
- **Redis eviction kills idempotency**: Redis `maxmemory-policy` set to `allkeys-lru` or `volatile-lru` — use `noeviction` or at minimum `volatile-ttl`

## See also
- `orchestratepay-daraja` skill — M-Pesa STK Push details, callback golden rules, circuit breaker, reconciliation
- `orchestratepay-android-nfc` skill — NFC layer, HMAC signing, PaymentIntent construction, HCE

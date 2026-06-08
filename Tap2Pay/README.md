# OrchestratePay

NFC and QR tap-to-pay platform for Kenyan merchants, built on M-Pesa Daraja. Merchants tap an NFC sticker, scan a QR code, or accept a phone-to-terminal HCE payment — the platform fires an M-Pesa STK Push to the consumer and settles in KES. Supports multi-currency conversion, loyalty programmes, real-time WebSocket updates, KRA eTIMS fiscal receipts, GL export to QuickBooks/Xero/Sage/Wave, and SMS notifications via Africa's Talking.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Payment Flows](#payment-flows)
- [Project Structure](#project-structure)
- [Backend](#backend)
  - [Prerequisites](#prerequisites)
  - [Quick Start](#quick-start)
  - [Environment Variables](#environment-variables)
  - [API Reference](#api-reference)
  - [Background Jobs](#background-jobs)
  - [Database Schema](#database-schema)
  - [Security Model](#security-model)
- [Android](#android)
  - [Modules](#modules)
  - [Build Variants](#build-variants)
  - [Running on a Device](#running-on-a-device)
- [Infrastructure](#infrastructure)
  - [Docker Compose (local dev)](#docker-compose-local-dev)
  - [Production Deployment](#production-deployment)
- [Testing](#testing)
- [Known Gaps / Pre-launch Checklist](#known-gaps--pre-launch-checklist)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            Payment Sources                               │
│                                                                          │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │  Sunmi Terminal  │  │  Consumer Wallet  │  │     QR Code Page      │  │
│  │  (NFC reader)   │  │  (HCE emulator)  │  │  (web, no app)       │  │
│  │  NFC_TAG        │  │  HCE_PHONE       │  │  QR_CODE             │  │
│  │  ISO_CARD       │  │  AID: F04F52…41  │  │  SOFTPOS_MOBILE      │  │
│  └────────┬────────┘  └────────┬─────────┘  └──────────┬───────────┘  │
│           │                    │                         │              │
└───────────┼────────────────────┼─────────────────────────┼──────────────┘
            │                    │                         │
            └──────────────────┬─┘                         │
                               ▼                           ▼
              ┌────────────────────────────────────────────────────┐
              │          OrchestratePay Backend (Express/TS)        │
              │                                                     │
              │  ┌──────────┐  ┌──────────┐  ┌─────────────────┐  │
              │  │  Routes  │  │  Auth MW │  │  Rate Limiter   │  │
              │  │  (13)    │  │  JWT/RBAC│  │  100/30 rpm     │  │
              │  └──────────┘  └──────────┘  └─────────────────┘  │
              │                                                     │
              │  ┌─────────────────────────────────────────────┐   │
              │  │              M-Pesa Daraja                   │   │
              │  │  STK Push → circuit breaker → reconciliation │   │
              │  │  Safaricom IP allowlist on /mpesa-callback    │   │
              │  └─────────────────────────────────────────────┘   │
              │                                                     │
              │  ┌──────────────┐  ┌──────────────┐               │
              │  │  PostgreSQL  │  │    Redis      │               │
              │  │  (ledger)    │  │  (cache/IPC)  │               │
              │  └──────────────┘  └──────────────┘               │
              └────────────────────────────────────────────────────┘
                               │
              ┌────────────────┼──────────────────────┐
              ▼                ▼                       ▼
         KRA eTIMS       FX Rates             GL Export
       (fiscal receipt)  (OpenExchangeRates)  (QuickBooks/Xero/
                                               Sage/Wave)
```

**Key invariants:**

1. Every transaction is written to the DB as `PENDING` before the STK Push is fired. A server crash between the two is recovered by the reconciliation job.
2. Idempotency is enforced at two layers: a Redis fast path and a `UNIQUE` constraint on `idempotency_key` in PostgreSQL. Double-charges are impossible.
3. M-Pesa callbacks are only accepted from Safaricom's 12 published egress IPs in production. Fake callbacks are rejected with HTTP 403 before reaching route logic.
4. `PrinterState` never blocks a payment — a receipt failure is a UX issue, not a financial one.
5. NFC tag signing uses HMAC-SHA256 with merchant-scoped keys. A cloned tag without the correct signature is rejected before any STK Push is fired.

---

## Payment Flows

### NFC Tag Flow (primary)

```
Merchant taps NFC sticker
        │
        ▼
Android reads NDEF record
orchestratepay://pay?mid={merchantId}&tid={tagId}&v=1
        │
        ▼
Backend verifies HMAC signature on tagId
        │
        ▼
POST /api/v1/transactions
  { amountCents, source: "NFC_TAG", tagId, idempotencyKey, timestamp }
        │
        ▼
STK Push → consumer phone rings
        │
Consumer enters PIN
        │
        ▼
POST /api/v1/mpesa-callback  (from Safaricom)
  → status = CONFIRMED / DECLINED
        │
        ▼
WebSocket push → merchant terminal shows result
Redis pub/sub → reconciliation skips this transaction
```

### HCE Phone-to-Terminal Flow

```
Consumer wallet displays QR code or holds phone to terminal
        │
        ▼
AID select: F04F52434845535441  (proprietary range F0–FF)
        │
        ▼
APDU handshake:
  SELECT AID → 9000
  GET DATA (0x80 0xC0) → signed JSON token + 9000
  CONFIRM  (0x80 0xC1) → 9000
        │
        ▼
Terminal resolves consumerId from token, fires STK Push
→ same callback path as NFC_TAG flow
```

### QR Code Flow (consumer-initiated)

```
Consumer scans merchant QR code (web page, no app needed)
        │
        ▼
POST /api/v1/consumers/pay/:merchantId
  { amountCents, idempotencyKey, timestamp, currency }
        │
        ▼
FX conversion (if non-KES) → STK Push → polling
GET /api/v1/consumers/transactions/:txnId/status  (2.5s interval)
```

---

## Project Structure

```
Tap2Pay/
├── backend/                    Node.js/Express API
│   ├── src/
│   │   ├── routes/             13 route modules (~50 endpoints)
│   │   ├── middleware/         auth, validate, request-id, safaricom-ip
│   │   ├── integrations/       daraja, etims, quickbooks, xero, sage, wave, africas-talking
│   │   ├── jobs/               reconciliation, gl-posting
│   │   ├── realtime/           WebSocket server (ws-server.ts)
│   │   ├── util/               logger, fx, nfc-signing, hce-token, vat, circuit-breaker,
│   │   │                       fraud, cbk-compliance, latency-tracker, fcm
│   │   └── db/                 index.ts (pool), migrate.ts (14+ tables), redis.ts
│   ├── src/__tests__/          34 test suites · 717 assertions
│   ├── Dockerfile              Multi-stage Node 20 Alpine, non-root user
│   └── package.json
│
├── web/                        Next.js 14 web app (merchant + consumer + admin portals)
│   └── src/app/
│       ├── auth/               Login, merchant & consumer registration
│       ├── admin/              Admin portal (stats, approvals, fleet overview)
│       ├── merchant/           Dashboard, transactions, analytics, loyalty, accounting
│       ├── consumer/           Dashboard, profile, loyalty, pay
│       └── pay/[merchantId]    Public QR payment page (no app needed)
│
├── android/
│   ├── app/                    Merchant terminal app (Sunmi P2 Pro / any NFC Android)
│   ├── nfc-core/               Shared NFC library (tag read/write, NDEF format)
│   ├── consumer-wallet/        Consumer HCE wallet app
│   └── softpos/                SoftPOS module (Play Integrity attestation)
│
└── docker-compose.yml          Local dev stack (postgres:15, redis:7, backend)
```

---

## Backend

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20 LTS |
| PostgreSQL | 15+ |
| Redis | 7+ |
| TypeScript | 5.3+ |

### Quick Start

```bash
cd backend

# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#    → fill in DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, JWT_SECRET, ADMIN_SECRET

# 3. Create database tables
npm run migrate

# 4. Start development server (hot reload)
npm run dev
# → listening on http://localhost:3000
```

Or run the full stack with Docker:

```bash
# From project root
docker compose up --build
# postgres:5432, redis:6379, backend:3000 all start with health checks
```

### Environment Variables

All variables must be set before the server starts. Missing required variables cause a hard crash at startup with a clear error listing what's absent.

```bash
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/orchestratepay
REDIS_URL=redis://localhost:6379

# ── M-Pesa Daraja ─────────────────────────────────────────────────────────────
DARAJA_CONSUMER_KEY=your_consumer_key
DARAJA_CONSUMER_SECRET=your_consumer_secret
DARAJA_SHORTCODE=174379                         # sandbox till; replace in prod
DARAJA_PASSKEY=bfb279f9aa9bdbcf...              # from Daraja portal
DARAJA_CALLBACK_BASE_URL=https://your-domain.com
DARAJA_ENV=sandbox                              # set to "production" for live

# ── Application ───────────────────────────────────────────────────────────────
NODE_ENV=development                            # "production" enables IP allowlist + strict CORS
PORT=3000
JWT_SECRET=change_this_to_a_64_char_random_string
ADMIN_SECRET=change_this_to_a_strong_random_secret

# ── Optional ──────────────────────────────────────────────────────────────────
OPENEXCHANGERATES_APP_ID=                       # required for live FX rates; falls back to hardcoded
PLAY_INTEGRITY_REQUIRED=false                   # set "true" in prod to enforce SoftPOS attestation
NFC_SIGNING_SECRET=                             # overrides JWT_SECRET for tag HMAC derivation
SENTRY_DSN=                                     # add before going live — production errors are silent without this
LOG_LEVEL=info                                  # debug | info | warn | error
```

**Sandbox Daraja credentials** (Safaricom test environment, safe to commit):

| Variable | Sandbox value |
|---|---|
| `DARAJA_SHORTCODE` | `174379` |
| `DARAJA_PASSKEY` | `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919` |

Replace both with values from [developer.safaricom.co.ke](https://developer.safaricom.co.ke) for production.

### API Reference

All routes are prefixed `/api/v1`. Authenticated routes require `Authorization: Bearer <JWT>`.

#### Authentication — `/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | Admin secret | Register a new merchant (admin only) |
| `POST` | `/auth/login` | None | Merchant login — returns JWT |
| `POST` | `/auth/logout` | Merchant JWT | Invalidate device session |
| `POST` | `/auth/admin/approve/:merchantId` | Admin secret | Approve a merchant for payments |
| `GET` | `/auth/admin/pending` | Admin secret | List merchants awaiting approval |
| `POST` | `/auth/consumer/register` | None | Register a consumer account |
| `POST` | `/auth/consumer/login` | None | Consumer login — returns JWT |

Merchant login enforces:
- bcrypt 12 rounds with constant-time dummy compare (prevents user enumeration)
- Single-device enforcement: a second device login invalidates the first
- Approval gate: `PENDING_REVIEW` / `SUSPENDED` merchants are blocked at login

#### Transactions — `/transactions`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/transactions` | Merchant JWT | Initiate payment (NFC / HCE / ISO card) |
| `GET` | `/transactions/:id/status` | Merchant JWT | Poll payment status |
| `GET` | `/transactions` | Merchant JWT | Transaction history (paginated) |

The `POST /transactions` body:

```json
{
  "amountCents": 50000,
  "source": "NFC_TAG",
  "tagId": "xxxxxxxx-...",
  "idempotencyKey": "32-char-hex-string",
  "timestamp": 1716825600000,
  "currency": "KES",
  "hceToken": "optional-for-HCE_PHONE-source"
}
```

`source` values: `NFC_TAG` · `QR_CODE` · `ISO_CARD` · `HCE_PHONE` · `SOFTPOS_MOBILE`

Idempotency: send the same `idempotencyKey` on retry — the cached response is returned immediately without firing a second STK Push.

Transaction status lifecycle:

```
PENDING → STK_SENT → CONFIRMED
                   → DECLINED
                   → FAILED      (STK Push rejected by Daraja)
                   → EXPIRED     (reconciliation job, >90 min)
```

#### Merchants — `/merchants`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/merchants/me` | Merchant JWT | Own profile |
| `PUT` | `/merchants/me` | Merchant JWT | Update name, shortcode, account ref |
| `GET` | `/merchants/me/z-report` | Merchant JWT | End-of-day Z report (settlements) |
| `GET` | `/merchants/me/analytics/weekly` | Merchant JWT | 7-day revenue breakdown |
| `GET` | `/merchants/me/analytics/peak-hours` | Merchant JWT | Hourly volume heatmap |
| `GET` | `/merchants/me/analytics/sources` | Merchant JWT | Revenue by payment source |

#### Consumers — `/consumers`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/consumers/pay/:merchantId` | None | Merchant info for QR payment page |
| `GET` | `/consumers/c/:consumerId` | Merchant JWT | Look up consumer by NFC tag ID |
| `GET` | `/consumers/me` | Consumer JWT | Own profile (phone masked) |
| `PUT` | `/consumers/me` | Consumer JWT | Update display name, SMS opt-in |
| `GET` | `/consumers/me/transactions` | Consumer JWT | Transaction history across merchants |
| `GET` | `/consumers/me/loyalty` | Consumer JWT | Loyalty balances across merchants |
| `POST` | `/consumers/pay/:merchantId` | Consumer JWT | Consumer-initiated QR payment |
| `POST` | `/consumers/qr-token` | Consumer JWT | Issue single-use QR token (90s TTL) |
| `POST` | `/consumers/me/fcm-token` | Consumer JWT | Register FCM push token |
| `GET` | `/consumers/transactions/:txnId/status` | Consumer JWT | Poll own payment status |

#### Loyalty — `/loyalty`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/loyalty/balance` | Merchant JWT | Consumer's loyalty balance at this merchant |
| `GET` | `/loyalty/programme` | Merchant JWT | Own loyalty programme config |
| `POST` | `/loyalty/programme` | Merchant JWT | Create / update loyalty programme |
| `POST` | `/loyalty/redeem` | Merchant JWT | Redeem consumer points/stamps |

Reward types: `POINTS` (KSh spend → points) · `STAMPS` (per visit)

#### FX Rates — `/fx`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/fx/rates` | None | Current rates (KES base) with age in minutes |

Supported currencies: `KES · USD · EUR · GBP · TZS · UGX · RWF`

Rate source priority: DB cache (< 1 hour old) → OpenExchangeRates API → hardcoded emergency fallback

#### Accounting — `/accounting`

GL export endpoints for QuickBooks, Xero, Sage, and Wave. All require Merchant JWT. Exports settled transactions as journal entries, grouped by settlement date.

#### Admin — `/admin`

Protected by `X-Admin-Secret` header (value must match `ADMIN_SECRET` env var).

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/stats` | Platform-wide metrics: counts, success rate, p95 latency, hourly volume, circuit breaker state |
| `GET` | `/admin/pending` | Transactions stuck in PENDING / STK_SENT |
| `GET` | `/admin/circuit` | Daraja circuit breaker current state |
| `GET` | `/admin/fleet` | Device fleet overview (MDM telemetry) |
| `POST` | `/admin/fx/refresh` | Force-refresh all FX rates immediately |

#### Devices — `/devices`

Fleet telemetry ingest from Sunmi terminals: battery, NFC reads, printer state, uptime. Reported every 5 minutes by the merchant app.

#### Attestation — `/attestation`

SoftPOS Play Integrity token verification. Validates the Android device integrity verdict before allowing `SOFTPOS_MOBILE` transactions. Controlled by `PLAY_INTEGRITY_REQUIRED` env var.

#### M-Pesa Callback — `/mpesa-callback`

`POST /api/v1/mpesa-callback` — receives Safaricom STK Push results. Protected by Safaricom IP allowlist in production. Not for direct use.

#### WebSocket — `/ws`

Real-time payment status pushed to the merchant terminal. Connect with:

```
wss://api.orchestratepay.co.ke/ws?token=<JWT>
```

Messages emitted on payment outcome:

```json
{ "type": "PAYMENT_CONFIRMED", "txnId": "...", "amountCents": 50000, "mpesaRef": "NLJ7RT61SV" }
{ "type": "PAYMENT_DECLINED",  "txnId": "...", "reason": "Request cancelled by user" }
```

Idle connections are closed after 70 seconds. The app pings every 15 seconds.

### Background Jobs

| Job | Schedule | Description |
|---|---|---|
| **Reconciliation** | Every 5 min | Queries Daraja STK Query API for any PENDING/STK_SENT transactions older than 5 min. Confirms, declines, or expires them. Protects against missed callbacks. |
| **GL Posting** | Every 2 min | Drains confirmed transactions into merchant GL journal entries for accounting export. |
| **FX Refresh** | Every hour | Refreshes KES exchange rates for all supported currencies via OpenExchangeRates. |
| **MV Refresh** | Every 15 min | Refreshes `mv_hourly_revenue` materialized view (non-blocking `CONCURRENTLY`). |

All jobs run in the same process. **In a multi-instance deployment, add a Redlock distributed lock to the reconciliation job** — concurrent runs from multiple pods will produce duplicate Daraja queries and double-confirm notifications.

### Database Schema

Core tables:

| Table | Purpose |
|---|---|
| `merchants` | One row per merchant terminal. Stores M-Pesa shortcode, KRA PIN, device ID. |
| `consumers` | Consumer accounts. Phone stored as plaintext for STK Push; `phone_hash` (SHA-256) for lookups. |
| `nfc_tags` | Maps an NTAG215 sticker (`tag_id`) to a consumer account. |
| `transactions` | The financial ledger. Append-only; status transitions are the only mutations. |
| `daraja_callback_log` | Raw Safaricom callback bodies. 7-year retention (CBK compliance). |
| `server_audit_log` | Append-only server audit trail: merchant approvals, device events, reconciliation runs. |
| `exchange_rates` | FX rate history (base=KES). Queried for each non-KES transaction. |
| `fiscal_log` | KRA eTIMS receipt records. 7-year retention. |
| `loyalty_programmes` | Merchant loyalty config: reward type, points per KSh, redeem threshold. |
| `loyalty_balances` | Consumer points/stamps balance per merchant. |
| `devices` | Fleet telemetry: battery, NFC stats, printer state, last seen. |
| `web_sessions` | Consumer QR web sessions (short TTL). |

Key indexes:

- `transactions.idempotency_key` — UNIQUE constraint, the double-charge guard
- `transactions.checkout_request_id` — for callback matching
- `transactions.created_at` — for reconciliation range scans
- `consumers.phone_hash` — for phone lookups without exposing PII
- `nfc_tags.tag_id` — for sub-millisecond tag resolution on every tap

### Security Model

**Transport:** TLS enforced. `app.set('trust proxy', 1)` in Express so `req.ip` reflects the real client IP through nginx/load balancer. The Android app pins the TLS certificate (primary + backup pin, see [network_security_config.xml](android/app/src/main/res/xml/network_security_config.xml)).

**Authentication:**
- Merchants: JWT (8h TTL), bcrypt 12 rounds, single-device enforcement, approval gate
- Consumers: separate JWT issued by `/auth/consumer/login`
- Admin operations: `X-Admin-Secret` header

**NFC tag integrity:** Each tag carries an HMAC-SHA256 signature derived from `JWT_SECRET + merchantId`. A cloned or tampered tag is rejected before any DB lookup.

**HCE token integrity:** Single-use HMAC-SHA256 tokens with 90-second TTL. Constant-time comparison — expiry check runs after the HMAC to prevent timing oracles.

**M-Pesa callback authenticity:** Safaricom does not sign callbacks. The only reliable guard is IP-based: all 12 known Safaricom egress IPs are in an allowlist (`middleware/safaricom-ip.ts`). Non-Safaricom sources receive HTTP 403. Disabled in `NODE_ENV !== production`.

**Idempotency:** SHA-256 keyed idempotency check at Redis (fast path) and PostgreSQL `UNIQUE` constraint (durable). Two simultaneous requests with the same key are serialized; the second gets the cached response.

**Circuit breaker:** Daraja STK Push calls are wrapped in a circuit breaker (5 failures → OPEN, 30s reset window). When the circuit is OPEN, new payment requests fail fast with a 503 rather than queuing behind a stalled Daraja.

**Rate limits:**
- General API: 100 requests/min per IP
- Transaction initiation: 30 requests/min per IP
- M-Pesa callbacks: unlimited (Safaricom controls rate; blocking them risks missed confirmations)

---

## Web App

### Quick Start

```bash
cd web
npm install
npm run dev
# → http://localhost:3001 (proxies /api/* to backend at :3000)
```

### Routes

| Portal | Path | Description |
|---|---|---|
| **Auth** | `/auth/login` | Merchant / consumer login with mode toggle |
| | `/auth/register/merchant` | Merchant registration (admin approval required) |
| | `/auth/register/consumer` | Consumer self-registration |
| **Admin** | `/admin/login` | Admin portal login (uses `ADMIN_SECRET`) |
| | `/admin` | Platform stats: volume, success rate, p95 latency, circuit breaker |
| | `/admin/merchants` | Pending merchant approvals |
| | `/admin/fleet` | Device fleet overview |
| **Merchant** | `/merchant/dashboard` | Real-time transaction feed (WebSocket) |
| | `/merchant/transactions` | Paginated transaction history + detail view |
| | `/merchant/analytics` | Weekly revenue, peak hours, payment sources |
| | `/merchant/devices` | Fleet telemetry (battery, NFC, printer state) |
| | `/merchant/loyalty` | Loyalty programme configuration |
| | `/merchant/accounting` | GL export to QuickBooks / Xero / Sage / Wave |
| **Consumer** | `/consumer/dashboard` | Transaction history across merchants |
| | `/consumer/loyalty` | Loyalty balances |
| | `/consumer/pay` | Consumer-initiated payment by merchant ID |
| **Public** | `/pay/[merchantId]` | QR payment page — no account needed |

### Environment

```bash
# web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3000   # backend base URL
```

---

## Android

### Modules

| Module | Description |
|---|---|
| `app` (merchant) | Main merchant terminal app. NFC reader, PaymentOrchestrator, Sunmi printer, WebSocket client, fleet telemetry. |
| `nfc-core` | Shared NFC library: NDEF read/write, tag format validation, HMAC signature verification. |
| `consumer-wallet` | Consumer HCE wallet app. Emulates AID `F04F52434845535441`, handles APDU handshake, displays QR token. |
| `softpos` | SoftPOS module. Play Integrity API attestation, device fingerprinting, soft keyboard PIN entry. |

All modules target **Android 8 (API 26)** minimum, **Android 14 (API 34)** target. Java/Kotlin source level 17.

### Build Variants

| Variant | API base URL | Notes |
|---|---|---|
| `debug` | `http://10.0.2.2:3000` | Emulator host, trusts user-installed CAs (Charles/mitmproxy) |
| `release` | `https://api.orchestratepay.co.ke` | Minified, certificate-pinned, ProGuard/R8 |

BuildConfig fields (`API_BASE_URL`, `WS_BASE_URL`, `SENTRY_DSN`) are injected at compile time. Override in CI:

```bash
./gradlew assembleRelease -PSENTRY_DSN="https://your-dsn@sentry.io/..."
```

### Running on a Device

1. Open `android/` in Android Studio (Electric Eel or later)
2. Sync Gradle
3. Select the `debug` build variant
4. Run on a Sunmi P2 Pro, Sunmi P2 Mini, or any Android 8+ device with NFC

**NFC hardware required:** The manifest declares `android.hardware.nfc` as `required="true"`. Devices without NFC are filtered out on the Play Store.

**HCE (consumer wallet):** HCE is supported on Android 4.4+ (API 19). The `OrchestaHceService` and `ConsumerHceService` register AID `F04F52434845535441` in the `AndroidManifest.xml`. No EMVCo registration needed — the F0–FF range is proprietary.

**Certificate pins:** Before a release build, replace the placeholder SHA-256 pins in [`network_security_config.xml`](android/app/src/main/res/xml/network_security_config.xml):

```bash
openssl s_client -connect api.orchestratepay.co.ke:443 </dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | base64
```

Paste the output as the `<pin digest="SHA-256">` value. Keep the backup pin for the next certificate.

---

## Infrastructure

### Docker Compose (local dev)

```bash
# Start full stack
docker compose up --build

# Start with a clean database
docker compose down -v && docker compose up --build
```

Services:

| Service | Image | Port | Notes |
|---|---|---|---|
| `postgres` | `postgres:15-alpine` | 5432 | AOF persistence, health check |
| `redis` | `redis:7-alpine` | 6379 | AOF + RDB snapshot, `maxmemory-policy noeviction` |
| `backend` | Local Dockerfile | 3000 | Depends on postgres + redis healthy |

Redis is configured `noeviction` — it will error rather than silently drop idempotency keys when memory fills up. Size the Redis instance to comfortably hold all active idempotency keys (each is ~200 bytes, TTL 120s).

### Production Deployment

The backend is a stateless HTTP + WebSocket server. Horizontal scaling requires:

1. **Distributed lock on reconciliation** — add Redlock before scaling past 1 instance (see [Known Gaps](#known-gaps--pre-launch-checklist))
2. **Session affinity not required** — WebSocket connections reconnect automatically; no sticky sessions needed
3. **PostgreSQL connection pool** — default `max: 10` per instance; adjust for your instance count and RDS connection limit
4. **Redis** — single node is fine for pilot; add Redis Sentinel or Cluster for HA

Recommended nginx configuration:

```nginx
server {
    listen 443 ssl;
    server_name api.orchestratepay.co.ke;

    location / {
        proxy_pass         http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";  # required for WebSocket
        proxy_set_header   X-Forwarded-For $remote_addr;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Host $host;
    }
}
```

`X-Forwarded-For` must be set to `$remote_addr` (not `$proxy_add_x_forwarded_for`) so the Safaricom IP allowlist sees the correct source IP, not a chain of proxy IPs.

---

## Testing

```bash
cd backend

# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

Coverage thresholds (enforced by Jest): 60% branches · 70% functions · 70% lines

Test suite (34 files, 717 assertions, ~34 seconds):

| File | What it covers |
|---|---|
| `auth.test.ts` | Merchant login, consumer auth, approval gate, constant-time dummy compare |
| `transactions.test.ts` | STK Push flow, amount bounds, source validation |
| `idempotency.test.ts` | Idempotency key deduplication (cache hit + DB hit) |
| `idempotency-race.test.ts` | Concurrent requests with the same key |
| `concurrency.test.ts` | Race conditions on idempotency check |
| `mpesa-callback.test.ts` | Callback parsing, status transitions, idempotent re-delivery |
| `callback-edge-cases.test.ts` | Duplicate callbacks, out-of-order delivery, unknown `checkoutRequestId` |
| `reconciliation.test.ts` | Stuck transaction recovery, PENDING/STK_SENT expiry |
| `circuit-breaker.test.ts` | CLOSED → OPEN → HALF_OPEN → CLOSED state machine |
| `safaricom-ip.test.ts` | IP allowlist enforcement, IPv4-mapped IPv6, dev bypass |
| `nfc-security.test.ts` | Tag signature validation, replay attack prevention |
| `hce-token.test.ts` | HCE token issuance, constant-time verify, expiry |
| `consumer-tag.test.ts` | Consumer identity verification via tag ID |
| `consumer-qr.test.ts` | Consumer QR token issuance and validation |
| `merchant-hce.test.ts` | Merchant HCE session handling |
| `payment-links.test.ts` | Single-use shareable payment link lifecycle |
| `split-payments.test.ts` | Group bill splitting |
| `p2p-transactions.test.ts` | Consumer-initiated payment flow |
| `fraud-scoring.test.ts` | Velocity checks, amount deviation scoring |
| `device-binding.test.ts` | Single-device enforcement on login |
| `fx.test.ts` | FX rate lookup, conversion, fallback chain |
| `vat.test.ts` | VAT calculation |
| `compliance.test.ts` | KRA / CBK audit log field requirements |
| `cbk-compliance.test.ts` | CBK audit trail completeness |
| `daraja.test.ts` | Access token caching, STK Push, STK Query, error handling |
| `realtime-ws.test.ts` | WebSocket connection, auth, message delivery |
| `z-report.test.ts` | Z-report generation, daily settlement totals |
| `latency-tracker.test.ts` | P95/P99 histogram accuracy |
| `security-injection.test.ts` | SQL injection, XSS, oversized payloads |
| `protocol-handshake.test.ts` | NFC NDEF format, signing, tag ID length |
| `immutable-ledger.test.ts` | Transaction immutability (no status rollbacks) |

---

## Known Gaps / Pre-launch Checklist

### Critical

- [x] **Distributed reconciliation lock** — `util/distributed-lock.ts` implements a Redis SET NX lock; `runReconciliation()` acquires it before each run. Safe for multi-instance deployments.

- [x] **CI/CD pipeline** — `.github/workflows/ci.yml` runs `npm test`, `npm run lint`, and `docker build` on every push to `main`/`develop` and on all PRs.

- [ ] **Kubernetes deployment manifests** — No `k8s/` or Helm chart yet. The `docker-compose.yml` is for local dev only. Required before multi-node production deployment. *(In progress)*

- [x] **TLS certificate pins in Android** — `network_security_config.xml` pins to ISRG Root X1 + X2 (Let's Encrypt CA-level pinning). Survives 90-day leaf cert renewals without an app update. Backup pin covers ECDSA root transition.

- [x] **JWT refresh token rotation** — `merchant_refresh_tokens` table tracks hashed refresh tokens. `issueMerchantRefreshToken` / `refreshMerchantToken` in `auth.ts` implement rotation on use.

### High

- [x] **Sentry error tracking** — `@sentry/node` installed, `util/sentry.ts` initialised before any other import in `index.ts`. Set `SENTRY_DSN` in production `.env`.

- [x] **Readiness probe** — `GET /readiness` runs `SELECT 1` against PostgreSQL and `PING` against Redis; returns 503 if either fails. (`GET /health` is the liveness probe, always 200.)

- [x] **Account lockout on `/auth/login`** — Redis key `auth:lockout:{email}` tracks failed attempts. After 5 consecutive failures the account is locked for 15 minutes; event written to `server_audit_log`.

### Medium

- [x] **`.env.example`** — `backend/.env.example` exists with all required and optional variables documented with placeholder values.

- [x] **Migration versioning** — `migrate.ts` rewritten as a file-based versioned runner. Each migration is a numbered `.sql` file in `src/db/migrations/`. The runner checks `schema_migrations` before applying and skips already-applied files, making re-runs and future schema changes safe.

- [x] **Content-Security-Policy header** — `helmet.contentSecurityPolicy()` configured in `index.ts` with an explicit directive set covering scripts, styles, frames, and connect sources.

- [ ] **Integration tests with real database** — All test files mock the database layer. Real PostgreSQL constraint violations (duplicate keys, FK violations) are not exercised. Add Docker-based integration tests using `testcontainers-node` before launch.

- [x] **Consistent audit logging on admin endpoints** — `writeAuditLog` wired to all state-mutating admin routes: merchant approve/reject (`auth.ts`), remote device config push (`devices.ts`), and FX force-refresh (`fx.ts`). Read-only GET routes do not require audit entries. `adminFleetRouter` also now enforces `requireAdmin` on all routes (was missing the guard).

---

## License

Proprietary — OrchestratePay Ltd. All rights reserved.

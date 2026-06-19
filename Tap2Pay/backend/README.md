# OrchestratePay Backend — Setup & Testing Guide

Node.js 20 + TypeScript + Express API powering the OrchestratePay platform. Handles M-Pesa STK Push, NFC/HCE/QR payment flows, merchant auth, real-time WebSocket updates, GL export, KRA eTIMS receipts, and background reconciliation.

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20 LTS | `node -v` to check |
| PostgreSQL | 15+ | Local or Docker |
| Redis | 7+ | Local or Docker |
| TypeScript | 5.3+ | Installed via `npm install` |

---

## 2. Quick Start

### With Docker (recommended — spins up Postgres + Redis automatically)

```bash
# From Tap2Pay/
docker compose up --build
# postgres:5432, redis:6379, backend:3000 all start with health checks
```

### Without Docker

```bash
cd Tap2Pay/backend

# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in DATABASE_URL, REDIS_URL, DARAJA_* and JWT_SECRET

# 3. Run database migrations
npm run migrate

# 4. Start the development server (hot reload via ts-node-dev)
npm run dev
# → listening on http://localhost:3000
```

---

## 3. Environment Variables

All required variables are checked at startup. Missing ones cause a hard crash with a clear list of what's absent.

```bash
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/orchestratepay
REDIS_URL=redis://localhost:6379

# ── M-Pesa Daraja ─────────────────────────────────────────────────────────────
DARAJA_CONSUMER_KEY=your_consumer_key
DARAJA_CONSUMER_SECRET=your_consumer_secret
DARAJA_SHORTCODE=174379                           # sandbox till number
DARAJA_PASSKEY=bfb279f9aa9bdbcf...               # from Daraja portal
DARAJA_CALLBACK_BASE_URL=https://your-domain.com
DARAJA_ENV=sandbox                                # "production" for live

# ── Application ───────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3000
JWT_SECRET=change_this_to_a_64_char_random_string
ADMIN_SECRET=change_this_to_a_strong_random_secret

# ── Optional ──────────────────────────────────────────────────────────────────
OPENEXCHANGERATES_APP_ID=                         # live FX rates (falls back to hardcoded)
PLAY_INTEGRITY_REQUIRED=false                     # set "true" to enforce SoftPOS attestation
NFC_SIGNING_SECRET=                               # overrides JWT_SECRET for tag HMAC
SENTRY_DSN=                                       # set before going live
LOG_LEVEL=info                                    # debug | info | warn | error

# ── Accounting integrations (optional) ────────────────────────────────────────
QBO_CLIENT_ID=                                    # QuickBooks OAuth
QBO_CLIENT_SECRET=
QBO_SANDBOX=true
XERO_CLIENT_ID=
XERO_CLIENT_SECRET=
SAGE_CLIENT_ID=
SAGE_CLIENT_SECRET=
WAVE_ACCESS_TOKEN=

# ── KRA eTIMS ─────────────────────────────────────────────────────────────────
ETIMS_API_URL=                                    # KRA sandbox or production
ETIMS_API_KEY=                                    # your KRA PIN / API key
```

**Sandbox Daraja credentials** (safe for development):

| Variable | Sandbox value |
|---|---|
| `DARAJA_SHORTCODE` | `174379` |
| `DARAJA_PASSKEY` | `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919` |

---

## 4. Available Scripts

```bash
npm run dev            # hot-reload dev server on :3000 (ts-node-dev)
npm run build          # compile TypeScript → dist/
npm start              # run compiled output (production)
npm run migrate        # apply unapplied SQL migrations in src/db/migrations/
npm test               # run all test suites
npm run test:watch     # re-run tests on file save (TDD mode)
npm run test:coverage  # tests + branch/line/function coverage report
npm run lint           # ESLint + TypeScript type check
npm run lint:fix       # auto-fix lint errors where possible
```

---

## 5. Run Tests

Tests mock the database pool and Redis client — **no live Postgres or Redis required**.

```bash
cd Tap2Pay/backend

# Run all tests
npm test

# Run in watch mode (re-runs on file save)
npm run test:watch

# Run a single test file
npx jest src/__tests__/auth.test.ts

# Run tests matching a name pattern
npx jest --testNamePattern "circuit breaker"
npx jest --testNamePattern "idempotency"

# Run serially (avoids rare timer/module state leaks in parallel mode)
npm test -- --runInBand
```

---

## 6. Coverage Report

```bash
npm run test:coverage
```

The HTML report is written to `coverage/lcov-report/index.html`. Open it:

```bash
open coverage/lcov-report/index.html       # macOS
xdg-open coverage/lcov-report/index.html   # Linux
```

**Coverage thresholds** (enforced in CI — tests fail if below these):

| Metric | Threshold |
|---|---|
| Branches | 60% |
| Functions | 70% |
| Lines | 70% |

---

## 7. Test Suites

85 suites · 1,836 tests · ~18s

### Core Payment Flow

| File | What it covers |
|---|---|
| `auth.test.ts` | Merchant login, consumer auth, approval gate, constant-time dummy compare, account lockout |
| `transactions.test.ts` | STK Push flow, amount bounds, source validation, idempotency fast path |
| `idempotency.test.ts` | Idempotency key deduplication (Redis cache hit + DB UNIQUE constraint) |
| `idempotency-race.test.ts` | Concurrent requests with the same key |
| `concurrency.test.ts` | Race conditions on idempotency check |
| `mpesa-callback.test.ts` | Callback parsing, status transitions, idempotent re-delivery |
| `callback-edge-cases.test.ts` | Duplicate callbacks, out-of-order delivery, unknown `checkoutRequestId` |

### Background Jobs

| File | What it covers |
|---|---|
| `reconciliation.test.ts` | Stuck transaction recovery, PENDING/STK_SENT expiry, Daraja query |
| `jobs-gl-posting.test.ts` | GL posting job: no pending entries, success path, accounting client errors |
| `jobs-subscription-billing.test.ts` | Billing cron: empty queue, STK Push per enrollee, retry on failure, trial expiry |

### Security & Auth Middleware

| File | What it covers |
|---|---|
| `safaricom-ip.test.ts` | IP allowlist enforcement, IPv4-mapped IPv6, dev bypass |
| `nfc-security.test.ts` | NFC tag HMAC signature validation, replay attack prevention |
| `hce-token.test.ts` | HCE token issuance, constant-time verify, 90s expiry |
| `device-binding.test.ts` | Single-device enforcement, Redis device key, DB fallback |
| `middleware-auth-extra.test.ts` | API key auth, `requireAuthOrApiKey`, `last_used_at` fire-and-forget |
| `middleware-validate.test.ts` | Joi validation: required fields, types, `stripUnknown`, multi-error response |
| `security-injection.test.ts` | SQL injection, XSS, oversized payloads |

### NFC / HCE / Consumer

| File | What it covers |
|---|---|
| `consumer-tag.test.ts` | Consumer identity via tag ID |
| `consumer-qr.test.ts` | Consumer QR token issuance and validation |
| `merchant-hce.test.ts` | Merchant HCE session activate/expire/clear |
| `protocol-handshake.test.ts` | NFC NDEF format, signing, tag ID length |

### Routes

| File | What it covers |
|---|---|
| `routes-attestation.test.ts` | SoftPOS Play Integrity token verify, `PLAY_INTEGRITY_REQUIRED` gate |
| `routes-webhooks.test.ts` | Webhook CRUD, HMAC signing, delivery job, abort timeout |
| `routes-api-keys.test.ts` | API key creation, hash verification, expiry, `last_used_at` update |
| `payment-links.test.ts` | Single-use shareable payment link lifecycle |
| `split-payments.test.ts` | Group bill splitting, per-participant STK Push |
| `p2p-transactions.test.ts` | Consumer-initiated QR payment flow |

### Integrations

| File | What it covers |
|---|---|
| `daraja.test.ts` | Access token caching, STK Push, STK Query, B2C stub, phone normalisation |
| `integrations-etims.test.ts` | KRA eTIMS: local skip, invoice body format, 400/401/500 error paths, idempotency |
| `integrations-quickbooks.test.ts` | Journal entry POST, 401 token refresh, sandbox vs production URL |
| `integrations-xero.test.ts` | ManualJournals PUT, Xero debit/credit convention, token refresh |
| `integrations-sage.test.ts` | Sage journals POST, ledger codes, token refresh |
| `integrations-wave.test.ts` | Wave GraphQL mutation, missing anchor account guard |
| `integrations-africas-talking.test.ts` | SMS dispatch, delivery receipt callback |
| `fcm.test.ts` | FCM push token registration, notification dispatch |

### Analytics & Reporting

| File | What it covers |
|---|---|
| `z-report.test.ts` | Z-report generation, daily settlement totals, empty day |
| `vat.test.ts` | 16% VAT calculation, rounding |
| `latency-tracker.test.ts` | P95/P99 histogram accuracy |
| `fx.test.ts` | FX rate lookup, KES conversion, fallback chain |

### Infrastructure & Compliance

| File | What it covers |
|---|---|
| `circuit-breaker.test.ts` | CLOSED → OPEN → HALF_OPEN → CLOSED state machine, 30s reset |
| `realtime-ws.test.ts` | WebSocket connection, JWT auth, message delivery, pub/sub |
| `immutable-ledger.test.ts` | Transaction immutability (no status rollbacks) |
| `compliance.test.ts` | KRA / CBK audit log field requirements |
| `cbk-compliance.test.ts` | CBK 7-year audit trail completeness |
| `fraud-scoring.test.ts` | Velocity checks, amount deviation scoring, risk flags |
| `util-fraud.test.ts` | Fraud utility function unit tests |
| `coverage-gaps-utils.test.ts` | Utility catch/error paths (circuit breaker open, logger levels) |

---

## 8. Route Modules

All routes are mounted under `/api/v1`:

| Mount path | File | Description |
|---|---|---|
| `/auth` | `routes/auth.ts` | Login, registration, refresh, lockout |
| `/transactions` | `routes/transactions.ts` | Core payment initiation (NFC/HCE/QR/SoftPOS) |
| `/mpesa-callback` | `routes/mpesa-callback.ts` | Safaricom webhook (IP-gated) |
| `/merchants` | `routes/merchants.ts` | Merchant CRUD, profile, analytics, Z-report |
| `/consumers` | `routes/consumers.ts` | Consumer auth, QR pay, status polling |
| `/tags` | `routes/tags.ts` | NFC tag provisioning and signing |
| `/admin` | `routes/admin.ts` | Stats, merchant approvals, audit log |
| `/devices` | `routes/devices.ts` | Fleet telemetry ingest |
| `/loyalty` | `routes/loyalty.ts` | Points and stamps programmes |
| `/fx` | `routes/fx.ts` | FX rate queries |
| `/accounting` | `routes/accounting.ts` | GL export + eTIMS fiscal receipts |
| `/payment-links` | `routes/payment-links.ts` | Shareable single-use payment links |
| `/split-payments` | `routes/split-payments.ts` | Multi-party bill splitting |
| `/rails` | `routes/payment-rails.ts` | Alternative payment rails |
| `/wallet` | `routes/wallet.ts` | Consumer wallet operations |
| `/attestation` | `routes/attestation.ts` | Play Integrity attestation for SoftPOS |
| `/webhooks` | `routes/webhooks.ts` | Merchant webhook subscriptions |
| `/api-keys` | `routes/api-keys.ts` | Merchant API key management |
| `/disputes` | `routes/disputes.ts` | Payment dispute lifecycle |
| `/refunds` | `routes/refunds.ts` | B2C refund initiation |
| `/subscriptions` | `routes/subscriptions.ts` | Recurring subscription plans |

---

## 9. Background Jobs

| Job | Schedule | File |
|---|---|---|
| Reconciliation | Every 5 min | `jobs/reconciliation.ts` |
| GL Posting | Every 2 min | `jobs/gl-posting.ts` |
| Webhook Delivery | Every 1 min | `jobs/webhook-delivery.ts` |
| Subscription Billing | Every 1 min | `jobs/subscription-billing.ts` |
| Trial Expiry | Daily 02:00 | `jobs/subscription-billing.ts` |
| FX Refresh | Every hour | `util/fx.ts` |
| MV Refresh | Every 15 min | inline in `index.ts` |

All jobs use Redlock (`util/distributed-lock.ts`) so only one instance runs per job in multi-replica deployments.

---

## 10. Database Migrations

Migrations live in `src/db/migrations/`. The runner (`src/db/migrate.ts`) tracks applied files in a `schema_migrations` table and only applies new ones.

```bash
# Apply any unapplied migrations
npm run migrate

# Add a new migration
# Create: src/db/migrations/003_<description>.sql
# Run:    npm run migrate
```

Never edit already-applied migration files. Always add a new numbered file.

---

## 11. Health Endpoints

| Path | Purpose | Auth |
|---|---|---|
| `GET /health` | Liveness probe — always 200 (no DB hit) | None |
| `GET /readiness` | Readiness probe — runs `SELECT 1` + Redis PING, 503 if either fails | None |
| `GET /health/deep` | Deep check — per-component status (database/redis) with degraded/down granularity | None |

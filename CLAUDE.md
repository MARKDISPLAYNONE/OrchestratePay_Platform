# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (`Tap2Pay/backend/`)

```bash
npm run dev            # hot-reload dev server on :3000 (ts-node-dev)
npm run build          # compile TypeScript → dist/
npm start              # run compiled output (production)
npm run migrate        # run versioned SQL migrations (src/db/migrations/)
npm test               # run all 71 test suites (~12s)
npm run test:coverage  # tests + branch/line coverage report
npm run lint           # ESLint + TypeScript check
npm run lint:fix       # auto-fix lint errors
```

Run a single test file:
```bash
npx jest src/__tests__/auth.test.ts
npx jest --testNamePattern "circuit breaker"
```

### Web (`Tap2Pay/web/`)

```bash
npm run dev            # Next.js dev server (auto-selects :3001 if :3000 is taken)
npm run build          # production build
npm run lint           # Next.js ESLint
npm run test:unit      # Jest unit tests
npm run test:e2e       # Playwright end-to-end tests
npm run test:e2e:ui    # Playwright with interactive UI
```

### Docker (full local stack)

```bash
cd Tap2Pay
docker compose up --build   # Postgres :5432 + Redis :6379 + Backend :3000
```

## Architecture

### Request Lifecycle

All API traffic enters `Tap2Pay/backend/src/index.ts`. Middleware is applied in strict order:
`Helmet → CORS → Rate limiter (100/30 rpm) → Morgan → JSON parser → requestId → Routes → Error handler`

The `/mpesa-callback` route has an extra `requireSafaricomIp` middleware that gates on Safaricom's 12 published egress IPs — callbacks from any other IP are rejected with HTTP 403 before route logic runs.

### Authentication & RBAC

`src/middleware/auth.ts` decodes JWTs and attaches `req.merchant` (MERCHANT role), `req.consumer` (CONSUMER role), or handles ADMIN (also accepts `X-Admin-Secret` header as a fallback). Legacy merchant JWTs without a `role` claim are treated as MERCHANT for backwards compatibility. Device binding is verified on every merchant request via a Redis key (`merchant:device:{merchantId}`, TTL 9h) and a DB `device_bindings` lookup.

### Payment Flow (critical invariants)

1. **PENDING before STK Push** — every transaction is written as `PENDING` to PostgreSQL before `POST /api/v1/transactions` fires a Daraja STK Push. The 5-minute reconciliation job (`src/jobs/reconciliation.ts`) recovers any `PENDING` transactions older than 90 minutes.
2. **Double-charge prevention** — idempotency key is checked in Redis first (fast path), then enforced by a `UNIQUE` constraint on `idempotency_key` in PostgreSQL (slow path).
3. **NFC tag authentication** — HMAC-SHA256 signed with merchant-scoped keys (`src/util/nfc-signing.ts`). Cloned/invalid tags are rejected before any DB write.
4. **HCE tokens** — single-use with 90-second TTL, constant-time comparison (`src/util/hce-token.ts`). AID: `F04F52434845535441`.

### Route Modules (13 total, `src/routes/`)

| File | Responsibility |
|---|---|
| `auth.ts` | Login, registration, refresh tokens, account lockout |
| `transactions.ts` | Core payment initiation (NFC_TAG, HCE_PHONE, QR_CODE, SOFTPOS_MOBILE) |
| `mpesa-callback.ts` | Safaricom webhook — updates status, publishes WebSocket event |
| `merchants.ts` | Merchant CRUD, profile, onboarding |
| `consumers.ts` | Consumer auth, QR pay, transaction status polling |
| `tags.ts` | NFC tag provisioning and signing |
| `admin.ts` | Stats, merchant approvals, audit log |
| `devices.ts` | Device binding, fleet telemetry |
| `loyalty.ts` | Points and stamps loyalty programmes |
| `fx.ts` | FX rate queries; `adminFxRouter` for force-refresh |
| `accounting.ts` | GL export (QuickBooks, Xero, Sage, Wave) + eTIMS fiscal receipts |
| `payment-links.ts` | Shareable payment links |
| `split-payments.ts` | Multi-party payment splitting |
| `payment-rails.ts` | Alternative payment rails |
| `wallet.ts` | Consumer wallet operations |
| `attestation.ts` | Play Integrity attestation for SoftPOS |

### Background Jobs

- **Reconciliation** (`src/jobs/reconciliation.ts`) — runs every 5 minutes via `node-cron`. Uses `src/util/distributed-lock.ts` (Redlock) so only one instance runs in multi-replica deployments. Expires `PENDING` transactions older than 90 minutes.
- **GL Posting** (`src/jobs/gl-posting.ts`) — runs every 2 minutes. Pushes confirmed transactions to the configured accounting platform.

### Real-time Updates

`src/realtime/ws-server.ts` — WebSocket server sharing the HTTP server instance. On `mpesa-callback`, the route publishes to Redis pub/sub; the WS server subscribes and pushes status updates to connected merchant terminals.

### Database

Single migration file: `src/db/migrations/001_initial.sql`. Add new migrations as `002_<description>.sql` — the versioned runner (`src/db/migrate.ts`) applies only unapplied files in alphabetical order, each in its own transaction.

PostgreSQL pool: `src/db/index.ts`. Redis client: `src/db/redis.ts` (ioredis).

### Testing

Tests live in `src/__tests__/`. The test environment mocks the database pool and Redis — tests do **not** require live Postgres or Redis. The `uuid` package is mapped to a CJS shim (`__mocks__/uuid.js`) because uuid v14 is pure ESM.

Coverage thresholds (enforced in CI): branches 60%, functions 70%, lines 70%.

### Android Modules (`Tap2Pay/android/`)

| Module | Purpose |
|---|---|
| `app/` | Merchant terminal for Sunmi P2 Pro — reads NFC tags, fires payment |
| `nfc-core/` | Shared AAR library for tag read/write and NDEF formatting |
| `consumer-wallet/` | HCE consumer wallet — emulates NFC card to terminal |
| `softpos/` | SoftPOS with Play Integrity attestation |

Open `Tap2Pay/android/` in Android Studio (Electric Eel+), sync Gradle, select `debug` build variant.

### Infrastructure

K8s manifests live in `infra/k8s/`. Two **P0 pre-deploy fixes** are required before first production deploy — see the "Known Production Gaps" section in `README.md`:
1. Rename `DARAJA_CALLBACK_URL` → `DARAJA_CALLBACK_BASE_URL` in `infra/k8s/backend/deployment.yaml`
2. Add `ADMIN_SECRET` and `NFC_SIGNING_SECRET` to `infra/k8s/secrets.template.yaml` and `deployment.yaml`

CI runs on every PR to `main` and every push to `main`/`develop` via `.github/workflows/ci.yml`. It spins up real Postgres 15 and Redis 7 services — tests run against them, not mocks.

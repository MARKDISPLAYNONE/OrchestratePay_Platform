# OrchestratePay — NFC Tap-to-Pay Platform

M-Pesa NFC/QR payments for Kenyan merchants. A merchant taps an NFC sticker on their Sunmi P2 Pro terminal or scans a QR code; the consumer's phone receives an M-Pesa STK Push and enters their PIN. Payment confirmed in seconds, receipt printed instantly.

## What's Inside

| Component | Stack | Location |
|---|---|---|
| **Backend API** | Node.js 20 + TypeScript + Express | `Tap2Pay/backend/` |
| **Web App** | Next.js 14 + Tailwind CSS | `Tap2Pay/web/` |
| **Merchant Terminal** | Kotlin + Coroutines (Sunmi P2 Pro) | `Tap2Pay/android/app/` |
| **Consumer Wallet** | Kotlin HCE (phone-to-terminal) | `Tap2Pay/android/consumer-wallet/` |
| **SoftPOS** | Kotlin + Play Integrity | `Tap2Pay/android/softpos/` |
| **NFC Core Library** | Kotlin (shared AAR) | `Tap2Pay/android/nfc-core/` |

## Architecture

```
Payment Sources
──────────────────────────────────────────────────────────
  Sunmi Terminal    Consumer Wallet    Web QR Page
  (NFC_TAG)         (HCE_PHONE)       (QR_CODE / SOFTPOS_MOBILE)
       │                  │                    │
       └──────────────────┴────────────────────┘
                          │
              OrchestratePay Backend (Express/TS)
              ┌──────────────────────────────────┐
              │  13 route modules                 │
              │  JWT auth + RBAC                 │
              │  Rate limiting (100/30 rpm)       │
              │  Safaricom IP allowlist           │
              │  Circuit breaker (Daraja)         │
              └──────────────────────────────────┘
                    │              │
              PostgreSQL        Redis
              (ledger, 14+    (idempotency
               tables)         cache + pub/sub)
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
    KRA eTIMS    FX Rates     GL Export
                           (QuickBooks/Xero/
                            Sage/Wave)
```

**Critical invariants:**
1. `PENDING` is written to DB *before* STK Push fires — crash-safe by design
2. Idempotency enforced at two layers: Redis fast-path + PostgreSQL `UNIQUE` constraint on `idempotency_key`
3. M-Pesa callbacks accepted only from Safaricom's 12 published egress IPs in production
4. NFC tags are HMAC-SHA256 signed with merchant-scoped keys — cloned tags rejected before any DB touch
5. HCE tokens are single-use with 90-second TTL + constant-time comparison

## Repository Layout

```
OrchestratePay_Platform/
├── README.md               ← you are here
└── Tap2Pay/
    ├── README.md           ← detailed backend/Android/infra docs
    ├── docker-compose.yml  ← Postgres 15 + Redis 7 + backend (local dev)
    ├── backend/            ← Node.js/TypeScript API
    │   ├── src/
    │   │   ├── routes/         13 route modules (~50 endpoints)
    │   │   ├── middleware/     auth, validate, safaricom-ip, request-id
    │   │   ├── integrations/   daraja, etims, accounting (4 platforms), africas-talking
    │   │   ├── jobs/           reconciliation (5 min), gl-posting (2 min)
    │   │   ├── realtime/       WebSocket server (ws-server.ts)
    │   │   ├── util/           fx, nfc-signing, hce-token, circuit-breaker, fraud, vat
    │   │   └── db/             PostgreSQL pool, Redis, migrations (14+ tables)
    │   ├── src/__tests__/      34 test suites · 717 assertions · all passing
    │   └── Dockerfile          Multi-stage Node 20 Alpine, non-root user
    ├── web/                ← Next.js 14 web app
    │   └── src/app/
    │       ├── auth/           Login, merchant & consumer registration
    │       ├── admin/          Admin portal (stats, approvals, fleet)
    │       ├── merchant/       Dashboard, transactions, analytics, loyalty, accounting
    │       ├── consumer/       Dashboard, profile, loyalty, pay
    │       └── pay/[merchantId]  Public QR payment page (no app needed)
    └── android/            ← Kotlin Android apps
        ├── app/            Merchant terminal (Sunmi P2 Pro)
        ├── nfc-core/       Shared NFC library
        ├── consumer-wallet/ HCE consumer wallet
        └── softpos/        SoftPOS + Play Integrity
```

## Quick Start

### Option A — Docker (recommended for first run)

```bash
cd Tap2Pay
cp backend/.env.example backend/.env
# Edit backend/.env — set DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, JWT_SECRET, ADMIN_SECRET

docker compose up --build
# Postgres :5432, Redis :6379, Backend API :3000 all start with health checks
```

### Option B — Local Development

```bash
# 1. Backend
cd Tap2Pay/backend
cp .env.example .env           # fill in credentials
npm install
npm run migrate                # create all DB tables
npm run dev                    # hot reload on :3000

# 2. Web app (separate terminal)
cd Tap2Pay/web
npm install
npm run dev                    # Next.js on :3001 (proxies /api/* to :3000)

# 3. Expose backend for Safaricom callbacks
ngrok http 3000
# Copy the https URL → set DARAJA_CALLBACK_BASE_URL in .env
```

### Option C — Local Development (step-by-step)

**Step 1 — Install PostgreSQL and Redis**

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib redis-server
sudo systemctl enable postgresql redis-server
sudo systemctl start postgresql redis-server
```

**Step 2 — Create the database user and database**

```bash
sudo -u postgres psql -c "CREATE USER orchestratepay WITH PASSWORD 'devpassword';"
sudo -u postgres psql -c "CREATE DATABASE orchestratepay OWNER orchestratepay;"
```

**Terminal 1 — Backend**

```bash
cd ~/AXLE/OrchestratePay_Platform/Tap2Pay/backend
cp .env.example .env
# Edit .env: set DATABASE_URL=postgresql://orchestratepay:devpassword@localhost:5432/orchestratepay
npm install
npm run migrate      # creates all DB tables
npm run dev          # starts Express API on :3000 with hot reload
```

**Terminal 2 — Web app** (open a new terminal)

```bash
cd ~/AXLE/OrchestratePay_Platform/Tap2Pay/web
npm install
npm run dev          # Next.js on :3001 (proxies /api/* → backend :3000)
```

> **Port conflict note:** Start the backend first. Both default to :3000, but Next.js will auto-pick :3001 if :3000 is already taken.

**Terminal 3 — M-Pesa callbacks** (only needed for payment testing)

```bash
ngrok http 3000
# Copy the https://xxxx.ngrok.io URL
# Paste it into backend/.env:
#   DARAJA_CALLBACK_BASE_URL=https://xxxx.ngrok.io
# Then restart the backend (Ctrl+C → npm run dev)
```

**Where things run:**

| Service | URL |
|---|---|
| Backend API | http://localhost:3000 |
| Web dashboard | http://localhost:3001 |
| Health check | http://localhost:3000/health |

**Stopping everything:**

- Backend and web dev servers: `Ctrl+C` in each terminal
- ngrok: `Ctrl+C` in its terminal
- PostgreSQL and Redis (stop but keep installed):

```bash
sudo systemctl stop postgresql redis-server
```

- PostgreSQL and Redis (disable auto-start on boot):

```bash
sudo systemctl disable postgresql redis-server
```


### Android

```
Open Tap2Pay/android/ in Android Studio (Electric Eel or later)
→ Sync Gradle
→ Select 'debug' build variant
→ Run on Sunmi P2 Pro or any Android 8+ device with NFC
```

## Running Tests

```bash
cd Tap2Pay/backend
npm test                  # 34 suites, 717 assertions (~34 seconds)
npm run test:coverage     # with branch/line coverage report
npm run lint              # ESLint + TypeScript check
```

## Key Capabilities

| Feature | Status |
|---|---|
| M-Pesa STK Push (NFC, QR, HCE, SoftPOS) | Production-ready |
| NFC tag signing (HMAC-SHA256, per-merchant keys) | Production-ready |
| HCE phone-to-terminal (AID F04F52434845535441) | Production-ready |
| Idempotency (Redis + PostgreSQL UNIQUE) | Production-ready |
| Real-time WebSocket payment status | Production-ready |
| Circuit breaker on Daraja calls | Production-ready |
| Reconciliation job (every 5 min, 90-min expiry) | Production-ready |
| FX conversion (7 currencies, KES base) | Production-ready |
| KRA eTIMS fiscal receipts | Production-ready |
| GL export (QuickBooks, Xero, Sage, Wave) | Production-ready |
| Loyalty programmes (points + stamps) | Production-ready |
| Fleet telemetry (battery, NFC, printer state) | Production-ready |
| Fraud scoring (velocity + amount deviation) | Production-ready |
| CBK 7-year audit log | Production-ready |
| Payment links + split payments | Implemented |
| SMS notifications (Africa's Talking) | Implemented (disabled by default) |
| Admin portal (web) | Implemented |
| Consumer portal (web) | Implemented |
| Merchant portal (web) | Implemented |

## Sandbox Testing

Safaricom sandbox credentials (safe to use in dev, never charges real money):

```
Test phone: 254708374149
M-Pesa PIN: 1234
Shortcode:  174379
```

## Environment Variables (backend/.env)

```bash
# Required
DATABASE_URL=postgresql://orchestratepay:devpassword@localhost:5432/orchestratepay
REDIS_URL=redis://localhost:6379
JWT_SECRET=<64-char random string — openssl rand -hex 64>
ADMIN_SECRET=<strong random string>
DARAJA_CONSUMER_KEY=<from developer.safaricom.co.ke>
DARAJA_CONSUMER_SECRET=<from developer.safaricom.co.ke>
DARAJA_SHORTCODE=174379
DARAJA_PASSKEY=bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
DARAJA_CALLBACK_BASE_URL=https://your-public-url.com

# Optional
DARAJA_ENV=sandbox                  # set "production" for live payments
OPENEXCHANGERATES_APP_ID=           # for live FX rates
SENTRY_DSN=                         # add before going live
SMS_ENABLED=false                   # Africa's Talking SMS
LOG_LEVEL=info
```

## Pre-launch Checklist

Critical items before production:

- [ ] Add distributed Redlock to reconciliation job (required before running 2+ backend instances)
- [ ] Set up CI/CD pipeline (GitHub Actions — tests + lint + Docker build on every PR)
- [ ] Add Kubernetes/Helm manifests for production deployment
- [ ] Replace placeholder TLS certificate pins in `network_security_config.xml`
- [ ] Add JWT refresh token rotation (current 8-hour access tokens have no revocation)
- [ ] Integrate Sentry (production errors currently go to stdout only)
- [ ] Add `/readiness` probe (current `/health` always returns 200 regardless of DB state)
- [ ] Implement account lockout after failed login attempts

See `Tap2Pay/README.md` for the full pre-launch checklist with implementation details.

## License

Proprietary — OrchestratePay Ltd. All rights reserved.

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
    │   ├── src/__tests__/      71 test suites · 1,291 assertions · all passing
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
npm test                  # 71 suites, 1,291 assertions (~12 seconds)
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

## Known Production Gaps (P0)

These issues **will cause a failed deployment** if not fixed before applying the K8s manifests. They are intentionally left as manual action items — fixing them requires your specific credentials and cluster details.

### 1 — Env var name mismatch: `DARAJA_CALLBACK_URL` vs `DARAJA_CALLBACK_BASE_URL`

`infra/k8s/backend/deployment.yaml` injects the Daraja callback URL as:
```yaml
- name: DARAJA_CALLBACK_URL
  valueFrom:
    configMapKeyRef:
      name: orchestratepay-config
      key: daraja-callback-url
```

But `src/index.ts` startup check requires `DARAJA_CALLBACK_BASE_URL`:
```typescript
const required = [..., 'DARAJA_CALLBACK_BASE_URL', ...]
```

**Fix:** Rename the env var in `deployment.yaml` from `DARAJA_CALLBACK_URL` to `DARAJA_CALLBACK_BASE_URL`.

### 2 — Missing env vars in K8s deployment

`ADMIN_SECRET` and `NFC_SIGNING_SECRET` are required at startup but are absent from `infra/k8s/backend/deployment.yaml` and `infra/k8s/secrets.template.yaml`.

**Fix:** Add both to `secrets.template.yaml`:
```yaml
data:
  admin-secret: <base64-encoded value>
  nfc-signing-secret: <base64-encoded value>
```

And add to `deployment.yaml` container env:
```yaml
- name: ADMIN_SECRET
  valueFrom:
    secretKeyRef:
      name: orchestratepay-secrets
      key: admin-secret
- name: NFC_SIGNING_SECRET
  valueFrom:
    secretKeyRef:
      name: orchestratepay-secrets
      key: nfc-signing-secret
```

---

## Pre-launch Checklist

Critical items before production:

- [x] Add distributed Redlock to reconciliation job — implemented in `util/distributed-lock.ts`, used by reconciliation job
- [x] Set up CI/CD pipeline — `.github/workflows/ci.yml` runs tests, lint, and Docker build on every PR
- [x] Add Kubernetes/Helm manifests for production deployment — manifests in `infra/k8s/`; see P0 gaps above for two required fixes before first deploy
- [x] Replace placeholder TLS certificate pins in `network_security_config.xml` — pins to ISRG Root X1/X2 (Let's Encrypt CA), survives 90-day cert renewals
- [x] Add JWT refresh token rotation — `merchant_refresh_tokens` table + `issueMerchantRefreshToken` in `auth.ts`
- [x] Integrate Sentry — `@sentry/node` wired in `util/sentry.ts`, initialised at startup
- [x] Add `/readiness` probe — `GET /readiness` checks PostgreSQL + Redis, returns 503 on failure
- [x] Implement account lockout after failed login attempts — Redis-based per-email lockout (5 attempts → 15 min) in `auth.ts`
- [x] Migration versioning — `migrate.ts` rewritten as versioned runner; migrations live in `src/db/migrations/`
- [x] Admin endpoint audit logging — `requireAdmin` guard + `writeAuditLog` added to fleet config push and FX force-refresh

See `Tap2Pay/README.md` for the full pre-launch checklist with implementation details.

##Here's the complete picture — organized by what matters most:

What's Missing: Full Gap Analysis
🔴 Blocking — Breaks Core Promises
1. Merchant Settlement (Money Never Reaches Merchants)
Zero settlement infrastructure. Merchants process payments but there's no mechanism to move float to their bank accounts. This is the most critical gap — a payment platform that doesn't pay out is just an expensive ledger. Need:

settlement_accounts table (merchant IBAN/bank details)
A nightly settlement job (T+0 or T+1) using Daraja B2B or bank API
Settlement history endpoint + web page
Minimum payout thresholds and hold periods
2. B2C Refunds Don't Actually Work
initiateB2cPayout() throws unconditionally. Refunds are accepted via the API and immediately fail silently. Real B2C credentials + the Daraja B2C endpoint call need to be implemented.

3. Merchant Self-Service Onboarding + KYC
Registration is admin-only. No self-service signup, no document upload (national ID, business registration, KRA certificate), no automated approval flow. Every merchant requires manual admin intervention.

🟠 High Business Impact — Missing Revenue & Retention
4. Card Payment Rails (Visa/Mastercard/PesaLink)
payment-rails.ts defines 5 non-M-Pesa rails — all return 501 Not Implemented. Kenya has growing card usage. Integrating a PSP (e.g., DPO Group or Cellulant) for card acquiring would unlock a major merchant segment.

5. Airtel Money + T-Kash
STK Push is M-Pesa only. ~30% of Kenyan mobile subscribers are on Airtel or Telkom. Airtel Money API + T-Kash (Telkom) integration would give merchants full market coverage.

6. USSD Payment Initiation Fallback
Africa's Talking is wired only for OTP/alerts. For feature phones (still significant in rural Kenya), a USSD-initiated payment (*334*amount*merchantId#) would dramatically expand the addressable merchant base.

7. Consumer Credit / BNPL
Zero lending logic. This is the highest-margin fintech product. Integrating with a credit bureau (e.g., Metropol, TransUnion Kenya) for instant credit scoring + offering buy-now-pay-later at checkout is a major revenue unlock and retention driver.

8. Merchant Analytics Dashboard
The admin web has basic stats. Merchants need their own analytics: revenue trends, peak hours, top customers, average basket size, loyalty ROI, chargeback rates. This is table-stakes for merchant retention.

🟡 Competitive Edge — What Separates Good from Best
9. OpenAPI / Developer SDK
No Swagger docs, no client SDK, no sandbox environment. Every serious payment platform (Stripe, Flutterwave, Paystack) has this. Without it, B2B integrations require the merchant to read raw route files. A Swagger UI + a Node.js/Python SDK would unlock the developer-merchant segment entirely.

10. Per-Merchant Rate Limiting
Currently global (100 req/min for all merchants combined). One misbehaving merchant can degrade service for others. Redis-backed per-merchant rate limiting (sliding window keyed on merchantId) is essential for multi-tenant fairness.

11. Instant Settlement (T+0)
Most Kenyan processors are T+1 or T+2. Offering same-day settlement as a premium feature (small fee) is a strong differentiator that wins price-sensitive merchants even if the transaction fee is slightly higher.

12. Merchant Financing (Revenue-Based)
The platform has 100% visibility into each merchant's transaction history. That data is a credit score. Offering working capital advances (e.g., "KSh 50,000 advance, repaid at 5% of daily receipts") is how Square, Stripe, and M-Kopa built massive secondary revenue streams.

13. Terminal Lifecycle: Repair, Swap, Insurance
The Android fleet has MDM hooks but no terminal insurance or swap program. Merchants whose Sunmi P2 Pro breaks are dead in the water. A hardware-as-a-service subscription (device swap SLA + insurance) is a moat — hardware is sticky.

🔵 Platform-Level (Makes This a Super-App)
14. Cross-Border Payments (EAC)
The FX module handles rates but there's no cross-border send. Tanzania (TIGO Pesa, Airtel TZ), Uganda (MTN MoMo), Rwanda (MTN Rwanda) are all reachable via mobile money APIs. Position as the East African Commerce rail, not just a Kenyan one.

15. Consumer Super-Wallet
The consumer app is payment-only. Adding bill payments (KPLC electricity, Nairobi Water, DSTV), airtime top-up, and peer-to-peer transfers (not just merchant pay) turns it into a daily-use app — which is the only way to win consumer loyalty in a mobile money market.

16. Marketplace / Platform Payments
Split payments exist but there's no marketplace model: a platform merchant who takes a cut, disburses to multiple sub-merchants, and manages the escrow period. This unlocks e-commerce, gig economy, and delivery platforms as customers.

17. Embedded Finance / White-Label API
The platform's infrastructure (NFC, HCE, STK Push, ledger) could be offered as white-label to SACCOs, MFIs, and smaller banks who can't afford to build this themselves. That's the B2B2C model that Interswitch and Cellulant use to scale.

Quick Priority Stack-Rank
Priority	Feature	Why
1	Settlement job	Merchants can't use a platform that doesn't pay them out
2	Real B2C refunds	Consumer trust depends on this
3	Merchant self-onboarding + KYC	Can't scale with admin-only registration
4	Airtel Money + T-Kash	30% market coverage gap
5	OpenAPI + SDK	Unlocks B2B integrations without hand-holding
6	Merchant analytics dashboard	Retention — merchants stay where they can see their numbers
7	Per-merchant rate limiting	Multi-tenancy correctness
8	BNPL / consumer credit	Highest-margin product available
9	Card rails (DPO/Cellulant)	Corporate and tourist segment
10	Cross-border EAC	Regional moat
The platform is already ahead of most Kenyan competitors on NFC depth, offline resilience, and real-time WebSocket confirmations. Settlement, refunds, and self-onboarding are the three things that would block a CBK production license. Everything else is differentiation
## License

Proprietary — OrchestratePay Ltd. All rights reserved.

# CLAUDE.md

Orientation for Claude Code / AI-assisted sessions on this repository.

**This file carries no project status.** Before doing anything, read `docs/SESSION_HANDOVER.md` §0–§2 — it has the open bugs, the plan, the environment traps, and the onboarding order. If this file and the handover disagree, the handover wins; if the handover and a command's output disagree, the output wins.

## Rules for working in this repo

1. **No status claim without pasted command output.** Not in chat, not in docs, not in commit messages. "Committed", "applied", and "verified" are three different states — always say which one.
2. `git status --short` before every commit; check the `N files changed` line against intent. Push to `fork`, never `origin`.
3. The dev terminal is Git Bash / MINGW64 on Windows. **One command per paste** — multi-line blocks scramble.
4. **Angle brackets are stripped from anything pasted into the chat.** XML files and generics-heavy Kotlin must be dumped with `sed 's/</[/g; s/>/]/g' FILE` before pasting. `grep`/`cat` "returning nothing" on an XML file is NOT evidence the file is empty — this produced one false bug report (July, Bug #2) and one false "terminal bug" (Session 5).
5. Backend readiness is the literal log line `OrchestratePay backend running on port 3000`, not the version banner. Curling before it produces phantom failures.
6. READMEs describe design and how-to. They never carry status words ("ready", "verified", "done"). Status lives only in the handover.
7. Every backend test mocks PostgreSQL and Redis; every Android test mocks the network. **Client/server contract drift (Kotlin data class ≠ `res.json`) is invisible to both.** It has been the root cause of Bugs #10, #14, #17. Check the live JSON with curl before trusting a data class.
8. Do not `git checkout --` a mysteriously dirty file without running `git diff -w --stat` first.

## Commands

### Backend (`Tap2Pay/backend/`)
```bash
npm run dev            # ts-node-dev on :3000 — WAIT for "OrchestratePay backend running on port 3000"
npm run build          # tsc → dist/
npm start              # run compiled output
npm run migrate        # versioned SQL runner, src/db/migrations/ (001–004 applied)
npm test               # 93 suites · 1959 tests · 108 FAILING as of 2 Sep 2026 (pre-existing, Bug #15)
npm run test:coverage  # thresholds: branches 60 / functions 70 / lines 70
npm run lint
npx jest src/__tests__/auth.test.ts
npx jest --testNamePattern "circuit breaker"
```
Redis is not on PATH on the dev machine: `/c/Users/admin/redis/redis-server.exe --port 6379`. Orphaned servers after Ctrl+C: `/c/Windows/System32/netstat.exe -ano | grep :3000` → `taskkill //F //PID <pid>`. Docker is **not installed** on the dev machine — none of the three `docker-compose*.yml` files are usable there.

### Web (`Tap2Pay/web/`)
```bash
npm run dev            # Vite 6 on :3001, proxies /api/* → :3000
npm run build
npm run lint
npm run test:unit      # Jest + RTL — 23 suites · 452 assertions
npm run test:e2e       # Playwright (page.route mocks, no live backend needed)
```

### Android (`Tap2Pay/android/`)
```bash
./gradlew assembleDebug                              # all 4 modules; Gradle 9.4.1, Java 21; AGP deprecation warnings are noise
./gradlew :app:test :consumer-wallet:test            # JVM unit tests
./gradlew :consumer-wallet:compileDebugKotlin        # fastest single-module compile check
adb reverse tcp:3000 tcp:3000                        # REQUIRED per device; does not survive adb restarts
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -s AndroidRuntime:E                       # crash triage
```
Emulator: `emulator-5554`. Real device: `RF8R42CY49R`. **Emulators have no NFC radio** — they are for login/UI/API testing only. HCE and tag flows need two physical phones.

Before an Android login can succeed: backend `/readiness` returns `ready`; a merchant exists AND is `APPROVED` (registration needs `ADMIN_SECRET`); `adb reverse --list` shows the port. Test accounts are in the handover §1.

## Architecture

### Request lifecycle
All traffic enters `backend/src/index.ts`. Middleware order: `Helmet → CORS → rate limiter (100/min general, 30/min transactions) → Morgan → JSON → requestId → routes → error handler`. `/mpesa-callback` adds `requireSafaricomIp` (active only when `NODE_ENV=production`).

**An unhandled promise rejection exits the process** (`index.ts`, `process.on('unhandledRejection')`). Async route handlers must be wrapped in `asyncHandler` so errors reach the error middleware and return 500. It is applied in `consumers.ts` (Bug #14) and not yet rolled out to the other route modules.

### Auth & RBAC (`middleware/auth.ts`)
JWT → `req.merchant` / `req.consumer`; admin via role or `X-Admin-Secret` header. Legacy merchant JWTs without a `role` claim are treated as MERCHANT. Merchant device binding is checked on every request via Redis `merchant:device:{merchantId}` (TTL 9 h) plus the `device_bindings` table. Access TTL: merchant 8 h, consumer 24 h.

Refresh: `POST /api/v1/auth/refresh` (merchant) and `POST /api/v1/auth/consumer/refresh` (consumer). Both are **single-use rotation** — the old refresh token is revoked on every use (`merchant_refresh_tokens`, `consumer_refresh_tokens`, SHA-256 hashed). Consumer refresh returns `token, refreshToken, role, consumerId, phone, displayName, expiresAt`. Open items: #21 (consumer refresh handler may reference an undefined `consumer` variable → 500), #17c (whether refresh re-arms the device-binding key), #17d (WebSocket behaviour after refresh). See handover §4.

### Payment invariants
1. A `PENDING` row is written before the STK Push fires. Reconciliation job (every 5 min, Redlock-guarded) expires anything older than 90 min.
2. Idempotency: Redis fast path, then PostgreSQL `UNIQUE (idempotency_key)`. Key = 32 lowercase hex chars (Android `IdempotencyKeyGen.kt`, verified compliant).
3. NFC tags carry HMAC-SHA256 under a merchant-scoped key (`util/nfc-signing.ts`); requires `NFC_SIGNING_SECRET`, otherwise merchant login returns `nfcSigningKey: null`.
4. HCE tokens are single-use, 90 s TTL, constant-time compared (`util/hce-token.ts`). AID `F04F52434845535441`.
5. `POST /transactions` responds `201 STK_SENT` or `502 FAILED` — never `PENDING` over HTTP. Tests must accept both.
6. Daraja calls are wrapped in a circuit breaker (5 failures → OPEN, 30 s reset).

### Route modules — 21 (`src/routes/`, all under `/api/v1`)
`auth` · `transactions` · `mpesa-callback` · `merchants` · `consumers` · `tags` · `admin` · `devices` · `loyalty` · `fx` · `accounting` · `payment-links` · `split-payments` · `payment-rails` (mounted at `/rails`) · `wallet` · `attestation` · `webhooks` · `api-keys` · `disputes` · `refunds` · `subscriptions`. Descriptions and endpoints: `Tap2Pay/backend/README.md` §8.

### Background jobs — 7 (all Redlock-guarded via `util/distributed-lock.ts`)
Reconciliation every 5 min · GL posting every 2 min · Webhook delivery every 1 min · Subscription billing every 1 min · Trial expiry daily 02:00 · FX refresh hourly · `mv_hourly_revenue` refresh every 15 min.

### Real-time
`realtime/ws-server.ts` shares the HTTP server. Callback route → Redis pub/sub → WS push to merchant terminals and consumer wallets. Authenticated by `?token=<jwt>` at connect; idle close at 70 s, clients ping every 15 s.

### Database
Migrations: `001_initial`, `002_new_features`, `003_settlement_kyc`, `004_kyc_aml` — all applied. Add `005_<name>.sql`; never edit an applied file. Pool: `db/index.ts`; Redis: `db/redis.ts` (ioredis). Loyalty schema ground truth (Bug #14): `loyalty_programmes(programme_type, points_per_ksh, stamps_for_reward, reward_description, active)`, `loyalty_balances(points_balance, stamps_balance, lifetime_spent_cents)`.

### Testing
Backend tests live in `src/__tests__/` and mock the DB pool and Redis. `uuid` is mapped to a CJS shim (`__mocks__/uuid.js`). CI (`.github/workflows/ci.yml`) declares real Postgres 15 and Redis 7 services, but the jest config mocks the pool regardless — whether any test actually touches those services is unverified. CI status on the fork is unknown (Bug #15); assume red until checked.

### Web
Vite 6 + React 19 + React Router v6 + Tailwind. **Not Next.js** — the upstream repo was; the fork rewrote it in commit `8f72155`. Env var is `VITE_API_URL`, never `NEXT_PUBLIC_*`. `src/lib/api.ts` is the typed client; `src/lib/auth.ts` handles JWT storage and roles. Three portals (merchant, consumer, admin) plus the public `/pay/:merchantId` page.

### Android
Two apps exist because Android cannot run NFC reader mode and host-card-emulation in one process.

| Module | Role | Facts |
|---|---|---|
| `app/` | Merchant terminal, package `com.orchestratepay`, NFC **reader** | Groovy `build.gradle`; compileSdk 35 / minSdk 26 / targetSdk 35; Retrofit 2.9, Room 2.6 via KSP (`ksp.useKSP2=false`), WorkManager, CameraX + ML Kit, security-crypto 1.1.0-alpha06, Sentry 7.6.0. Sentry auto-init is disabled in debug via `src/debug/AndroidManifest.xml` (Bug #11 — committed, not yet launch-verified). `testImplementation project(':softpos')` — a softpos compile break breaks `:app:test`. |
| `consumer-wallet/` | Consumer wallet, package `com.orchestratepay.consumer`, NFC **card emulation** | `.kts`; `ConsumerHceService` registered in the manifest; OkHttp `Authenticator` for refresh (`ConsumerTokenAuthenticator`, single-flight, one retry). Home-screen P2P buttons have no click listeners (Bug #16). |
| `nfc-core/` | Shared AAR | `.kts`; requires compileSdk 35. |
| `softpos/` | SoftPOS | Builds; **no login UI** — not a shippable product. |

Build config (`buildConfigField`s in each module): debug → `http://localhost:3000/api/v1/` + `ws://localhost:3000` (via `adb reverse`); release → `https://api.orchestratepay.co.ke/api/v1/` (**not deployed anywhere**). `defaultConfig` has a stale `/v1/` path (missing `/api`) — fix before adding a `staging` buildType. Cert pins in `network_security_config.xml` are ISRG Root X1/X2 (CA-level, correct); cleartext is allowed for `10.0.2.2` and `localhost`. Google Services plugin is commented out (`1d332fb`) → FCM is disabled in both apps. `androidTest/` sources are stale and do not compile against current layouts.

## What not to trust
- Any "production-ready", "verified", "confirmed" in `README.md`, `Tap2Pay/README.md`, `skills/*/SKILL.md`, or commit messages before `b3c2cc9` → read as "compiles". No payment flow has been executed end to end on physical NFC hardware.
- `Tap2Pay/README.md`: Next.js, `NEXT_PUBLIC_API_URL`, three different test counts, "no k8s yet", `10.0.2.2` debug URL, SDK 34, "placeholder pins", SoftPOS-as-product, APDU bytes `0xC0`/`0xC1` (reader uses `0x80`/`0x81` since `16e333c` — Bug #20) — all stale or contested.
- `Tap2Pay/android/README.md` §3 "gradlew is not checked in" — it is.
- `Tap2Pay/dashboard/` — undocumented React 18 + Vite 5 app. Do not spend time on it without a product-owner ruling.
- `skills/` (42 files) and `.agents/skills/` — design intent from before any hardware test. Useful for understanding what a subsystem was meant to do; never for what it does.

## Infrastructure
`infra/k8s/` manifests exist; the two P0 env-var gaps (`DARAJA_CALLBACK_BASE_URL` rename, `ADMIN_SECRET`/`NFC_SIGNING_SECRET` secrets) were fixed in `534c7ba`. They have never been applied to a cluster. Deployment sequence (staging → hardening → production) and its gates are in the handover §11.
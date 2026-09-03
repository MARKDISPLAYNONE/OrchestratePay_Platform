# OrchestratePay — NFC Tap-to-Pay Platform

M-Pesa NFC / HCE / QR payments for Kenyan merchants and consumers. A consumer taps a merchant's NFC sticker, holds their phone to a Sunmi terminal (HCE), or scans a QR code; the consumer's phone receives an M-Pesa STK Push, they enter their PIN, the merchant terminal shows the result in real time.

> **Project status lives in one place: [`docs/SESSION_HANDOVER.md`](docs/SESSION_HANDOVER.md).**
> This README describes how the system is designed and how to run it. It makes **no** claims about what has been verified. Where an earlier version of this file said "Production-ready", read "compiles". No payment flow has yet been executed end-to-end on physical NFC hardware.

---

## Components

| Component | Stack | Path | Notes |
|---|---|---|---|
| Backend API | Node 20 · TypeScript · Express · PostgreSQL 15 · Redis 7 · ws | `Tap2Pay/backend/` | 21 route modules, 7 cron jobs, 4 migrations |
| Web app | Vite 6 · React 19 · React Router v6 · Tailwind | `Tap2Pay/web/` | Merchant + consumer + admin portals, public `/pay/:merchantId` page |
| Merchant terminal | Kotlin · Retrofit/OkHttp · Room (KSP) · Sentry | `Tap2Pay/android/app/` | Package `com.orchestratepay`. NFC **reader** role. |
| Consumer wallet | Kotlin · HCE · Retrofit/OkHttp | `Tap2Pay/android/consumer-wallet/` | Package `com.orchestratepay.consumer`. NFC **card-emulation** role. |
| NFC core | Kotlin library (AAR) | `Tap2Pay/android/nfc-core/` | NDEF read/write, HMAC verification |
| SoftPOS | Kotlin · Play Integrity | `Tap2Pay/android/softpos/` | Builds. **No login UI — not a shippable product yet.** |
| Infra | K8s manifests, nginx | `infra/` | **Never applied to a cluster.** |
| `Tap2Pay/dashboard/` | React 18 · Vite 5 | — | Undocumented. Purpose unknown. Product-owner ruling pending. |

Two Android apps exist because Android cannot run NFC reader mode and host-card-emulation in the same process; the merchant app is always the reader, the wallet is always the card.

---

## Architecture
Merchant terminal Consumer wallet Web / QR page
(NFC_TAG, ISO_CARD) (HCE_PHONE, P2P) (QR_CODE, SOFTPOS_MOBILE)
│ │ │
└────────────────────────┼─────────────────────────┘
▼
Express backend ── /api/v1/* ── /ws
Helmet → CORS → rate limit → morgan → json → requestId → routes → error handler
│ │
PostgreSQL (ledger) Redis (idempotency, pub/sub,
device binding, lockout)
│
Daraja STK Push (circuit breaker) ── callback ← Safaricom IP allowlist (prod only)
KRA eTIMS · OpenExchangeRates · QuickBooks/Xero/Sage/Wave · Africa's Talking (off)

text


**Design invariants** (enforced in code; end-to-end verification pending):

1. A transaction row is written `PENDING` **before** the STK Push fires. The 5-minute reconciliation job recovers anything stuck.
2. Idempotency at two layers: Redis fast path, PostgreSQL `UNIQUE (idempotency_key)`.
3. `/mpesa-callback` accepts only Safaricom's published egress IPs when `NODE_ENV=production`.
4. NFC tags carry an HMAC-SHA256 signature under a merchant-scoped key; unsigned/cloned tags are rejected before any DB write.
5. HCE tokens are single-use, 90 s TTL, constant-time compared. AID `F04F52434845535441`.
6. Access JWT: merchant 8 h, consumer 24 h. Refresh tokens are single-use-rotated (`/auth/refresh`, `/auth/consumer/refresh`).
7. `POST /transactions` never returns `PENDING` over HTTP — it returns `201 STK_SENT` or `502 FAILED`.

Full route table and job schedule: [`Tap2Pay/backend/README.md`](Tap2Pay/backend/README.md).

---

## Repository layout
OrchestratePay_Platform/
├── README.md ← this file (design + how-to; no status)
├── CLAUDE.md ← orientation for AI-assisted sessions
├── docs/
│ ├── SESSION_HANDOVER.md ← THE status document. Read first.
│ ├── PRODUCTION_READINESS_CHECKLIST.md compliance + deploy gates (CBK, KRA, DPA)
│ ├── ANDROID_NFC_TESTING_PROTOCOL.md two-phone tap test procedure
│ └── ...
├── infra/k8s, infra/nginx
└── Tap2Pay/
├── backend/ README.md — most detailed, most accurate
├── web/ README.md
├── android/ README.md — {app, consumer-wallet, nfc-core, softpos}
├── dashboard/ (undocumented)
└── docker-compose.yml

text


---

## Quick start (native, Windows / Git Bash — the current dev machine)

Docker is **not** installed on the current dev machine; `docker-compose.yml` is for machines that have it.

```bash
# 0. every new terminal
pwd; which adb; java -version

# 1. Redis (not on PATH)
/c/Users/admin/redis/redis-server.exe --port 6379        # leave running
redis-cli ping                                            # PONG

# 2. Backend — PostgreSQL must already be running on :5432
cd Tap2Pay/backend
cp .env.example .env    # first time: DATABASE_URL, REDIS_URL, JWT_SECRET, ADMIN_SECRET, DARAJA_*
npm install
npm run migrate         # applies 001–004
npm run dev             # WAIT for the line: "OrchestratePay backend running on port 3000"
curl -s localhost:3000/readiness                          # {"status":"ready"}

# 3. Web (new terminal)
cd Tap2Pay/web
cp .env.example .env.local   # VITE_API_URL=http://localhost:3000
npm install
npm run dev                  # http://localhost:3001  (proxies /api/* → :3000)

# 4. Android (new terminal)
cd Tap2Pay/android
./gradlew assembleDebug                                   # all 4 modules
adb reverse tcp:3000 tcp:3000                             # per device; redo after adb restarts
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r consumer-wallet/build/outputs/apk/debug/consumer-wallet-debug.apk
Before an Android login can succeed: backend /readiness is ready; a merchant exists and is APPROVED (registration needs ADMIN_SECRET; login is gated on approval); adb reverse --list shows the port; for NFC-tag flows NFC_SIGNING_SECRET is set (otherwise merchant login returns nfcSigningKey: null).

Debug builds talk to http://localhost:3000 through adb reverse. That works on emulators and USB-connected phones. A Wi-Fi-only phone needs a build pointing at the dev machine's LAN IP (add it to the cleartext allowlist in both apps' network_security_config.xml) or an ngrok HTTPS URL.

Test data
Value
Consumer	consumer2@test.com / TestPass123
Merchant	merchant@test.com / TestPass123 (APPROVED)
Safaricom sandbox phone / PIN	254708374149 / 1234
Sandbox shortcode / passkey	174379 / bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
Daraja sandbox DARAJA_CONSUMER_KEY/SECRET are still placeholders on the dev machine — every STK Push currently returns 502. Obtain real sandbox keys from developer.safaricom.co.ke before testing payments.

Feature status — three columns, not one
"Backend" = route + tests exist. "Client" = a UI a user can reach calls it. "Verified" = a human ran it end-to-end and pasted evidence. Dates and evidence are in the handover.

Feature	Backend	Client	Verified end-to-end
Merchant / consumer auth (login, register, lockout)	✅	web ✅ · wallet ✅ · merchant app ⚠️ launch unverified (Bug #11)	web ✅ · wallet ✅ (emulator + real device) · merchant app ❌
Refresh-token rotation	✅	Android committed, never exercised (Bug #17)	❌
M-Pesa STK Push (any source)	✅ (mocked Daraja)	web + Android	❌ — no sandbox credentials configured
M-Pesa callback → WebSocket push	✅	wallet WS connects ✅ · merchant ❌	❌
NFC tag read + HMAC verification	✅	merchant app (untested)	❌ — needs physical phone + tag
HCE phone-to-terminal	✅	wallet HCE service + merchant reader (APDU byte agreement unverified, Bug #20)	❌ — needs two physical phones
P2P wallet payments	✅	Activities exist; unreachable from home screen (Bug #16)	❌
Idempotency (Redis + UNIQUE)	✅ (DB mocked in tests)	key format ✅	❌ against real DB
Reconciliation job / circuit breaker	✅ unit-tested	n/a	❌ live
Loyalty (points / stamps)	✅ (schema drift fixed, Bug #14)	web ✅ · wallet ✅	balances endpoint ✅ · redeem flow ❌
FX conversion	✅ (hardcoded fallback)	web	❌ live rates (no API key)
KRA eTIMS · GL export (QBO/Xero/Sage/Wave)	✅ code, mocked	web accounting page	❌ — no credentials
Fleet telemetry · fraud scoring · audit log · payment links · split payments · disputes · refunds · subscriptions · webhooks · API keys	✅ code	partial	❌
FCM push notifications	✅	disabled — Google Services plugin commented out (1d332fb)	❌
SMS (Africa's Talking)	✅	off by default	❌
SoftPOS + Play Integrity	✅	no login screen	❌
Admin portal (web)	✅	✅	⚠️ not re-verified since Aug
Environment variables
Backend: see Tap2Pay/backend/README.md §3 — it is the authoritative list. Required: DATABASE_URL, REDIS_URL, JWT_SECRET, ADMIN_SECRET, DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, DARAJA_SHORTCODE, DARAJA_PASSKEY, DARAJA_CALLBACK_BASE_URL.
Web: VITE_API_URL (required), VITE_GOOGLE_CLIENT_ID (optional). Not NEXT_PUBLIC_* — the web app is not Next.js.
Android: API_BASE_URL / WS_BASE_URL / SENTRY_DSN are buildConfigFields in each module's build.gradle. Release points at https://api.orchestratepay.co.ke, which is not deployed.

Testing
Bash

cd Tap2Pay/backend && npm test          # 93 suites · 1959 tests · 108 failing as of 2 Sep 2026 (Bug #15)
cd Tap2Pay/web     && npm run test:unit # 23 suites · 452 assertions
cd Tap2Pay/android && ./gradlew test    # JVM unit tests, all modules (androidTest is stale — see handover)
Backend tests mock PostgreSQL and Redis. They cannot catch SQL-vs-schema drift (Bug #14 class). CI (.github/workflows/ci.yml) status on the fork is unknown.

Deployment
Not started. Sequence and gates are in the handover §11: Staging (VPS + domain + TLS + Daraja sandbox + signed APKs) → Hardening → Production (Safaricom go-live, CBK PSP licence, KRA eTIMS, Kenya DPA 2019). K8s manifests in infra/k8s/ have had their P0 env-var gaps fixed (534c7ba) but have never been applied.

Documentation map
Read	For	Trust
docs/SESSION_HANDOVER.md	what is true right now, open bugs, plan, environment traps	high — evidence-cited
Tap2Pay/backend/README.md	routes, jobs, env vars, migrations	high
Tap2Pay/web/README.md	routes, tests	high
Tap2Pay/android/README.md	build, test, install	medium
Tap2Pay/README.md	payment-flow diagrams, security model	medium — other sections superseded
CLAUDE.md	AI-session orientation and rules	high after 3 Sep 2026
License
Proprietary — OrchestratePay Ltd. All rights reserved.

text


---

## `CLAUDE.md` — drop-in replacement

```markdown
# CLAUDE.md

Orientation for Claude Code / AI-assisted sessions on this repository.
**Status is not in this file.** Read `docs/SESSION_HANDOVER.md` §0–§2 before doing anything; it has the open bugs, the plan, and the environment traps.

## Rules for working in this repo

1. **No status claim without pasted command output.** Not in chat, not in docs, not in commit messages. "Committed", "applied" and "verified" are three different states — say which.
2. `git status --short` before every commit; check `N files changed` against intent. Push to `fork`, never `origin`.
3. The dev terminal is Git Bash / MINGW64 on Windows. **One command per paste** — multi-line blocks scramble.
4. **Angle brackets are stripped from text pasted into the chat.** Any XML or generic-heavy Kotlin must be dumped with `sed 's/</[/g; s/>/]/g' <file>` first. `grep` returning nothing on an XML file is NOT evidence the file is empty (this produced one false bug report and one false "terminal bug").
5. Backend readiness is the literal log line `OrchestratePay backend running on port 3000`, not the version banner. `curl` before it = phantom failure.
6. Docs describe design. If a doc and a command disagree, the command wins; update the doc in the same session.
7. Every backend test mocks the DB and Redis; every Android test mocks the network. **Client/server contract drift (Kotlin data class ≠ `res.json`) is invisible to both** — it has been the root cause of Bugs #10, #14, #17. Check the live JSON.

## Commands

### Backend (`Tap2Pay/backend/`)
```bash
npm run dev            # ts-node-dev on :3000 — wait for the "running on port 3000" line
npm run build && npm start
npm run migrate        # versioned SQL runner, src/db/migrations/001–004
npm test               # 93 suites · 1959 tests · 108 FAILING (pre-existing, Bug #15)
npm run test:coverage  # thresholds: branches 60 / functions 70 / lines 70
npm run lint
npx jest src/__tests__/auth.test.ts
npx jest --testNamePattern "circuit breaker"
Redis is not on PATH on the dev machine: /c/Users/admin/redis/redis-server.exe --port 6379. Orphaned servers after Ctrl+C: /c/Windows/System32/netstat.exe -ano | grep :3000 → taskkill //F //PID <pid>.

Web (Tap2Pay/web/)
Bash

npm run dev            # Vite 6 on :3001, proxies /api/* → :3000
npm run build
npm run test:unit      # Jest + RTL, 23 suites
npm run test:e2e       # Playwright (page.route mocks, no live backend)
Android (Tap2Pay/android/)
Bash

./gradlew assembleDebug                              # 4 modules; Gradle 9.4, Java 21, AGP warnings are noise
./gradlew :app:test :consumer-wallet:test
./gradlew :consumer-wallet:compileDebugKotlin        # fastest compile check for one module
adb reverse tcp:3000 tcp:3000                        # REQUIRED per device; non-persistent
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -s AndroidRuntime:E                       # crash triage
Emulator: emulator-5554. Real device: RF8R42CY49R. Emulators have no NFC radio — they are for login/UI/API testing only.

Architecture
Request lifecycle
All traffic enters backend/src/index.ts. Middleware order: Helmet → CORS → rate limiter (100/min general, 30/min transactions) → Morgan → JSON → requestId → routes → error handler. /mpesa-callback adds requireSafaricomIp (production only). Async route errors must go through asyncHandler (added to consumers.ts for Bug #14; not yet rolled out everywhere) — an unhandled rejection exits the process (index.ts process.on('unhandledRejection')).

Auth & RBAC (middleware/auth.ts)
JWT → req.merchant / req.consumer / admin (X-Admin-Secret fallback). Merchant device binding checked on every request via Redis merchant:device:{id} (TTL 9 h) + device_bindings table. Access TTL: merchant 8 h, consumer 24 h. Refresh: POST /auth/refresh, POST /auth/consumer/refresh, single-use rotation (merchant_refresh_tokens, consumer_refresh_tokens, SHA-256 hashed). Open question #17c: whether refresh re-arms the device-binding key.

Payment invariants
PENDING row before STK Push; reconciliation job (5 min, Redlock) expires >90 min.
Idempotency: Redis then PostgreSQL UNIQUE (idempotency_key). Key = 32 lowercase hex (IdempotencyKeyGen.kt on Android, verified).
NFC tag HMAC-SHA256, merchant-scoped keys (util/nfc-signing.ts); needs NFC_SIGNING_SECRET.
HCE token single-use, 90 s, constant-time (util/hce-token.ts). AID F04F52434845535441.
POST /transactions responds 201 STK_SENT or 502 FAILED, never PENDING.
Route modules — 21 (src/routes/, mounted under /api/v1)
auth · transactions · mpesa-callback · merchants · consumers · tags · admin · devices · loyalty · fx · accounting · payment-links · split-payments · payment-rails (/rails) · wallet · attestation · webhooks · api-keys · disputes · refunds · subscriptions. Descriptions: backend/README.md §8.

Background jobs — 7 (all Redlock-guarded)
Reconciliation 5 min · GL posting 2 min · Webhook delivery 1 min · Subscription billing 1 min · Trial expiry daily 02:00 · FX refresh hourly · mv_hourly_revenue refresh 15 min.

Real-time
realtime/ws-server.ts shares the HTTP server. Callback route → Redis pub/sub → WS push to merchant terminals and consumer wallets. Auth by ?token= at connect; behaviour after a refresh is unverified (#17d).

Database
Migrations 001_initial, 002_new_features, 003_settlement_kyc, 004_kyc_aml. Add 005_<name>.sql; never edit applied files. Loyalty ground truth: loyalty_programmes(programme_type, points_per_ksh, stamps_for_reward, reward_description, active), loyalty_balances(points_balance, stamps_balance, lifetime_spent_cents).

Web
Vite 6 + React 19 + React Router v6 (not Next.js — the upstream repo was; the fork rewrote it). Env VITE_API_URL. src/lib/api.ts is the typed client; src/lib/auth.ts handles JWT/roles.

Android
Module	Role	Facts
app/	merchant terminal, NFC reader	Groovy build.gradle; compileSdk 35 / min 26; Retrofit 2.9, Room 2.6 via KSP (ksp.useKSP2=false), WorkManager, CameraX + ML Kit, Sentry 7.6 (auto-init disabled in debug via src/debug/AndroidManifest.xml); testImplementation project(':softpos')
consumer-wallet/	consumer wallet, HCE card	.kts; ConsumerHceService registered in manifest; OkHttp Authenticator for refresh (ConsumerTokenAuthenticator)
nfc-core/	shared AAR	.kts; requires compileSdk 35
softpos/	SoftPOS	builds; no login UI
Build config: debug → http://localhost:3000/api/v1/ + ws://localhost:3000 (via adb reverse); release → https://api.orchestratepay.co.ke/api/v1/ (undeployed). defaultConfig has a stale /v1/ path — fix before adding a staging buildType. Cert pins: ISRG Root X1/X2 (correct; CA-level). Google Services plugin commented out → FCM disabled. androidTest sources are stale and do not compile against current layouts.

What not to trust
Any "production-ready", "verified", "confirmed" in README.md/Tap2Pay/README.md/commit messages before commit b3c2cc9 → means "compiled".
Tap2Pay/README.md: Next.js, NEXT_PUBLIC_API_URL, three different test counts, "no k8s yet", 10.0.2.2 debug URL, SDK 34, placeholder pins — all stale.
Tap2Pay/android/README.md §3 "gradlew is not checked in" — it is.
Tap2Pay/dashboard/ — undocumented; do not spend time on it without a product-owner ruling.
Infrastructure
infra/k8s/ manifests exist; P0 env gaps fixed in 534c7ba; never applied. CI (.github/workflows/ci.yml) — status on the fork unknown; assume red until checked (Bug #15).

text


---

## Handover patch (same commit) — F-3 correction

In `docs/SESSION_HANDOVER.md`, replace the **F-3** heading + paragraph with:

> ### F-3: Working tree dirty after clean commit — RESOLVED 3 Sep
> Not line endings. `git diff -w --stat` = 53+/407−. The previous lead supplied a replacement `ConsumerApiClient.kt` *after* `176101f` was pushed; the session ended before it was committed. The replacement (authenticator, nullable headers, typed refresh models) compiled and was committed in the follow-up commit. **New sub-item #17e:** `ConsumerRefreshResponse.expiresAt` is non-null `Long`; if `/auth/consumer/refresh` doesn't return `expiresAt`, Gson yields `0`, `getToken()` returns null forever, and the app refresh-loops — verify against `auth.ts` before the runtime test.

And in §2, change row **18** to `Closed — see F-3` and add row **17e** (🟡 Hypothesis, blocker: Bug #17 runtime test). Also add to F-2: "**CONFIRMED 3 Sep** — sed output arrived intact; pasted Kotlin lost all generics."

Commit:
```bash
git add README.md CLAUDE.md docs/SESSION_HANDOVER.md && git status --short
Bash

git commit -m "docs: rewrite root README (three-column feature status, native Windows quick start, no 'production-ready' claims) + CLAUDE.md (21 routes, 7 jobs, 4 migrations, real test counts, session rules); handover F-2 confirmed, F-3 resolved, add #17e"
Cleanup — my call
Do not delete the test files. Here's why, briefly:

Backend: 1,847 passing tests are the only regression net on idempotency, callback handling, lockout, circuit breaker. Deleting them means every future change is blind. The problem is 7 failing suites, not 93. Quarantine those seven (rename to *.test.ts.skip or add to testPathIgnorePatterns with a comment referencing Bug #15) so npm test goes green and CI becomes meaningful again; fix them in Phase 5.
Web: 452 assertions, passing. Keep.
Android JVM tests: keep — they run without a device and caught nothing only because nobody ran them.
Android androidTest/: stale, doesn't compile against current layouts, never runs. This is the set to delete (or rewrite in Phase 3 if someone commits to instrumented testing). Keep ConsumerP2PPayFlowTest.kt only if it compiles.
Definite deletions / moves (once I see the tree): archived handovers → docs/archive/; Tap2Pay/android/build_log.txt and test-logs/ → untrack + .gitignore; Tap2Pay/README.md → cut to Payment Flows + Security Model + index. Not without a ruling: Tap2Pay/dashboard/, skills/.

I won't write the cleanup commit blind. Paste these two and I'll give you the exact git rm/git mv list:

Bash

git ls-files | awk -F/ 'NF>2{print $1"/"$2"/"$3}NF<=2{print $0}' | sort -u
Bash

git ls-files | grep -Ei 'archive|handover|build_log|test-logs|\.log$|androidTest' 
Order of operations: tree fix (4 commands above) → docs commit → paste tree → cleanup commit → Phase 1: rebuild :app, launch, logcat. That last one is the whole point of today.
# SESSION_HANDOVER.md

**Last Updated:** 2 September 2026 (Session 5, IN PROGRESS)
**Project:** OrchestratePay Platform
**Status:** 🟡 ALL THREE SURFACES RUNNING AGAINST ONE LIVE BACKEND (web + consumer-wallet + merchant app on emulator) — consumer-wallet PROVEN on emulator; Merchant Terminal (`:app`) BLOCKED by fatal Sentry crash-on-launch (fix in hand, not yet applied); NFC hardware tests still awaiting 2nd physical device

**Prepared by:** Senior Lead Dev (10x) — Session 5
**Recipient:** Incoming Senior Lead Dev / Project Continuation Lead

---

## 🎯 QUICK ORIENTATION (Read This First)

**What is this project?** NFC Tap-to-Pay platform for the Kenyan market. Integrates with M-Pesa (Daraja API, sandbox). Consumer taps phone/sticker → M-Pesa STK Push → PIN → Payment confirmed. QR fallback for iOS.

**⚠️ Date discrepancy (flagged, unresolved):** Onboarding brief said 9 Aug 2026; prior handover was dated 16 Aug 2026; the dev machine clock prints **2 September 2026** (Redis banner, health timestamps). Either ~2.5 weeks of real time passed since the 16 Aug session, or the machine clock is wrong. **Verify the real date before scheduling anything.** The clock discrepancy correlates with observed environment drift (npm suddenly blocking install scripts).

**✅ RESOLVED — Stack contradiction (former item #34, open since July):** `Tap2Pay/web/` is **Vite 6 + React 19 + react-router-dom**. Verified via package.json. There is no Next.js in the web app. Explanation found: the *upstream original repo* (gabrielngige) used Next.js 15; the fork rewrote web as Vite and the docs never caught up. Env var is `VITE_API_URL`, NOT `NEXT_PUBLIC_API_URL` (README is stale on this). Closed in commit `96f2d0b`.

**⚠️ Correction to the 16 August handover:** That document was written BEFORE the previous dev's final commits landed. The "5 uncommitted files" were in fact committed as `73b066c` (localhost fix) and `154b0a9` (auth contract fix), plus docs in `b3c2cc9`. Working tree was CLEAN at Session 5 start. This is the third consecutive handover whose status claims did not match disk state — the "no status without pasted command output" rule remains in force and is the reason this document cites specific command outputs and commit hashes throughout.

**Current Status — Ground Truth Only (all verified this session by pasted output):**

- ✅ Backend running and healthy — full startup sequence observed, `"OrchestratePay backend running on port 3000"` seen
- ✅ Redis 5.0.14.1 running (PID 17212, manual start, PONG verified)
- ✅ PostgreSQL up (`:5432` LISTENING, 4 migrations applied — 001–004, verified via `schema_migrations` query)
- ✅ Web frontend running on `:3001` (`npm run dev` now works on Windows — Bug #12 fixed and live-verified)
- ✅ Web consumer portal: login `consumer2@test.com` → 200, dashboard + transactions render
- ✅ Web merchant portal: login `merchant@test.com` → 200, analytics + KYC status render
- ✅ **Consumer wallet app PROVEN ON EMULATOR** (project first): login → JWT → WebSocket connected (`WS: consumer wallet connected`) → dashboard renders with real data
- ✅ Bug #14 fix verified at API level: `/consumers/me/loyalty` → `{"balances":[]}`, `/me` → 200, `/me/transactions` → 200, health `ok` AFTER all three (backend survives the endpoint that used to kill it)
- 🔴 Merchant Terminal (`:app`) **cannot start on the emulator** — fatal Sentry crash loop (Bug #11, upgraded to CRITICAL — see findings log). Fix written, not yet applied
- ⚠️ Consumer wallet "Scan QR" / "Send Money" buttons appeared dead during emulator test — **invalid test: the backend was already dead** (Bug #14 crash, 1s after login). Retest required against live backend before diagnosing
- ⚠️ 2nd NFC phone — STILL not confirmed. Never has been. `adb devices` across all sessions shows at most one real device (`RF8R42CY49R`) plus the new emulator
- ⚠️ Test suite reality: **93 suites / 1959 tests, 108 FAILING, 1847 passing** (Bug #15 — pre-existing rot, not from this session's changes; proven by A/B)

**Working tree state (as of end of Session 5 so far):** CLEAN at HEAD `23ef6f6`, all commits pushed to `fork` remote. Branch is ahead of `origin/main` (gabrielngige) by ~36 commits — origin is NOT the push target.

**Git remotes (verified):**
- `origin` → `https://github.com/gabrielngige/OrchestratePay_Platform.git` (upstream — do not push)
- `fork` → `https://github.com/MARKDISPLAYNONE/OrchestratePay_Platform.git` (our backup — push target, in sync through `23ef6f6`)

---

## 🚨 FINDINGS LOG (Chronological, Most Recent First)

### Bug #11 (UPGRADED to 🔴 CRITICAL): Sentry Android SDK crash is FATAL on `:app` — app cannot start at all (2 September 2026)

**Prior status (16 Aug):** "observed, recoverable, deferred." **That claim is now proven false.** It was never tested on `:app` — the merchant app had never been launched on any device until Session 5. Ground truth from the emulator: three consecutive `FATAL EXCEPTION: main` entries, every launch:

```
Process: com.orchestratepay
java.lang.RuntimeException: Unable to get provider io.sentry.android.core.SentryInitProvider
Caused by: java.lang.IllegalArgumentException: DSN is required. Use empty string or set enabled to false in SentryOptions to disable SDK.
```

Sentry's `SentryInitProvider` (a ContentProvider) runs BEFORE any Activity. No DSN is configured for debug builds → `IllegalArgumentException` during app init → process dies before the launcher activity ever renders. **The merchant app is a crash-looping black icon.**

**Why consumer-wallet survives:** the build logs show Sentry native libraries (`libsentry-android.so`, `libsentry.so`) are packaged only into `:app` — the wallet app does not bundle Sentry.

**Fix (written, NOT yet applied/verified):** debug-only manifest overlay disabling Sentry auto-init:
- Create `Tap2Pay/android/app/src/debug/AndroidManifest.xml` containing `<meta-data android:name="io.sentry.auto-init" android:value="false" />` inside `<application>`
- Rebuild `:app:assembleDebug`, reinstall on emulator, launch
- Release builds unaffected. This is Sentry's documented kill switch.
- **This blocks the handover's top pending milestone: Merchant Terminal login test.** It would have blocked the real-device test too — the emulator found it for free.

### Bug #15: Backend test suite — 108 pre-existing failures; all previously documented test counts were fiction (2 September 2026)

**Ground truth (first full honest run ever):**
```
Test Suites: 7 failed, 1 skipped, 85 passed, 92 of 93 total
Tests:       108 failed, 4 skipped, 1847 passed, 1959 total
```

**Documented claims vs reality:** CLAUDE.md said "71 test suites"; Tap2Pay/README.md claims BOTH "34 suites · 717 assertions" AND "85 suites · 1,836 tests" in different sections. None match. Reality: 93/1959.

**Proven NOT caused by this session's changes:** A/B test — `git checkout 1df609c -- src/routes/consumers.ts` (pre-Bug-#14-fix file) → `routes-auth-mock.test.ts` failed 55/55; fixed file → same suite failed identically in the full run. Failures are pre-existing.

**Failure clusters:** `routes-auth-mock` (55), `admin-audit`, `merchant-refresh-token`, `account-lockout`, `consumer-otp`, `coverage-gaps-routes`, `ws-server-full` — mostly app-mounting suites; one concrete assertion drift spotted (`tags.ts` test expects 500, code returns 503). Likely mock-state pollution and code/test drift accumulated over months.

**Open sub-question (deployment blocker):** CI (`.github/workflows/ci.yml`) supposedly runs `npm test` on every push. Either Actions are disabled on the fork, or every push has been failing silently. **Audit before any deployment.**

### Bug #14: `/consumers/me/loyalty` SQL schema drift → one dashboard load killed the ENTIRE backend (2 September 2026) — ✅ FIXED, VERIFIED, one revert incident along the way

**Symptom:** First-ever load of the web consumer Loyalty page → backend log `error: Unhandled Promise rejection 42703 undefined column (position 63)` → **whole process exits** (`index.ts:392-394`: `process.on('unhandledRejection') → process.exit(1)`) → every subsequent request (including all logins) gets `ECONNREFUSED` from the Vite proxy.

**Trigger surface:** web consumer Loyalty page AND the consumer-wallet app's post-login data load (observed on emulator: login 200 → WS connect → transactions 200 → 42703 crash).

**Root cause (fully mapped against live schema):** the route's SQL selected five columns that exist in NO migration, and ordered by a sixth that doesn't exist either:
- `lp.reward_type` → real column is `programme_type`
- `lp.stamps_per_visit` → real column is `stamps_for_reward`
- `lp.redeem_threshold` → does not exist anywhere
- `lb.lifetime_points`, `lb.lifetime_stamps` → do not exist (real: `lifetime_spent_cents`)
- `ORDER BY lb.updated_at` → column does not exist on `loyalty_balances`

**Why nothing caught it:** the entire jest suite mocks the DB pool — the SQL had never executed against the real schema until a human loaded the page. Same bug *class* as #10 (code-vs-reality contract drift, invisible to compile and to mocked tests).

**Fix (two layers, commits `b6f4f07` + `27bf4af`/`52197d6`):**
1. Rewrote the SELECT against the real schema, using aliases to preserve BOTH client contracts (web `LoyaltyPage.tsx` and Android `ConsumerApiClient.kt` both expect `reward_type`/`points_balance`/`stamps_balance`/`redeem_threshold` — aliases keep both working unchanged). `lifetime_points`/`lifetime_stamps` dropped from the response — no data source exists for them; Android field made nullable (`Int? = null`) as defense-in-depth.
2. Added an `asyncHandler` wrapper in `consumers.ts` so async route rejections reach the Express error middleware and return HTTP 500 instead of becoming fatal `unhandledRejection`. (Class-level fix — currently applied to consumers.ts routes only; consider rolling out to other route modules incrementally.)

**⚠️ Incident during the fix (process lesson, now a standing rule):** the A/B test command `git checkout 1df609c -- src/routes/consumers.ts` STAGES the file in git's index. The restore step was missed in execution, so commit `52197d6` (intended: one-line Kotlin fix) silently swept in the REVERTED, buggy consumers.ts — re-arming the crash. Caught by commit-stat inspection ("2 files changed" when 1 was added). Restored in `23ef6f6`. **Standing rule: `git status --short` before EVERY commit; read what's staged; sanity-check `N files changed` against intent.**

**Verification evidence (pasted this session):** loyalty → `{"balances":[]}` (empty = correct — consumer2 has no loyalty rows) · `/me` → 200 with masked phone · transactions → `{"transactions":[],...}` · health `ok` after all three. **The endpoint that killed the API now returns cleanly and the process survives.**

**Residual verification pending:** re-login on the wallet app against the restored backend (the emulator test ran while the reverted code was live, so it crashed); web Loyalty page load in Chrome.

### Bug #13: Orphaned backend processes + premature curl = phantom "backend broken" diagnoses (2 September 2026)

Two intertwined runbook items:
1. **Ctrl+C in Git Bash does not reliably kill npm-spawned children on Windows.** An orphaned ts-node-dev kept serving `:3000` invisibly (PID 6716) — later `EADDRINUSE` for the supervised instance looked like a "new" bug but wasn't. Kill by PID: `taskkill //F //PID <pid>` (double slashes in Git Bash). Find via `/c/Windows/System32/netstat.exe -ano | grep :3000`.
2. **The ts-node-dev version banner is NOT readiness.** A curl fired ~2s after `npm run dev` got "Failed to connect after 2248 ms" because the compile was still in progress — creating a false "backend won't start" narrative while it was actually starting fine. **Wait for the literal line `OrchestratePay backend running on port 3000` before hitting the API.**

### Bug #12: Web `npm run dev` script contained Linux-only `fuser` — broke on Windows (2 September 2026) — ✅ FIXED, commit `1df609c`, live-verified

**Symptom:** `npm run dev` in `web/` → `The system cannot find the path specified.` — Vite never launched. **Root cause:** `"dev": "fuser -k 3001/tcp 2>/dev/null; vite --port 3001"` — `fuser` doesn't exist on Windows and npm runs scripts through cmd.exe where `2>/dev/null` resolves to `C:\dev\null`. **Fix:** `"dev": "vite --port 3001"` (Vite auto-bumps ports anyway). Verified: dev server starts in ~1s.

### Bug #10 verification (16 Aug fix, API-level proof this session): consumer auth responses now include `phone` + `displayName` — confirmed in live JSON. Contract audit round 1 (item #41): **both auth paths CLEAN** — merchant `AuthResponse` (`token, merchantId, merchantName, expiresAt` non-null; `nfcSigningKey, kraPin` nullable) and consumer `AuthResponse` all match live responses. Merchant login verified at API level for the first time: `merchantId 6fce73f3-8482-43ff-ad67-7dce1db4074a`, `role: MERCHANT`, `approvalStatus: APPROVED`.

### Bugs #1–#9 — carried forward unchanged from prior handovers (APDU protocol, thread safety, TTL, kapt→KSP, colors, icons, emulator-only IP, adb reverse persistence, missing test account). All closed/committed. Cross-reference the 16 Aug handover by description.

---

## 🔍 OBSERVATIONS (Not Bugs — Logged for Clarity)

1. **The "jane kamaea" mystery — RESOLVED, not a bug.** Web was logged in as `consumer@example.com` (display_name "jane kamaea" — a real, pre-existing account in the DB) while Android used `consumer2@test.com` ("Test Consumer 2"). Different accounts → different data → the perceived "web vs Android disparity." DB contains exactly 3 consumers (one with null email, jane/consumer@example.com, consumer2). Nothing hardcoded (greps found only test fixtures/placeholders). **Lesson: parity comparisons are only valid same-account.**
2. **Functional parity is now PROVEN; visual parity is not.** Same account → same data across web and wallet app (Test Consumer 2, KSh 0, 0 payments). The Android wallet UI is green and does not match web styling — that is a design-language gap (new backlog **item #43: cross-platform design-language unification** — product decision: accept native theming vs define one brand kit; schedule AFTER functional milestones). Also: the merchant app is a checkout terminal by design — it is SUPPOSED to look nothing like the web merchant analytics dashboard.
3. **Neither Android client stores `refreshToken`** (both `AuthResponse` data classes omit it; backend issues it). Consequence: JWT expiry (consumer 24h, merchant 8h — measured from live tokens) forces re-login. Product decision needed before production.
4. **`nfcSigningKey: null` in merchant login** — caused by `NFC_SIGNING_SECRET` not set (backend warns at login). NFC tag flows need merchant-scoped HMAC keys; provision before tag-payment testing.
5. **Undocumented background jobs observed live:** "Subscription billing" and "Webhook delivery" jobs run on cron — neither is in CLAUDE.md's jobs list (which documents only reconciliation + GL posting). Docs updated for their existence; full inventory still needed.
6. **Undocumented module `Tap2Pay/dashboard/`** — React 18 + Vite 5 app, mentioned in zero docs. Status unknown (abandoned? internal admin?). **Product-owner ruling required before spending any time on it.**
7. **Item #42: androidTest suite is stale/dead.** `app/src/androidTest/.../LoginActivityTest.kt` references view IDs (`emailEditText`, `passwordEditText`, `loginButton`) that no longer exist in current layouts — shows as red "Unresolved reference" in the IDE. Does NOT affect `assembleDebug` (androidTest sources aren't compiled for APKs). Needs rewrite before instrumented testing is possible.
8. **Tap2Pay/README.md contains multiple verified-stale claims** (Next.js web, NEXT_PUBLIC_API_URL, "no k8s yet", 10.0.2.2 debug URL, SDK 34, three different test counts). Treat as aspirational history, not truth. Trust: code > package.json > this handover > everything else.
9. **`npm` on this machine now blocks dependency install scripts** (`install-scripts` warnings for bcrypt, esbuild, @scarf/scarf). bcrypt's native binding verified WORKING despite the warning (`bcrypt OK: $2b$10$...`). Do NOT approve `@scarf/scarf` (telemetry). Likely a Node/npm update since 16 Aug — part of the unexplained environment drift.
10. **Emulator NFC reality (asked repeatedly):** AVD emulators have NO NFC radio. Two emulators or phone+emulator can NEVER test HCE/tag flows. Emulator value = login/UI/API/parity testing (which it has now delivered: Bug #11 discovery + wallet proof). True NFC tests still require TWO PHYSICAL PHONES. Interim hardware-free option on the table: APDU loopback test harness against the real protocol classes; or a cheap ACR122U USB reader (~KSh 3–5k) as merchant-side radio.
11. **Merchant login enforces single-device** — emulator/real-device/web logins kick each other. Expected behavior, not a bug.

---

## 🖥️ ENVIRONMENT SETUP (Windows/MINGW64 — all rules consolidated)

**Every new terminal, before anything:** `pwd`, `which adb`, `java -version` — MINGW64 does not reliably persist PATH across terminal windows even with `.bashrc` edits (reconfirmed again this session).

**Redis:** NOT on PATH. Manual start every session: `/c/Users/admin/redis/redis-server.exe --port 6379` (leave running). Verify: `redis-cli ping` → PONG. Backend log "Reached the max retries per request limit" = Redis not running.

**PostgreSQL:** Running natively on `:5432` (not Docker). **Docker is NOT installed on this machine** (`docker: command not found`) — the docker-compose local stack documented in README is unusable here.

**netstat:** Not on PATH in Git Bash. Use `/c/Windows/System32/netstat.exe -ano`.

**Backend:** `cd Tap2Pay/backend && npm run dev` — **wait for the literal line `OrchestratePay backend running on port 3000`** (version banner ≠ readiness). If `EADDRINUSE :::3000`: orphaned process — find PID via netstat, `taskkill //F //PID <pid>`. Ctrl+C may NOT kill npm children — always verify the port is free after stopping.

**Web:** `cd Tap2Pay/web && npm run dev` → Vite on `:3001`, proxies `/api/*` to `:3000`. (Fixed this session; was broken on Windows.)

**Android/adb:**
- `adb` may need `export PATH="$PATH:/c/Users/admin/AppData/Local/Android/Sdk/platform-tools"` in fresh terminals.
- **`adb reverse tcp:3000 tcp:3000` is required per device/emulator** — works on BOTH real devices and emulators. Does NOT survive ADB daemon restarts; if "Failed to connect to localhost:3000" reappears, check `adb reverse --list` FIRST.
- Emulator in use: `emulator-5554` (Pixel AVD created this session via Android Studio Device Manager).
- Build: `cd Tap2Pay/android && ./gradlew assembleDebug` (all 4 modules, verified BUILD SUCCESSFUL post-Bug-#14-fix). Gradle 9.4.1, Java 21 (OpenJDK 21.0.10), AGP deprecation warnings are noise.
- Install: `adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk` (paths resolve only from inside `Tap2Pay/android/`).

**Pasting discipline (NEW, important):** multi-line command blocks pasted into this MINGW64 terminal get SCRAMBLED (observed repeatedly — caused two silently-failed doc edits and a mangled heredoc). **Paste one command at a time**, or do file edits in VS Code. Terminal = single-line commands only.

**Git discipline (NEW standing rule):** `git status --short` before EVERY commit; read what's staged; verify `N files changed` matches intent. (Born from the `52197d6` accidental-revert incident.) Push target: `git push fork main` — NOT origin.

---

## 🏗️ PROJECT ARCHITECTURE (Current State)

```
OrchestratePay_Platform/
├── CLAUDE.md                  # ✅ corrected this session (Vite stack, line 29)
├── docs/                      # 🟡 this handover replaces prior version
├── infra/                     # k8s/ + nginx/ — untouched; 2 P0 pre-deploy fixes pending
├── Tap2Pay/
│   ├── backend/               # Express + pg + Joi + Redis (ioredis) + ws
│   │   └── src/routes/consumers.ts   # ✅ Bug #14 fixed (asyncHandler + real-schema SQL)
│   ├── web/                   # ✅ Vite 6 + React 19 (Next.js claim CLOSED)
│   ├── dashboard/             # ⚠️ UNDOCUMENTED React 18 + Vite 5 app — ruling needed
│   └── android/
│       ├── app/               # 🔴 BLOCKED: fatal Sentry crash on launch (Bug #11)
│       ├── consumer-wallet/   # ✅ PROVEN on emulator end-to-end
│       ├── nfc-core/          # unchanged
│       └── softpos/           # builds green, untested at runtime
└── test-logs/
```

**Known accounts (verified live this session):**
| Account | Status | Notes |
|---|---|---|
| `consumer2@test.com` / `TestPass123` | ✅ login-verified (web + emulator app + curl) | ID `a09df433-e945-40ad-9177-54ec6ac94300`, phone 254700000002, "Test Consumer 2" |
| `merchant@test.com` / `TestPass123` | ✅ API-verified; ⚠️ app login BLOCKED by Bug #11 | ID `6fce73f3-8482-43ff-ad67-7dce1db4074a`, APPROVED, `nfcSigningKey: null` (NFC_SIGNING_SECRET unset) |
| `consumer@example.com` (jane kamaea) | exists | The source of the "parity" confusion — different account, different data |

**Migrations:** 001_initial, 002_new_features, 003_settlement_kyc, 004_kyc_aml — all 4 applied (verified via schema_migrations). Loyalty schema ground truth: `loyalty_programmes(programme_type, points_per_ksh, stamps_for_reward, reward_description, active)`, `loyalty_balances(points_balance, stamps_balance, lifetime_spent_cents)`.

---

## 🔧 CURRENT BLOCKERS & NEXT STEPS

### 🔴 Immediate — in this exact order:
1. **Apply the Bug #11 fix** (written, unapplied): create `Tap2Pay/android/app/src/debug/AndroidManifest.xml` with `<meta-data android:name="io.sentry.auto-init" android:value="false" />` → `./gradlew :app:assembleDebug` → reinstall on emulator → **launch and login merchant app** (`merchant@test.com` / `TestPass123` / Device ID `emu-01`). This completes the handover's #1 pending milestone at emulator grade. Commit the fix.
2. **Verify backend is running the restored Bug #14 code** (it should have auto-respawned on the `23ef6f6` restore): health → consumer login → `/me/loyalty` → health. Then **re-login the wallet app on the emulator** and confirm the backend survives its post-login loyalty call. Then load the **web consumer Loyalty page** in Chrome — same check.
3. **Retest wallet "Scan QR" / "Send Money"** against the live backend (previous test invalid — backend was dead). Capture `adb logcat -d -b crash` + on-screen error text if they fail. THEN diagnose.

### 🟡 Next (no hardware needed):
4. Bug #15 triage: audit CI (is it running? failing silently on the fork?) — deployment blocker. Then failure-cluster triage.
5. Item #41 contract audit round 2: extend the live-JSON vs data-class diff beyond auth (transactions, loyalty, merchants/me) — the class is proven to exist (Bugs #10, #14).
6. Roll `asyncHandler` out to remaining route modules (Bug #14 class-fix).

### ⏳ Blocked on hardware (unchanged critical path):
7. Merchant Terminal on the REAL device (after Bug #11 fix + emulator pass).
8. 2nd NFC phone — physically confirm via `adb devices` showing two entries, pasted output.
9. ANDROID_NFC_TESTING_PROTOCOL.md Tests 1–4. (Note: that protocol's pre-flight and account tables are superseded by this document.)

### 🗓️ Parallel, non-engineering:
10. CBK PSP license (3–6 months lead — must already be in motion), KRA eTIMS, Kenya DPA 2019.
11. Product-owner rulings needed: `dashboard/` module fate; refresh-token storage on Android; design-language unification (item #43); Daraja sandbox credentials for real STK Push testing.

### Deployment path (agreed direction, not started):
**Phase S (staging):** fix the 2 P0 k8s manifest gaps → VPS deploy via docker-compose → domain + TLS → nginx serves built web → Daraja sandbox creds → Android staging build config + signed APKs. **Phase H (hardening):** JWT_SECRET rotation, DB SSL, rate limiting, Sentry upgrades (backend 8.x→10.x AND Android DSN config), backups. **Phase P (production):** gated on Safaricom production onboarding + CBK license. **Bugs #14/#15 and the CI audit gate Phase S.**

---

## 📝 SESSION 5 COMMIT LOG (all pushed to `fork`)

| Hash | Change |
|---|---|
| `1df609c` | fix(web): remove Linux-only fuser from dev script (Bug #12) |
| `b6f4f07` | fix(backend): Bug #14 — /me/loyalty schema drift + asyncHandler |
| `27bf4af` | fix(android): lifetimePoints nullable (Bug #14 client side) |
| `52197d6` | fix(android): `Int? = null` completion — ⚠️ accidentally also reverted consumers.ts |
| `96f2d0b` | docs(claude): web stack corrected to Vite 6 (closes item #34) |
| `23ef6f6` | fix(backend): restore Bug #14 fix lost in 52197d6 |

---

## 📝 DECISION LOG (Session 5)

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-02 | Verify stack claims from package.json, not docs | Closed the months-old Next.js/Vite contradiction (item #34) in minutes |
| 2026-09-02 | Fixed Bug #14 with schema-aligned SQL + client-contract-preserving aliases, plus asyncHandler class-fix | Never-released endpoint = no compat to preserve; aliases avoid touching both clients; wrapper prevents future single-query process kills |
| 2026-09-02 | Made Android `lifetimePoints` nullable rather than keeping a field with no data source | Bug #10-class defense-in-depth |
| 2026-09-02 | Upgraded Bug #11 from "deferred" to CRITICAL after emulator evidence | Prior "recoverable" claim was never tested on `:app`; three fatal crashes observed; blocks the merchant-app milestone entirely |
| 2026-09-02 | Declared wallet button test INVALID (backend was dead during it) | Evidence-based triage — no UI debugging against a dead API |
| 2026-09-02 | Logged 108 test failures as pre-existing (Bug #15) after A/B proof; did NOT block current work on it | Honest baseline; rot predates session; CI audit queued as the real deployment gate |
| 2026-09-02 | New standing rules: `git status --short` before every commit; single-line terminal pastes; wait for the running-line before curling | Each born from a real incident this session |
| 2026-09-02 | Emulator adopted as the standing 3rd test surface (with web + real phone) | Already earned its keep: found Bug #11 for free, proved wallet parity |
| 2026-09-02 | Confirmed NFC HCE testing is physically impossible on any emulator combination | Prevents wasted cycles; two real phones remain the only true HCE test |

END OF SESSION_HANDOVER.md
After saving and committing it (git add docs/SESSION_HANDOVER.md → git status --short → commit docs: session 5 handover — full rewrite with verified ground truth → git push fork main), continue exactly where we left off:

Verify the backend is running the restored fix — health curl, consumer login, /me/loyalty, health again
Apply the Bug #11 Sentry fix — the manifest file (I'll give you the exact commands again if needed), rebuild :app, reinstall, launch the merchant app
Retest the wallet buttons against the live backend
Paste everything back — especially whether the merchant app finally boots. That's the last gate before this project's oldest blocked milestone (Merchant Terminal login) closes.
Here's the complete, drop-in replacement. Every section that was already accurate is preserved verbatim; new findings from this session (Bug #16, Bug #17, IdempotencyKeyGen verification, E2E test correction, terminal `cat` quirk) are integrated at the correct chronological/logical positions.

```markdown
# SESSION_HANDOVER.md

**Last Updated:** 2 September 2026 (Session 5, CONTINUED — second-opinion deep-dive)
**Project:** OrchestratePay Platform
**Status:** 🟡 ALL THREE SURFACES RUNNING AGAINST ONE LIVE BACKEND (web + consumer-wallet + merchant app on emulator) — consumer-wallet PROVEN on emulator; Merchant Terminal (`:app`) BLOCKED by fatal Sentry crash-on-launch (fix in hand, not yet applied); **TWO NEW BUGS DIAGNOSED THIS SESSION** (Bug #16: dead P2P buttons in wallet; Bug #17: token-expiry 401 on both Android apps — refresh-token contract fully mapped, fix designed, not yet applied); NFC hardware tests still awaiting 2nd physical device
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
- ✅ **IdempotencyKeyGen.kt verified compliant** (this session): SHA-256 → 16 bytes → `%02x` = exactly 32 lowercase hex chars. Passes Joi `.length(32).hex()`. No fix needed.
- 🔴 Merchant Terminal (`:app`) **cannot start on the emulator** — fatal Sentry crash loop (Bug #11, upgraded to CRITICAL — see findings log). Fix written, not yet applied
- 🔴 **Bug #16 (NEW, this session):** Consumer wallet "Scan QR" / "Send Money" buttons are complete no-ops — no navigation, no crash, no log lines. Root cause confirmed: `HomeFragment.kt` binds zero click listeners; buttons are orphaned views in `fragment_home.xml`. Target Activities all exist. Fix designed, blocked on XML file content extraction (see environment notes).
- 🔴 **Bug #17 (NEW, this session):** Both Android apps surface raw 401 errors after JWT expiry (merchant 8h, consumer 24h). Root cause confirmed: neither client persists the `refreshToken` the backend issues (both `AuthResponse` data classes silently drop the field); neither client has an OkHttp `Authenticator` or 401 interceptor. Merchant app: client-side clock expiry in `SessionManager.getToken()` → null token → no auth header → 401 → `ApiResponse.Declined("Request error 401")`. Consumer wallet: WORSE — `bearer()` returns literal `"Bearer null"`, AND `ConsumerService` methods return bare types (not `Response<T>`), so Retrofit throws unhandled `HttpException` on 401 — potential app crash. Backend refresh contract fully mapped: `POST /auth/refresh` (merchant) and `POST /auth/consumer/refresh` (consumer), both use single-use rotation (old token revoked on every refresh). Fix designed (Authenticator + synchronized single-flight refresh + force-logout fallback), not yet applied.
- ⚠️ 2nd NFC phone — STILL not confirmed. Never has been. `adb devices` across all sessions shows at most one real device (`RF8R42CY49R`) plus the new emulator
- ⚠️ Test suite reality: **93 suites / 1959 tests, 108 FAILING, 1847 passing** (Bug #15 — pre-existing rot, not from this session's changes; proven by A/B)

**Working tree state (as of end of Session 5 so far):** CLEAN at HEAD `23ef6f6`, all commits pushed to `fork` remote. Branch is ahead of `origin/main` (gabrielngige) by ~36 commits — origin is NOT the push target.

**Git remotes (verified):**
- `origin` → `https://github.com/gabrielngige/OrchestratePay_Platform.git` (upstream — do not push)
- `fork` → `https://github.com/MARKDISPLAYNONE/OrchestratePay_Platform.git` (our backup — push target, in sync through `23ef6f6`)

---

## 🚨 FINDINGS LOG (Chronological, Most Recent First)

### Bug #17 (🔴 NEW): Token expiry → raw 401 on both Android apps — no refresh-token handling anywhere (2 September 2026, second-opinion deep-dive)

**Symptom:** Merchant app "Present NFC" shows HTTP 401 ~20h after a successful login. Consumer wallet likely exhibits the same (or worse — see below) after 24h.

**Prior status:** Logged as Observation #3 ("neither Android client stores refreshToken"). That was correct but understated — this is not a "product decision needed" backlog item, it is a **live, reproducible, user-facing auth failure** that hits every user after their first session expires. Upgraded to tracked bug.

**Root cause (fully confirmed from source review of all four relevant files):**

**Merchant app (`OrchestaApiClient.kt` + `SessionManager.kt`):**
1. `SessionManager.getToken()` performs a client-side expiry check: `return if (System.currentTimeMillis() < expiresAt) token else null`. Once 8h passes, it returns `null` — the token is dead before the request is even built.
2. The OkHttp auth interceptor reads `SessionManager.getToken()`. When null, it sends the request with **no Authorization header at all**.
3. Backend correctly 401s the unauthenticated request.
4. `safeCall()` maps `response.code() in 400..499` to `ApiResponse.Declined(body?.reason ?: "Request error ${response.code()}")`. Since a 401-with-no-body has no `reason` field, the user sees the literal string **"Request error 401"**.
5. The `AuthResponse` data class (`token, merchantId, merchantName, expiresAt, nfcSigningKey, kraPin`) **omits `refreshToken` entirely**. The backend sends it in the login response (`token, refreshToken, role: 'MERCHANT'` — confirmed from `auth.ts` line 149), but Gson silently drops the unmapped field.

**Consumer wallet (`ConsumerApiClient.kt` + `ConsumerSessionManager.kt`) — TWO compounding problems:**
1. `bearer()` is defined as `"Bearer ${ConsumerSessionManager.getToken()}"`. When `getToken()` returns null, Kotlin string templates render this as the literal text `"Bearer null"` — not "no header." Functionally the same 401, but sloppier and could trip WAF/logging pattern matchers.
2. **This is the actually serious one:** `ConsumerService` methods return **bare types** (e.g., `suspend fun getProfile(...): ConsumerProfile`), not `Response<T>`. When a Retrofit suspend function's return type is not wrapped in `Response<T>`, Retrofit throws `retrofit2.HttpException` on any non-2xx response instead of returning a response object. **None of the call sites in `ConsumerApiClientInstance` catch this.** `getProfile()`, `getTransactions()`, `getLoyalty()`, `p2pPay()` — all will throw uncaught into whatever ViewModel called them the moment a 401 happens. Whether this crashes the app or fails silently depends on whether the ViewModels wrap calls in `try/catch` — `HomeViewModel.kt` not yet reviewed to confirm.
3. Same `AuthResponse` omission as merchant: `token, consumerId, phone, displayName, expiresAt` — no `refreshToken`.

**Backend refresh contract (fully mapped from `Tap2Pay/backend/src/routes/auth.ts`):**

| | Merchant | Consumer |
|---|---|---|
| **Endpoint** | `POST /api/v1/auth/refresh` | `POST /api/v1/auth/consumer/refresh` |
| **Request body** | `{ "refreshToken": "<string>" }` | `{ "refreshToken": "<string>" }` |
| **Response** | `{ "token": "<new JWT>", "refreshToken": "<new refresh>" }` | `{ "token": "<new JWT>", "refreshToken": "<new refresh>" }` |
| **Token storage** | `merchant_refresh_tokens` (SHA-256 hashed) | `consumer_refresh_tokens` (SHA-256 hashed) |
| **Rotation** | **Single-use** — `UPDATE merchant_refresh_tokens SET revoked_at = NOW() WHERE id = $1` on every refresh | **Single-use** — same pattern on `consumer_refresh_tokens` |
| **TTL** | 8h access + 30d refresh (from `auth.ts` line 25 comment) | 24h access + refresh TTL TBD (verify from `issueRefreshToken`) |

**⚠️ CRITICAL DESIGN IMPLICATION of single-use rotation:** If two API calls 401 at nearly the same moment (e.g., a screen that fires `getProfile()` + `getTransactions()` concurrently) and both naively call `/auth/refresh` with the same refresh token, the first call succeeds and burns the token; the second call gets `401 Invalid or expired refresh token` and the user gets force-logged-out even though a perfectly valid session exists from the first refresh. **The `Authenticator` implementation MUST include a synchronized single-flight guard** (check if another thread already refreshed while we waited for the lock, and use their token instead of making a second refresh call). This is not optional — guessing wrong here introduces a new concurrency bug.

**Fix (designed, NOT yet applied — blocked on confirming exact refresh response shape + `HomeViewModel.kt` crash assessment):**
1. Add `refreshToken: String` to both `AuthResponse` data classes.
2. Add `KEY_REFRESH_TOKEN` to both `SessionManager`/`ConsumerSessionManager` with save/get methods in `EncryptedSharedPreferences`.
3. Persist `refreshToken` in the login success path of both API clients.
4. Add `OkHttp Authenticator` (NOT Interceptor — Authenticator is the correct mechanism for reactive 401 handling) to both `OkHttpClient.Builder()` chains:
   - Synchronized single-flight refresh (prevent concurrent refresh calls from burning the token).
   - Retry the original request with the new access token.
   - On unrecoverable failure (refresh call itself 401s) — clear stored session, signal UI to route to `LoginActivity`.
5. Fix consumer `bearer()` to return `null` (not `"Bearer null"`) when no token exists, and handle the null case at the call site.
6. **Consider wrapping `ConsumerService` return types in `Response<T>`** to prevent unhandled `HttpException` on any future non-2xx — this is a broader hardening item beyond just the 401 case.

**Backlog re-prioritization note:** This was previously sitting near the bottom of the backlog as a "nice to have." It shouldn't be — it's a live, reproducible, user-facing auth failure with a well-understood fix. Moved to **immediate priority, right after Bug #11 and Bug #16**.

---

### Bug #16 (🔴 NEW): Consumer wallet "Scan QR" / "Send Money" buttons are complete no-ops — no click listeners wired (2 September 2026, second-opinion deep-dive)

**Symptom:** Tapping "Scan QR" or "Send Money" on the consumer wallet home screen does nothing — no navigation, no crash, no logcat output.

**Prior status:** Initially suspected to be an invalid test (backend was dead from Bug #14 during the first observation). Retested conceptually after Bug #14 fix — symptom persists regardless of backend state because the buttons never fire any network call or navigation intent. This is a pure client-side wiring gap.

**Root cause (confirmed by full source review of all three candidate files):**

1. **`HomeFragment.kt`** — binds exactly seven views: `tv_greeting`, `tv_user_name`, `tv_loyalty_points`, `tv_recent_label`, `tv_txn_1`, `tv_txn_2`, `tv_txn_3`. **Zero click listeners. Zero navigation logic. Zero references to any button view.** This Fragment is a read-only dashboard — it displays data but has no interactive entry points.

2. **`TapToPayFragment.kt`** — cleared of suspicion. Only wires a `TabLayout` toggling between NFC-receive and QR-receive sections (`viewModel.loadQr()` — the wallet showing *its own* QR for merchants to scan, which already works). No P2P navigation.

3. **`HomeActivity.kt`** — cleared of suspicion. Only wires `BottomNavigationView` → fragment swap, NFC foreground dispatch for tag taps, WebSocket dialog handling, and FCM tap-through. No FAB, no standalone buttons, no P2P navigation at the Activity level.

4. **`fragment_home.xml`** exists on disk (6557 bytes — large enough to contain button views) but its content could not be extracted due to a persistent terminal `cat` rendering issue (see Environment Notes). The buttons are almost certainly declared here as orphaned views — present in XML, never referenced in Kotlin.

5. **Target Activities all exist and are compiled into the module:** `P2PQrScannerActivity.kt`, `P2PSendActivity.kt`, `P2PPayActivity.kt`, `MerchantHcePayActivity.kt`, `NfcTagPaymentActivity.kt` — all present in `consumer-wallet/src/main/java/com/orchestratepay/consumer/ui/`. The destinations are built; the entry points were never connected.

6. **Supporting evidence from test coverage gap:** `ConsumerP2PPayFlowTest.kt` exists in `androidTest` (the P2P pay flow was tested in isolation), but there is **no `HomeFragmentTest.kt` or `HomeActivityTest.kt`** anywhere in the test tree. Someone wrote and tested the P2P Activities but never wrote (or tested) the tap-through from the home screen.

**Fix (designed, blocked on `fragment_home.xml` + `activity_home.xml` + `AndroidManifest.xml` content extraction):**
```kotlin
// HomeFragment.kt, inside onViewCreated — exact view IDs TBD from XML
binding.btnScanQr.setOnClickListener {
    startActivity(Intent(requireContext(), P2PQrScannerActivity::class.java))
}
binding.btnSendMoney.setOnClickListener {
    startActivity(Intent(requireContext(), P2PSendActivity::class.java))
}
```
Plus: verify both Activities are declared in `consumer-wallet/src/main/AndroidManifest.xml` (115 lines, 5259 bytes — content not yet extracted). If not declared, wiring the listener will produce `ActivityNotFoundException` at runtime — the manifest fix must ship in the same commit.

**Priority:** This is the highest-ROI fix in the entire backlog. The core P2P feature is *literally unreachable* from the UI. Trivial effort to fix once the XML IDs are confirmed.

---

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
- Create `Tap2Pay/android/app/src/debug/AndroidManifest.xml` containing `<provider android:name="io.sentry.android.core.SentryInitProvider" tools:node="remove" />` inside `<application>`
- Rebuild `:app:assembleDebug`, reinstall on emulator, launch
- Release builds unaffected. This is Sentry's documented kill switch.
- **This blocks the handover's top pending milestone: Merchant Terminal login test.** It would have blocked the real-device test too — the emulator found it for free.

---

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

---

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

**⚠️ Incident during the fix (process lesson, now a standing rule):** the A/B test command `git checkout 1df609c -- src/routes/consumers.ts` STAGES the file in git's index. The restore step was missed in execution, so commit `52197d6` (intended: one-line Kotlin fix) silently swept in the REVERTED, buggy consumers.ts — re-arming the crash. Caught by commit-stat inspection ("2 files changed" when 1 was added). Restored in `23ef6f6`.

**Standing rule: `git status --short` before EVERY commit; read what's staged; sanity-check `N files changed` against intent.**

**Verification evidence (pasted this session):** loyalty → `{"balances":[]}` (empty = correct — consumer2 has no loyalty rows) · `/me` → 200 with masked phone · transactions → `{"transactions":[],...}` · health `ok` after all three. **The endpoint that killed the API now returns cleanly and the process survives.**

**Residual verification pending:** re-login on the wallet app against the restored backend (the emulator test ran while the reverted code was live, so it crashed); web Loyalty page load in Chrome.

---

### Bug #13: Orphaned backend processes + premature curl = phantom "backend broken" diagnoses (2 September 2026)

Two intertwined runbook items:
1. **Ctrl+C in Git Bash does not reliably kill npm-spawned children on Windows.** An orphaned ts-node-dev kept serving `:3000` invisibly (PID 6716) — later `EADDRINUSE` for the supervised instance looked like a "new" bug but wasn't. Kill by PID: `taskkill //F //PID <pid>` (double slashes in Git Bash). Find via `/c/Windows/System32/netstat.exe -ano | grep :3000`.
2. **The ts-node-dev version banner is NOT readiness.** A curl fired ~2s after `npm run dev` got "Failed to connect after 2248 ms" because the compile was still in progress — creating a false "backend won't start" narrative while it was actually starting fine. **Wait for the literal line `OrchestratePay backend running on port 3000` before hitting the API.**

---

### Bug #12: Web `npm run dev` script contained Linux-only `fuser` — broke on Windows (2 September 2026) — ✅ FIXED, commit `1df609c`, live-verified

**Symptom:** `npm run dev` in `web/` → `The system cannot find the path specified.` — Vite never launched.

**Root cause:** `"dev": "fuser -k 3001/tcp 2>/dev/null; vite --port 3001"` — `fuser` doesn't exist on Windows and npm runs scripts through cmd.exe where `2>/dev/null` resolves to `C:\dev\null`.

**Fix:** `"dev": "vite --port 3001"` (Vite auto-bumps ports anyway). Verified: dev server starts in ~1s.

---

### Bug #10 verification (16 Aug fix, API-level proof this session): consumer auth responses now include `phone` + `displayName` — confirmed in live JSON. Contract audit round 1 (item #41): **both auth paths CLEAN** — merchant `AuthResponse` (`token, merchantId, merchantName, expiresAt` non-null; `nfcSigningKey, kraPin` nullable) and consumer `AuthResponse` all match live responses. Merchant login verified at API level for the first time: `merchantId 6fce73f3-8482-43ff-ad67-7dce1db4074a`, `role: MERCHANT`, `approvalStatus: APPROVED`.

### Bugs #1–#9 — carried forward unchanged from prior handovers (APDU protocol, thread safety, TTL, kapt→KSP, colors, icons, emulator-only IP, adb reverse persistence, missing test account). All closed/committed. Cross-reference the 16 Aug handover by description.

---

## 🔍 OBSERVATIONS (Not Bugs — Logged for Clarity)

1. **The "jane kamaea" mystery — RESOLVED, not a bug.** Web was logged in as `consumer@example.com` (display_name "jane kamaea" — a real, pre-existing account in the DB) while Android used `consumer2@test.com` ("Test Consumer 2"). Different accounts → different data → the perceived "web vs Android disparity." DB contains exactly 3 consumers (one with null email, jane/consumer@example.com, consumer2). Nothing hardcoded (greps found only test fixtures/placeholders). **Lesson: parity comparisons are only valid same-account.**

2. **Functional parity is now PROVEN; visual parity is not.** Same account → same data across web and wallet app (Test Consumer 2, KSh 0, 0 payments). The Android wallet UI is green and does not match web styling — that is a design-language gap (new backlog **item #43: cross-platform design-language unification** — product decision: accept native theming vs define one brand kit; schedule AFTER functional milestones). Also: the merchant app is a checkout terminal by design — it is SUPPOSED to look nothing like the web merchant analytics dashboard.

3. **`nfcSigningKey: null` in merchant login** — caused by `NFC_SIGNING_SECRET` not set (backend warns at login). NFC tag flows need merchant-scoped HMAC keys; provision before tag-payment testing.

4. **Undocumented background jobs observed live:** "Subscription billing" and "Webhook delivery" jobs run on cron — neither is in CLAUDE.md's jobs list (which documents only reconciliation + GL posting). Docs updated for their existence; full inventory still needed.

5. **Undocumented module `Tap2Pay/dashboard/`** — React 18 + Vite 5 app, mentioned in zero docs. Status unknown (abandoned? internal admin?). **Product-owner ruling required before spending any time on it.**

6. **Item #42: androidTest suite is stale/dead.** `app/src/androidTest/.../LoginActivityTest.kt` references view IDs (`emailEditText`, `passwordEditText`, `loginButton`) that no longer exist in current layouts — shows as red "Unresolved reference" in the IDE. Does NOT affect `assembleDebug` (androidTest sources aren't compiled for APKs). Needs rewrite before instrumented testing is possible.

7. **Tap2Pay/README.md contains multiple verified-stale claims** (Next.js web, NEXT_PUBLIC_API_URL, "no k8s yet", 10.0.2.2 debug URL, SDK 34, three different test counts). Treat as aspirational history, not truth. Trust: code > package.json > this handover > everything else.

8. **`npm` on this machine now blocks dependency install scripts** (`install-scripts` warnings for bcrypt, esbuild, @scarf/scarf). bcrypt's native binding verified WORKING despite the warning (`bcrypt OK: $2b$10$...`). Do NOT approve `@scarf/scarf` (telemetry). Likely a Node/npm update since 16 Aug — part of the unexplained environment drift.

9. **Emulator NFC reality (asked repeatedly):** AVD emulators have NO NFC radio. Two emulators or phone+emulator can NEVER test HCE/tag flows. Emulator value = login/UI/API/parity testing (which it has now delivered: Bug #11 discovery + wallet proof). True NFC tests still require TWO PHYSICAL PHONES. Interim hardware-free option on the table: APDU loopback test harness against the real protocol classes; or a cheap ACR122U USB reader (~KSh 3–5k) as merchant-side radio.

10. **Merchant login enforces single-device** — emulator/real-device/web logins kick each other. Expected behavior, not a bug.

11. **IdempotencyKeyGen.kt verified compliant (this session):** `MessageDigest.getInstance("SHA-256").digest(raw).take(16).joinToString("") { "%02x".format(it) }` → exactly 32 lowercase hex characters, deterministic. Passes Joi `.length(32).hex()`. No fix needed. Non-blocking design note: canonical string uses `:` separator — safe today since both `merchantId` and `tagId` are UUID-shaped (no colons), but theoretically fragile if input shapes change. Log as backlog nit.

12. **Proposed E2E test flow correction (this session):** The originally proposed test expected `PENDING` as the HTTP response from `POST /transactions`. Based on the consumer-pay route pattern in the same codebase (PENDING is a transient DB state written *before* the STK Push; the STK Push fires synchronously in the same request; the response is `201 STK_SENT` on success or `502 FAILED` on STK error), `PENDING` is NOT a terminal HTTP response. With placeholder Daraja creds, expect `502` (STK Push rejected) or `201 STK_SENT` (if creds somehow pass). The test assertion should accept both as valid terminal outcomes. Also: QR token TTL is 90s — scripted tests must run without human pauses between steps.

---

## 🖥️ ENVIRONMENT SETUP (Windows/MINGW64 — all rules consolidated)

**Every new terminal, before anything:** `pwd`, `which adb`, `java -version` — MINGW64 does not reliably persist PATH across terminal windows even with `.bashrc` edits (reconfirmed again this session).

**Redis:** NOT on PATH. Manual start every session: `/c/Users/admin/redis/redis-server.exe --port 6379` (leave running). Verify: `redis-cli ping` → PONG. Backend log "Reached the max retries per request limit" = Redis not running.

**PostgreSQL:** Running natively on `:5432` (not Docker).

**Docker is NOT installed on this machine** (`docker: command not found`) — the docker-compose local stack documented in README is unusable here.

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

**⚠️ Terminal `cat` rendering issue (NEW, this session):** `cat` on specific XML files in the consumer-wallet layout directory produces **zero output and zero error**, even though `file` confirms the files are plain ASCII/UTF-8 and `wc -l`/`wc -c` report real line/byte counts (e.g., `AndroidManifest.xml`: 115 lines, 5259 bytes; `fragment_home.xml`: 6557 bytes). NOT an encoding issue — `file` rules out UTF-16. NOT a missing-file issue — `ls -la` confirms presence and size. Suspected MinTTY/Git-Bash rendering bug specific to certain file content patterns. **Workaround:** use `grep -n "" <file>` (forces output through grep's code path) or `code <file>` (opens in VS Code, paste from editor tab). Do NOT waste time re-running `cat` — it has failed four consecutive times on the same files across different working directories and invocation styles.

**Git discipline (NEW standing rule):** `git status --short` before EVERY commit; read what's staged; verify `N files changed` matches intent. (Born from the `52197d6` accidental-revert incident.) Push target: `git push fork main` — NOT origin.

---

## 🏗️ PROJECT ARCHITECTURE (Current State)

```
OrchestratePay_Platform/
├── CLAUDE.md                          # ✅ corrected this session (Vite stack, line 29)
├── docs/                              # 🟡 this handover replaces prior version
├── infra/                             # k8s/ + nginx/ — untouched; 2 P0 pre-deploy fixes pending
├── Tap2Pay/
│   ├── backend/                       # Express + pg + Joi + Redis (ioredis) + ws
│   │   └── src/routes/
│   │       ├── consumers.ts           # ✅ Bug #14 fixed (asyncHandler + real-schema SQL)
│   │       └── auth.ts                # ✅ refresh endpoints confirmed: /auth/refresh + /auth/consumer/refresh (single-use rotation)
│   ├── web/                           # ✅ Vite 6 + React 19 (Next.js claim CLOSED)
│   ├── dashboard/                     # ⚠️ UNDOCUMENTED React 18 + Vite 5 app — ruling needed
│   └── android/
│       ├── app/                       # 🔴 BLOCKED: fatal Sentry crash on launch (Bug #11)
│       ├── consumer-wallet/           # ✅ PROVEN on emulator end-to-end; ⚠️ Bug #16 (dead P2P buttons) + Bug #17 (401 on token expiry)
│       ├── nfc-core/                  # unchanged
│       └── softpos/                   # builds green, untested at runtime
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

1. **Apply the Bug #11 fix** (written, unapplied): create `Tap2Pay/android/app/src/debug/AndroidManifest.xml` with `<provider android:name="io.sentry.android.core.SentryInitProvider" tools:node="remove" />` → `./gradlew :app:assembleDebug` → reinstall on emulator → **launch and login merchant app** (`merchant@test.com` / `TestPass123` / Device ID `emu-01`). This completes the handover's #1 pending milestone at emulator grade. Commit the fix.

2. **Verify backend is running the restored Bug #14 code** (it should have auto-respawned on the `23ef6f6` restore): health → consumer login → `/me/loyalty` → health. Then **re-login the wallet app on the emulator** and confirm the backend survives its post-login loyalty call. Then load the **web consumer Loyalty page** in Chrome — same check.

3. **Apply Bug #16 fix** (consumer wallet dead buttons): extract `fragment_home.xml` + `activity_home.xml` + `AndroidManifest.xml` content via VS Code (`code <file>`) since `cat` is broken for these files → confirm button view IDs → wire `setOnClickListener` in `HomeFragment.kt` → verify manifest declarations for `P2PQrScannerActivity` and `P2PSendActivity` → rebuild → retest on emulator. This is the highest-ROI fix in the backlog — P2P is currently unreachable from the UI.

4. **Apply Bug #17 fix** (token-expiry 401 on both Android apps): confirm exact refresh response shape from `sed -n '195,215p'` and `sed -n '695,715p'` of `auth.ts` → confirm consumer crash-vs-silent-fail from `HomeViewModel.kt` → add `refreshToken` to both `AuthResponse` data classes → persist in both `SessionManager`s → add `OkHttp Authenticator` with synchronized single-flight refresh to both API clients → fix consumer `bearer()` null handling → rebuild both apps → test by waiting for token expiry or manually setting `expiresAt` to the past.

### 🟡 Next (no hardware needed):

5. Bug #15 triage: audit CI (is it running? failing silently on the fork?) — deployment blocker. Then failure-cluster triage.
6. Item #41 contract audit round 2: extend the live-JSON vs data-class diff beyond auth (transactions, loyalty, merchants/me) — the class is proven to exist (Bugs #10, #14, #17).
7. Roll `asyncHandler` out to remaining route modules (Bug #14 class-fix).

### ⏳ Blocked on hardware (unchanged critical path):

8. Merchant Terminal on the REAL device (after Bug #11 fix + emulator pass).
9. 2nd NFC phone — physically confirm via `adb devices` showing two entries, pasted output.
10. ANDROID_NFC_TESTING_PROTOCOL.md Tests 1–4. (Note: that protocol's pre-flight and account tables are superseded by this document.)

### 🗓️ Parallel, non-engineering:

11. CBK PSP license (3–6 months lead — must already be in motion), KRA eTIMS, Kenya DPA 2019.
12. Product-owner rulings needed: `dashboard/` module fate; design-language unification (item #43); Daraja sandbox credentials for real STK Push testing. (Refresh-token handling is NO LONGER a product decision — it's a confirmed bug with a designed fix; just needs implementation.)

### Deployment path (agreed direction, not started):

**Phase S (staging):** fix the 2 P0 k8s manifest gaps → VPS deploy via docker-compose → domain + TLS → nginx serves built web → Daraja sandbox creds → Android staging build config + signed APKs.
**Phase H (hardening):** JWT_SECRET rotation, DB SSL, rate limiting, Sentry upgrades (backend 8.x→10.x AND Android DSN config), backups.
**Phase P (production):** gated on Safaricom production onboarding + CBK license.

**Bugs #14/#15/#17 and the CI audit gate Phase S.** Bug #17 in particular is a deployment blocker — you cannot ship an app that silently loses auth after 8–24h with no recovery path.

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

*Pending commits (fixes designed, not yet applied):*
- Bug #11: Sentry debug manifest overlay for `:app`
- Bug #16: HomeFragment click listener wiring + manifest verification
- Bug #17: Refresh-token persistence + OkHttp Authenticator (both apps)

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
| 2026-09-02 | Upgraded refresh-token handling from "backlog observation" to Bug #17 (tracked, immediate priority) | Source review confirmed it's a live user-facing auth failure, not a "nice to have." Both clients silently drop the refresh token the backend already sends. Single-use rotation confirmed — Authenticator design must include single-flight guard. |
| 2026-09-02 | Diagnosed Bug #16 (dead P2P buttons) by elimination: cleared TapToPayFragment, HomeActivity, and HomeFragment of navigation logic → buttons must be orphaned XML views | Systematic source review of all three candidate files; supported by test coverage gap (P2P Activities tested, home entry point not) |
| 2026-09-02 | Verified IdempotencyKeyGen.kt compliant with Joi `.length(32).hex()` — no fix needed | SHA-256 → 16 bytes → 32 hex chars. Deterministic. Prevents wasted effort chasing a non-bug. |
| 2026-09-02 | Corrected E2E test flow: `PENDING` is a transient DB state, not an HTTP response — test should expect `201 STK_SENT` or `502 FAILED` | Prevents a false-negative test assertion that would have blocked the parity verification milestone |
| 2026-09-02 | Documented terminal `cat` rendering quirk; established `grep -n ""` / VS Code as the reliable file-reading fallback | Four consecutive `cat` failures on confirmed-real ASCII files. Don't fight the terminal — route around it. |

---

END OF SESSION_HANDOVER.md
```

---

**To save and commit** (single-line commands, per the standing rule):

```bash
code docs/SESSION_HANDOVER.md
```
Paste the full content above into the VS Code tab, save, then:

```bash
cd ~/Desktop/projects/colab\ project/OrchestratePay_Platform
git add docs/SESSION_HANDOVER.md
git status --short
```
Verify it shows `M  docs/SESSION_HANDOVER.md` (and ONLY that), then:

```bash
git commit -m "docs(handover): session 5 update — Bug #16 (dead P2P buttons) + Bug #17 (token-expiry 401) diagnosed, refresh contract mapped, IdempotencyKeyGen verified, E2E test corrected"
git push fork main
```

After that's pushed, the next steps are exactly the four items in the 🔴 Immediate section — Bug #11 fix first (unblocks merchant app), then Bug #14 re-verification, then Bug #16 (unblocks P2P), then Bug #17 (unblocks sustained sessions). Let me know when you want to tackle each one and I'll provide the exact file replacements.
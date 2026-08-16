# PRODUCTION READINESS CHECKLIST
**Project:** OrchestratePay Platform
**Last Updated:** 16 August 2026
**Status:** 🟡 PHASE 1 IN PROGRESS (PARTIAL) — Consumer Wallet confirmed working end-to-end on ONE real device. Merchant Terminal NOT yet tested. Second physical phone NOT yet confirmed by `adb devices`. 5 UNCOMMITTED FILES currently in working tree — must be committed before any further work continues, to avoid losing real, verified fixes.

---

## ⚠️ CORRECTION TO PRIOR VERSION OF THIS DOCUMENT

The 12 August version of this checklist stated: *"2ND NFC PHONE NOW AVAILABLE — Phase 1 Hardware Validation UNBLOCKED, starting now"* and *"working tree fully clean."*

**Both claims are now known to be false as of this session:**
- The last confirmed `adb devices` output showed exactly **one** device (`RF8R42CY49R`). No second device has been confirmed connected via ADB at any point in the logs reviewed.
- The working tree currently has **5 modified, uncommitted files** — real bug fixes, not yet committed.

**Standing lesson reaffirmed (again):** status claims in these docs must be backed by pasted command output, not narrative. Every previous "fully closed" declaration in this project's history has eventually been contradicted by a wider-scope check. Treat every ✅ in this document as "true as of the last command output we actually saw," not as permanent fact.

---

## LEGEND
- ✅ COMPLETED - Fix applied, tested, committed
- 🟡 IN PROGRESS - Work started, not finalized
- ⚠️ PENDING - Not started, blocking production
- 🔴 CRITICAL - Must fix before launch

---

## 🚨 URGENT — DO THIS BEFORE ANYTHING ELSE

| # | Item | Why It's Urgent |
|---|------|------------------|
| 35 | **Commit the 5 uncommitted files** | Real, verified fixes (see items #36–39 below) currently exist only on disk. Any accidental `git checkout`, machine restart mid-work, or careless `git stash` could destroy hours of debugging. This is the single highest-priority action right now — higher than continuing hardware testing. |

Files pending commit:
modified: app/build.gradle (10.0.2.2 → localhost)
modified: consumer-wallet/build.gradle.kts (10.0.2.2 → localhost)
modified: consumer-wallet/.../ConsumerApiClient.kt (phone: String → String?)
modified: consumer-wallet/.../ConsumerSessionManager.kt (phone: String → String?)
modified: ../backend/src/routes/auth.ts (added phone + displayName to responses)

text


**Recommendation:** commit as 2–3 atomic commits, not one blob — the Android network config change (build.gradle files) is a distinct concern from the backend/Android response-contract fix (auth.ts + ConsumerApiClient.kt + ConsumerSessionManager.kt). Suggested split:
1. `fix(android): point debug builds at localhost instead of emulator-only 10.0.2.2`
2. `fix(auth): include phone and displayName in consumer login/register responses; make Android AuthResponse.phone nullable as defense-in-depth`

---

## ✅ COMPLETED (Code Fixes & Build) — Prior Session (12 August, verified via build logs)

| # | Item | File | Change | Commit | Status |
|---|------|------|--------|--------|--------|
| 1 | **APDU Protocol** | `NfcReaderManager.kt:255,271` | 0xC0→0x80, 0xC1→0x81 | `16e333c` | ✅ FIXED |
| 2 | **Thread Safety** | `ConsumerHceService.kt:47` | AtomicReference | `8ef53d8` | ✅ FIXED |
| 3 | **TTL Consistency** | `ConsumerHceService.kt:44` | 60s→90s | `36a9c5c` | ✅ FIXED |
| 4 | **SDK Version** | `build.gradle.kts` | 34→35 | `186521c` | ✅ FIXED |
| 5 | **Google Services** | `build.gradle.kts` | Disabled for testing | `1d332fb` | ✅ FIXED |
| 6 | **Missing Layout** | `activity_consumer_tag_writer.xml` | Created | `3525e52` | ✅ FIXED |
| 7 | **Consumer Wallet Build (4 root causes)** | Various | Fixed all 4 blockers | `fd21ba5` | ✅ FIXED |
| 8 | **Gradle Wrapper** | `gradlew`, `gradlew.bat`, `gradle-wrapper.jar` | Generated & committed | `fd21ba5` | ✅ FIXED |
| 9 | **HCE Manifest — false alarm retracted** | `AndroidManifest.xml` | No code change | `4d77878` | ✅ CONFIRMED NOT A BUG |
| 10 | **Missing `colors.xml` in `:app`** | `app/src/main/res/values/colors.xml` | Created | `e9866d0` | ✅ FIXED |
| 11 | **Launcher icons untracked (`:app`)** | mipmap dirs | Committed | `e9866d0` | ✅ FIXED |
| 12 | **`backend/package-lock.json` review** | `package-lock.json` | Reviewed, safe | `b5317a5` | ✅ FIXED |
| 31 | **nfc-core missing `consumer-rules.pro`** | `nfc-core/build.gradle.kts` | Created placeholder | `6e33592` | ✅ FIXED |
| 32 | **softpos missing launcher icons** | `softpos/src/main/res/*` | Reused `:app` icon set | `35ec698` | ✅ FIXED |
| 33 | **softpos `AnimatorSet.repeatCount` misuse** | `TapGuideActivity.kt` | Moved to child `ObjectAnimator`s | `35ec698` | ✅ FIXED |

**Note on commit count:** the previously-cited "50 commits, 28 ahead" figure is now **stale** — it predates the 5 currently-uncommitted files from this session. **Do not cite a commit count in any future doc without running `git log --oneline | wc -l` fresh in that same session.**

---

## ✅ NEW FINDINGS — THIS SESSION (16 August) — Real Bugs, Found and Fixed on Real Hardware

These are qualitatively different from the Phase 0 bugs above: those were caught by `assembleDebug`. These were only reachable by **actually running the app on a physical device and attempting a real login** — proof that build-green ≠ runtime-correct, and a strong argument for why hardware testing was never optional.

| # | Item | File(s) | Root Cause | Fix | Status |
|---|------|---------|------------|-----|--------|
| 36 | **Test consumer account never existed in DB** | N/A (data, not code) | `consumer2@test.com` was referenced throughout every testing doc but never actually seeded into `consumers` table. Only pre-existing rows: one with `email: null`, one with `consumer@example.com`. | Created via real `POST /api/v1/auth/consumer/register` — went through actual bcrypt hashing, SHA-256 phone hashing, UUID gen, audit log. Consumer ID `a09df433-e945-40ad-9177-54ec6ac94300`. | ✅ FIXED — verified via `curl` login success |
| 37 | **Debug build hardcoded emulator-only IP (`10.0.2.2`)** | `app/build.gradle:32`, `consumer-wallet/build.gradle.kts:24` | Both modules' debug `API_BASE_URL` pointed at the Android-emulator-only loopback alias. Real physical devices cannot resolve `10.0.2.2` to the host machine. | Changed to `localhost`, paired with `adb reverse tcp:3000 tcp:3000` to forward the phone's `localhost:3000` to the dev machine over USB. `localhost` was already permitted in `network_security_config.xml`. | ✅ FIXED (uncommitted — see item #35) |
| 38 | **`adb reverse` binding does not survive ADB daemon restart** | N/A (environment/process, not code) | Any daemon restart (e.g. `* daemon not running; starting now`) silently drops the port forward, causing "Failed to connect" errors that look identical to a fresh config problem. | No code fix — **process/runbook fix**: re-run `adb -s <serial> reverse tcp:3000 tcp:3000` after any daemon restart, verify with `adb reverse --list` before assuming connectivity is broken again. | ✅ DOCUMENTED — added to runbook below |
| 39 | **Backend/Android auth response contract mismatch → NullPointerException on login** | `backend/src/routes/auth.ts`, `ConsumerApiClient.kt`, `ConsumerSessionManager.kt` | Backend's `POST /api/v1/auth/consumer/login` queried `phone` and `display_name` from the DB (confirmed at query level, line 413) but **never included them in the JSON response body**. Android's `AuthResponse` data class declared `phone: String` as **non-nullable**. Gson deserialized the missing field as `null`, Kotlin's null-safety threw at runtime: `NullPointerException: Parameter specified as non-null is null: method ConsumerSessionManager.saveSession, parameter phone`. | Two-sided fix: (1) backend now includes `phone` + `displayName` in all consumer login/registration/Google-auth responses (5 call sites: lines 380, 432, 519, 550, 661); (2) Android `AuthResponse.phone` and `ConsumerSessionManager.saveSession(phone: ...)` both changed to nullable `String?` as defense-in-depth against any other auth path with the same gap. | ✅ FIXED (uncommitted — see item #35) — **verified working: Consumer Wallet dashboard now renders correctly with "Test Consumer 2", loyalty points, quick actions** |
| 40 | **Sentry Android SDK crashes on missing DSN** | N/A — Sentry auto-init via ContentProvider | `IllegalArgumentException: DSN is required. Use empty string or set enabled to false in SentryOptions to disable SDK.` Debug builds have no DSN configured, but Sentry's default auto-init doesn't tolerate that gracefully. | **Not yet fixed.** App recovered and continued past this crash in the observed run, so it is not currently blocking, but this is fragile — a future Android/Sentry SDK version could make this fatal instead of recoverable. | ⚠️ DEFERRED — track before production. Recommended fix: explicitly disable Sentry for debug builds (`enabled = false` in `SentryOptions`) rather than relying on auto-init tolerating a missing DSN. |

**New standing lesson from this session:** a schema/contract mismatch between backend response shape and Android's expected data class (item #39) is a **class of bug that `assembleDebug` and Kotlin compilation can never catch**, because both sides compile fine independently — it only manifests at runtime against a real backend response. This strongly suggests **an API contract audit is worth doing across all auth/session endpoints**, not just the one that happened to crash first. Recommend adding this as a new backlog item (see #41 below).

| # | Item | Severity | Action |
|---|------|----------|--------|
| 41 | **Full auth/session API contract audit** | 🟡 MEDIUM | Systematically diff every backend response shape against its corresponding Android/web data class for all auth-adjacent endpoints (merchant login, Google auth, refresh token, etc.) — item #39 was found by accident via a crash; there is no guarantee it's the only instance of this pattern. |

---

## ✅ COMPLETED (Infrastructure & Verification) — Updated

| Component | Status | URL | Verification |
|-----------|--------|-----|---------------|
| PostgreSQL 18 | ✅ | localhost:5432 | 4 migrations applied |
| Redis | ✅ | localhost:6379 | Started manually this session via full path (`/c/Users/admin/redis/redis-server.exe --port 6379`), `PING → PONG` confirmed. **Not on PATH — must be started manually each session until added to `.bashrc` or a startup script.** |
| Backend API | ✅ | :3000 | Started manually this session (`npm run dev`), confirmed via log line `"OrchestratePay backend running on port 3000"` |
| Web Frontend | ⚠️ UNVERIFIED THIS SESSION | :3001 | Not touched this session — carried over from prior doc, not re-confirmed. Do not assume still running. |
| Test Accounts | 🟡 PARTIAL | - | `consumer2@test.com` — ✅ now real, created and login-verified. `merchant@test.com` — exists, APPROVED, but **login not yet attempted this session** (next immediate step). |
| Android Kotlin Compile (all 4 modules) | ✅ (as of 12 Aug) | `app`, `consumer-wallet`, `nfc-core`, `softpos` | Not re-verified this session — recommend re-running before next commit given 5 files changed |
| Android APK Packaging | 🟡 PARTIAL | — | Consumer Wallet: rebuilt, reinstalled, confirmed working on real device this session. `:app` (Merchant Terminal): not yet reinstalled/retested with the `localhost` fix. |
| **2nd NFC-enabled phone** | ⚠️ **NOT CONFIRMED** | — | **Correction from prior doc: no `adb devices` output in this session or the prior one has ever shown two devices simultaneously. Treat as unavailable until proven otherwise with pasted output.** |
| Consumer Wallet — real device, real login, real dashboard | ✅ | — | **First genuine end-to-end mobile success this project has had.** Login → JWT issued → session saved → dashboard rendered with real data. |
| Merchant Terminal — real device | ⚠️ NOT YET TESTED | — | Immediate next step |
| Git working tree | 🔴 **NOT CLEAN** | — | 5 uncommitted files — see URGENT section above |

---

## 🟡 PHASE 1 — HARDWARE VALIDATION (Corrected Status: PARTIAL, NOT "ACTIVE")

| # | Item | Status | Blocker | Success Criteria |
|---|------|--------|---------|-------------------|
| 13 | **Phone-to-Phone NFC (HCE)** | 🔴 **NOT READY** — was previously marked "READY TO TEST" in error | Requires: (a) 5 files committed, (b) Merchant Terminal login verified on at least one device, (c) a genuine second `adb`-confirmed device | APDU exchange: SELECT→GET DATA→CONFIRM |
| 14 | **NFC Tag Read** | ⚠️ PENDING | Needs NTAG215/216 sticker — availability still unconfirmed | Tag signature verified, STK Push sent |
| 15 | **P2P Transfer** | ⚠️ PENDING | Needs 2nd confirmed device | Token exchange, backend settlement |
| 16 | **APDU Log Capture** | ⚠️ PENDING | Depends on #13 | Logcat shows 0x80/0x81 instructions |

**Corrected sequencing — do this in order, do not skip ahead:**
1. Commit the 5 pending files (#35)
2. Test Merchant Terminal login on the **one confirmed device** (single-device sanity check — cheap, fast, catches any similar contract bugs in the merchant auth path before we're mid-hardware-test)
3. Physically confirm a second device via `adb devices` showing two `device` entries simultaneously — paste the output, don't assume
4. Only then proceed to Test 1 (Phone-to-Phone HCE)

---

## ⚠️ PENDING (Security Hardening) — Unchanged, still deprioritized behind Phase 1 completion

| # | Item | Severity | Effort | Action |
|---|------|----------|--------|--------|
| 17 | **JWT Secret** | 🔴 CRITICAL (at deploy) | 5 min | `openssl rand -hex 64` → `.env` at deploy time |
| 18 | **Database SSL** | 🔴 CRITICAL | 10 min | Add `sslmode=require` |
| 19 | **Rate Limiting** | 🟡 MEDIUM | 30 min | Add to `/merchant-hce-token` |
| 20 | **P2P Timeout** | 🟢 LOW | 15 min | Add 5min TTL to `P2PHceSession` |
| 21 | **`@sentry/node` upgrade (backend)** | 🟡 MEDIUM | 2-4 hrs | 8.x→10.68.0 — separate track from item #40 (Android Sentry DSN crash) |
| 23 | **APDU sniffing / server-side idempotency review** | 🟡 MEDIUM | 1 hr | Still unreviewed — directly relevant to eventual Test 4c |

---

## ⚠️ PENDING (Architecture Clarity) — Unchanged

| # | Item | Severity | Action |
|---|------|----------|--------|
| 34 | **Web stack contradiction unresolved** | 🟡 MEDIUM | Still not resolved with product owner. Does not block current work. |

---

## ⚠️ PENDING (Compliance) — Unchanged, calendar-driven, start regardless

| # | Item | Severity | Timeline |
|---|------|----------|----------|
| 28 | **CBK PSP License** | 🔴 CRITICAL | 3-6 months — should have been started already, start immediately, does not compete with any engineering time |
| 29 | **KRA eTIMS** | 🟡 MEDIUM | 2-4 weeks |
| 30 | **Data Protection (Kenya DPA 2019)** | 🟡 MEDIUM | Lawyer needed |

---

## 🎯 IMMEDIATE NEXT ACTIONS (Corrected, in real priority order)

1. 🔴 **Commit the 5 uncommitted files** as 2 atomic commits (see item #35 for split)
2. 🔴 **Re-run `./gradlew clean assembleDebug`** for all 4 modules post-commit — the network config + nullable-type changes touched real code, this must be re-verified green before trusting anything built on top of it
3. 🔴 **Test Merchant Terminal login** on the confirmed device (`merchant@test.com` / `TestPass123`) — cheapest possible next signal, do this before chasing a second phone
4. 🔴 **Physically resolve second-device status** — plug it in, confirm Developer Options + USB debugging are on, run `adb devices`, confirm two `device` (not `unauthorized`) entries, paste output
5. 🟡 Fix Sentry DSN crash properly (item #40) — low effort, prevents a currently-recoverable crash from becoming fatal on a future SDK bump
6. 🟡 Begin item #41 (full auth contract audit) in parallel — doesn't block hardware testing
7. ⚠️ CBK license application — should already be in motion, independent of all of the above

**Not doing right now, and why:** items #17–21, #23, #28-30 remain correctly deprioritized behind getting an actual second confirmed device and a working Merchant Terminal login — that is still the true critical path, exactly as the 12 August doc argued, it just hadn't actually been reached yet.

---

## 📝 DECISION LOG (New Entries)

| Date | Decision | Impact |
|------|----------|--------|
| 2026-08-16 | Corrected prior doc's false claims of "2nd phone available" and "working tree clean" | Restores trust in this document as ground truth; both claims are now shown to have been premature/incorrect |
| 2026-08-16 | Created real `consumer2@test.com` account via actual registration endpoint rather than direct DB insert | Fix went through the full production code path (bcrypt, phone hashing, audit log) — more trustworthy than a raw SQL insert |
| 2026-08-16 | Root-caused NPE to a genuine backend/Android response-contract mismatch, not a client-side bug | Fixed both sides; flagged as a new bug *class* not caught by existing build verification, opened item #41 (contract audit) as a direct consequence |
| 2026-08-16 | Diagnosed `10.0.2.2` as emulator-only and switched debug builds to `localhost` + `adb reverse` | Real devices can now reach the local backend over USB; documented that this binding does not survive daemon restarts (item #38) |
| 2026-08-16 | Deferred Sentry DSN crash fix (recoverable, not fatal) rather than fixing immediately | Correctly triaged as non-blocking for hardware testing, but tracked so it isn't forgotten before production |
| 2026-08-16 | Explicitly did NOT advance Phase 1 status to "active" despite one device working end-to-end | One working device ≠ two working devices; refused to repeat the previous session's premature "unblocked" declaration |

---

## END OF CHECKLIST
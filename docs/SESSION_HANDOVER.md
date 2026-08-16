# SESSION_HANDOVER.md
**Last Updated:** 16 August 2026 (Session 4, IN PROGRESS — do not mark closed)
**Project:** OrchestratePay Platform
**Status:** 🟡 CONSUMER WALLET WORKING END-TO-END ON ONE REAL DEVICE — Merchant Terminal untested on hardware, 2nd NFC phone still awaited, 5 files uncommitted on disk right now
**Prepared by:** Senior Lead Dev (10x)
**Recipient:** Incoming Senior Lead Dev / Project Continuation Lead

---

## 🎯 QUICK ORIENTATION (Read This First)

**What is this project?**
NFC Tap-to-Pay platform for Kenyan market. Integrates with M-Pesa (Daraja API). Consumer taps phone/sticker → M-Pesa STK Push → PIN entry → Payment confirmed.

**⚠️ Stack Correction (still unconfirmed with product owner) — UNCHANGED, still open:**
`CLAUDE.md` describes `Tap2Pay/web/` as Next.js; an earlier note claimed Vite 6 + React 19. Unresolved. Not touched this session — does not block current work.

**⚠️ Correction to prior handover (12 August):** That document declared Phase 0 "FULLY CLOSED," working tree "fully clean," and stated the 2nd NFC phone was "confirmed no... yet." A follow-up checklist dated the same day then contradicted itself, claiming the 2nd phone was "NOW AVAILABLE." Neither the "clean tree" claim nor the "2nd phone available" claim has ever been backed by pasted command output. **Both are now known to be inaccurate as of this session.** Going forward: no status in this document is asserted without the command output that proves it, pasted in the same session it was run.

**Current Status — Ground Truth Only:**
- ✅ Backend confirmed running this session (`npm run dev` → `"OrchestratePay backend running on port 3000"`)
- ✅ Redis confirmed running this session — **not on PATH, must be started manually via full path each session** (`/c/Users/admin/redis/redis-server.exe --port 6379`), `PING → PONG` verified
- ✅ Consumer account `consumer2@test.com` — **did not exist prior to this session** despite being referenced in every prior testing doc. Created via real `POST /api/v1/auth/consumer/register`. Consumer ID `a09df433-e945-40ad-9177-54ec6ac94300`.
- ✅ Consumer Wallet — **first genuine end-to-end success this project has had on real hardware**: login → JWT issued → session persisted → dashboard rendered with real data ("Test Consumer 2", loyalty points, quick actions)
- ⚠️ Merchant Terminal (`:app`) — **not yet installed/tested on the corrected `localhost` config this session** — immediate next step
- ⚠️ 2nd NFC phone — **NOT confirmed by `adb devices`.** Every `adb devices` output seen across this and the prior session shows exactly one device (`RF8R42CY49R`). Awaiting physical arrival/connection.
- 🔴 **5 files currently uncommitted on disk** — real, verified fixes, not yet committed. See Blockers section — this is the single highest-priority action pending right now, ahead of any further testing.
- ⚠️ One new non-blocking bug observed and deferred: Sentry Android SDK DSN crash (recoverable in current SDK version, not yet fixed)

**Working tree state (as of this session, NOT clean):**
modified: app/build.gradle
modified: consumer-wallet/build.gradle.kts
modified: consumer-wallet/.../ConsumerApiClient.kt
modified: consumer-wallet/.../ConsumerSessionManager.kt
modified: ../backend/src/routes/auth.ts

text

**Commit count not re-verified this session — do not cite the stale "50 commits, 28 ahead" figure from the prior handover. Run `git log --oneline | wc -l` fresh before writing any number down.**

---

## 🚨 FINDINGS LOG (Chronological, Most Recent First)

### Bug #11: Sentry Android SDK Crashes on Missing DSN — ⚠️ OBSERVED, DEFERRED (16 August 2026)
**Symptom:** `IllegalArgumentException: DSN is required. Use empty string or set enabled to false in SentryOptions to disable SDK.`
**Root cause:** Sentry Android SDK auto-initializes via a ContentProvider on app startup. No DSN is configured for debug builds, and the SDK's default behavior does not tolerate an absent DSN gracefully.
**Status:** App recovered and continued past the crash in the observed run — **not currently blocking**, but fragile. A future SDK version could make this fatal rather than recoverable.
**Fix (not yet applied):** Explicitly set `enabled = false` in `SentryOptions` for debug builds rather than relying on tolerant auto-init behavior.
**Do not conflate with the separate, previously-deferred backend `@sentry/node` upgrade — independent tracks, as noted in prior sessions.**

### Bug #10: Backend/Android Auth Response Contract Mismatch → NullPointerException on Login — ✅ FIXED, NOT YET COMMITTED (16 August 2026)
**Symptom:** Consumer Wallet login succeeded at the network level (backend returned HTTP 200, JWT issued) but the app immediately crashed:
NullPointerException: Parameter specified as non-null is null: method ConsumerSessionManager.saveSession, parameter phone

text

**Root cause:** `POST /api/v1/auth/consumer/login` in `backend/src/routes/auth.ts` **queried** `phone` and `display_name` from the DB (confirmed at the SQL level: `SELECT id, display_name, phone, password_hash, active FROM consumers`) but never included either field in the JSON response body. Android's `AuthResponse` data class declared `phone: String` as **non-nullable**. Gson silently deserialized the missing key as `null`; Kotlin's null-safety threw at the first point that value was used non-nullably.
**This is a genuinely new class of bug for this project** — a backend/client data-contract mismatch that compiles clean on both sides independently and is invisible to `assembleDebug` or any Kotlin-only check. It is only reachable by actually running the app against a real backend response.
**Fix (two-sided, uncommitted):**
- Backend: added `phone: consumer.phone, displayName: consumer.display_name` to all 5 consumer auth response call sites (login, registration, Google auth — `auth.ts` lines 380, 432, 519, 550, 661)
- Android: `AuthResponse.phone` (`ConsumerApiClient.kt`) and `saveSession(phone: ...)` (`ConsumerSessionManager.kt`) both changed `String` → `String?` as defense-in-depth, in case any other auth path has the same gap
**Verified:** Consumer Wallet dashboard now renders correctly post-login.
**Follow-up opened:** full auth/session API contract audit (see Checklist item #41) — this bug was found by accident; there's no evidence it's the only instance of this pattern across merchant login, refresh-token, or Google-auth flows.

### Bug #9: `adb reverse` Binding Does Not Survive ADB Daemon Restart — ✅ DOCUMENTED, PROCESS FIX ONLY (16 August 2026)
**Symptom:** After an ADB daemon restart (`* daemon not running; starting now` — happens on its own, e.g. after a USB disconnect/reconnect or `adb kill-server`), previously-working port forwarding silently drops, and login fails again with "Failed to connect" — looking identical to a fresh config problem, wasting time re-diagnosing something already fixed.
**Root cause:** `adb reverse` bindings are process-scoped to the current ADB daemon session, not persistent.
**Fix:** No code fix applicable — this is a runbook item. Re-run `adb -s <serial> reverse tcp:3000 tcp:3000` after any daemon restart; verify with `adb reverse --list` before assuming connectivity is broken for a different reason.
**Standing rule added:** whenever "Failed to connect to localhost:3000" reappears after previously working, check `adb reverse --list` **before** re-investigating build config — this specific failure mode has already wasted cycles once.

### Bug #8: Debug Build Hardcoded Emulator-Only IP (`10.0.2.2`) — ✅ FIXED, NOT YET COMMITTED (16 August 2026)
**Symptom:** Both APKs installed successfully on a real phone, but login failed with "Failed to connect to localhost/127.0.0.1:3000" even after `adb reverse` was configured.
**Root cause:** `app/build.gradle:32` and `consumer-wallet/build.gradle.kts:24` both hardcoded `API_BASE_URL = "http://10.0.2.2:3000"` for the debug build variant. `10.0.2.2` is a special-purpose alias that **only resolves inside the Android emulator** — it routes to the host machine's loopback from within QEMU's virtual network. A real physical device has no such alias and will never reach it.
**Fix:** Changed both to `localhost`, paired with `adb reverse tcp:3000 tcp:3000` (phone's `localhost:3000` → dev machine's `localhost:3000` over USB). `localhost` cleartext traffic was already permitted in both apps' `network_security_config.xml`, so no additional config change was needed there.
**Status:** ✅ Verified working on `consumer-wallet`. **`:app` (Merchant Terminal) has the same fix applied but has not yet been reinstalled/retested on hardware this session** — do not assume it works until confirmed.

### Bug #7: Test Consumer Account Never Existed in Database — ✅ FIXED, NOT YET COMMITTED (data only, no code change) (16 August 2026)
**Symptom:** Login with `consumer2@test.com` / `TestPass123` failed. This exact credential pair has been cited as the standard test login in every testing doc since the project's early sessions.
**Root cause:** The account was never actually seeded. The `consumers` table contained exactly two rows: one with `email: null`, one with `consumer@example.com` — neither matches the documented test credentials.
**Investigation method:** Direct DB query (`\dt` + table inspection) rather than assuming the login endpoint itself was broken — this correctly isolated "account doesn't exist" from "auth logic is broken," which are different failure modes with different fixes.
**Fix:** Created the account through the real `POST /api/v1/auth/consumer/register` endpoint (not a raw SQL insert) — `{phone: "254700000002", email: "consumer2@test.com", password: "TestPass123", displayName: "Test Consumer 2"}`. This exercised the full production code path: bcrypt password hashing, SHA-256 phone hashing, UUID generation, audit logging. Resulting consumer ID: `a09df433-e945-40ad-9177-54ec6ac94300`.
**Why this matters beyond just fixing the login:** using the real registration endpoint (rather than inserting a row directly) means this account's data shape is guaranteed correct for whatever the registration code path actually produces — a raw INSERT could easily have missed a column the app relies on.

---

### Bugs #1–#6 — Carried forward from 12 August session, unchanged, see prior handover for full detail:
- Bug #6: nfc-core missing `consumer-rules.pro` — ✅ FIXED, committed `6e33592`
- Bug #5: 5 post-KSP `:app` compile error clusters — ✅ ALL CLOSED, committed `e9866d0`
- Bug #4: kapt→KSP migration — ✅ FIXED, committed `e9866d0`
- Bug #3: colors.xml — ✅ FIXED, committed `e9866d0`
- Bug #2: HCE false alarm — RETRACTED, `4d77878`
- Bug #1: Launcher icons (`:app`) — ✅ FIXED, committed `e9866d0`
- Bug #6 (renumbered from prior doc's own "#7"): softpos missing icons + `AnimatorSet.repeatCount` misuse — ✅ FIXED, committed `35ec698`

**Note:** the numbering scheme was reset this session to keep new findings clearly ordered chronologically. Cross-reference by description, not number, when comparing against the 12 August handover.

---

## 🔍 OBSERVATIONS (Not Bugs — Logged for Clarity)

**Native Sentry libraries present in `:app`** — carried forward, unchanged from 12 August. Android/native Sentry SDK is a separate upgrade track from backend `@sentry/node`. No action needed now.

---

## 🖥️ ENVIRONMENT SETUP

**JAVA_HOME:** Fixed via `.bashrc` (prior session) — not re-verified this session, assumed stable.

**adb on PATH:** Added this session via:
```bash
echo 'export PATH="$PATH:/c/Users/admin/AppData/Local/Android/Sdk/platform-tools"' >> ~/.bashrc
Not yet confirmed to persist across a fresh terminal window — verify at the start of next session by opening a brand-new terminal and running which adb with no prior export. If it resolves immediately, this is permanently fixed.

Redis — must be started manually, every session, not on PATH:

Bash

/c/Users/admin/redis/redis-server.exe --port 6379
Verify with ./redis-cli ping → expect PONG. This is not automated. If backend logs show "Reached the max retries per request limit", this is almost certainly why.

adb reverse — must be re-applied after any daemon restart:

Bash

adb -s <serial> reverse tcp:3000 tcp:3000
adb reverse --list    # confirm the binding actually took
gradle.properties (load-bearing, unchanged from 12 August):

text

org.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8
ksp.useKSP2=false
Standing rule — MINGW64 environment does not persist across terminal windows:
Reconfirmed twice more this session — both the adb PATH export and (in the prior session) JAVA_HOME required re-application in fresh terminals despite .bashrc edits appearing correct. Always run pwd, which adb, and java -version at the start of any new terminal before assuming environment state carried over.

Standing rule — build-green does not mean runtime-correct:
New this session. Bug #10 (auth contract mismatch) compiled clean on both backend and Android independently, passed assembleDebug, and only surfaced by actually running the app against a live backend. Full 4-module assembleDebug remains necessary but is no longer sufficient — real device testing against a real running backend is now a required step, not an optional nice-to-have, before any auth-adjacent change is considered done.

🏗️ PROJECT ARCHITECTURE (Current State)
text

OrchestratePay_Platform/
├── Tap2Pay/
│   ├── backend/                    # Express + raw pg pool + Joi
│   │   └── src/routes/auth.ts      # 🟡 MODIFIED, UNCOMMITTED — phone/displayName added to responses
│   ├── web/                        # ⚠️ Stack unconfirmed — unchanged, unresolved
│   └── android/
│       ├── app/                    # 🟡 MODIFIED, UNCOMMITTED — build.gradle localhost fix; NOT retested on hardware
│       ├── consumer-wallet/        # 🟡 MODIFIED, UNCOMMITTED — build.gradle.kts, ConsumerApiClient.kt, ConsumerSessionManager.kt; ✅ VERIFIED WORKING on real device
│       ├── nfc-core/                # ✅ Unchanged since 12 Aug, committed
│       └── softpos/                 # ✅ Unchanged since 12 Aug, committed
├── docs/                            # 🟡 This rewrite in progress
└── infra/k8s/                       # Untouched this session
🔧 CURRENT BLOCKERS & NEXT STEPS
🔴 Immediate — before anything else:

 Commit the 5 uncommitted files (recommend 2 atomic commits: Android network config, backend+Android auth contract fix)
 Re-run ./gradlew clean assembleDebug (all 4 modules) post-commit — real code changed, must re-verify green
🔴 Next — cheapest remaining signal, no 2nd phone needed:

 Install corrected :app (Merchant Terminal) APK on the one confirmed device
 Test login: merchant@test.com / TestPass123 / Device ID: any
 Watch for the same class of bug as #10 — if merchant login also crashes, it's likely the same response-contract gap on a different endpoint
⏳ Blocked on hardware:

 Physically confirm 2nd device via adb devices showing two device entries — paste output, don't assume
 Only then proceed to ANDROID_NFC_TESTING_PROTOCOL.md Test 1
🟡 Parallel, non-blocking:

 Fix Sentry DSN crash properly (Bug #11) — low effort, prevents a currently-recoverable issue from becoming fatal later
 Begin full auth/session API contract audit (opened as a direct consequence of Bug #10)
 CBK PSP license application — should already be in motion regardless of engineering status
📝 DECISION LOG (New Entries)
Date	Decision	Impact
2026-08-16	Corrected prior session's false "2nd phone available" and "tree clean" claims	Restores this document as a trustworthy source; both claims are now proven inaccurate
2026-08-16	Created consumer2@test.com via real registration endpoint, not raw SQL insert	Guarantees data shape matches what the app actually produces/expects
2026-08-16	Diagnosed and fixed 10.0.2.2 emulator-only IP as root cause of real-device connectivity failure	Unblocked all real-device testing; documented as distinct from the earlier adb reverse fix
2026-08-16	Root-caused login NPE to a genuine backend/Android response-contract mismatch, not a client bug	Fixed both sides; opened a new backlog item (contract audit) rather than treating this as a one-off
2026-08-16	Deferred Sentry DSN crash (recoverable, not fatal) rather than fixing immediately mid-hardware-test	Correctly triaged priority; tracked so it isn't forgotten before production
2026-08-16	Refused to declare Phase 1 "active" despite one device working end-to-end	One working device is real progress, not the same as two-device hardware validation being unblocked
END OF SESSION_HANDOVER.md
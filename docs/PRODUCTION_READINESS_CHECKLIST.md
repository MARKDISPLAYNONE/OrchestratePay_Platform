# PRODUCTION READINESS CHECKLIST

**Project:** OrchestratePay Platform
**Last Updated:** 8 August 2026
**Status:** 🟡 CODE COMPLETE — 1 Fix Applied Pending Build Verification (colors.xml) — 1 Fix Applied Pending Git Commit (icons) — NFC Hardware Testing Pending

---

## LEGEND

- ✅ COMPLETED - Fix applied, tested, committed
- 🟡 IN PROGRESS - Work started, not finalized
- ⚠️ PENDING - Not started, blocking production
- 🔴 CRITICAL - Must fix before launch

---

## ✅ COMPLETED (Code Fixes & Build)

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
| 9 | **HCE Manifest — false alarm retracted** | `AndroidManifest.xml` (consumer-wallet) | No code change — verified already correct | `4d77878` | ✅ CONFIRMED NOT A BUG |

**Total: 22 commits ahead of upstream** (confirmed via `git status`, 8 August 2026 — always re-verify with `git log --oneline | wc -l` before writing this number in future updates, it changes every commit).

---

## 🟡 IN PROGRESS (Applied, Not Yet Verified/Committed)

| # | Item | Status | Blocker | Action Required |
|---|------|--------|---------|-------------------|
| 10 | **Missing `colors.xml` in `:app`** | 🟡 Fix written to disk | Needs fresh `./gradlew :app:assembleDebug` to confirm `BUILD SUCCESSFUL` | Run the build, paste result, then commit |
| 11 | **Launcher icons untracked in git** | 🟡 Files exist locally, work in current build | `git status` shows them as untracked — a fresh clone would NOT have them | `git add` all mipmap dirs + `ic_launcher-playstore.png`, commit alongside #10 |
| 12 | **`backend/package-lock.json` modified, uncommitted** | 🟡 Unreviewed diff | Unknown whether this is safe dependency noise or an accidental version bump (e.g. into deferred Sentry 10.x territory) | Run `git diff package-lock.json`, review before committing — do NOT bundle with #10/#11 |

**Do not mark #10 or #11 as ✅ until:**
1. `./gradlew :app:assembleDebug` shows `BUILD SUCCESSFUL` in raw terminal output (not assumed)
2. Both are `git add`ed and committed
3. `git status` shows clean working tree for these paths

---

## 🔴 CRITICAL — RESOLVED FINDINGS LOG (For Audit Trail)

### Finding: Missing Launcher Icons (`:app` module) — 29 July 2026
**Confirmed via:** Real `BUILD FAILED` AAPT error (`resource mipmap/ic_launcher not found`).
**Current state:** Files exist on disk (source unclear — possibly Android Studio auto-fix), but untracked in git as of 8 Aug. See item #11 above.

### Finding: Missing `colors.xml` (`:app` module) — 8 August 2026
**Confirmed via:** Real `BUILD FAILED` AAPT resource-linking error:
error: resource color/white (aka com.orchestratepay:color/white) not found.

text

**Investigation method:** Ran `grep -rho '@color/[a-zA-Z0-9_]*' app/src/main/res/layout/ | sort -u` across ALL layouts before fixing — confirmed only `@color/white` is referenced anywhere in `:app`, so the fix is complete in one pass, not iterative.
**Fix:** Created `app/src/main/res/values/colors.xml` with `white = #FFFFFFFF`.
**Status:** See item #10 above — awaiting build confirmation.

### False Alarm: HCE Service Not Registered — Retracted 8 August 2026
**Original claim (29 July):** Based on `grep -c "HOST_APDU_SERVICE"` returning `0`.
**Correction:** Manual VS Code verification confirmed manifest is correctly wired. Terminal tools were silently failing to read the file for undetermined reasons (confirmed not an encoding issue).
**Committed retraction:** `4d77878`
**Lesson applied to Finding #2 above:** Before writing any fix based on a suspected "missing resource," verify with a full, deliberate scan — not a single narrow grep — and only trust real compiler errors as ground truth.

---

## ✅ COMPLETED (Infrastructure & Verification)

| Component | Status | URL | Verification |
|-----------|--------|-----|---------------|
| PostgreSQL 18 | ✅ | localhost:5432 | 4 migrations applied |
| Redis 5.0.14.1 | ✅ | localhost:6379 | PONG verified |
| Backend API | ✅ | :3000 | Health check OK, login working |
| Web Frontend | ✅ | :3001 | Merchant/Consumer portals accessible |
| K8s Manifests | ✅ | infra/k8s/ | `DARAJA_CALLBACK_BASE_URL` & secrets verified |
| Test Accounts | ✅ | - | Merchant & Consumer created |
| Android Kotlin Compile (all 4 modules) | ✅ | `app`, `consumer-wallet`, `nfc-core`, `softpos` | All compile clean |
| Android APK Packaging (`consumer-wallet`) | ✅ | — | `assembleDebug` succeeds |
| Android APK Packaging (`app`) | 🟡 | — | Blocked on colors.xml verification (item #10) |
| HCE Manifest Wiring (`consumer-wallet`) | ✅ | `AndroidManifest.xml`, `apduservice.xml` | Verified correct, false alarm retracted |
| JAVA_HOME environment | ✅ | Local dev machine | Persisted via `.bashrc` |

---

## ⚠️ PENDING (NFC Hardware Required)

| # | Item | Status | Blocker | Success Criteria |
|---|------|--------|---------|-------------------|
| 13 | **Phone-to-Phone NFC** | ⏸️ BLOCKED | Awaiting 2nd phone | APDU exchange: SELECT→GET DATA→CONFIRM |
| 14 | **NFC Tag Read** | ⏸️ BLOCKED | Awaiting NTAG215 | Tag signature verified, STK Push sent |
| 15 | **P2P Transfer** | ⏸️ BLOCKED | Awaiting 2nd phone | Token exchange, backend settlement |
| 16 | **APDU Log Capture** | ⏸️ BLOCKED | Awaiting test | Logcat shows 0x80/0x81 instructions |

---

## ⚠️ PENDING (Security Hardening - No Hardware Needed)

| # | Item | Severity | Effort | Action | Risk if Delayed |
|---|------|----------|--------|--------|-------------------|
| 17 | **JWT Secret** | 🔴 CRITICAL (at deploy) | 5 min | `openssl rand -hex 64` → `.env` at deploy time | Token forgery possible |
| 18 | **Database SSL** | 🔴 CRITICAL | 10 min | Add `sslmode=require` | MITM attacks |
| 19 | **Rate Limiting** | 🟡 MEDIUM | 30 min | Add to `/merchant-hce-token` | DoS via token generation |
| 20 | **P2P Timeout** | 🟢 LOW | 15 min | Add 5min TTL to `P2PHceSession` | Mode confusion |
| 21 | **NPM Audit — Sentry upgrade** | 🟡 MEDIUM | 2-4 hrs | Upgrade `@sentry/node` 8.x→10.68.0 (breaking) | Vulnerable `@opentelemetry/core` chain |
| 22 | **Review pending `package-lock.json` diff** | 🟡 MEDIUM | 15 min | `git diff` before commit | Could silently pull in #21 prematurely, untested |
| 23 | **APDU sniffing threat model review** | 🟡 MEDIUM | 1 hr | Confirm 90s TTL is acceptable; verify single-use enforced server-side, not just client-side | Replay attack within tap window |

**Recommendation:** Complete #17–20 before hardware testing. Resolve #22 immediately (it's blocking a clean commit right now). Defer #21 until after NFC testing.

---

## ✅ COMPLETED (Infrastructure Verification)

| # | Item | Severity | Status | Verification |
|---|------|----------|--------|---------------|
| 24 | **K8s Manifests** | 🔴 CRITICAL | ✅ VERIFIED | `infra/k8s/` exists with correct structure |
| 25 | **DARAJA_CALLBACK_BASE_URL** | 🔴 CRITICAL | ✅ VERIFIED | Present in `backend/deployment.yaml` |
| 26 | **ADMIN_SECRET** | 🔴 CRITICAL | ✅ VERIFIED | Present in both deployment and secrets template |
| 27 | **NFC_SIGNING_SECRET** | 🔴 CRITICAL | ✅ VERIFIED | Present in both deployment and secrets template |

---

## ⚠️ PENDING (Compliance)

| # | Item | Severity | Blocker | Timeline |
|---|------|----------|---------|----------|
| 28 | **CBK PSP License** | 🔴 CRITICAL | Application | 3-6 months (START NOW) |
| 29 | **KRA eTIMS** | 🟡 MEDIUM | Prod cert | 2-4 weeks (code ready) |
| 30 | **Data Protection (Kenya DPA 2019)** | 🟡 MEDIUM | Lawyer | Privacy policy needed — handling phone numbers + transaction data |

---

## 🗺️ FULL PRODUCTION READINESS ROADMAP

### Phase 0: Close Out Current Bugs (TODAY — before Phase 1)
- [ ] Verify colors.xml fix (`assembleDebug` → `BUILD SUCCESSFUL`)
- [ ] Review & commit/discard `package-lock.json` diff
- [ ] `git add` + commit icon files
- [ ] Re-run full 4-module `assembleDebug` to confirm nothing else is hiding

### Phase 1: Hardware Validation
**Blocker level:** 🔴 Critical — nothing else matters if taps don't work
- Execute `ANDROID_NFC_TESTING_PROTOCOL.md` fully (all 6 test cases)
- Confirm APDU fix works on real hardware, not just compiles
- Test on 2+ phone models (NFC chipsets vary — Samsung, Pixel, etc.)

### Phase 2: Security Hardening
**Blocker level:** 🔴 Critical for handling real money
- Generate real `JWT_SECRET` at deploy time
- Resolve `@sentry/node` vulnerability (isolated, post-NFC-testing)
- Confirm APDU 90s TTL is acceptable for actual threat model — verify single-use enforced **server-side**, not just client-side
- Rate limiting on STK Push endpoint
- Finish reviewing `package-lock.json` diff (currently open item #22)

### Phase 3: Compliance & Legal
**Blocker level:** 🔴 Critical — illegal to operate without this in Kenya
- CBK license application — 3-6 month lead time, start NOW in parallel
- Kenya DPA 2019 compliance review
- M-Pesa Daraja production credentials (vs current sandbox/mock)

### Phase 4: Infrastructure Readiness
**Blocker level:** 🟡 High
- Specify exactly what's broken in K8s manifests (currently vague "needs fixes")
- Test database backup/restore (not just assume it works)
- Configure Redis persistence (session/token loss on restart = failed mid-flight payments)
- Move secrets out of `.env` files for production

### Phase 5: Resilience & Failure Modes
**Blocker level:** 🟡 High
- M-Pesa STK Push timeout handling + reconciliation process
- Backend crash between "HCE token issued" and "payment confirmed" — orphaned transaction handling
- Confirm backend-level idempotency (not just client-side, per Test 4c in NFC protocol)

### Phase 6: Observability
**Blocker level:** 🟡 High
- Structured logging per transaction stage (tap → token → STK → confirm)
- Alerting on failed payment rate spikes
- Merchant transaction success rate dashboard

### Phase 7: Scale Testing
**Blocker level:** 🟢 Medium
- Load test backend under concurrent NFC taps
- Database connection pool sizing under load

### Phase 8: iOS Strategy Execution
**Blocker level:** 🟢 Medium
- Implement QR fallback flow per `IOS_LIMITATIONS_AND_FALLBACK.md`

---

## 📊 RISK ASSESSMENT

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| colors.xml fix doesn't actually resolve build | Low | Medium | Verify with real build output before proceeding |
| Icon files lost on fresh clone (uncommitted) | Certain until committed | High | Commit immediately after build verification |
| package-lock.json hides an unintended dependency change | Medium | Medium | Full diff review before commit — don't skip this again |
| NFC test fails | Medium | High | APDU fix verified in code, hardware test still needed |
| CBK license delay | High | Critical | Start application immediately |
| Sentry upgrade breaks logging | Medium | Medium | Defer until after NFC testing |
| iOS users excluded | Certain | Medium | QR fallback documented, not yet built |

---

## 🎯 IMMEDIATE NEXT ACTIONS

**Right Now (No Hardware):**
1. 🔴 Run `./gradlew :app:assembleDebug` — confirm `BUILD SUCCESSFUL`
2. 🔴 Review `git diff backend/package-lock.json` before touching it further
3. 🟡 `git add` icon files + `colors.xml`, commit together once build confirmed
4. ⚠️ Start CBK license application (3-6 month process)

**Requires 2nd NFC Phone:**
5. ⏸️ Build and install APKs (both modules)
6. ⏸️ Execute NFC Phone-to-Phone test
7. ⏸️ Verify APDU exchange in logcat

---

## DECISION LOG

| Date | Decision | Impact |
|------|----------|--------|
| 2026-07-23 | APDU mismatch identified & fixed | Core functionality restored |
| 2026-07-27 | SDK 35 update | Build compatibility fixed |
| 2026-07-28 | Root-caused 150+ compile errors to 4 bugs (`fd21ba5`) | Avoided blind mass-editing |
| 2026-07-28 | Generated & committed Gradle wrapper | Unblocked terminal/CI builds |
| 2026-07-29 | Full `assembleDebug` run caught real icon bug | More rigorous than Kotlin-only compile |
| 2026-07-29 | Suspected HCE manifest bug from empty grep output | Later disproven |
| 2026-08-08 | Retracted HCE false alarm in commit `4d77878` | Permanent correction |
| 2026-08-08 | Discovered icon fix files were untracked in git | New standing check: verify `git status` after any "it just works now" moment |
| 2026-08-08 | Found and fixed missing `colors.xml` via full grep-first investigation | Avoided iterative one-color-at-a-time rebuild cycles |
| 2026-08-08 | Flagged `package-lock.json` as needing diff review before commit | Prevents silently reintroducing deferred Sentry upgrade |

---

## END OF CHECKLIST
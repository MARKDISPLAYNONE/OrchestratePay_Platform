# PRODUCTION READINESS CHECKLIST

**Project:** OrchestratePay Platform
**Last Updated:** 12 August 2026
**Status:** 🟢 PHASE 0 FULLY CLOSED — All 4 Android modules build green, all fixes committed, working tree clean — 🟢 2ND NFC PHONE NOW AVAILABLE — Phase 1 Hardware Validation UNBLOCKED, starting now

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
| 10 | **Missing `colors.xml` in `:app`** | `app/src/main/res/values/colors.xml` | Created, `white` color added, verified `BUILD SUCCESSFUL` | `e9866d0` | ✅ FIXED |
| 11 | **Launcher icons untracked in git (`:app`)** | mipmap dirs | Committed | `e9866d0` | ✅ FIXED |
| 12 | **`backend/package-lock.json` review** | `package-lock.json` | Full diff reviewed — patch/minor transitive bumps only, no Sentry/OTel creep confirmed absent | `b5317a5` | ✅ FIXED |
| 31 | **nfc-core missing `consumer-rules.pro`** | `nfc-core/build.gradle.kts`, `consumer-rules.pro` | Created placeholder file | `6e33592` | ✅ FIXED |
| 32 | **softpos missing launcher icons** | `softpos/src/main/res/mipmap-*/`, `drawable/*` | Reused `:app` icon set | `35ec698` | ✅ FIXED |
| 33 | **softpos `AnimatorSet.repeatCount` misuse** | `TapGuideActivity.kt` | Moved `repeatCount` to child `ObjectAnimator`s | `35ec698` | ✅ FIXED |

**Total: 50 commits, 28 ahead of upstream** (confirmed via `git log --oneline | wc -l`, 12 August 2026 — always re-verify before writing this number in future updates, it changes every commit).

**Full 4-module `assembleDebug` verified TWICE:** pre-commit (153 tasks, 149 executed, `BUILD SUCCESSFUL` in 47s) and post-commit (153 tasks, 149 executed, 4 up-to-date, `BUILD SUCCESSFUL` in 49s). Zero regressions from the commit process.

---

## ✅ RESOLVED FINDINGS LOG (For Audit Trail)

### Finding: Missing Launcher Icons (`:app` module) — 29 July 2026 — ✅ RESOLVED
Confirmed via real `BUILD FAILED` AAPT error. Fixed and committed `e9866d0`.

### Finding: Missing `colors.xml` (`:app` module) — 8 August 2026 — ✅ RESOLVED
Confirmed via real `BUILD FAILED` AAPT resource-linking error: `resource color/white not found`. Investigation method: full `grep -rho '@color/[a-zA-Z0-9_]*' app/src/main/res/layout/ | sort -u` scan before fixing — confirmed one-pass fix, not iterative. Committed `e9866d0`.

### False Alarm: HCE Service Not Registered — Retracted 8 August 2026
Original claim based on narrow `grep -c` returning `0`. Manual verification confirmed manifest correctly wired. Committed retraction `4d77878`. **Lesson applied throughout:** trust only real compiler errors, never a single narrow grep, as ground truth for "missing" resources.

### Finding: nfc-core missing `consumer-rules.pro` — 12 August 2026 — ✅ RESOLVED
Surfaced by first-ever full 4-module `assembleDebug` run. Scope-checked (`grep -rn "consumerProguardFiles"`) to confirm isolated to `nfc-core`. Fixed and committed `6e33592`.

### Finding: softpos missing launcher icons + AnimatorSet.repeatCount misuse — 12 August 2026 — ✅ RESOLVED
Also surfaced by the same full build run — `:softpos` had never been included in a build wide enough to reach it before. Both sub-bugs fixed and committed together in `35ec698`. Full details in `SESSION_HANDOVER.md`.

**Standing lesson (reaffirmed twice more this session):** A full `assembleDebug` across the entire module graph is the only reliable way to surface these classes of packaging/API-misuse bugs. Confirmed again when Bug #6 and Bug #7 were found in modules that had individually "compiled" via Kotlin-only checks but had never been packaged end-to-end.

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
| Android APK Packaging — ALL 4 MODULES | ✅ | — | `./gradlew clean assembleDebug` verified TWICE, both `BUILD SUCCESSFUL` |
| HCE Manifest Wiring (`consumer-wallet`) | ✅ | `AndroidManifest.xml`, `apduservice.xml` | Verified correct, false alarm retracted |
| JAVA_HOME environment | ✅ | Local dev machine | Persisted via `.bashrc` |
| Git working tree | ✅ | — | Confirmed clean via `git status`, all fixes committed |
| **2nd NFC-enabled phone** | ✅ | — | **Now available as of this session — Phase 1 unblocked** |

---

## 🟢 IN PROGRESS — HARDWARE VALIDATION (Phase 1 — NOW ACTIVE)

| # | Item | Status | Blocker | Success Criteria |
|---|------|--------|---------|-------------------|
| 13 | **Phone-to-Phone NFC (HCE)** | 🟢 READY TO TEST | None — code verified, hardware available | APDU exchange: SELECT→GET DATA→CONFIRM |
| 14 | **NFC Tag Read** | 🟢 READY TO TEST | Needs NTAG215/216 sticker (confirm availability) | Tag signature verified, STK Push sent |
| 15 | **P2P Transfer** | 🟢 READY TO TEST | None — same 2 phones | Token exchange, backend settlement |
| 16 | **APDU Log Capture** | 🟢 READY TO CAPTURE | None | Logcat shows 0x80/0x81 instructions |

**Recommendation:** Junior dev can execute Test 1 (Phone-to-Phone HCE — the CRITICAL test) independently by following `ANDROID_NFC_TESTING_PROTOCOL.md` step by step — it is fully self-contained with expected outputs, logcat commands, and troubleshooting for every known failure mode. Escalate back only if:
- APDU exchange fails in a way not covered in the Troubleshooting section
- Any resource-linking / build error appears (that would be a NEW packaging bug, not an NFC bug — do not debug via hardware, flag immediately)
- Success criteria for idempotency (Test 4c, server-side enforcement) cannot be confirmed just by observation — that specific check requires backend code review, see item #23 below

---

## ⚠️ PENDING (Security Hardening - No Hardware Needed) — LOWER PRIORITY THAN LIVE NFC TEST RIGHT NOW

| # | Item | Severity | Effort | Action | Risk if Delayed |
|---|------|----------|--------|--------|-------------------|
| 17 | **JWT Secret** | 🔴 CRITICAL (at deploy) | 5 min | `openssl rand -hex 64` → `.env` at deploy time | Token forgery possible |
| 18 | **Database SSL** | 🔴 CRITICAL | 10 min | Add `sslmode=require` | MITM attacks |
| 19 | **Rate Limiting** | 🟡 MEDIUM | 30 min | Add to `/merchant-hce-token` | DoS via token generation |
| 20 | **P2P Timeout** | 🟢 LOW | 15 min | Add 5min TTL to `P2PHceSession` | Mode confusion |
| 21 | **NPM Audit — Sentry upgrade (backend `@sentry/node`)** | 🟡 MEDIUM | 2-4 hrs | Upgrade `@sentry/node` 8.x→10.68.0 (breaking) | Vulnerable `@opentelemetry/core` chain. **Note: separate from Android-native Sentry SDK already bundled in `:app` — independent upgrade tracks, do not conflate.** |
| 23 | **APDU sniffing threat model review** | 🟡 MEDIUM | 1 hr | Confirm 90s TTL acceptable; verify single-use enforced server-side, not just client-side | Replay attack within tap window — **directly relevant to Test 4c in the NFC protocol, should be reviewed alongside hardware testing, not after** |

**Item #22 (package-lock.json review) — ✅ RESOLVED, moved to Completed table above (item #12).**

**Note on sequencing:** Since NFC hardware is now available, items #17–20 and #21 are correctly deprioritized behind the live hardware test — they don't block Phase 1. **Item #23 is the exception** — it's directly tied to correctly interpreting Test 4c's result, so it should be reviewed in parallel with, not after, hardware testing.

---

## ✅ COMPLETED (Infrastructure Verification)

| # | Item | Severity | Status | Verification |
|---|------|----------|--------|---------------|
| 24 | **K8s Manifests** | 🔴 CRITICAL | ✅ VERIFIED | `infra/k8s/` exists with correct structure |
| 25 | **DARAJA_CALLBACK_BASE_URL** | 🔴 CRITICAL | ✅ VERIFIED | Present in `backend/deployment.yaml` |
| 26 | **ADMIN_SECRET** | 🔴 CRITICAL | ✅ VERIFIED | Present in both deployment and secrets template |
| 27 | **NFC_SIGNING_SECRET** | 🔴 CRITICAL | ✅ VERIFIED | Present in both deployment and secrets template |

---

## ⚠️ PENDING (Compliance) — LOWER PRIORITY THAN LIVE NFC TEST, BUT CALENDAR-DRIVEN

| # | Item | Severity | Blocker | Timeline |
|---|------|----------|---------|----------|
| 28 | **CBK PSP License** | 🔴 CRITICAL | Application | 3-6 months — **START IN PARALLEL, does not compete with hardware testing time** |
| 29 | **KRA eTIMS** | 🟡 MEDIUM | Prod cert | 2-4 weeks (code ready) |
| 30 | **Data Protection (Kenya DPA 2019)** | 🟡 MEDIUM | Lawyer | Privacy policy needed |

---

## ⚠️ PENDING (Architecture Clarity)

| # | Item | Severity | Blocker | Action |
|---|------|----------|---------|--------|
| 34 | **Web stack contradiction unresolved** | 🟡 MEDIUM | Product owner input | `CLAUDE.md` states Next.js; earlier note claimed Vite 6 + React 19. Does not block NFC testing — resolve when time allows. |

---

## 🗺️ FULL PRODUCTION READINESS ROADMAP

### Phase 0: Close Out Current Bugs — ✅ FULLY CLOSED (12 August 2026)
- [x] Verify colors.xml fix
- [x] Review & commit `package-lock.json` diff (`b5317a5`)
- [x] Commit icon files
- [x] Re-run full 4-module `assembleDebug` twice, confirmed clean both times
- [x] Commit softpos fix (`35ec698`)
- [x] Sync all docs

### Phase 1: Hardware Validation — 🟢 ACTIVE NOW (2nd phone available)
**Blocker level:** 🔴 Critical — nothing else matters if taps don't work
- [ ] Execute `ANDROID_NFC_TESTING_PROTOCOL.md` Phase 0 pre-flight check (Java, build, APK existence)
- [ ] Build & install both APKs on the 2 phones
- [ ] **TEST 1 — Phone-to-Phone HCE Payment (CRITICAL)** — this is the single most important test in the whole project right now
- [ ] Test 2 — NFC Tag Read (if NTAG215 sticker available)
- [ ] Test 3 — P2P Transfer
- [ ] Test 4 — Error handling (expired token, invalid signature, double-tap idempotency)
- [ ] Capture logcat + screenshots per protocol's Capture Requirements section
- [ ] Update `ANDROID_NFC_TESTING_PROTOCOL.md` with PASS/FAIL results

### Phase 2: Security Hardening
**Blocker level:** 🔴 Critical for handling real money — but does not block Phase 1
- Generate real `JWT_SECRET` at deploy time
- Resolve `@sentry/node` (backend) vulnerability — post-NFC-testing
- Confirm APDU 90s TTL + server-side single-use enforcement (item #23) — **do this alongside Test 4c, not after**
- Rate limiting on STK Push endpoint

### Phase 3: Compliance & Legal
**Blocker level:** 🔴 Critical — illegal to operate without this — **start in parallel, today**
- CBK license application — 3-6 month lead time
- Kenya DPA 2019 compliance review
- M-Pesa Daraja production credentials

### Phase 4: Infrastructure Readiness
- K8s P0 fixes (`DARAJA_CALLBACK_URL` rename, missing secrets)
- Database backup/restore test
- Redis persistence config
- Move secrets out of `.env` for production

### Phase 5: Resilience & Failure Modes
- M-Pesa STK Push timeout handling
- Orphaned transaction handling
- Backend-level idempotency confirmation (ties directly to item #23 / Test 4c)

### Phase 6: Observability
- Structured logging per transaction stage
- Alerting on failed payment rate spikes
- Merchant success rate dashboard

### Phase 7: Scale Testing
- Load test under concurrent NFC taps
- DB connection pool sizing

### Phase 8: iOS Strategy Execution
- QR fallback per `IOS_LIMITATIONS_AND_FALLBACK.md`

---

## 📊 RISK ASSESSMENT

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Live NFC test fails on real hardware** | Medium | High | This is now the #1 active risk — code verified in isolation but never tap-tested. Everything else is secondary until this is resolved. |
| CBK license delay | High | Critical | Start application immediately, in parallel with hardware testing |
| Server-side idempotency gap (item #23 unverified) | Unknown | High (double-charge risk) | Review in parallel with Test 4c, don't treat as separate later task |
| Sentry (backend) upgrade breaks logging | Medium | Medium | Deferred until after NFC testing |
| iOS users excluded | Certain | Medium | QR fallback documented, not yet built |
| Web stack decisions made against wrong assumed framework | Medium | Medium | Confirm with product owner, no urgency |

---

## 🎯 IMMEDIATE NEXT ACTIONS

**RIGHT NOW — Hardware Available, This Is The Critical Path:**
1. 🔴 Run Phase 0 pre-flight check from `ANDROID_NFC_TESTING_PROTOCOL.md` (Java version, `assembleDebug` for both `:app` + `:consumer-wallet`, confirm real `.apk` files exist)
2. 🔴 Install `consumer-wallet` APK on Phone A, `app` APK on Phone B
3. 🔴 Execute **TEST 1 — Phone-to-Phone HCE Payment** — capture logcat with the exact filter from the protocol
4. 🟡 While hardware test runs / between attempts: review `hce-token.ts` + transaction creation path for server-side single-use enforcement (item #23) — this directly informs whether Test 4c passing "for real" or just client-side

**Delegable to junior dev (not critical-path blocking, can run in parallel):**
5. ⚠️ Start CBK license application paperwork
6. 🟡 Security hardening #17–20 (all mechanical, well-documented, low-ambiguity)
7. 🟡 K8s P0 fixes

**After Phase 1 passes:**
8. Update `ANDROID_NFC_TESTING_PROTOCOL.md` with PASS status + date
9. Confirm commit count fresh (`git log --oneline | wc -l`)
10. Prepare PR to upstream per protocol's Post-Test Actions section

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
| 2026-08-08 | Flagged `package-lock.json` as needing diff review before commit | Prevented silently reintroducing deferred Sentry upgrade |
| 2026-08-12 | First-ever full 4-module `assembleDebug` surfaced Bug #6 (nfc-core) and Bug #7 (softpos) | Neither a regression — both pre-existing, previously invisible |
| 2026-08-12 | Committed all Phase 0 fixes atomically and separately | Clean, auditable commit history maintained |
| 2026-08-12 | Re-ran full build post-commit to confirm zero regressions | Phase 0 formally closed with double-verified evidence |
| 2026-08-12 | **2nd NFC phone became available — Phase 1 activated, deprioritized non-blocking security/compliance items behind live hardware test** | **Critical path shifted from "code readiness" to "does it actually tap-to-pay" — the core product hypothesis** |

---

## END OF CHECKLIST
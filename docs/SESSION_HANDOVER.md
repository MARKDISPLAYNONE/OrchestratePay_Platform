# SESSION HANDOVER & ONBOARDING GUIDE

**Last Updated:** 29 July 2026
**Project:** OrchestratePay Platform
**Status:** Kotlin Compiles Clean — 2 NEW Packaging Bugs Found via Full Build Test (Pre-Hardware Validation)
**Prepared by:** Senior Lead Dev (10x)
**Recipient:** Incoming Senior Lead Dev / Project Continuation Lead

---

## 🎯 QUICK ORIENTATION (Read This First)

**What is this project?**
- NFC Tap-to-Pay platform for Kenyan market
- Integrates with M-Pesa (Daraja API)
- Consumer taps phone/sticker → M-Pesa STK Push → PIN entry → Payment confirmed

**Current Status in 4 Bullets:**
1. ✅ **Backend operational** (login, dashboard, APIs verified working)
2. ✅ **Kotlin compiles clean** across all 4 modules (`app`, `consumer-wallet`, `nfc-core`, `softpos`)
3. 🔴 **2 NEW packaging bugs found** — missing launcher icons, missing HCE service manifest registration (see below)
4. ⏳ **NFC hardware testing PENDING** (no phone yet; emulator being set up for UI-level validation in the meantime)

**Your Immediate Task:**
- Fix the 2 packaging bugs below (both block real APK installation/function)
- Re-run full `assembleDebug` to confirm APKs actually package
- Once phone available: execute `ANDROID_NFC_TESTING_PROTOCOL.md`

---

## 🚨 NEW CRITICAL FINDINGS — 29 July 2026

Found by running `./gradlew :app:assembleDebug :consumer-wallet:assembleDebug` (full APK packaging, not just Kotlin compile). **This is a more thorough test than `compileDebugKotlin` — it catches resource/manifest bugs that pure Kotlin compilation misses.**

### Bug #1: Missing Launcher Icons (`:app` module)

**Error:**
AAPT: error: resource mipmap/ic_launcher not found.
AAPT: error: resource mipmap/ic_launcher_round not found.

text


**Root cause:** `app/src/main/AndroidManifest.xml` references `@mipmap/ic_launcher` and `@mipmap/ic_launcher_round`, but `app/src/main/res/` has **no mipmap folders at all**. The app cannot be packaged into an installable APK in this state.

**Status:** ⬜ NOT YET FIXED — blocks Merchant Terminal APK entirely.

**Fix path:** Use Android Studio → right-click `app/src/main/res` → New → Image Asset → generate Launcher Icons (placeholder branding acceptable for now, replace before public launch).

### Bug #2: HCE Service Not Registered in Manifest (`consumer-wallet` module)

**Discovery:** `ConsumerHceService.kt` (the HCE card-emulation logic) and `apduservice.xml` (the AID configuration) both exist in the codebase — but `consumer-wallet/src/main/AndroidManifest.xml` has **no `<service>` declaration** and **no `HOST_APDU_SERVICE` intent-filter** wiring them together.

**Impact:** This is **more severe than a build error** — the app would install and run fine, but NFC taps would silently never invoke the HCE flow on a real device. No error message, no crash — the core "tap to pay" feature simply wouldn't work, and this would only be discovered during actual phone testing (potentially wasting significant hardware test time debugging "why isn't the phone responding to taps").

**Status:** ⬜ NOT YET FIXED — critical for core product function, must fix BEFORE phone testing begins.

**Fix path:** Add to `consumer-wallet/src/main/AndroidManifest.xml`:
```xml
<service
    android:name=".hce.ConsumerHceService"
    android:exported="true"
    android:permission="android.permission.BIND_NFC_SERVICE">
    <intent-filter>
        <action android:name="android.nfc.cardemulation.action.HOST_APDU_SERVICE"/>
    </intent-filter>
    <meta-data
        android:name="android.nfc.cardemulation.host_apdu_service"
        android:resource="@xml/apduservice"/>
</service>
(Exact placement/attributes to be verified against existing manifest structure before applying.)

Key Lesson: compileDebugKotlin only checks that Kotlin code type-checks — it does NOT verify manifest wiring, resource references, or that services are properly registered. Always run a full assembleDebug before considering a module "done," especially for NFC/HCE apps where manifest configuration IS the feature.

📚 REQUIRED READING ORDER
Before You Start Coding:

THIS DOCUMENT (SESSION_HANDOVER.md) - You are here
PRODUCTION_READINESS_CHECKLIST.md - What's done vs pending
Before You Test NFC:
3. ANDROID_NFC_TESTING_PROTOCOL.md - Step-by-step test procedures (do NOT proceed to hardware testing until Bug #2 above is fixed)
4. Tap2Pay/README.md - Detailed architecture (has APDU documentation bug at line ~190)

For Context:
5. IOS_LIMITATIONS_AND_FALLBACK.md - iPhone QR strategy (Apple blocks HCE)
6. CLAUDE.md - AI assistant instructions (if using Claude Code)

🏗️ PROJECT ARCHITECTURE
text

OrchestratePay_Platform/
├── Tap2Pay/
│   ├── backend/                      # Node.js + Express API (:3000)
│   ├── web/                          # React frontend (:3001)
│   └── android/                      # Kotlin Android apps
│       ├── app/                      # Merchant Terminal (READER)
│       │   └── [MISSING mipmap icons — Bug #1]
│       ├── consumer-wallet/          # Consumer Wallet (HCE CARD)
│       │   ├── gradlew, gradlew.bat  # Gradle wrapper (committed)
│       │   └── [HCE service not wired in manifest — Bug #2]
│       ├── nfc-core/                 # Shared NFC library
│       └── softpos/                  # SoftPOS module
├── docs/                             # DOCUMENTATION (start here)
└── infra/k8s/                        # Kubernetes manifests (needs fixes)
Key Data Flow:

text

Consumer Phone (HCE) → NFC Tap → Merchant Terminal (Reader) →
Backend API → M-Pesa STK Push → Consumer Phone (PIN)
✅ WHAT WE'VE ACCOMPLISHED
🆕 Build Stabilization — 28 July 2026
Problem: :consumer-wallet:compileDebugKotlin failed with 150+ cascading errors.

4 Root Causes Found & Fixed:

#	File	Root Cause	Fix
1	ConsumerTagWriterActivity.kt	Wrong import: android.nfc.NdefFormatable	Corrected to android.nfc.tech.NdefFormatable
2	build.gradle.kts	Missing androidx.biometric dependency	Added implementation("androidx.biometric:biometric:1.1.0")
3	8 ViewModels	Missing ConsumerApiClientInstance import	Added missing import to each file
4	ConsumerNotificationService.kt	Missing R import (sub-package issue)	Added explicit R import
Infrastructure Fix: Generated and committed Gradle wrapper (gradlew, gradlew.bat, gradle-wrapper.jar) — was missing from repo, blocking all terminal/CI builds. Any dev can now run ./gradlew from a fresh clone.

Verification: ./gradlew :consumer-wallet:compileDebugKotlin → BUILD SUCCESSFUL

🆕 Full Packaging Test — 29 July 2026
Ran ./gradlew :app:assembleDebug :consumer-wallet:assembleDebug :nfc-core:assembleDebug :softpos:assembleDebug — this is a more rigorous test than Kotlin compilation alone (validates manifests, resources, packaging).

Result: Found the 2 critical bugs documented above. This is a GOOD outcome — these bugs would have otherwise been discovered mid-phone-testing, wasting hardware test time on confusing silent failures.

Critical Bug Fixes (Prior Sessions — COMPLETE)
Fix	File	Change	Status
APDU Protocol	NfcReaderManager.kt	0xC0→0x80, 0xC1→0x81	✅ FIXED
Thread Safety	ConsumerHceService.kt	AtomicReference	✅ FIXED
TTL Consistency	ConsumerHceService.kt	60s→90s	✅ FIXED
SDK Version	build.gradle.kts	34→35	✅ FIXED
Infrastructure (VERIFIED WORKING)
Component	Status	Notes
PostgreSQL 18	✅	4 migrations applied
Redis	✅	PONG verified
Backend API	✅	Health check OK on :3000
Web Frontend	✅	Login working on :3001
Android Kotlin Compile	✅	All 4 modules clean
Android APK Packaging	🔴	Blocked by Bug #1 (icons)
HCE Core Function	🔴	Blocked by Bug #2 (manifest wiring)
Security Audit — 29 July 2026
NPM Audit (backend): 52 vulnerabilities found (19 moderate, 33 high).

Assessment: Nearly all are devDependencies (eslint, jest, ts-jest, ts-node-dev tooling) — not shipped to production, low real-world risk.
One exception requiring attention: @sentry/node (production dependency) depends on vulnerable @opentelemetry/core. Fix requires breaking upgrade to @sentry/node@10.68.0. Deferred — tracked in PRODUCTION_READINESS_CHECKLIST.md, to be tested in isolation before applying (not mixed with other changes).
JWT Secret: Confirmed .env is git-ignored (git check-ignore verified) — no secret exposure in repo history. Current value is a dev placeholder (test-jwt-secret-for-development-only) — must be rotated to a real generated secret before production deploy (generation command ready, not yet applied).

Test Accounts (READY FOR TESTING)
Merchant: merchant@test.com / TestPass123 / Any device ID
Consumer: consumer2@test.com / TestPass123 (email login)
Backend: Running with DARAJA_ENV=mock
🔧 CURRENT BLOCKERS & NEXT STEPS
Immediate (No Hardware Needed)
Fix Bug #1 — Generate launcher icons for :app module
Fix Bug #2 — Wire ConsumerHceService into consumer-wallet manifest
Re-run ./gradlew :app:assembleDebug :consumer-wallet:assembleDebug — confirm both produce real .apk files
Set up Android emulator for UI-level smoke testing (login, navigation, no crashes) — validates app before hardware NFC testing, currently blocked on local disk space (clearing now)
Pending (Awaiting 2nd NFC Phone)
Execute ANDROID_NFC_TESTING_PROTOCOL.md — full hardware tap testing
Deferred (Tracked, Not Urgent)
@sentry/node dependency upgrade (breaking change, needs isolated testing)
JWT_SECRET rotation (do at actual deploy time, not before)
CBK license application — should be started in parallel now, 3-6 month lead time, doesn't block dev work
🚨 CRITICAL FINDINGS FOR NEW DEV
Issue	Impact	Status
APDU Plaintext	NFC payload sniffable	✅ Accepted (90s TTL mitigation)
iOS No HCE	iPhones can't use NFC tap	✅ QR fallback documented
NPM Vulnerabilities (mostly dev-only)	Low prod risk	✅ Triaged, documented
@sentry/node vulnerable dependency	Moderate	⚠️ Deferred, tracked
CBK License Required	Legal for production	⚠️ 3-6 month application, START NOW
Missing launcher icons	App won't package	🔴 NEW — fix immediately
HCE service not in manifest	Core feature silently broken	🔴 NEW — fix immediately, before phone testing
Gradle Wrapper	Was missing, blocked CLI builds	✅ FIXED — now committed
🔗 ESSENTIAL URLS & PATHS
Resource	Location
Your Fork	https://github.com/MARKDISPLAYNONE/OrchestratePay_Platform
Upstream	https://github.com/gabrielngige/OrchestratePay_Platform
Local Path	~/Desktop/projects/colab project/OrchestratePay_Platform/
Backend API	http://localhost:3000
Web Frontend	http://localhost:3001
Android Project	Tap2Pay/android/
Commit Count	Run `git log --oneline
📝 DECISION LOG
Date	Decision	Impact
2026-07-23	APDU mismatch identified & fixed	Core functionality restored
2026-07-27	SDK 35 update	Build compatibility fixed
2026-07-28	Root-caused 150+ compile errors to 4 actual bugs	Avoided blind mass-editing
2026-07-28	Generated & committed Gradle wrapper	Unblocked terminal/CI builds permanently
2026-07-29	Ran full assembleDebug before hardware testing	Caught 2 critical packaging/wiring bugs early
2026-07-29	NPM audit triaged	Confirmed low prod risk, one item deferred with rationale
2026-07-29	Renamed handover doc (removed date from filename)	Consistent with team convention — dates tracked inside file, not filename
🎓 NEW DEV CHECKLIST
Before You Start:

 Read this document completely
 Fix Bug #1 (icons) and Bug #2 (HCE manifest wiring) — DO NOT skip to phone testing before these are resolved
 Run ./gradlew :app:assembleDebug :consumer-wallet:assembleDebug and confirm both succeed with real APK output
 Verify backend running on :3000
When You Have 2nd Phone:

 Confirm Bug #2 fix first — otherwise you'll waste phone-testing time debugging "why doesn't tap work"
 Execute NFC test protocol
 Update documentation with results
END OF ONBOARDING GUIDE
# ANDROID NFC TESTING PROTOCOL
**Project:** OrchestratePay Platform
**Last Updated:** 16 August 2026
**Status:** ⚠️ NOT YET READY FOR TWO-PHONE TESTS — single-device login path now proven working; second device still awaited; 5 files uncommitted must be committed before proceeding further
**Prerequisites:** 2x NFC-enabled Android phones (API 26+) — **currently have 1 confirmed, 1 awaited**, Android Studio, Working Backend

---

## ⚠️ DO NOT PROCEED TO TWO-PHONE TESTS UNTIL ALL OF THE FOLLOWING ARE TRUE

This protocol has twice previously been marked "ready" prematurely (28 July, then again implicitly via the 12 August checklist's "Phase 1 ACTIVE" claim) only for a real blocker to surface later. Do not repeat that pattern. Before attempting Test 1:

1. [ ] The 5 currently-uncommitted files are committed
2. [ ] `./gradlew clean assembleDebug` re-verified green across all 4 modules, post-commit
3. [ ] Merchant Terminal (`:app`) login verified working on the one confirmed device (not yet done — see below)
4. [ ] `adb devices` shows **two** entries, both status `device` (not `unauthorized`), pasted as real output in this session

---

## 📋 PHASE 0: MANDATORY PRE-FLIGHT CHECK — UPDATED THIS SESSION, DO NOT SKIP

Two new checks added this session, based on real failures encountered. All checks must pass with real command output, not assumptions.

```bash
cd Tap2Pay/android

# Check 1: Confirm JAVA_HOME is set
java -version

# Check 2: Confirm adb resolves (NEW — this failed mid-session on 16 Aug due to fresh-terminal PATH loss)
which adb
# If "command not found": run
# export PATH="$PATH:/c/Users/admin/AppData/Local/Android/Sdk/platform-tools"
# This was added to .bashrc this session but NOT YET CONFIRMED to persist — verify in a truly fresh terminal.

# Check 3: Full packaging succeeds for BOTH modules
./gradlew :app:assembleDebug :consumer-wallet:assembleDebug

# Check 4: Confirm real APK files were produced
find . -name "*.apk" -path "*/outputs/*"

# Check 5 (NEW — infrastructure, not build): Confirm backend AND Redis are both actually running
# Redis is NOT on PATH — must use full path:
/c/Users/admin/redis/redis-server.exe --port 6379   # separate terminal, leave running
cd ../backend && npm run dev                          # separate terminal, leave running
curl http://localhost:3000/health                     # Expected: {"status":"ok",...}

# Check 6 (NEW — this exact failure happened this session): Confirm test accounts actually exist in the DB
# Do NOT assume consumer2@test.com exists just because it's documented here — it previously didn't.
# If in doubt, re-create via the real endpoint (see "Known Accounts" section below), not raw SQL.
If Check 3 fails on :app with a resource-linking error: packaging bug, not NFC bug — see prior sessions' known instances (missing icons, missing colors.xml). Fix before proceeding.

If Check 5 shows the backend can't reach Redis ("Reached the max retries per request limit" in backend logs): Redis isn't running. This is not a code bug — start it manually, it does not auto-start.

🎯 TEST OBJECTIVE
Verify the APDU protocol fix (0xC0→0x80, 0xC1→0x81) resolves communication between:

Phone A: Consumer Wallet (HCE - card emulation)
Phone B: Merchant Terminal (NFC reader)
Success: Successful APDU exchange → M-Pesa STK Push → Payment confirmation

📋 PRE-TEST CHECKLIST — UPDATED WITH REAL-DEVICE STEPS
1. Infrastructure Verification
Bash

# Terminal 1 - Backend
cd Tap2Pay/backend
npm run dev
# Verify: "OrchestratePay backend running on port 3000"

# Terminal 2 - Health check
curl http://localhost:3000/health

# Terminal 3 - Redis (full path, NOT on system PATH)
/c/Users/admin/redis/redis-server.exe --port 6379
./redis-cli ping   # Expected: PONG
2. Real Device Connectivity — NEW SECTION, replaces emulator-only assumptions from prior version of this doc
⚠️ Critical correction from prior version of this document: earlier guidance assumed 10.0.2.2 (emulator-only loopback alias) would work for real-device testing. It does not. Real devices require:

Bash

cd Tap2Pay/android

# Confirm device is visible
adb devices
# Expected: <serial>    device      (NOT "unauthorized" — if unauthorized, check phone screen for a trust prompt)

# Forward the phone's localhost:3000 to your dev machine over USB
adb -s <serial> reverse tcp:3000 tcp:3000

# Verify the binding actually took
adb reverse --list
⚠️ This binding is lost every time the ADB daemon restarts (e.g. after a USB disconnect, adb kill-server, or sometimes spontaneously). If login suddenly fails with "Failed to connect" after previously working, check adb reverse --list first before assuming a new bug — re-run the adb reverse command above if the binding is gone.

3. Known Test Accounts — CORRECTED, verify before assuming
Account	Status as of 16 Aug	Notes
consumer2@test.com / TestPass123	✅ Confirmed real, login-verified this session	Consumer ID a09df433-e945-40ad-9177-54ec6ac94300. Did not exist prior to 16 Aug despite being documented since early sessions — do not assume any documented test account exists without checking.
merchant@test.com / TestPass123	⚠️ Exists in DB, APPROVED, login not yet attempted on real hardware with corrected localhost config	Next immediate test — see below
If a documented test account turns out not to exist, recreate it via the real endpoint, not a raw SQL insert:

Bash

curl -X POST http://localhost:3000/api/v1/auth/consumer/register \
  -H "Content-Type: application/json" \
  -d '{"phone":"254700000002","email":"consumer2@test.com","password":"TestPass123","displayName":"Test Consumer 2"}'
Using the real endpoint guarantees the resulting row has the correct shape (bcrypt hash, phone hash, etc.) — a raw INSERT risks missing a column the app depends on.

4. Android Studio Setup — unchanged
Open Android Studio → Tap2Pay/android/ → confirm debug variant selected for both :app and :consumer-wallet → no red errors in Build panel.

5. Phone Preparation
Both phones: Developer Options → USB Debugging ON
Both phones: Connect via USB, confirm Allow USB debugging prompt is accepted (status must read device, not unauthorized)
Both phones: NFC enabled in Settings
🔧 BUILD & INSTALL — UPDATED
Bash

cd Tap2Pay/android
./gradlew :app:assembleDebug
./gradlew :consumer-wallet:assembleDebug
Step 2: Install and re-verify connectivity per phone

For each phone you install onto:

Bash

adb -s <serial> install -r <path-to-apk>
adb -s <serial> reverse tcp:3000 tcp:3000
adb reverse --list   # confirm before attempting login
Phone A (Consumer): install consumer-wallet → login consumer2@test.com / TestPass123 → ✅ confirmed working this session — dashboard renders correctly.

Phone B (Merchant): install app → login merchant@test.com / TestPass123 / Device ID: any → ⚠️ not yet tested with corrected config — do this before attempting any two-phone test.

🧪 TEST EXECUTION — UNCHANGED CONTENT, STATUS UPDATED
All test steps below (Test 1–4) are unchanged in mechanics from the prior version of this protocol. Status: none have been attempted yet. The work done this session was entirely single-device connectivity/login groundwork — necessary prerequisite work, not the NFC test itself.

TEST 1: Phone-to-Phone HCE Payment (CRITICAL) — ⬜ NOT ATTEMPTED
Blocked on: 2nd confirmed device, Merchant Terminal login verification.

(Full setup/execution/expected sequence/logcat command — unchanged from prior version, retained below for reference)

Setup: Phone A: Consumer Wallet open, logged in. Phone B: Merchant Terminal open, logged in, "Ready for tap."

Execution: Align Phone A and Phone B NFC antennas (center-back), distance 0-2cm, hold steady 2-3 seconds.

Expected Sequence:

Time	Phone B (Merchant)	Phone A (Consumer)
0s	"Tag detected" vibrate/beep	-
1s	"Processing..."	-
2s	-	M-Pesa STK Push arrives
3s	-	Enter PIN on Phone A
4s	"Payment Confirmed" KES XXX	-
Logcat Command:

Bash

adb logcat -s "NfcReaderManager:D" "ConsumerHceService:D" "ApduProtocol:D" "*:S"
TEST 2: NFC Tag Read (NTAG215) — ⬜ NOT ATTEMPTED
Blocked on: NTAG215/216 sticker availability (still unconfirmed).

TEST 3: P2P Transfer — ⬜ NOT ATTEMPTED
Blocked on: 2nd confirmed device.

TEST 4: Error Handling — ⬜ NOT ATTEMPTED
Blocked on: 2nd confirmed device. Test 4c (idempotency) additionally requires the server-side single-use review (Checklist item #23) to interpret correctly, not just observe.

🐛 TROUBLESHOOTING — NEW ENTRIES ADDED THIS SESSION
Issue: App crashes immediately after apparently successful login
New this session. Backend returns 200 and issues a JWT, but the app crashes with a NullPointerException mentioning a non-null parameter.
Root cause (confirmed 16 Aug): backend/Android response-contract mismatch — backend omitted a field (phone) that Android's data class required non-null. See SESSION_HANDOVER.md Bug #10 for full detail.
Fix already applied: backend now includes phone/displayName in consumer auth responses; Android made the field nullable as defense-in-depth.
If this recurs on a different endpoint (e.g. merchant login): don't assume it's the same root cause automatically — verify by comparing the actual JSON response (curl -v the endpoint) against the Android data class field-by-field, the same way this instance was diagnosed.

Issue: "Failed to connect to localhost/127.0.0.1:3000" on a real (non-emulator) device
New this session. Two possible causes, check in this order:

API_BASE_URL still set to 10.0.2.2 — this only works in the emulator, never on a real phone. Check app/build.gradle and consumer-wallet/build.gradle.kts debug variant config.
adb reverse binding dropped — happens automatically after any ADB daemon restart. Run adb reverse --list to check; re-run adb -s <serial> reverse tcp:3000 tcp:3000 if empty.
Issue: Backend logs show "Reached the max retries per request limit (which is 3)"
Cause: Redis isn't running. It is not on PATH and does not auto-start.
Fix: /c/Users/admin/redis/redis-server.exe --port 6379 in its own terminal, verify with ./redis-cli ping → PONG.

Issue: adb: command not found in a terminal that previously had it working
Cause: MINGW64 environment does not reliably persist PATH exports across terminal windows, even after a .bashrc edit — reconfirmed this session.
Fix: export PATH="$PATH:/c/Users/admin/AppData/Local/Android/Sdk/platform-tools" — re-run per fresh terminal until .bashrc persistence is independently confirmed.

Issue: Sentry crash on app startup (IllegalArgumentException: DSN is required...)
Observed this session, not yet fixed. Currently recoverable — app continues past it. Do not treat as a hard blocker for NFC testing, but do not ignore indefinitely either; track per SESSION_HANDOVER.md Bug #11.

🐛 TROUBLESHOOTING — CARRIED FORWARD, UNCHANGED
(Tag Not Detected, SELECT Failed / 6F 00, Resource Linking Errors, Kotlin Compile Errors, Session Expired, No STK Push — all unchanged from prior version, still valid, not reproduced here for brevity — see prior protocol version in version control)

📸 CAPTURE REQUIREMENTS — unchanged
Screenshots, adb logcat -d > test[N]-logcat.txt, APDU hex dump, backend logs, PASS/FAIL notes → Tap2Pay/test-logs/2026-08-XX-NFC-Test/

✅ SUCCESS CRITERIA SUMMARY — status corrected
Test	Critical	Expected Result	Status
Phone-to-Phone HCE	YES	APDU exchange → STK Push → Confirmation	⬜ NOT ATTEMPTED (blocked on 2nd device + merchant login test)
NFC Tag Read	YES	Tag verified → STK Push → Confirmation	⬜ NOT ATTEMPTED (blocked on sticker availability)
P2P Transfer	Medium	Token exchange → Settlement	⬜ NOT ATTEMPTED (blocked on 2nd device)
Expired Token	Low	Proper error handling	⬜ NOT ATTEMPTED
Invalid Signature	Low	Rejection before STK Push	⬜ NOT ATTEMPTED
Idempotency (client + server)	Medium	No double-charges either side	⬜ NOT ATTEMPTED
Overall Status: ⬜ NOT TESTED — single-device login groundwork complete and verified; two-device tests still blocked on hardware.

📝 POST-TEST ACTIONS — unchanged, retained for when Phase 1 actually completes
(If All Tests Pass / If Tests Fail sections unchanged from prior version)

🔗 QUICK REFERENCE — UPDATED
Resource	Value
Backend URL	http://localhost:3000 (real device: requires adb reverse tcp:3000 tcp:3000, re-apply after daemon restarts)
Merchant Login	merchant@test.com / TestPass123 — ⚠️ not yet hardware-tested with corrected config
Consumer Login	consumer2@test.com / TestPass123 — ✅ confirmed working, account created 16 Aug via real registration endpoint
Redis	/c/Users/admin/redis/redis-server.exe --port 6379 — NOT on PATH, manual start required every session
Key Files	NfcReaderManager.kt, ConsumerHceService.kt, ApduProtocol.kt, ConsumerApiClient.kt, ConsumerSessionManager.kt, backend/src/routes/auth.ts
Gradle Version	9.4.1 (wrapper committed, fd21ba5)
Emergency Logs	Tap2Pay/test-logs/*/backend.log
END OF PROTOCOL
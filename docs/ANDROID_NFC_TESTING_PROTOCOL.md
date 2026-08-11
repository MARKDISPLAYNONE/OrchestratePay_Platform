# ANDROID NFC TESTING PROTOCOL

**Project:** OrchestratePay Platform
**Last Updated:** 8 August 2026
**Status:** ⚠️ NOT YET READY FOR HARDWARE — Phase 0 build verification must pass first
**Prerequisites:** 2x NFC-enabled Android phones (API 26+), Android Studio, Working Backend

---

## ⚠️ DO NOT PROCEED TO HARDWARE UNTIL PHASE 0 IS GREEN

This protocol was previously marked "no code blockers remain" (28 July). That was **premature** — a full `assembleDebug` run on 8 August surfaced a real packaging bug (`colors.xml` missing) that had nothing to do with NFC logic but would have silently prevented `:app` from installing at all. This is exactly the failure mode this document warns about below — don't repeat the mistake of skipping the pre-flight check.

---

## 📋 PHASE 0: MANDATORY PRE-FLIGHT CHECK — DO NOT SKIP

Run this before connecting any phone. All three checks must pass with real command output, not assumptions.

```bash
cd Tap2Pay/android

# Check 1: Confirm JAVA_HOME is set (fresh terminals lose this without .bashrc persistence)
java -version
# Must print a version, not "JAVA_HOME is not set" error

# Check 2: Full packaging succeeds for BOTH modules — not just Kotlin compile
./gradlew :app:assembleDebug :consumer-wallet:assembleDebug
# Must show BUILD SUCCESSFUL for both

# Check 3: Confirm real APK files were produced
find . -name "*.apk" -path "*/outputs/*"
# Must list actual .apk files, not empty
If Check 2 fails on :app with a resource-linking error (e.g. resource color/X not found, resource mipmap/X not found): this is a packaging bug, not an NFC bug. Do NOT attempt to debug it via hardware testing — fix the resource issue first. See PRODUCTION_READINESS_CHECKLIST.md items #10–11 for the current known state of this exact class of bug.

Historical note (why this check exists): On 29 July, a missing launcher icon bug was found this way. On 8 August, a missing colors.xml bug was found the same way. Both would have looked like "the app won't even install" during hardware testing, wasting significant time chasing what looks like a device/antenna problem but is actually a build config gap. A previously suspected HCE manifest registration bug (also from this pre-flight check tradition) was investigated and found to be a false alarm (see SESSION_HANDOVER.md, retracted in commit 4d77878) — it is intentionally removed from this checklist below since it was never real.

🎯 TEST OBJECTIVE
Verify the APDU protocol fix (0xC0→0x80, 0xC1→0x81) resolves communication between:

Phone A: Consumer Wallet (HCE - card emulation)
Phone B: Merchant Terminal (NFC reader)
Success: Successful APDU exchange → M-Pesa STK Push → Payment confirmation

📋 PRE-TEST CHECKLIST
1. Infrastructure Verification
Bash

# Terminal 1 - Backend (must be running)
cd Tap2Pay/backend
npm run dev
# Verify: info: Server listening on port 3000

# Terminal 2 - Health check
curl http://localhost:3000/health
# Expected: {"status":"ok","timestamp":"..."}

# Terminal 3 - Redis (if not running)
cd /tmp && ./redis-server.exe --port 6379
./redis-cli ping
# Expected: PONG
2. Build Environment Status — ✅ Wrapper Resolved, Verify Fresh Each Session
Bash

# Verify wrapper exists (should be present now, committed in fd21ba5)
ls Tap2Pay/android/gradlew
ls Tap2Pay/android/gradlew.bat

# Verify consumer-wallet compiles clean
cd Tap2Pay/android
./gradlew :consumer-wallet:compileDebugKotlin
# Expected: BUILD SUCCESSFUL

# Verify Google Services disabled (for NFC testing phase)
grep "google-services" consumer-wallet/build.gradle.kts
# Expected: // id("com.google.gms.google-services")
3. Android Studio Setup
Open Android Studio → File → Open → Tap2Pay/android/
Gradle sync should complete quickly
Build variants: debug selected for both :app and :consumer-wallet
Verify no red errors in Build panel (yellow deprecation warnings are OK)
4. Phone Preparation
Phone A & B: Enable Developer Options → USB Debugging
Both phones: Connect to Android Studio (appear in Device Manager)
Both phones: NFC enabled in Settings
🔧 BUILD & INSTALL
Step 1: Build
Bash

cd Tap2Pay/android
./gradlew :app:assembleDebug
./gradlew :consumer-wallet:assembleDebug
Step 2: Install on Phones
Phone A (Consumer):

Run consumer-wallet module
Login: consumer2@test.com / TestPass123
Should show: "Ready to Pay" with QR code
Phone B (Merchant):

Run app module
Login: merchant@test.com / TestPass123 / Device ID: any
Should show: "Tap customer phone or NFC tag"
🧪 TEST EXECUTION
TEST 1: Phone-to-Phone HCE Payment (CRITICAL)
Setup: Phone A: Consumer Wallet open, logged in. Phone B: Merchant Terminal open, logged in, "Ready for tap".

Execution: Align Phone A and Phone B NFC antennas (center-back), distance 0-2cm, hold steady 2-3 seconds.

Expected Sequence:

Time	Phone B (Merchant)	Phone A (Consumer)
0s	"Tag detected" vibrate/beep	-
1s	"Processing..."	-
2s	-	M-Pesa STK Push arrives
3s	-	Enter PIN on Phone A (system dialog)
4s	"Payment Confirmed" KES XXX	-
APDU Exchange (Verify in Logcat):

text

NfcReaderManager: SELECT AID: F04F52434845535441
NfcReaderManager: SELECT response: 90 00 ✓
ConsumerHceService: processCommandApdu: INS=0x80 (GET DATA)
NfcReaderManager: GET DATA: 80 80 00 00 00 ✓
NfcReaderManager: JSON payload: {"phone":"254...","token":"..."}
NfcReaderManager: CONFIRM: 80 81 00 00 00 ✓
ConsumerHceService: Session cleared (single-use)
NfcReaderManager: Transaction initiated: txnId=xxx
Logcat Command:

Bash

adb logcat -s "NfcReaderManager:D" "ConsumerHceService:D" "ApduProtocol:D" "*:S"
TEST 2: NFC Tag Read (NTAG215)
Prerequisites: NTAG215/216 sticker programmed with:

text

orchestratepay://pay?mid=MERCHANT_ID&tid=TAG_ID&v=1&sign=HMAC
Execution: Phone B: Merchant Terminal open, logged in. Tap NTAG215 sticker to back of Phone B.

Success Criteria: Tag signature verified (HMAC-SHA256), no "Signature Invalid" error, STK Push initiated.

TEST 3: P2P Transfer
Setup: Phone A: Consumer Wallet → P2P Send → enter amount → generate P2P token. Phone B: Consumer Wallet → P2P Receive.

Execution: Tap Phone A to Phone B.

Success Criteria: P2P token transmitted, backend settles transfer, no "TOKEN_EXPIRED" errors.

TEST 4: Error Handling
4a: Expired HCE Token — Generate token, wait 90s (or reduce to 5s for testing), attempt tap. Expected: "Token Expired" error.

4b: Invalid Tag (Forged Signature) — Program tag with wrong HMAC, tap terminal. Expected: "Signature Invalid" error, no STK Push.

4c: Double Tap (Idempotency) — Complete successful payment, immediately tap again. Expected: New transaction (single-use tokens), not a duplicate charge. Also confirm this is enforced server-side, not just via client-side single-use token clearing — see PRODUCTION_READINESS_CHECKLIST.md item #23.

🐛 TROUBLESHOOTING
Issue: "Tag Not Detected"
Check	Action
NFC enabled?	Settings → NFC → ON
Phone cases?	Remove metal cases (block NFC)
Antenna alignment?	Center-back of phones, 0-2cm
Build variant?	Must be debug, not release
Issue: "SELECT Failed" or "6F 00"
Cause: APDU instruction mismatch (old bug, already fixed).
Verify: NfcReaderManager.kt has:

Kotlin

val getDataApdu = byteArrayOf(0x80.toByte(), 0x80.toByte(), ...) // Not 0xC0
val confirmApdu = byteArrayOf(0x80.toByte(), 0x81.toByte(), ...) // Not 0xC1
Issue: Build Fails with Resource Linking Error (AAPT: error: resource X not found)
This is NOT an NFC bug — it's a packaging bug and must be resolved before hardware testing begins. Do not attempt to diagnose via phone taps.

Diagnostic approach:

Read the exact resource name and type from the error (color/white, mipmap/ic_launcher, etc.)
Grep for ALL references to that resource type across layouts before fixing just one:
Bash

grep -rho '@color/[a-zA-Z0-9_]*' app/src/main/res/layout/ | sort -u
Create/update the appropriate values/ resource file with everything the grep found — fix once, not iteratively
Re-run assembleDebug, confirm BUILD SUCCESSFUL before considering it closed
Known instances of this exact failure mode:

29 July 2026 — missing mipmap/ic_launcher (launcher icons)
8 August 2026 — missing color/white (no colors.xml existed)
Issue: Build Compile Errors (Kotlin-level, not resource-level)
Diagnostic approach:

Run ./gradlew :consumer-wallet:compileDebugKotlin in isolation first — don't build the whole project blind
Read the FIRST error carefully — later errors in the same file are often cascading noise
Common root causes previously found: wrong import path (android.nfc.X vs android.nfc.tech.X), missing Gradle dependency, missing import for an existing class, sub-package files needing explicit R import
Issue: "Session Expired" Immediately
Check	Action
Phone time?	Check system time is correct
Backend time?	Run date on server
Timezone?	Ensure phones and server match
Issue: No STK Push Received
Check	Action
Backend env?	Must be DARAJA_ENV=mock
Phone format?	Must be 2547XXXXXXXX
Sandbox credentials?	Check backend/.env
Backend logs?	tail -f Tap2Pay/test-logs/*/backend.log
📸 CAPTURE REQUIREMENTS
For each test, record:

Screenshot of both phone screens at each stage
Logcat output: adb logcat -d > test[N]-logcat.txt
APDU hex dump (if available in logs)
Backend logs during transaction
Result: PASS / FAIL with notes
Save to: Tap2Pay/test-logs/2026-08-XX-NFC-Test/ (use actual test date)

✅ SUCCESS CRITERIA SUMMARY
Test	Critical	Expected Result	Status
Phone-to-Phone HCE	YES	APDU exchange → STK Push → Confirmation	⬜
NFC Tag Read	YES	Tag verified → STK Push → Confirmation	⬜
P2P Transfer	Medium	Token exchange → Settlement	⬜
Expired Token	Low	Proper error handling	⬜
Invalid Signature	Low	Rejection before STK Push	⬜
Idempotency (client + server)	Medium	No double-charges either side	⬜
Overall Status: ⬜ NOT TESTED (blocked on Phase 0 build verification) / ⬜ IN PROGRESS / ⬜ PASSED / ⬜ FAILED

📝 POST-TEST ACTIONS
If All Tests Pass:

Update this document with "PASSED" status and date
Save logcat files to repository
Confirm current commit count via git log --oneline | wc -l (do not copy a stale number from docs)
Create PR to upstream:
text

1. https://github.com/gabrielngige/OrchestratePay_Platform
2. New Pull Request
3. base: gabrielngige/main ← compare: MARKDISPLAYNONE/main
4. Title: "fix(nfc): Resolve APDU protocol mismatch + stabilize Android build"
5. Reference this test protocol and SESSION_HANDOVER.md
If Tests Fail:

Capture logs immediately (before they scroll away)
Document failure mode in this file
Check APDU instructions in code first — this is the most common root cause historically
Do NOT push to upstream until resolved
🔗 QUICK REFERENCE
Resource	Value
Backend URL	http://localhost:3000
Merchant Login	merchant@test.com / TestPass123
Consumer Login	consumer2@test.com / TestPass123
Key Files	NfcReaderManager.kt, ConsumerHceService.kt, ApduProtocol.kt
Gradle Version	9.4.1 (wrapper committed, fd21ba5)
Emergency Logs	Tap2Pay/test-logs/*/backend.log
END OF PROTOCOL
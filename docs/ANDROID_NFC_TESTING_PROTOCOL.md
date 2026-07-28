# ANDROID NFC TESTING PROTOCOL

**Project:** OrchestratePay Platform
**Last Updated:** 28 July 2026
**Status:** Build VERIFIED STABLE → NFC Hardware Testing (no code blockers remain)
**Prerequisites:** 2x NFC-enabled Android phones (API 26+), Android Studio, Working Backend

---

## 🎯 TEST OBJECTIVE

Verify the APDU protocol fix (0xC0→0x80, 0xC1→0x81) resolves communication between:
- **Phone A:** Consumer Wallet (HCE - card emulation)
- **Phone B:** Merchant Terminal (NFC reader)

**Success:** Successful APDU exchange → M-Pesa STK Push → Payment confirmation

---

## 📋 PRE-TEST CHECKLIST

### 1. Infrastructure Verification

```bash
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
2. Build Environment Status — ✅ RESOLVED (28 July 2026)
Previous blocker (now fixed): Gradle wrapper scripts were missing, blocking terminal builds. Root-caused and resolved — see SESSION_HANDOVER.md for full fix details.

Bash

# Verify wrapper exists (should be present now)
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
Gradle sync should complete quickly now (wrapper + dependencies already resolved)
Build variants: debug selected for both :app and :consumer-wallet
Verify no red errors in Build panel (yellow warnings OK — deprecation notices only)
4. Phone Preparation
 Phone A: Enable Developer Options → USB Debugging
 Phone B: Enable Developer Options → USB Debugging
 Phone A: Connect to Android Studio (appears in Device Manager)
 Phone B: Connect to Android Studio (appears in Device Manager)
 Both phones: NFC enabled in Settings
🔧 BUILD & INSTALL
Step 1: Build (Now Fast & Reliable)
Bash

cd Tap2Pay/android
./gradlew :app:assembleDebug
./gradlew :consumer-wallet:assembleDebug
Or in Android Studio: Build → Rebuild Project — should complete without the previous cascade of errors.

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
Setup:

Phone A: Consumer Wallet open, logged in
Phone B: Merchant Terminal open, logged in, showing "Ready for tap"
Execution:

Align Phone A and Phone B NFC antennas (center-back of phones)
Distance: 0-2cm
Hold steady for 2-3 seconds
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
Prerequisites: NTAG215 or NTAG216 sticker programmed with:

text

orchestratepay://pay?mid=MERCHANT_ID&tid=TAG_ID&v=1&sign=HMAC
Execution:

Phone B: Merchant Terminal open, logged in
Tap NTAG215 sticker to back of Phone B
Expected:

App reads tag → Displays merchant info → Fires STK Push to associated consumer phone
Success Criteria:

Tag signature verified (HMAC-SHA256)
No "Signature Invalid" error
STK Push initiated
TEST 3: P2P Transfer
Setup:

Phone A: Consumer Wallet → P2P Send → Enter amount → Generate P2P token
Phone B: Consumer Wallet → P2P Receive (or Merchant Terminal)
Execution:

Tap Phone A to Phone B
Expected:

P2P token transmitted via HCE → Backend processes transfer → Both wallets show updated balances
Success Criteria:

P2P token transmitted successfully
Backend settles transfer
No "TOKEN_EXPIRED" errors
TEST 4: Error Handling
TEST 4a: Expired HCE Token

Generate HCE token
Wait 90 seconds (or modify code to 5s for testing)
Attempt tap
Expected: "Token Expired" error on terminal
TEST 4b: Invalid Tag (Forged Signature)

Program tag with wrong HMAC signature
Tap to terminal
Expected: "Signature Invalid" error, no STK Push
TEST 4c: Double Tap (Idempotency)

Complete successful payment
Immediately tap same phones again
Expected: New transaction (tokens are single-use), not duplicate
🐛 TROUBLESHOOTING
Issue: "Tag Not Detected"
Check	Action
NFC enabled?	Settings → NFC → ON
Phone cases?	Remove metal cases (block NFC)
Antenna alignment?	Center-back of phones, 0-2cm
Build variant?	Must be debug, not release
Issue: "SELECT Failed" or "6F 00"
Cause: APDU instruction mismatch (old bug, already fixed)
Verify: NfcReaderManager.kt has:

Kotlin

val getDataApdu = byteArrayOf(0x80.toByte(), 0x80.toByte(), ...) // Not 0xC0
val confirmApdu = byteArrayOf(0x80.toByte(), 0x81.toByte(), ...) // Not 0xC1
Issue: Build Compile Errors — RESOLVED, But If They Reappear
Root causes previously found (see SESSION_HANDOVER.md for full details):

Wrong import path (android.nfc.X vs android.nfc.tech.X)
Missing dependency in build.gradle.kts
Missing import for a class/type that exists but isn't imported
Sub-package files need explicit R import (won't auto-resolve from parent package)
Diagnostic approach: Run ./gradlew :consumer-wallet:compileDebugKotlin in isolation first — don't build the whole project blind. Read the FIRST error in the log carefully; later errors in the same file are often cascading noise from the first one.

Issue: "Session Expired" Immediately
Check	Action
Phone time?	Check system time is correct
Backend time?	Run date on server
Timezone?	Ensure both phones and server same timezone
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
Save to: Tap2Pay/test-logs/2026-07-28-NFC-Test/

✅ SUCCESS CRITERIA SUMMARY
Test	Critical	Expected Result	Status
Phone-to-Phone HCE	YES	APDU exchange → STK Push → Confirmation	⬜
NFC Tag Read	YES	Tag verified → STK Push → Confirmation	⬜
P2P Transfer	Medium	Token exchange → Settlement	⬜
Expired Token	Low	Proper error handling	⬜
Invalid Signature	Low	Rejection before STK Push	⬜
Idempotency	Medium	No double-charges	⬜
Overall Status: ⬜ NOT TESTED / ⬜ IN PROGRESS / ⬜ PASSED / ⬜ FAILED

📝 POST-TEST ACTIONS
If All Tests Pass:

Update this document with "PASSED" status and date
Save logcat files to repository
Commit count check: See SESSION_HANDOVER.md for current count
Create PR to upstream:
Bash

# GitHub Web:
# 1. https://github.com/gabrielngige/OrchestratePay_Platform
# 2. New Pull Request
# 3. base: gabrielngige/main ← compare: MARKDISPLAYNONE/main
# 4. Title: "fix(nfc): Resolve APDU protocol mismatch + stabilize Android build"
# 5. Reference this test protocol and SESSION_HANDOVER.md
If Tests Fail:

Capture logs immediately (before they scroll away)
Document failure mode in this file
Check APDU instructions in code
Do NOT push to upstream until resolved
🔗 QUICK REFERENCE
Resource	Value
Backend URL	http://localhost:3000
Merchant Login	merchant@test.com / TestPass123
Consumer Login	consumer2@test.com / TestPass123
Key Files	NfcReaderManager.kt, ConsumerHceService.kt, ApduProtocol.kt
Gradle Version	9.4.1 (wrapper committed to repo)
Emergency Logs	Tap2Pay/test-logs/*/backend.log
END OF PROTOCOL

text


### Commit It

```bash
git add ANDROID_NFC_TESTING_PROTOCOL.md
git commit -m "docs: Update NFC testing protocol — build blockers resolved

- Remove outdated 'wrapper missing' troubleshooting (fixed in fd21ba5)
- Confirm consumer-wallet compiles clean via ./gradlew
- Simplify build steps (no more workarounds needed)
- Add generalized compile-error diagnostic approach for future issues
- Update date to 28 July 2026"
🗺️ FULL PRODUCTION READINESS ROADMAP
Here's the honest, ordered path from "code compiles" to "real users, real money, real phones." I'll rank by risk × blocking-ness, not just checklist order.

Phase 1: Hardware Validation (NEXT — you're here)
Blocker level: 🔴 Critical — nothing else matters if taps don't work

 Execute ANDROID_NFC_TESTING_PROTOCOL.md fully (all 6 test cases)
 Confirm APDU fix actually works on real hardware (not just compiles)
 Test on 2+ different phone models/manufacturers (NFC chipsets vary — Samsung, Pixel, etc. behave differently)
Phase 2: Security Hardening
Blocker level: 🔴 Critical for handling real money

 Generate real JWT_SECRET (not dev placeholder) — rotate on deploy
 Resolve the 19 NPM vulnerabilities (Sentry/OpenTelemetry chain) — audit if any are exploitable in your actual usage path
 APDU plaintext risk — you accepted 90s TTL as mitigation; confirm this is actually acceptable for your threat model (a sniffer within 2cm during the 90s window could theoretically replay). Consider: is HCE session single-use enforced server-side too, not just client-side?
 Rate limiting on STK Push endpoint (prevent spam-triggering M-Pesa prompts)
 Audit package-lock.json diff we skipped — don't leave it unexamined forever
Phase 3: Compliance & Legal
Blocker level: 🔴 Critical — literally illegal to operate without this in Kenya

 CBK (Central Bank of Kenya) license application — 3-6 month lead time, start this NOW in parallel, it's your longest pole
 Data protection compliance (Kenya DPA 2019) — you're handling phone numbers + transaction data
 M-Pesa Daraja production credentials (vs current sandbox/mock)
Phase 4: Infrastructure Readiness
Blocker level: 🟡 High — needed before any real traffic

 K8s manifests — your docs mention "needs fixes," get specific on what's broken
 Database backup/restore strategy tested (not just assumed)
 Redis persistence configured (session/token loss on restart = failed payments mid-flight)
 Environment secrets management (not .env files in production)
Phase 5: Resilience & Failure Modes
Blocker level: 🟡 High — money systems fail in weird ways

 What happens if M-Pesa STK Push times out mid-transaction? Reconciliation process?
 What happens if backend crashes between "HCE token issued" and "payment confirmed"? Orphaned transactions?
 Idempotency at the backend level (Test 4c above tests client-side, but confirm backend rejects duplicate transaction IDs too)
Phase 6: Observability
Blocker level: 🟡 High — you can't fix what you can't see

 Structured logging for every transaction stage (tap → token → STK → confirm)
 Alerting on failed payment rate spike
 Dashboard for merchant transaction success rate
Phase 7: Scale Testing
Blocker level: 🟢 Medium — matters once you have real merchants

 Load test backend under concurrent NFC taps (100 merchants tapping simultaneously?)
 Database connection pool sizing under load
Phase 8: iOS Strategy Execution
Blocker level: 🟢 Medium — you've documented QR fallback, now build it

 Implement QR fallback flow for iPhone users (per IOS_LIMITATIONS_AND_FALLBACK.md)

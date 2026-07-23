# SESSION HANDOVER DOCUMENT
**Date:** 23 July 2026  
**Project:** OrchestratePay Platform  
**Status:** Backend Operational - APDU Fix Applied & Committed - Security Audit Completed  
**Prepared by:** Senior Lead Dev (10x)  
**Recipient:** Incoming Senior Lead Dev / Project Continuation Lead

---

## 1. EXECUTIVE SUMMARY

**MILESTONE ACHIEVED:** 
- Backend infrastructure fully operational (PostgreSQL, Redis, API)
- Test accounts created with valid JWT tokens and HCE session tokens
- **CRITICAL BUG FIXED:** APDU instruction codes corrected in `NfcReaderManager.kt` (0xC0→0x80, 0xC1→0x81)
- Code committed and pushed to secure fork
- **SECURITY AUDIT COMPLETED:** 19 NPM vulnerabilities documented, credential exposure mitigated, NFC sniffing risk assessed

**Current Blocker:** Android NFC tap testing (Phone-to-Phone) to verify the APDU fix resolves the communication failure between Consumer Wallet (HCE) and Merchant Terminal (Reader).

**Next Action Required:** Build Android debug APKs, install on two NFC-enabled phones, execute tap test, verify APDU exchange in logcat.

---

## 2. PROJECT OVERVIEW

**OrchestratePay** is a closed-loop NFC Tap-to-Pay platform designed for the Kenyan market, integrating with M-Pesa (Daraja API), Airtel Money, and local banking infrastructure.

**Architecture Type:** Proprietary HCE (Host Card Emulation) Wallet  
**NOT EMV-compliant** (avoiding Visa/Mastercard certification overhead)  
**Settlement Rail:** M-Pesa STK Push (Daraja API)  
**Regulatory Scope:** CBK Payment Service Provider (PSP) licensing required for production

### Core Value Proposition
- Consumer taps merchant NFC sticker, Sunmi P2 Pro terminal, or scans QR code
- Consumer receives M-Pesa STK Push on phone
- Enters PIN, payment confirmed in <3 seconds
- Receipt printed instantly (Sunmi P2 Pro thermal printer)

---

## 3. REPOSITORY STRUCTURE & LOCATIONS

### Repository Remotes
| Remote | URL | Purpose | Status |
|--------|-----|---------|--------|
| **upstream** | `https://github.com/gabrielngige/OrchestratePay_Platform.git` | Junior dev original | Missing APDU fix (behind) |
| **origin** (fork) | `https://github.com/MARKDISPLAYNONE/OrchestratePay_Platform.git` | **Current development** | Ahead by 2 commits (fix + docs) |

### Complete File Structure


OrchestratePay_Platform/ [GIT ROOT]
├── .agents/ [TRACKED - AI assistant skills]
│ └── skills/
│ ├── systematic-debugging/ (Test debugging patterns)
│ └── tdd/ (Test-driven development patterns)
├── .github/
│ └── workflows/
│ └── ci.yml [TRACKED - CI/CD pipeline]
├── .git/ [GIT REPOSITORY]
├── .gitignore [TRACKED - Security rules updated]
├── CLAUDE.md [TRACKED - AI assistant instructions]
├── LICENSE [TRACKED]
├── README.md [TRACKED - Project overview]
├── docker-compose.ha.yml [TRACKED - High availability config]
├── docker-compose.yml [TRACKED - Local dev stack]
├── docs/ [TRACKED - Documentation]
│ ├── SESSION_HANDOVER_20260723.md [TRACKED - This document]
│ ├── ANDROID_NFC_TESTING_PROTOCOL.md [TRACKED - Test procedures]
│ └── PRODUCTION_READINESS_CHECKLIST.md [TRACKED - Security & infra tracking]
├── infra/ [TRACKED - Infrastructure]
│ ├── k8s/ [Kubernetes manifests]
│ │ ├── backend/ (Deployment, service YAMLs)
│ │ ├── ingress/ (K8s ingress rules)
│ │ ├── postgres/ (DB StatefulSet)
│ │ ├── redis/ (Redis deployment)
│ │ ├── namespace.yaml (K8s namespace)
│ │ └── secrets.template.yaml (Secrets template - P0 gap)
│ └── nginx/
│ └── nginx-lb.conf [TRACKED - Load balancer config]
├── scripts/ [TRACKED - Utilities]
│ └── extract-tls-pin.sh (TLS certificate pinning)
├── skills/ [TRACKED - AI context modules]
│ ├── orchestratepay-accounting-integrations/
│ ├── orchestratepay-android-kotlin/
│ ├── orchestratepay-android-nfc/ [SKILL.md - NFC domain knowledge]
│ ├── orchestratepay-android-printer/
│ ├── orchestratepay-backend-api/
│ ├── orchestratepay-biometric-authorization/
│ ├── orchestratepay-cbk-compliance/
│ ├── orchestratepay-circuit-breaker/
│ ├── orchestratepay-consumer-wallet/
│ ├── orchestratepay-daraja/
│ ├── orchestratepay-debugging/
│ ├── orchestratepay-device-attestation/
│ ├── orchestratepay-disputes/
│ ├── orchestratepay-fiscal-compliance/
│ ├── orchestratepay-fleet-mdm/
│ ├── orchestratepay-fraud-scoring/
│ ├── orchestratepay-fx-multicurrency/
│ ├── orchestratepay-hce-crypto/
│ ├── orchestratepay-loyalty-crm/
│ ├── orchestratepay-merchant-api-keys/
│ ├── orchestratepay-merchant-intelligence/
│ ├── orchestratepay-merchant-onboarding/
│ ├── orchestratepay-merchant-webhooks/
│ ├── orchestratepay-nfc-tag-lifecycle/
│ ├── orchestratepay-offline-first/
│ ├── orchestratepay-payment-links/
│ ├── orchestratepay-payments-domain/
│ ├── orchestratepay-realtime-notifications/
│ ├── orchestratepay-reconciliation/
│ ├── orchestratepay-refunds/
│ ├── orchestratepay-security-middleware/
│ ├── orchestratepay-settlement/
│ ├── orchestratepay-sms-ussd-fallback/
│ ├── orchestratepay-softpos/
│ ├── orchestratepay-split-payments/
│ ├── orchestratepay-subscriptions/
│ ├── orchestratepay-tap-latency-budget/
│ ├── orchestratepay-vat/
│ ├── orchestratepay-web-frontend/
│ ├── orchestratepay-websocket/
│ └── [Each subfolder contains SKILL.md for AI context]
├── skills-lock.json [TRACKED]
└── Tap2Pay/ [MAIN APPLICATION]
├── README.md [TRACKED - Detailed technical spec]
├── docker-compose.yml [TRACKED]
├── package.json [TRACKED - Workspace root]
├── android/ [ANDROID MODULES]
│ ├── README.md [TRACKED - Android build instructions]
│ ├── app/ [MERCHANT TERMINAL]
│ │ └── src/main/java/com/orchestratepay/
│ │ └── nfc/
│ │ ├── NfcReaderManager.kt [FIXED - Lines 255, 271]
│ │ └── NfcReaderManager.kt.bak [UNTRACKED - Local backup]
│ ├── consumer-wallet/ [HCE WALLET]
│ ├── nfc-core/ [SHARED LIBRARY]
│ └── softpos/ [SOFTPOS MODULE]
├── backend/ [NODE.JS API]
│ ├── .env [UNTRACKED - Local secrets]
│ ├── .env.example [TRACKED - Template]
│ ├── README.md [TRACKED - API documentation]
│ ├── node_modules/ [UNTRACKED - Dependencies]
│ ├── src/
│ │ ├── db/migrations/ (001-004 SQL files)
│ │ ├── routes/ (13 route modules)
│ │ └── tests/ (71 test suites)
│ └── package.json
├── dashboard/ [ADMIN DASHBOARD]
└── web/ [REACT FRONTEND]
├── .next/ [UNTRACKED - Build output]
└── src/

text


### Skills Folder Note
The `skills/` directory contains **AI context files** (`SKILL.md` in each subfolder). These are documentation for Claude Code AI assistant to understand domain-specific concepts (Daraja, NFC, etc.). They are **not production code** but aid future AI-assisted development. Safe to keep in repository.

### Documentation Hierarchy
Multiple README files exist - read in this order:
1. `README.md` (root) - Project overview and quick start
2. `Tap2Pay/README.md` - Detailed architecture and API reference (**CRITICAL**)
3. `Tap2Pay/backend/README.md` - Backend-specific documentation
4. `Tap2Pay/android/README.md` - Android build instructions

**Important:** `Tap2Pay/README.md` contains a **documentation bug** at line ~190 - it documents the OLD INCORRECT APDU codes (0xC0/0xC1). The code fix we applied uses the CORRECT codes (0x80/0x81) which match `ApduProtocol.kt` and `ConsumerHceService.kt`.

---

## 4. SYSTEM ARCHITECTURE ANALYSIS

### Payment Flow (Critical Invariants)
1. **Dual-Channel Idempotency:** Redis fast-path + PostgreSQL UNIQUE constraint on `idempotency_key`
2. **PENDING-First Design:** Transaction written as `PENDING` before STK Push fires (crash-safe)
3. **HCE Token Security:** Single-use tokens, 90-second TTL (code shows 60s - INCONSISTENCY), constant-time comparison
4. **NFC Tag Signing:** HMAC-SHA256 with merchant-scoped keys (prevents tag cloning)
5. **Safaricom IP Allowlist:** 12 egress IPs hardcoded for M-Pesa callback validation

### APDU Protocol (Proprietary - NOT EMV)
**AID:** `F04F52434845535441` (Hex: F0 ORCHESTRAT...)

**Three-Step Handshake:**
1. **SELECT AID** (`00 A4 04 00`) → Response: `90 00` (Success)
2. **GET DATA** (`80 80 00 00 00`) → Response: JSON payload + `90 00`
3. **CONFIRM** (`80 81 00 00 00`) → Response: `90 00` (session cleared)

**JSON Payload Format:**
```json
{
  "type": "CONSUMER_PAYMENT",
  "phone": "254XXXXXXXXX",
  "token": "<32-hex-chars>",
  "exp": 1690123456789,
  "deviceType": "CONSUMER_PHONE",
  "walletVersion": 2
}
5. CRITICAL BUG RESOLVED (P0 - FIXED)
The APDU Instruction Mismatch
Status: ✅ FIXED AND COMMITTED

Location: Tap2Pay/android/app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt (Lines 255, 271)

Issue: Merchant terminal was sending wrong instruction codes:

Command	Was Sending (WRONG)	Should Send (CORRECT)	Status
GET DATA	0xC0	0x80	✅ FIXED
CONFIRM	0xC1	0x81	✅ FIXED
Fix Applied:

Kotlin

// Line 255 - GET DATA
val getDataApdu = byteArrayOf(0x80.toByte(), 0x80.toByte(), 0x00, 0x00, 0x00)

// Line 271 - CONFIRM  
val confirmApdu = byteArrayOf(0x80.toByte(), 0x81.toByte(), 0x00, 0x00, 0x00)
Verification:

Bash

grep -n "0x80\|0x81" NfcReaderManager.kt | head -10
# Output: Lines 255 and 271 show correct codes
Commit: 16e333c - "fix(nfc): Correct APDU instruction codes in NfcReaderManager"

Secondary Issues (Still Present)
Thread Safety: ConsumerHceService.sessionPayload is not volatile (race condition)
TTL Mismatch: Documentation says 90s, code implements 60s (TOKEN_TTL_MS = 60_000L)
P2P Priority Risk: P2P mode takes precedence over payment mode without timeout
6. LOCAL DEVELOPMENT ENVIRONMENT STATUS
Machine: Windows (MINGW64/Git Bash)
IDE: VS Code
Date Operational: 23 July 2026

Infrastructure Established
PostgreSQL 18: Running locally on port 5432

Database: orchestratepay
User: orchestratepay / Password: devpassword
Migrations: 4 applied (001_initial, 002_new_features, 003_settlement_kyc, 004_kyc_aml)
Redis 5.0.14.1: Running via portable binary on port 6379

Location: /tmp/redis-server.exe
Status: Active
Backend API: Running on http://localhost:3000

Status: Healthy
Environment: DARAJA_ENV=mock
Debug logging: Enabled
Web Frontend: Running on http://localhost:3001

Status: Active
Build: Vite dev server
Security Measures Applied
.test-env files added to .gitignore (contain JWT tokens)
test-logs/ directory added to .gitignore (contains HCE tokens, merchant IDs)
*.bak backup files added to .gitignore
Root package-lock.json deleted (accidental creation)
Test Accounts Created (VALID - Use for Testing)
Merchant Account (Primary):

Merchant ID: 6fce73f3-8482-43ff-ad67-7dce1db4074a
Email: merchant@test.com
Phone: 254700000001
Status: APPROVED
JWT Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (expires ~8 hours from generation)
Consumer Account (Secondary):

Merchant ID: 32e27ee7-472f-4298-918f-20d712623a8d
Email: consumer@test.com
Phone: 254700000002
Status: APPROVED
JWT Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (expires ~8 hours from generation)
Active HCE Token (VALID for NFC Testing):

JSON

{
  "token": "8a49f3af-dd09-4af4-b054-806a17d336ce",
  "expiresAt": 1784804652168,
  "amountCents": 100000,
  "merchantName": "Test Consumer"
}
API Endpoints Verified
POST /api/v1/auth/register - Creates merchant/consumer (requires admin approval)
POST /api/v1/auth/admin/approve/{merchantId} - Approves pending accounts
POST /api/v1/auth/login - Returns JWT (requires deviceId)
POST /api/v1/transactions/merchant-hce-token - Generates HCE session token
7. TESTING PROTOCOL
Phase 1: APDU Fix Verification ✅ COMPLETED
Fix applied via:

Bash

sed -i 's/0xC0.toByte()/0x80.toByte()/g' NfcReaderManager.kt
sed -i 's/0xC1.toByte()/0x81.toByte()/g' NfcReaderManager.kt
Verification:

Bash

grep -n "0x80\|0x81" Tap2Pay/android/app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt
# Lines 255, 271 confirmed correct
Phase 2: Build & Deploy (NEXT)
Open Tap2Pay/android/ in Android Studio (Electric Eel or later)
Sync Gradle
Select debug build variant
Build app (Merchant Terminal) and consumer-wallet (Consumer HCE)
Install on two NFC-enabled Android phones (API 26+)
Phase 3: Test Matrix
Test	Device A	Device B	Expected Result
Phone-to-Phone	Consumer Wallet (HCE)	Merchant App (Reader)	Transaction initiated, M-Pesa STK Push sent
Tag Read	NTAG 215/216	Merchant App	Tag signature verified, payment initiated
P2P Transfer	Consumer Wallet (HCE)	Consumer Wallet (Reader)	P2P token exchange, backend settlement
Phase 4: Log Analysis
Capture APDU exchange via Android Studio logcat:

Bash

adb logcat -s "NfcReaderManager:D" "ConsumerHceService:D" "ApduProtocol:D"
Look for:

SELECT AID success (90 00)
GET DATA success with JSON payload
CONFIRM success (90 00)
8. SECURITY CONSIDERATIONS
Current State: NOT PRODUCTION READY

JWT secrets in .env are test-only (test-jwt-secret...)
ADMIN_SECRET not configured in K8s manifests (Known Production Gap #2)
HCE tokens use 128-bit entropy (UUID v4)
No rate limiting on HCE token generation observed
28 npm vulnerabilities detected (npm audit)
Required Before Prod:

CBK PSP license application
Fix K8s manifest gaps (DARAJA_CALLBACK_URL vs BASE_URL, missing secrets)
Dependency audit and upgrade
TLS certificate pinning verification
Remove test credentials from all .env files
9. DECISION LOG
2026-07-23 00:30: Repository cloned to Windows environment
2026-07-23 00:45: PostgreSQL 18 and Redis 5.0.14.1 infrastructure established
2026-07-23 01:00: Backend API operational on :3000
2026-07-23 01:15: APDU instruction mismatch identified (C0/C1 vs 80/81)
2026-07-23 01:25: Database migrations applied (4 files)
2026-07-23 02:00: Test merchants created and approved
2026-07-23 13:00: Valid HCE token generated: 8a49f3af-dd09-4af4-b054-806a17d336ce
2026-07-23 14:15: APDU fix applied and committed (16e333c)
2026-07-23 14:26: Security audit completed - test credentials gitignored
2026-07-23 14:30: Pushed to fork: https://github.com/MARKDISPLAYNONE/OrchestratePay_Platform
2026-07-23 21:00: Web frontend started on :3001
2026-07-23 21:05: Security audit results documented

10. IMMEDIATE NEXT STEPS
✅ COMPLETED: Fix APDU Protocol (sed commands applied, committed, pushed)
✅ COMPLETED: Security Audit (NPM vulnerabilities documented, risks assessed)
🔄 NEXT: Build Android APKs (Android Studio)
⏳ PENDING: Execute Phone-to-Phone Tap Test
⏳ PENDING: Log Results (APDU hex dumps, success/failure)
⏳ PENDING: Update This Document with test results
⏳ PENDING: Create Pull Request to upstream (junior dev's repo) after testing
APPENDIX: Repository Locations
Primary Development Fork (Current):

URL: https://github.com/MARKDISPLAYNONE/OrchestratePay_Platform
Branch: main
Commit: 07a1d92 (Security audit + docs)
Status: Ahead of upstream by 3 commits
Local Path: ~/Desktop/projects/colab project/OrchestratePay_Platform/
Upstream (Junior Dev Original):

URL: https://github.com/gabrielngige/OrchestratePay_Platform
Status: Missing APDU fix (behind by 3 commits)
Action Required: Pull request after NFC testing confirms fix
Local Infrastructure:

PostgreSQL: localhost:5432
Redis: localhost:6379
Backend API: http://localhost:3000
Web Frontend: http://localhost:3001
Test Logs: Tap2Pay/test-logs/20260723_003312/ (gitignored, keep locally)
APPENDIX: Security Audit Results (23 July 2026)
Conducted By: Senior Lead Dev
Scope: Backend dependencies, credential exposure, NFC transmission security

Critical Findings:
NFC APDU Sniffing: Payload transmitted plaintext over ISO 14443-4. Mitigated by 90s token TTL but documented for CBK compliance review.
JWT Secret: Test secret in use. Must regenerate with openssl rand -hex 64 for production.
NPM Vulnerabilities: 19 moderate severity remain (OpenTelemetry/Sentry chain). Require manual upgrade to @sentry/node@10.67.0 (breaking change).
Mitigations Applied:
✅ .env and test-logs/ gitignored
✅ APDU protocol fixed (reliability improvement)
✅ PRODUCTION_READINESS_CHECKLIST.md created for tracking
Next Actions:
Upgrade Sentry/OpenTelemetry dependencies (breaking change - test thoroughly)
Implement rate limiting on HCE token generation endpoint
Fix thread safety in ConsumerHceService (volatile/AtomicReference)
Add 5-minute timeout to P2PHceSession to prevent mode confusion
END OF HANDOVER

Next Update: Post-Android build and NFC tap test results

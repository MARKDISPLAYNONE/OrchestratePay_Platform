# SESSION HANDOVER DOCUMENT
**Date:** 23 July 2026  
**Project:** OrchestratePay Platform  
**Status:** Backend Operational - HCE Token Generated - APDU Fix Pending  
**Prepared by:** Senior Lead Dev (10x)  
**Recipient:** Incoming Senior Lead Dev / Project Continuation Lead

---

## 1. EXECUTIVE SUMMARY

**MILESTONE ACHIEVED:** Backend infrastructure fully operational with valid test data. HCE token generated successfully. Critical APDU protocol bug identified and ready for fix.

**Next Action Required:** Fix APDU instruction codes in `NfcReaderManager.kt` (0xC0→0x80, 0xC1→0x81), then build Android apps and execute NFC tap tests.

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

## 3. REPOSITORY STRUCTURE

```
OrchestratePay_Platform/
├── README.md                    # Project overview (READ FIRST)
├── CLAUDE.md                    # Claude Code AI assistant instructions
├── docs/                        # This document lives here
├── Tap2Pay/                     # Main application monorepo
│   ├── backend/                 # Node.js 20 + TypeScript + Express
│   │   ├── src/routes/          # 13 route modules (~50 endpoints)
│   │   ├── src/db/migrations/   # PostgreSQL schema (4 migration files)
│   │   └── src/__tests__/       # 71 test suites, 1,291 assertions
│   ├── web/                     # Vite + React 19 SPA
│   ├── dashboard/               # Admin dashboard (Vite)
│   └── android/                 # Kotlin Android modules
│       ├── app/                 # Merchant Terminal (Sunmi P2 Pro) - BUG HERE
│       ├── nfc-core/            # Shared AAR library (APDU protocol)
│       ├── consumer-wallet/     # HCE Consumer Wallet
│       └── softpos/             # SoftPOS with Play Integrity
```

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
```

---

## 5. CRITICAL BUG IDENTIFIED (P0 - BLOCKING)

### The APDU Instruction Mismatch
**Location:** `Tap2Pay/android/app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt` (Lines ~207, ~217)

**Issue:** Merchant terminal sends wrong instruction codes:

| Command | Merchant Sends (Current - WRONG) | Consumer Expects (HCE - CORRECT) | Status |
|---------|----------------------------------|----------------------------------|---------|
| GET DATA | `0xC0` | `0x80` | ❌ **MISMATCH** |
| CONFIRM | `0xC1` | `0x81` | ❌ **MISMATCH** |

**Root Cause:** `NfcReaderManager.kt` uses hex `C0/C1` but `ConsumerHceService.kt` and `ApduProtocol.kt` expect `80/81`.

**Impact:** Every phone-to-terminal tap fails at Step 2. Merchant sends `80 C0 00 00 00`, HCE service returns `6F 00` (unknown instruction), transaction aborts.

**Fix Required:**
```kotlin
// File: Tap2Pay/android/app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt
// Line ~207 - CHANGE FROM:
val getDataApdu = byteArrayOf(0x80.toByte(), 0xC0.toByte(), 0x00, 0x00, 0x00)
// TO:
val getDataApdu = byteArrayOf(0x80.toByte(), 0x80.toByte(), 0x00, 0x00, 0x00)

// Line ~217 - CHANGE FROM:
val confirmApdu = byteArrayOf(0x80.toByte(), 0xC1.toByte(), 0x00, 0x00, 0x00)
// TO:
val confirmApdu = byteArrayOf(0x80.toByte(), 0x81.toByte(), 0x00, 0x00, 0x00)
```

### Secondary Issues
1. **Thread Safety:** `ConsumerHceService.sessionPayload` is not volatile (race condition)
2. **TTL Mismatch:** Documentation says 90s, code implements 60s (`TOKEN_TTL_MS = 60_000L`)
3. **P2P Priority Risk:** P2P mode takes precedence over payment mode without timeout

---

## 6. LOCAL DEVELOPMENT ENVIRONMENT STATUS

**Machine:** Windows (MINGW64/Git Bash)  
**IDE:** VS Code  
**Date Operational:** 23 July 2026

### Infrastructure Established
- **PostgreSQL 18:** Running locally on port 5432
  - Database: `orchestratepay`
  - User: `orchestratepay` / Password: `devpassword`
  - Migrations: 4 applied (001_initial, 002_new_features, 003_settlement_kyc, 004_kyc_aml)
  
- **Redis 5.0.14.1:** Running via portable binary on port 6379
  - Location: `/tmp/redis-server.exe`
  - Status: Active

- **Backend API:** Running on `http://localhost:3000`
  - Status: Healthy
  - Environment: `DARAJA_ENV=mock`
  - Debug logging: Enabled

### Test Accounts Created (VALID - Use for Testing)
**Merchant Account (Primary):**
- Merchant ID: `6fce73f3-8482-43ff-ad67-7dce1db4074a`
- Email: `merchant@test.com`
- Phone: `254700000001`
- Status: APPROVED
- JWT Token: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZmNlNzNmMy04NDgyLTQzZmYtYWQ2Ny03ZGNlMWRiNDA3NGEiLCJuYW1lIjoiVGVzdCBNZXJjaGFudCIsInJvbGUiOiJNRVJDSEFOVCIsImRldmljZUlkIjoidGVzdC1kZXZpY2UtMDAxIiwiYXBwcm92YWxTdGF0dXMiOiJBUFBST1ZFRCIsImlhdCI6MTc4NDgwNDQ3OCwiZXhwIjoxNzg0ODMzMjc4fQ.4vIryUG2_itqmfHSCoOLY3JFXa_dAp0TGkVTiU6yU2w`

**Consumer Account (Secondary):**
- Merchant ID: `32e27ee7-472f-4298-918f-20d712623a8d`
- Email: `consumer@test.com`
- Phone: `254700000002`
- Status: APPROVED
- JWT Token: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzMmUyN2VlNy00NzJmLTQyOTgtOTE4Zi0yMGQ3MTI2MjNhOGQiLCJuYW1lIjoiVGVzdCBDb25zdW1lciIsInJvbGUiOiJNRVJDSEFOVCIsImRldmljZUlkIjoidGVzdC1kZXZpY2UtMDAyIiwiYXBwcm92YWxTdGF0dXMiOiJBUFBST1ZFRCIsImlhdCI6MTc4NDgwNDQ3OSwiZXhwIjoxNzg0ODMzMjc5fQ.U7yyGv2n6cUkapo011E9N61FVjpqz-dA63H1mbMqSmo`

**Active HCE Token (VALID for NFC Testing):**
```json
{
  "token": "8a49f3af-dd09-4af4-b054-806a17d336ce",
  "expiresAt": 1784804652168,
  "amountCents": 100000,
  "merchantName": "Test Consumer"
}
```

### API Endpoints Verified
- `POST /api/v1/auth/register` - Creates merchant/consumer (requires admin approval)
- `POST /api/v1/auth/admin/approve/{merchantId}` - Approves pending accounts
- `POST /api/v1/auth/login` - Returns JWT (requires deviceId)
- `POST /api/v1/transactions/merchant-hce-token` - Generates HCE session token

---

## 7. TESTING PROTOCOL

### Phase 1: APDU Fix Verification (IMMEDIATE)
**Command to apply fix:**
```bash
cd ~/Desktop/projects/colab\ project/OrchestratePay_Platform

# Backup
cp Tap2Pay/android/app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt \
   Tap2Pay/android/app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt.bak.20260723

# Fix instruction codes
sed -i 's/0xC0.toByte()/0x80.toByte()/g' \
    Tap2Pay/android/app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt
sed -i 's/0xC1.toByte()/0x81.toByte()/g' \
    Tap2Pay/android/app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt
```

### Phase 2: Build & Deploy
1. Open `Tap2Pay/android/` in Android Studio
2. Sync Gradle
3. Select `debug` build variant
4. Build `app` (Merchant) and `consumer-wallet` (Consumer)
5. Install on two NFC-enabled Android phones (API 26+)

### Phase 3: Test Matrix
| Test | Device A | Device B | Expected Result |
|------|----------|----------|-----------------|
| Phone-to-Phone | Consumer Wallet (HCE) | Merchant App (Reader) | Transaction initiated, M-Pesa STK Push sent |
| Tag Read | NTAG 215/216 | Merchant App | Tag signature verified, payment initiated |
| P2P Transfer | Consumer Wallet (HCE) | Consumer Wallet (Reader) | P2P token exchange, backend settlement |

---

## 8. SECURITY CONSIDERATIONS

**Current State:** NOT PRODUCTION READY
- JWT secrets in `.env` are test-only
- `ADMIN_SECRET` not configured in K8s manifests (Known Production Gap #2)
- HCE tokens use 128-bit entropy (UUID v4)
- No rate limiting on HCE token generation observed

**Required Before Prod:**
1. CBK PSP license application
2. Fix K8s manifest gaps (DARAJA_CALLBACK_URL vs BASE_URL, missing secrets)
3. Dependency audit (28 npm vulnerabilities detected)
4. TLS certificate pinning verification

---

## 9. DECISION LOG

**2026-07-23 00:30:** Repository cloned to Windows environment  
**2026-07-23 00:45:** PostgreSQL 18 and Redis 5.0.14.1 infrastructure established  
**2026-07-23 01:00:** Backend API operational on :3000  
**2026-07-23 01:15:** APDU instruction mismatch identified (C0/C1 vs 80/81)  
**2026-07-23 01:25:** Database migrations applied (4 files)  
**2026-07-23 02:00:** Test merchants created and approved  
**2026-07-23 13:00:** Valid HCE token generated: `8a49f3af-dd09-4af4-b054-806a17d336ce`  
**2026-07-23 13:15:** **MILESTONE:** Backend fully operational, ready for Android APDU fix

---

## 10. IMMEDIATE NEXT STEPS

1. **Fix APDU Protocol** (sed commands in Section 7)
2. **Build Android APKs** (Android Studio)
3. **Execute Phone-to-Phone Tap Test**
4. **Log Results** (success/failure with APDU hex dumps)
5. **Update This Document** with test results

---

**END OF HANDOVER**

*Next Update: Post-APDU fix and NFC tap test results*
```

**Save this file to:** `OrchestratePay_Platform/docs/SESSION_HANDOVER_20260723.md`

**Then execute the APDU fix when ready:**
```bash
cd ~/Desktop/projects/colab\ project/OrchestratePay_Platform

sed -i 's/0xC0.toByte()/0x80.toByte()/g' Tap2Pay/android/app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt
sed -i 's/0xC1.toByte()/0x81.toByte()/g' Tap2Pay/android/app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt
```

**Report back once you've applied the fix and are ready to build the Android apps.**
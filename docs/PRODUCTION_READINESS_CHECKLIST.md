# PRODUCTION READINESS CHECKLIST
**Project:** OrchestratePay Platform  
**Last Updated:** 27 July 2026  
**Status:** 🟡 CODE COMPLETE - NFC Testing & Infrastructure Pending

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
| 1 | **APDU Protocol** | `NfcReaderManager.kt:255,271` | 0xC0→0x80, 0xC1→0x81 | 16e333c | ✅ FIXED |
| 2 | **Thread Safety** | `ConsumerHceService.kt:47` | AtomicReference | 8ef53d8 | ✅ FIXED |
| 3 | **TTL Consistency** | `ConsumerHceService.kt:44` | 60s→90s | 36a9c5c | ✅ FIXED |
| 4 | **SDK Version** | `build.gradle.kts` | 34→35 | 186521c | ✅ FIXED |
| 5 | **Google Services** | `build.gradle.kts` | Disabled for testing | 3dad4ce | ✅ FIXED |
| 6 | **Missing Layout** | `activity_consumer_tag_writer.xml` | Created | 3525e52 | ✅ FIXED |

**Total: 13 commits ahead of upstream. Android build now compiles successfully.**

---

## ✅ COMPLETED (Infrastructure & Verification)

| Component | Status | URL | Verification |
|-----------|--------|-----|--------------|
| PostgreSQL 18 | ✅ | localhost:5432 | 4 migrations applied |
| Redis 5.0.14.1 | ✅ | localhost:6379 | PONG verified |
| Backend API | ✅ | :3000 | Health check OK, login working |
| Web Frontend | ✅ | :3001 | Merchant/Consumer portals accessible |
| Android Build | ✅ | - | Gradle sync successful, APK compiles |
| Test Accounts | ✅ | - | Merchant & Consumer created |
| Documentation | ✅ | docs/ | 5 comprehensive files created |

---

## ⚠️ PENDING (NFC Hardware Required)

| # | Item | Status | Blocker | Success Criteria |
|---|------|--------|---------|------------------|
| 7 | **Phone-to-Phone NFC** | ⏸️ BLOCKED | Awaiting 2nd phone | APDU exchange: SELECT→GET DATA→CONFIRM |
| 8 | **NFC Tag Read** | ⏸️ BLOCKED | Awaiting NTAG215 | Tag signature verified, STK Push sent |
| 9 | **P2P Transfer** | ⏸️ BLOCKED | Awaiting 2nd phone | Token exchange, backend settlement |
| 10 | **APDU Log Capture** | ⏸️ BLOCKED | Awaiting test | Logcat shows 0x80/0x81 instructions |

**Status:** Code is ready. Hardware availability is the only blocker.

---

## ⚠️ PENDING (Security Hardening - No Hardware Needed)

| # | Item | Severity | Effort | Action | Risk if Delayed |
|---|------|----------|--------|--------|-----------------|
| 11 | **JWT Secret** | 🔴 CRITICAL | 5 min | `openssl rand -hex 64` → `.env` | Token forgery possible |
| 12 | **Database SSL** | 🔴 CRITICAL | 10 min | Add `sslmode=require` | MITM attacks |
| 13 | **Rate Limiting** | 🟡 MEDIUM | 30 min | Add to `/merchant-hce-token` | DoS via token generation |
| 14 | **P2P Timeout** | 🟢 LOW | 15 min | Add 5min TTL to `P2PHceSession` | Mode confusion |
| 15 | **NPM Audit** | 🟡 MEDIUM | 2-4 hrs | Upgrade Sentry 8.x→10.x | Memory exhaustion DoS |

**Recommendation:** Complete #11-14 now. Save #15 (Sentry upgrade) for AFTER NFC testing (breaking change could disrupt debugging).

---

## ⚠️ PENDING (Infrastructure)

| # | Item | Severity | Blocker | Action |
|---|------|----------|---------|--------|
| 16 | **K8s Manifests** | 🔴 CRITICAL | None | Fix `DARAJA_CALLBACK_URL` → `BASE_URL` |
| 17 | **Secrets Mgmt** | 🔴 CRITICAL | None | Add `ADMIN_SECRET`, `NFC_SIGNING_SECRET` |
| 18 | **Redis HA** | 🟡 MEDIUM | Budget | Document: Single node OK for MVP |
| 19 | **PG Backups** | 🔴 CRITICAL | CBK | 7-year retention (legal requirement) |
| 20 | **TLS Pins** | 🟡 MEDIUM | ✅ Ready | ISRG Root X1/X2 configured |

---

## ⚠️ PENDING (Compliance)

| # | Item | Severity | Blocker | Timeline |
|---|------|----------|---------|----------|
| 21 | **CBK PSP License** | 🔴 CRITICAL | Application | 3-6 months (START NOW) |
| 22 | **KRA eTIMS** | 🟡 MEDIUM | Prod cert | 2-4 weeks (code ready) |
| 23 | **Data Protection** | 🟡 MEDIUM | Lawyer | Privacy policy needed |

---

## 🔴 CRITICAL PATH TO PRODUCTION

**Phase 1: Immediate (Today)**
```bash
# 1. Generate production JWT secret
openssl rand -hex 64

# 2. Fix K8s manifests
sed -i 's/DARAJA_CALLBACK_URL/DARAJA_CALLBACK_BASE_URL/g' infra/k8s/backend/deployment.yaml

# 3. Add secrets template
cat >> infra/k8s/secrets.template.yaml << 'SECRETS'
ADMIN_SECRET: <64-char-random>
NFC_SIGNING_SECRET: <64-char-random>
SECRETS

# 4. Start CBK license application (longest lead time)
Phase 2: NFC Testing (When 2nd Phone Available)

Connect Phone A and Phone B to Android Studio
Build and install debug APKs
Execute test protocol (see ANDROID_NFC_TESTING_PROTOCOL.md)
Capture APDU logs
Phase 3: Post-Test

Create PR to upstream (gabrielngige/OrchestratePay_Platform)
Staging deployment
Load testing with k6/Artillery
Production deployment
📊 RISK ASSESSMENT
Risk	Likelihood	Impact	Mitigation
NFC test fails	Medium	High	APDU fix verified in code, but hardware test needed
CBK license delay	High	Critical	Start application immediately (3-6 months)
Sentry upgrade breaks logging	Medium	Medium	Defer until after NFC testing
iOS users excluded	Certain	Medium	QR fallback documented and implemented
🎯 IMMEDIATE NEXT ACTIONS
You Can Do Right Now (No Hardware):

✅ Generate JWT secret (5 min)
✅ Fix K8s manifest typos (10 min)
✅ Start CBK license application (3-6 month process)
Requires 2nd NFC Phone:
4. ⏸️ Build and install APKs
5. ⏸️ Execute NFC Phone-to-Phone test
6. ⏸️ Verify APDU exchange in logcat

DECISION LOG
Date	Decision	Impact
2026-07-23	Repository cloned	Project start
2026-07-23	APDU mismatch identified	Root cause found
2026-07-23	3 critical bugs fixed	Core functionality restored
2026-07-27	SDK 35 update	Build compatibility fixed
2026-07-27	Layout file created	ConsumerTagWriterActivity compiles
2026-07-27	13 commits ahead, build successful	Ready for NFC hardware test
END OF CHECKLIST
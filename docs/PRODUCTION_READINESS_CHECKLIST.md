# PRODUCTION READINESS CHECKLIST
**Project:** OrchestratePay Platform  
**Last Updated:** 24 July 2026  
**Status:** 🟡 CODE COMPLETE - Infrastructure & Compliance Pending

---

## ✅ COMPLETED (Code & Documentation)

| Item | Commit | Status |
|------|--------|--------|
| APDU Instruction Fix | 16e333c | ✅ MERCHANT terminal sends 0x80/0x81 |
| Thread Safety (HCE) | 8ef53d8 | ✅ AtomicReference implemented |
| TTL Consistency | 36a9c5c | ✅ 90s token expiry |
| iOS Strategy | 8f4a279 | ✅ QR fallback documented |
| Security Audit | de2c160 | ✅ 19 vulnerabilities documented |
| System Verification | - | ✅ Merchant login, dashboard, APIs working |

**10 commits ahead of upstream.** All code fixes done.

---

## ⚠️ PENDING (No NFC Hardware Required)

### A. SECURITY HARDENING (Can do now)

| # | Item | Severity | Effort | Action |
|---|------|----------|--------|--------|
| 1 | **JWT Secret** | 🔴 CRITICAL | 5 min | Generate: `openssl rand -hex 64` → update `.env` |
| 2 | **Database SSL** | 🔴 CRITICAL | 10 min | Add `sslmode=require` to DATABASE_URL |
| 3 | **Rate Limiting** | 🟡 MEDIUM | 30 min | Add `express-rate-limit` to `/merchant-hce-token` |
| 4 | **P2P Timeout** | 🟢 LOW | 15 min | Add 5min TTL to `P2PHceSession.kt` |
| 5 | **NPM Audit** | 🟡 MEDIUM | 2-4 hrs | Upgrade Sentry (breaking change - test after NFC) |

**Recommendation:** Do #1-4 now. Save #5 (Sentry upgrade) for AFTER NFC testing (could break error logging).

---

### B. INFRASTRUCTURE (K8s/Prod)

| # | Item | Severity | Blocker | Action |
|---|------|----------|---------|--------|
| 6 | **K8s Manifests** | 🔴 CRITICAL | None | Fix `DARAJA_CALLBACK_URL` → `BASE_URL` in `infra/k8s/backend/deployment.yaml` |
| 7 | **Secrets** | 🔴 CRITICAL | None | Add `ADMIN_SECRET`, `NFC_SIGNING_SECRET` to `secrets.template.yaml` |
| 8 | **Redis HA** | 🟡 MEDIUM | Budget | Document: Single node OK for MVP, Sentinel for HA |
| 9 | **PG Backups** | 🔴 CRITICAL | CBK | Configure 7-year retention (legal requirement) |

---

### C. COMPLIANCE (Legal/Regulatory)

| # | Item | Severity | Blocker | Timeline |
|---|------|----------|---------|----------|
| 10 | **CBK PSP License** | 🔴 CRITICAL | Application | 3-6 months (start NOW) |
| 11 | **KRA eTIMS Cert** | 🟡 MEDIUM | Prod cert | 2-4 weeks (code ready) |
| 12 | **Data Protection** | 🟡 MEDIUM | Lawyer | Privacy policy, consent UI |

---

## 🔴 CRITICAL PATH TO PRODUCTION

**Without NFC Test:**
1. ✅ Code fixes (DONE)
2. ⚠️ JWT Secret + DB SSL (DO NOW - 15 min)
3. ⚠️ K8s manifest fixes (DO NOW - 30 min)
4. 🔴 CBK License Application (START NOW - 3-6 month wait)
5. 🔴 NFC Phone-to-Phone Test (BLOCKED - get 2nd phone)

**With NFC Test Success:**
6. PR to upstream (junior dev's repo)
7. Staging deployment
8. Load testing
9. Production deployment

---

## WHAT TO DO RIGHT NOW (No NFC Phone Needed)

```bash
# 1. Generate production JWT secret (DO THIS)
openssl rand -hex 64

# 2. Fix K8s manifests
sed -i 's/DARAJA_CALLBACK_URL/DARAJA_CALLBACK_BASE_URL/g' infra/k8s/backend/deployment.yaml

# 3. Add secrets to template
cat >> infra/k8s/secrets.template.yaml << 'SECRETS'
ADMIN_SECRET: <64-char-random>
NFC_SIGNING_SECRET: <64-char-random>
SECRETS

# 4. Update .env for SSL
echo "DATABASE_URL=postgresql://orchestratepay:devpassword@localhost:5432/orchestratepay?sslmode=require" >> .env
DECISION LOG
Date	Decision
2026-07-23	All NFC code fixes complete. System verified working.
2026-07-24	Consumer login uses email/password (not phone/pin) - UI verified.
2026-07-24	Status: 10 commits ahead. Ready for infrastructure hardening.
END OF CHECKLIST

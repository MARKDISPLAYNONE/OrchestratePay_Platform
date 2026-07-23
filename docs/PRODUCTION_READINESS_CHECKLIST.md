# PRODUCTION READINESS CHECKLIST
**Project:** OrchestratePay Platform  
**Last Updated:** 23 July 2026  
**Status:** 🔴 NOT READY (Security patches required)

---

## 1. SECURITY [IN PROGRESS]

| Item | Severity | Status | Action Required | Owner |
|------|----------|--------|-----------------|-------|
| NPM Audit (OpenTelemetry) | Medium | ⚠️ PENDING | Upgrade @sentry/node to 10.67.0, test breaking changes | TBD |
| JWT Secret Strength | Critical | ⚠️ PENDING | Generate 64-byte hex secret, rotate keys | TBD |
| Database SSL | Critical | ⚠️ PENDING | Enable PostgreSQL SSL mode (require) | TBD |
| HCE Rate Limiting | Medium | ⚠️ PENDING | Add 10 req/min limit on /merchant-hce-token | TBD |
| NFC APDU Encryption | Low | ✅ ACCEPTED | Document risk: plaintext over air, mitigated by short TTL | Senior Dev |
| Thread Safety (HCE) | Medium | ⚠️ PENDING | Make sessionPayload volatile/AtomicReference | TBD |
| P2P Timeout | Low | ⚠️ PENDING | Add 5min timeout to P2PHceSession | TBD |

---

## 2. INFRASTRUCTURE [PENDING]

| Item | Severity | Status | Notes |
|------|----------|--------|-------|
| K8s Manifests | Critical | ⚠️ PENDING | Fix DARAJA_CALLBACK_URL → BASE_URL mismatch |
| Secrets Management | Critical | ⚠️ PENDING | Add ADMIN_SECRET, NFC_SIGNING_SECRET to k8s |
| Redis HA | Medium | ⚠️ PENDING | Configure Sentinel or Cluster for production |
| PostgreSQL Backups | Critical | ⚠️ PENDING | 7-year retention (CBK requirement) |

---

## 3. COMPLIANCE [PENDING]

| Item | Severity | Status | Notes |
|------|----------|--------|-------|
| CBK PSP License | Critical | ⚠️ PENDING | Required before live M-Pesa |
| KRA eTIMS Integration | High | ✅ READY | Code implemented, needs production cert |
| PCI-DSS | Low | ✅ N/A | Closed-loop wallet avoids card data |

---

## 4. TESTING [IN PROGRESS]

| Item | Status | Notes |
|------|--------|-------|
| NFC Phone-to-Phone | ⏸️ BLOCKED | Awaiting second NFC phone |
| Load Testing | ⚠️ PENDING | Need k6/Artillery scripts |
| Penetration Testing | ⚠️ PENDING | Hire third-party for NFC sniffing test |

---

## DECISION LOG

**2026-07-23:** Security audit completed. 19 NPM vulnerabilities remain (OpenTelemetry chain). NFC plaintext transmission accepted as low risk due to token TTL.

---

**SIGN-OFF REQUIRED:**
- [ ] Security Lead
- [ ] Backend Lead  
- [ ] Compliance Officer

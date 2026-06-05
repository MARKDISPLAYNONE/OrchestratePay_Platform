---
name: orchestratepay-payments-domain
description: >
  Authoritative reference for the financial and regulatory domain that OrchestratePay
  operates in. Covers M-Pesa STK Push lifecycle and integration patterns, transaction
  status machine (PENDING → STK_SENT → CONFIRMED/DECLINED/FAILED), CBK Kenya regulations
  (KYC tiers, daily spend limits, AML obligations), PCI DSS scope assessment for this
  platform, idempotency invariants, settlement and reconciliation concepts, KRA fiscal
  receipt requirements, and amounts-in-cents handling. Use this skill when implementing
  any payment flow change, assessing compliance impact of a new feature, debugging a
  stuck or duplicate transaction, understanding why a payment was declined, or evaluating
  the security implications of storing or transmitting financial data.
---

# OrchestratePay — Payments Domain

## M-Pesa STK Push lifecycle

```
Terminal taps consumer tag / QR / HCE phone
  │
  ▼
POST /api/v1/transactions  (idempotencyKey in header)
  │
  ├─ Backend validates → INSERT INTO transactions (status=PENDING)
  │
  ▼
POST https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest
  │  (Daraja API — OAuth2 bearer token, auto-refreshed every ~55 min)
  │
  ▼
Safaricom delivers STK Push to consumer's phone
  status → STK_SENT (backend updates DB)
  │
  ├─ Consumer enters correct M-Pesa PIN → Safaricom fires callback
  │       status → CONFIRMED  (mpesaRef set to e.g. "ODE3K5Z8")
  │
  ├─ Consumer cancels or enters wrong PIN 3× → callback arrives
  │       status → DECLINED
  │
  └─ No callback within ~5 min → reconciliation job sets status → FAILED
```

### Status machine
| Status | Meaning | Terminal action |
|---|---|---|
| `PENDING` | DB record created, STK not yet dispatched | Poll every 2.5 s |
| `STK_SENT` | STK prompt delivered to consumer phone | Poll / wait for WS push |
| `CONFIRMED` | Consumer entered PIN, Safaricom confirmed | Show success, print receipt |
| `DECLINED` | Consumer cancelled or PIN incorrect | Show failure, allow retry |
| `FAILED` | No callback received — timeout/Safaricom error | Show failure |

**Terminal-side rule**: stop polling when status is `CONFIRMED`, `DECLINED`, or `FAILED` — these are terminal states. `PENDING` and `STK_SENT` require continued polling.

### Idempotency invariant
The `Idempotency-Key` header (32-char hex UUID) prevents duplicate STK Pushes on network retry. Backend caches the result in Redis:
- PENDING result: cached 120 s
- CONFIRMED result: cached 3600 s

If the same key is submitted again within the cache window, the original response is returned — Daraja is **never called twice** for the same idempotency key.

**Invariant**: generate one key per tap. Never generate a new key on retry — reuse the original.

### Daraja integration details
- OAuth2 token: `GET /oauth/v1/generate?grant_type=client_credentials` with Basic auth
- Token cached in Redis at key `daraja:token`, TTL = `expires_in - 100` seconds
- Callback URL: `DARAJA_CALLBACK_BASE_URL/api/v1/mpesa-callback` — must be reachable from Safaricom's IPs
- Safaricom egress IPs are allowlisted via `middleware/safaricom-ip.ts` — any callback from outside those 12 IPs is rejected with 403
- `BusinessShortCode` = `DARAJA_SHORTCODE` env var
- `TransactionType` = `CustomerPayBillOnline`

### Phone number format
All phone numbers stored and transmitted in E.164 format: `254XXXXXXXXX` (12 digits, no `+`).
```
User input "0712345678"  →  "254712345678"
User input "+254712345678" → "254712345678"
```
The STK Push `PartyA` (consumer phone) must be in this format or Daraja returns an error.

## Amounts — always in cents (paise equivalent)

**Rule: all amount storage and transmission uses integer cents (KSh × 100).**

```
KSh 500.00  =  50,000 cents
KSh   0.50  =      50 cents
```

Display to user: `amountCents / 100.0` formatted as `KSh %.2f`.
Never store or compare floating-point KSh values — floating-point arithmetic introduces rounding errors in financial calculations.

**FX rounding rule**: when converting foreign currency to KES, always `Math.ceil()` — round up to the nearest cent. Never truncate or round down.

## CBK Kenya regulatory compliance

### KYC tiers and daily spend limits
| Tier | Limit (KES/day) | Cents | Consumer segment |
|---|---|---|---|
| `BASIC` | KSh 10,000 | 1,000,000 | Unverified phone-only registration |
| `ENHANCED` | KSh 100,000 | 10,000,000 | ID-verified consumers |
| `FULL` | Unlimited | ∞ | Fully KYC-verified (business/high-value) |

Limit is enforced by `util/cbk-compliance.ts` — called before dispatching the STK Push.
Daily spend is summed from `transactions.amount_cents` for CONFIRMED transactions today in `Africa/Nairobi` timezone.
Fail-safe: if the compliance check throws (DB error), the transaction is **allowed** — never block payments due to infra failures.

### KYC upgrade path
Tier upgrades are applied to `consumers.kyc_tier` column via the admin API.
`BASIC` → `ENHANCED`: requires national ID number verification
`ENHANCED` → `FULL`: requires additional business documentation

### AML obligations
- Transaction records must be retained for 7 years (CBK requirement)
- The `transactions` table is append-only — no UPDATE or DELETE on confirmed records (`immutable-ledger` pattern)
- Suspicious transactions flagged by the fraud engine (REVIEW decision) must be accessible for audit
- CBK expects transaction reports on demand — the Z-report (`GET /merchants/me/z-report`) supports daily summaries

## PCI DSS scope

OrchestratePay's PCI DSS scope is **narrow** because card numbers are never handled:

| Data type | Handled? | Stored? | Notes |
|---|---|---|---|
| M-Pesa phone numbers | Yes | Yes | Not card data; falls under PDPA Kenya |
| M-Pesa PINs | No | No | Entered directly on consumer's phone via STK Push |
| Card numbers (PAN) | No | No | Out of scope entirely (M-Pesa only) |
| CVV/CVV2 | No | No | Out of scope |
| JWT tokens | Yes | Android EncryptedSharedPreferences | In-transit only; not card data |
| NFC signing key | Yes | Android EncryptedSharedPreferences | Merchant-scoped HMAC key |

**Implication**: The platform falls under SAQ A-EP (or lighter) rather than SAQ D because consumers enter PINs on Safaricom's own STK prompt, not in our app. No card data ever transits OrchestratePay servers.

**What this means for code**:
- HTTP logging must be `Level.NONE` in release builds (phone numbers in request bodies are PII)
- JWT tokens must never appear in application logs
- `NFC_SIGNING_SECRET` is a production secret — rotate it only with a tag re-programming window
- Consumer phone numbers must be masked in logs: `254712****78` (see `util/africas-talking.ts:maskPhone`)

## Fiscal receipts (KRA requirement)

Kenyan merchants are required to issue KRA-compliant receipts. The receipt must include:
- Merchant KRA PIN (stored in `merchants.kra_pin`, returned in login response as `kraPin`)
- Transaction amount (KES, formatted to 2 decimal places)
- M-Pesa receipt reference (`mpesaRef`, e.g. `ODE3K5Z8`)
- Timestamp (Nairobi timezone)
- Merchant name and location

The KRA PIN is fetched from the DB at login and cached in `SessionManager` — it should appear on every printed or SMS receipt.

## Settlement and reconciliation

M-Pesa settles to the merchant's registered M-Pesa account (linked to the shortcode) on a T+1 basis. OrchestratePay's reconciliation job (`jobs/reconciliation.ts`, runs every 5 min) handles the following:
- STK_SENT transactions with no callback after timeout → FAILED
- Mismatches between Safaricom's records and local DB are flagged in logs
- The `GET /admin/stats` endpoint exposes unreconciled counts for ops monitoring

**The ledger is immutable**: CONFIRMED transactions are never modified. If a dispute arises, a separate `refunds` record is created — never an UPDATE to the original transaction.

## Common payment failure patterns

| Symptom | Root cause | Resolution |
|---|---|---|
| `INSUFFICIENT_FUNDS` in Daraja response | Consumer M-Pesa balance too low | Inform consumer; no retry |
| `THE_INITIATOR_INFORMATION_IS_INVALID` | Wrong `DARAJA_SHORTCODE` or `DARAJA_PASSKEY` | Check env vars; verify sandbox vs production |
| Callback never arrives | `DARAJA_CALLBACK_BASE_URL` not reachable from Safaricom IPs | Check firewall/allowlist; use ngrok in dev |
| Duplicate STK Push sent | New idempotency key generated on retry | Reuse original key on every retry attempt |
| Transaction stuck as PENDING | Reconciliation job not running | Check cron job logs; verify Redis is up |
| CBK limit error | Consumer at daily spend limit | Inform consumer; suggest KYC upgrade |
| Fraud DECLINE on legitimate payment | Score thresholds too tight | Review `FRAUD_VELOCITY_MAX_TXNS`; check merchant average for Rule 2 |

## See also
- `orchestratepay-daraja` — detailed Daraja API integration and OAuth management
- `orchestratepay-cbk-compliance` — KYC tier enforcement implementation
- `orchestratepay-fraud-scoring` — fraud rule tuning and REVIEW/DECLINE decisions
- `orchestratepay-reconciliation` — stuck transaction recovery and ledger integrity
- `orchestratepay-tap-latency-budget` — payment timing targets and p95 budget

# OrchestratePay — All 11 Payment Interaction Scenarios

This skill covers every way a payment can be initiated on the OrchestratePay platform.
Use it when diagnosing a broken interaction, adding a new one, or understanding the
relationship between Android components, backend endpoints, and Redis/DB state.

---

## Quick Reference Matrix

| # | Name | Initiator | Channel | Source value | Status |
|---|------|-----------|---------|--------------|--------|
| 1 | Consumer taps merchant NTAG215 sticker | Consumer | NFC NDEF | `NFC_TAG` | ✅ Working |
| 2 | Merchant reads consumer NTAG215 sticker | Merchant | NFC NDEF | `CONSUMER_TAG` | ✅ Fixed |
| 2b| Same as #2 via CONSUMER_QR (QR variant) | Merchant | QR scan | `CONSUMER_QR` | ✅ Fixed |
| 3 | Consumer phone → Sunmi terminal (HCE) | Consumer | ISO-DEP HCE | `HCE_PHONE` | ✅ Working |
| 4 | Consumer phone → SoftPOS merchant phone | Consumer | ISO-DEP HCE | `SOFTPOS_MOBILE` | ✅ Working |
| 5 | Merchant phone → consumer reads merchant HCE | Consumer | ISO-DEP HCE | `MERCHANT_HCE` | ✅ Built |
| 6 | Consumer A taps B's phone (B is payee) | Payer (A) | ISO-DEP HCE | `P2P_NFC` | ✅ Built |
| 7 | Consumer B taps A's phone (A is payee) | Payer (B) | ISO-DEP HCE | `P2P_NFC` | ✅ Built |
| 8 | Consumer scans merchant QR code | Consumer | QR | `QR_CODE` | ✅ Working |
| 9 | Merchant scans consumer QR code | Merchant | QR | `CONSUMER_QR` | ✅ Built |
|10 | Consumer A scans B's QR (B is payee) | Payer (A) | QR | `P2P_QR` | ✅ Built |
|11 | Consumer B scans A's QR (A is payee) | Payer (B) | QR | `P2P_QR` | ✅ Built |

---

## AID & APDU Protocol (all NFC HCE scenarios)

All HCE interactions use the same proprietary AID: **`F0 4F 52 43 48 45 53 54 41`**

Readers distinguish payload type via the `"type"` field in the JSON response:

| `type` value | Scenario | Reader |
|---|---|---|
| `CONSUMER_PAYMENT` | 3, 4 | `NfcReaderManager` / `SoftPosOrchestrator` (merchant app) |
| `MERCHANT_REQUEST` | 5 | `MerchantHceReader` (consumer-wallet) |
| `P2P_REQUEST` | 6, 7 | `ConsumerP2PReader` (consumer-wallet) |

### APDU sequence (all modes)
```
→ SELECT AID  (CLA=00 INS=A4 P1=04 P2=00 Lc=09 AID Le=00)
← 90 00

→ GET DATA    (CLA=80 INS=C0 P1=00 P2=00 Le=00)
← <JSON bytes> 90 00

→ CONFIRM     (CLA=80 INS=C1 P1=00 P2=00 Le=00)
← 90 00          ← clears the session (single-use)
```

---

## Scenario 1 — Consumer taps merchant NTAG215 sticker

**Flow:**
1. NTAG215 sticker encodes `https://orchestratepay.co.ke/pay/{merchantId}` as NDEF URL
2. Android opens the URL in the consumer's browser / wallet web view
3. Consumer sees merchant name + enters amount
4. Browser calls `POST /api/v1/consumers/pay/{merchantId}` with consumer JWT
5. Backend fires STK Push to consumer's phone
6. Consumer enters M-Pesa PIN → callback → `CONFIRMED`

**Key files:**
- `GET /api/v1/consumers/pay/:merchantId` — public endpoint, returns merchant name
- `POST /api/v1/consumers/pay/:merchantId` — `consumers.ts`, source hardcoded `QR_CODE`
- Schema: `consumerPaySchema` in `consumers.ts`

---

## Scenario 2 — Merchant reads consumer NTAG215 sticker

**Flow:**
1. Consumer's NTAG215 sticker encodes `https://orchestratepay.co.ke/c/{consumerId}` as NDEF URL
2. Merchant app (`NfcTagPaymentActivity`) reads the NDEF URL, extracts `consumerId`
3. Merchant app calls `GET /api/v1/consumers/c/{consumerId}` (merchant JWT) → gets `maskedPhone` + `displayName`
4. Merchant enters amount on dashboard, taps "Charge"
5. Merchant app calls `POST /api/v1/transactions` with `source=CONSUMER_TAG`, `consumerTagId={consumerId}`
6. Backend looks up consumer by ID, fires STK Push to their phone

**Key fix (was broken):** `CONSUMER_TAG` was missing from `transactions_source_check` DB constraint.
Added in `migrate.ts` as a non-destructive `ALTER TABLE … DROP CONSTRAINT / ADD CONSTRAINT`.

**Key files:**
- `GET /api/v1/consumers/c/:consumerId` — `consumers.ts`, requires merchant JWT
- `POST /api/v1/transactions` — `transactions.ts`, `consumerTagId` branch at line ~218
- `migrate.ts` — `transactions_source_check` constraint

---

## Scenario 3 — Consumer phone taps Sunmi terminal (HCE)

**Flow:**
1. Consumer opens wallet app → `ConsumerHceService` is registered as default payment app
2. Consumer taps phone to Sunmi P2 Pro NFC reader
3. Terminal sends SELECT AID → GET DATA → receives `CONSUMER_PAYMENT` payload
4. Terminal calls `POST /api/v1/transactions` with `source=HCE_PHONE`, `consumerPhone`, `hceToken`, `hceExp`
5. Backend verifies HMAC token via `verifyHceToken()`, fires STK Push

**Key files:**
- `ConsumerHceService.kt` (consumer-wallet) — emits `CONSUMER_PAYMENT` payload
- `NfcReaderManager` / `ApduProtocol` (Sunmi terminal SDK) — reads APDU
- `verifyHceToken()` — `backend/src/util/hce-token.ts`
- `transactions.ts` — `HCE_PHONE` branch

---

## Scenario 4 — Consumer phone taps SoftPOS merchant phone

Same HCE flow as Scenario 3 but the reader is another Android phone running SoftPOS mode.

**Key difference from #3:**
- Source: `SOFTPOS_MOBILE` instead of `HCE_PHONE`
- Ghost merchant check: Play Integrity attestation must be fresh (< 24h) — see `transactions.ts` lines ~98–125
- `deviceType` in body must be `SOFTPOS_MOBILE`

**Key files:**
- `SoftPosOrchestrator.kt` (merchant app) — reads APDU from consumer phone
- `transactions.ts` — `SOFTPOS_MOBILE` attestation check block

---

## Scenario 5 — Consumer wallet reads merchant phone HCE

The direction is reversed: **merchant activates HCE, consumer reads it.**

**Flow:**
1. Merchant enters amount on `MerchantDashboardActivity`, taps "Present to Customer"
2. Merchant app calls `POST /api/v1/transactions/merchant-hce-token` → gets signed UUID token (60s TTL)
3. Merchant app calls `MerchantHceSession.activate(Session(...))` in memory
4. `OrchestrateHceService` (merchant app) reads from `MerchantHceSession` and emits `MERCHANT_REQUEST` payload
5. Consumer opens `MerchantHcePayActivity`, taps their phone to merchant's phone
6. `MerchantHceReader.read(tag)` sends APDU sequence, verifies `type == "MERCHANT_REQUEST"`, returns `MerchantPaymentRequest`
7. Consumer sees amount + merchant name → taps Confirm
8. Consumer wallet calls `POST /api/v1/consumers/pay/{merchantId}` with `merchantHceToken`
   *(The consumer endpoint re-uses `/consumers/pay/:merchantId` — `source` and `merchantHceToken` are extra fields)*
   
   **Wait** — actually the consumer wallet calls `POST /api/v1/transactions` is wrong. Looking at `MerchantHcePayActivity`:
   it calls `ConsumerApiClient.payMerchantViaHce(merchantId, ...)` which posts to
   `POST /api/v1/consumers/pay/{merchantId}` with `source=MERCHANT_HCE` and `merchantHceToken`.
   
   The backend `/consumers/pay/:merchantId` handler currently hardcodes `source='QR_CODE'`.
   To support `MERCHANT_HCE` from the consumer side, the consumer pay endpoint would need updating,
   OR `MerchantHcePayActivity` should post directly to `/transactions` with the merchant JWT.
   
   **Actual implementation:** `MerchantHcePayActivity` calls `ConsumerApiClient.payMerchantViaHce`
   which posts to `/consumers/pay/{merchantId}` with `PayMerchantViaHceRequest` (source=MERCHANT_HCE).
   The `/consumers/pay/:merchantId` route needs to be updated to accept `source` + `merchantHceToken`
   from the body and route accordingly. That route currently hardcodes source as `'QR_CODE'`.

**Token Redis key:** `merchant:hce:{token}` → `{merchantId, merchantName, amountCents, exp}` — 60s TTL

**Key files:**
- `MerchantHceSession.kt` (merchant app hce/) — `@Volatile` singleton
- `OrchestrateHceService.kt` (merchant app hce/) — emits `MERCHANT_REQUEST` payload
- `MerchantHceReader.kt` (consumer-wallet nfc/) — reads APDU from merchant phone
- `MerchantHcePayActivity.kt` (consumer-wallet ui/) — confirmation + payment UI
- `transactions.ts` — `POST /transactions/merchant-hce-token` endpoint
- `transactions.ts` — `MERCHANT_HCE` consumer resolution branch

---

## Scenario 6 & 7 — P2P NFC (consumer-to-consumer)

Scenarios 6 and 7 are the same mechanism — one consumer is payee (activates HCE), the other is payer (reads it).

**Payee flow (P2PSendActivity):**
1. Payee opens `P2PSendActivity`, optionally enters preset amount
2. App calls `POST /api/v1/consumers/p2p-token` → gets UUID token (90s TTL)
3. `P2PHceSession.activate(Session(...))` stores session in memory
4. `ConsumerHceService` detects `P2PHceSession.isActive()` and emits `P2P_REQUEST` payload
5. Activity also renders the token as a QR bitmap (so either NFC or QR works)

**Payer flow (P2PPayActivity → NFC):**
1. Payer opens `P2PPayActivity`, enables NFC foreground dispatch
2. Payer taps phone to payee's phone
3. `ConsumerP2PReader.read(tag)` sends SELECT AID → GET DATA → verifies `type == "P2P_REQUEST"` → CONFIRM
4. Payer sees payee name + amount → taps Confirm
5. App calls `POST /api/v1/consumers/p2p-pay` with `source=P2P_NFC`, `p2pToken`
6. Backend resolves payee from Redis token, fires STK Push to **payer's** phone
7. Payer enters M-Pesa PIN → callback → `CONFIRMED`

**Token Redis key:** `consumer:p2p:{token}` → `{consumerId, displayName, amountCents?}` — 90s TTL

**DB rows written:**
- `transactions` — payer=consumer_id, merchant_id=PLATFORM_MERCHANT_ID, source=P2P_NFC
- `p2p_transactions` — payer_consumer_id, payee_consumer_id, transaction_id

**Key files:**
- `P2PHceSession.kt` (consumer-wallet hce/) — `@Volatile` singleton
- `ConsumerHceService.kt` (consumer-wallet hce/) — extended to emit `P2P_REQUEST` when P2PHceSession active
- `ConsumerP2PReader.kt` (consumer-wallet nfc/) — reads P2P APDU
- `P2PSendActivity.kt` (consumer-wallet ui/) — payee UI
- `P2PPayActivity.kt` (consumer-wallet ui/) — payer NFC UI
- `consumers.ts` — `POST /consumers/p2p-token` and `POST /consumers/p2p-pay`
- `validate.ts` — `p2pPaySchema`

---

## Scenario 8 — Consumer scans merchant QR code

**Flow:**
1. Merchant generates a QR code encoding `https://orchestratepay.co.ke/pay/{merchantId}`
2. Consumer scans QR with their wallet app or phone camera
3. Web/app loads payment page via `GET /api/v1/consumers/pay/{merchantId}` (public)
4. Consumer enters amount → `POST /api/v1/consumers/pay/{merchantId}` with consumer JWT
5. STK Push to consumer → PIN → CONFIRMED

**Key files:**
- `GET /api/v1/consumers/pay/:merchantId` — public, returns merchant name
- `POST /api/v1/consumers/pay/:merchantId` — authenticated consumer endpoint, `consumers.ts`

---

## Scenario 9 — Merchant scans consumer QR code

Consumer wallet generates a short-lived QR; merchant app scans it.

**Consumer side (wallet app):**
1. Consumer opens `TapToPayFragment` → taps "Show QR"
2. `QrTokenManager.requestToken()` calls `POST /api/v1/consumers/qr-token` → UUID token (90s)
3. Token rendered as QR bitmap → displayed on screen

**Merchant side (merchant app):**
1. Merchant taps "Scan Customer QR" on `MerchantDashboardActivity`
2. `ConsumerQrScannerActivity` launches — CameraX + ML Kit barcode scanner
3. Scanner validates scanned value is UUID format, returns token via `setResult(RESULT_OK)`
4. `MerchantDashboardActivity.onActivityResult()` receives `consumerQrToken`
5. Merchant calls `PaymentOrchestrator.processConsumerQr()` →
   `POST /api/v1/transactions` with `source=CONSUMER_QR`, `consumerQrToken={token}`
6. Backend deletes Redis key `consumer:qr:{token}` (single-use), looks up consumer, fires STK Push

**Token Redis key:** `consumer:qr:{token}` → `consumerId` (plain string) — 90s TTL

**Key files:**
- `QrTokenManager.kt` (consumer-wallet payment/) — calls `/consumers/qr-token`
- `ConsumerQrScannerActivity.kt` (merchant app ui/) — CameraX scanner
- `MerchantDashboardActivity.kt` (merchant app ui/) — `onActivityResult` → `processConsumerQr()`
- `transactions.ts` — `consumerQrToken` branch at line ~171
- `consumers.ts` — `POST /consumers/qr-token`

---

## Scenario 10 & 11 — P2P QR (consumer-to-consumer)

Same token as Scenarios 6/7 but delivered via QR instead of NFC tap.

**Payee flow:** identical to Scenarios 6/7 — `P2PSendActivity` renders both QR and activates HCE simultaneously.

**Payer flow (P2PQrScannerActivity):**
1. Payer opens `P2PQrScannerActivity` (from `P2PPayActivity` "Scan QR instead" button, or wallet home)
2. CameraX + ML Kit scans QR → validates UUID → calls `onTokenScanned(token)`
3. Payer enters amount (unless payee preset it — that enforcement happens server-side)
4. App calls `POST /api/v1/consumers/p2p-pay` with `source=P2P_QR`, `p2pToken`
5. Backend resolves payee from Redis token, fires STK Push to **payer's** phone

**Amount preset enforcement:** If the payee called `POST /consumers/p2p-token` with `amountCents`,
the backend returns a 400 if the payer submits a different amount. The payer UI does not know the
preset amount in advance (we don't embed it in the QR) — the server enforces it.

**Key files:**
- `P2PSendActivity.kt` (consumer-wallet ui/) — payee shows QR
- `P2PQrScannerActivity.kt` (consumer-wallet ui/) — payer scans QR
- `consumers.ts` — `POST /consumers/p2p-pay`, amount mismatch guard

---

## Backend Environment Variables

| Variable | Required for | Description |
|---|---|---|
| `PLATFORM_MERCHANT_ID` | Scenarios 6, 7, 10, 11 | UUID of the platform's merchant record; STK Push for P2P goes to this shortcode |
| `DARAJA_CALLBACK_BASE_URL` | All scenarios | Base URL for M-Pesa STK Push callbacks |
| `PLAY_INTEGRITY_REQUIRED` | Scenario 4 | Set to `false` to skip Play Integrity check in dev |

---

## Redis Key Space

| Key pattern | TTL | Value | Used by |
|---|---|---|---|
| `consumer:qr:{token}` | 90s | `consumerId` (plain string) | Scenarios 9 |
| `consumer:p2p:{token}` | 90s | `{consumerId, displayName, amountCents?}` JSON | Scenarios 6, 7, 10, 11 |
| `merchant:hce:{token}` | 60s | `{merchantId, merchantName, amountCents, exp}` JSON | Scenario 5 |
| `idempotency:{key}` | 120s | cached response JSON | All scenarios |
| `txn:{txnId}` | 120s | `{txnId, idempotencyKey}` JSON | Polling |

All token keys are **single-use** — deleted immediately after first resolution.

---

## DB Tables

| Table | Purpose |
|---|---|
| `transactions` | Primary financial ledger; one row per M-Pesa STK Push attempt |
| `p2p_transactions` | P2P routing layer; `payer_consumer_id` + `payee_consumer_id` + FK to `transactions` |
| `consumers` | Consumer accounts; `phone` for STK Push |
| `merchants` | Merchant accounts; `PLATFORM_MERCHANT_ID` is the sentinel for P2P rows |
| `nfc_tags` | Maps NTAG215 `tag_id` → `consumer_id` |

---

## Source Enum Values (all valid values in `transactions.source`)

```sql
'NFC_TAG'        -- #1: consumer's sticker tapped by merchant terminal
'QR_CODE'        -- #8: consumer scans merchant QR (and /consumers/pay route)
'ISO_CARD'       -- future: bank card via IsoDep
'HCE_PHONE'      -- #3: consumer HCE phone tapped by Sunmi terminal
'SOFTPOS_MOBILE' -- #4: consumer HCE tapped by SoftPOS merchant phone
'CONSUMER_TAG'   -- #2: merchant reads consumer-written identity sticker
'CONSUMER_QR'    -- #9: merchant scans consumer wallet QR token
'MERCHANT_HCE'   -- #5: consumer wallet reads merchant phone HCE
'P2P_NFC'        -- #6/#7: consumer reads another consumer's P2P HCE
'P2P_QR'         -- #10/#11: consumer scans another consumer's P2P QR
```

---

## Common Failure Modes

### "QR code expired or already used"
Token was consumed by a previous scan or the 90-second TTL elapsed.
Consumer must tap "Refresh" in the wallet app to get a new token.

### "Merchant HCE session expired — merchant must re-activate"
The 60-second merchant HCE token in Redis expired before the consumer tapped.
Merchant must re-tap "Present to Customer" to issue a fresh token.

### "P2P payments temporarily unavailable"
`PLATFORM_MERCHANT_ID` env var not set or points to a missing/inactive merchant.
Configure the env var with the UUID of the platform's seeded merchant record.

### "Amount mismatch: payee requested KSh X"
Payee preset an amount in their P2P token; payer tried to send a different amount.
Payer must send the exact preset amount, or the payee must regenerate without a preset.

### NDEF tag not reading
Check that the NTAG215 sticker was written with the correct NDEF URL schema.
Consumer stickers: `https://orchestratepay.co.ke/c/{consumerId}`
Merchant stickers: `https://orchestratepay.co.ke/pay/{merchantId}`

### STK Push fires but callback never arrives
Check `DARAJA_CALLBACK_BASE_URL` is a publicly reachable HTTPS URL.
In development, use ngrok: `ngrok http 3000` and set `DARAJA_CALLBACK_BASE_URL=https://{ngrok_url}`.

---

## Adding a New Interaction Scenario

1. Pick a new `source` value string
2. Add it to `transactions_source_check` in `migrate.ts` (non-destructive ALTER TABLE)
3. Add it to `transactionSchema` in `validate.ts`
4. Add a resolution branch in `transactions.ts` (or `consumers.ts` for consumer-initiated flows)
5. Implement Android side: emitter (HCE service or QR generator) + reader (APDU or camera)
6. Update this SKILL.md

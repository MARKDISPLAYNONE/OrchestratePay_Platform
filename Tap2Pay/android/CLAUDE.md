# CLAUDE.md — Android (OrchestratePay)

This file gives the Claude Code instance in Android Studio full context to build out
the Android modules. The VS Code Claude Code instance (backend/web) maintains this file.

---

## Project Overview

OrchestratePay is a Kenyan tap-to-pay platform built on M-Pesa. The Android side has
**two apps** and **two shared libraries**:

| Module | Type | Purpose |
|---|---|---|
| `app/` | Application | Merchant terminal (Sunmi P2 Pro) — NFC reader, payment initiation |
| `consumer-wallet/` | Application | Consumer wallet — HCE card emulation, QR pay, P2P |
| `nfc-core/` | Library | Shared NDEF parsing, APDU protocol, tap feedback |
| `softpos/` | Library | SoftPOS orchestrator + Play Integrity attestation |

Open `Tap2Pay/android/` in Android Studio (Electric Eel+). Sync Gradle. Use `debug`
build variant for local dev — debug builds point to `http://10.0.2.2:3000/api/v1/`
(the Android emulator's alias for localhost).

---

## Backend API

The backend runs at `Tap2Pay/backend/`. All endpoints are prefixed `/api/v1/`.

### Authentication

```
POST /api/v1/auth/login                    → merchant JWT
POST /api/v1/auth/consumer/login           → consumer JWT
POST /api/v1/auth/consumer/register        → consumer registration
```

JWT is passed as `Authorization: Bearer <token>` on every subsequent request.
Merchant JWTs also carry an `nfcSigningKey` in the login response — this is stored
in `EncryptedSharedPreferences` via `SessionManager` and used to verify NFC tag
HMAC signatures locally before any network call.

### Merchant App Endpoints

```
POST /api/v1/transactions                  → initiate payment (NFC/QR/HCE)
  Headers: Idempotency-Key: <uuid>
  Body: { merchantId, amountCents, source, tagId?, nfcUid?, idempotencyKey,
          timestamp, consumerPhone?, hceToken?, hceExp?, consumerTagId?,
          consumerQrToken? }
  source values: "NFC_TAG" | "QR_CODE" | "HCE_PHONE" | "CONSUMER_QR" | "CONSUMER_TAG"
  Returns immediately: { status: "PENDING", txnId }
  Then poll or wait for WebSocket push.

GET  /api/v1/transactions/{txnId}/status   → poll for M-Pesa confirmation
  Returns: { status: "PENDING"|"CONFIRMED"|"DECLINED"|"FAILED", txnId, mpesaRef?,
             amountCents?, merchantName?, consumerPhone?, reason? }

GET  /api/v1/merchants/me                  → merchant profile
GET  /api/v1/merchants/me/z-report?date=   → daily Z-Report totals
POST /api/v1/devices/telemetry             → fleet heartbeat (hourly)
POST /api/v1/tags/sign                     → sign NFC sticker URI at onboarding
GET  /api/v1/loyalty/balance?consumerId=   → consumer loyalty balance

POST /api/v1/transactions/merchant-hce-token → issue 60-second HCE token
  Body: { amountCents }
  Returns: { token, merchantName, amountCents, expiresAt }
```

### Consumer Wallet Endpoints

```
GET  /api/v1/consumers/me                  → consumer profile
PUT  /api/v1/consumers/me                  → update display name / SMS opt-in
GET  /api/v1/consumers/me/transactions     → transaction history (paginated)
GET  /api/v1/consumers/me/loyalty          → loyalty balances across merchants
POST /api/v1/consumers/qr-token            → issue 90-second QR payment token
POST /api/v1/consumers/me/fcm-token        → register FCM push token
GET  /api/v1/consumers/transactions/{id}/status

GET  /api/v1/consumers/pay/{merchantId}    → merchant info (public, no auth)
POST /api/v1/consumers/pay/{merchantId}    → consumer initiates pay to merchant
  source: "NFC_TAG" (consumer sticker) | "MERCHANT_HCE" (consumer reads merchant phone)

POST /api/v1/consumers/p2p-token           → payee issues P2P token
POST /api/v1/consumers/p2p-pay             → payer sends money to payee
  source: "P2P_NFC" | "P2P_QR"
```

### WebSocket

```
wss://<host>/                              → connect with ?token=<merchantJwt>
  or with Authorization header

Server pushes: { type: "payment_update", txnId, status, mpesaRef?, amountCents?,
                 merchantName?, consumerPhone?, reason? }
```

Subscribe to a transaction by sending: `{ "subscribe": "<txnId>" }` after connect.
WebSocket is the fast path (~100ms after M-Pesa callback). HTTP polling is the
fallback (poll every 2.5s, max 37.5s).

---

## Payment Flow Invariants (CRITICAL)

These invariants are enforced on the backend. The Android app must cooperate:

1. **Idempotency key** — generate once per payment attempt, reuse on retry.
   Use the same key if the user taps "retry" for a network error.
   Format: `SHA-256(merchantId + tagId/consumerId + amountCents + truncated-timestamp)`.
   See `app/src/main/java/com/orchestratepay/payment/IdempotencyKeyGen.kt`.

2. **PENDING before STK Push** — the backend always returns `PENDING` first.
   The app must poll or listen on WebSocket for `CONFIRMED`/`DECLINED`/`FAILED`.
   Do NOT assume a 200 response means the payment succeeded.

3. **NFC signature verification** — all `NFC_TAG` reads must pass HMAC-SHA256
   verification using the `nfcSigningKey` before calling the API.
   See `NfcSignatureVerifier.kt`. Reject invalid tags with `NfcError.SIGNATURE_INVALID`.

4. **HCE token TTL** — merchant HCE tokens expire in 60 seconds, consumer QR tokens
   in 90 seconds. Check `expiresAt` before use; regenerate if expired.

5. **Offline queue** — NFC_TAG and QR payments can be queued offline (Room DB).
   HCE_PHONE cannot (token would expire before sync). The `QueueSyncService`
   flushes when connectivity is restored.

6. **Amount range** — min KSh 1 (100 cents), max KSh 1,000,000 (100,000,000 cents).
   Validate before any API call.

---

## What's Already Built

### `app/` (Merchant Terminal) — largely complete

**API & Network**
- `api/OrchestaApiClient.kt` — Retrofit singleton, all endpoints, `ApiResponse` sealed class
- Auth interceptor (auto-injects Bearer token), retry on `NetworkError`

**Payment Core**
- `payment/PaymentOrchestrator.kt` — full retry logic, WebSocket primary + polling fallback
- `payment/PaymentIntent.kt`, `PaymentResult.kt`, `PaymentSource.kt`
- `payment/IdempotencyKeyGen.kt`

**NFC**
- `nfc/NfcReaderManager.kt` — NFC reader mode, NDEF dispatch
- `nfc/NfcSignatureVerifier.kt` — HMAC-SHA256 tag validation
- `nfc/TagWriterActivity.kt` — programs NTAG215 consumer identity stickers
- `nfc/DisplayTagWriterActivity.kt` — programs merchant display tags

**HCE**
- `hce/OrchestrateHceService.kt` — HOST_APDU_SERVICE implementation
- `hce/MerchantHceSession.kt` — session state for merchant phone-as-card mode

**UI**
- `ui/LoginActivity.kt`, `ui/MerchantDashboardActivity.kt`
- `ui/ReceiptActivity.kt`, `ui/ConsumerQrScannerActivity.kt`
- Layouts: `activity_login.xml`, `activity_merchant_dashboard.xml`,
  `activity_receipt.xml`, `activity_consumer_qr_scanner.xml`

**Infrastructure**
- `db/SessionManager.kt` — EncryptedSharedPreferences JWT storage
- `db/AuditLogger.kt` — on-device audit log (Room)
- `db/ReceiptCache.kt` — last-N receipts cache
- `offline/OfflineQueue.kt`, `ConnectivityMonitor.kt`, `QueueSyncService.kt`
- `realtime/PaymentWebSocketClient.kt`
- `printer/SunmiPrinterManager.kt`
- `telemetry/DeviceTelemetryCollector.kt`, `TelemetryWorker.kt`
- `OrchestaPayApp.kt` — Application class, Sentry init

### `consumer-wallet/` — UI scaffolding complete, wiring needs review

**API & Network**
- `api/ConsumerApiClient.kt` — all consumer endpoints, P2P, HCE, QR

**HCE**
- `hce/ConsumerHceService.kt` — HCE card emulation (consumer phone-as-card)
- `hce/P2PHceSession.kt` — P2P NFC session state

**NFC**
- `nfc/ConsumerP2PReader.kt` — consumer reads other consumer's NFC for P2P
- `nfc/MerchantHceReader.kt` — consumer reads merchant's HCE token
- `nfc/ConsumerTagWriterActivity.kt`

**UI Activities & Fragments**
- `ui/LoginActivity.kt`, `ui/RegisterActivity.kt`
- `ui/HomeActivity.kt`, `ui/HomeFragment.kt`
- `ui/TapToPayFragment.kt`, `ui/TransactionHistoryFragment.kt`
- `ui/LoyaltyFragment.kt`, `ui/ProfileFragment.kt`
- `ui/NfcTagPaymentActivity.kt` — consumer taps merchant's NFC sticker
- `ui/MerchantHcePayActivity.kt` — consumer reads merchant's HCE phone
- `ui/P2PPayActivity.kt`, `ui/P2PQrScannerActivity.kt`, `ui/P2PSendActivity.kt`
- `util/BiometricGate.kt`
- `realtime/ConsumerWebSocketClient.kt`, `ConsumerNotificationService.kt`
- `payment/QrTokenManager.kt`

### `nfc-core/`
- `ApduProtocol.kt`, `NdefTagParser.kt`, `NfcPaymentReader.kt`, `TapFeedback.kt`

### `softpos/`
- `PlayIntegrityChecker.kt`, `SoftPosOrchestrator.kt`
- `SoftPosDashboardActivity.kt`, `TapGuideActivity.kt`

---

## What's Missing / Needs Building

### Priority 1 — Blockers for any end-to-end test

1. **consumer-wallet layouts** — none of the UI activities/fragments have layout XML.
   Need to create: `activity_home.xml`, `activity_login.xml`, `activity_register.xml`,
   `fragment_home.xml`, `fragment_tap_to_pay.xml`, `fragment_transaction_history.xml`,
   `fragment_loyalty.xml`, `fragment_profile.xml`, `activity_nfc_tag_payment.xml`,
   `activity_merchant_hce_pay.xml`, `activity_p2p_pay.xml`,
   `activity_p2p_qr_scanner.xml`, `activity_p2p_send.xml`.

2. **consumer-wallet build.gradle** — module needs a `build.gradle` (use `app/build.gradle`
   as reference; change `applicationId` to `com.orchestratepay.consumer`).

3. **consumer-wallet AndroidManifest wiring** — review that all activities and the
   `ConsumerHceService` are registered. Check against `app/AndroidManifest.xml` pattern.

4. **softpos build.gradle + AndroidManifest** — `softpos/` has no manifest or build file.

5. **Duplicate HCE service** — `app/` has both `OrchestaHceService.kt` and
   `OrchestrateHceService.kt`. Only `OrchestrateHceService` is registered in the
   manifest. Delete or consolidate the duplicate.

### Priority 2 — Feature gaps

6. **ViewModel layer in consumer-wallet** — activities do direct coroutine calls.
   Add `ViewModel` + `StateFlow` so UI survives rotation without re-triggering payments.
   The merchant `app/` has the same issue but it's lower priority (Sunmi is fixed-orientation).

7. **FCM push service** — `ConsumerApiClient.updateFcmToken()` is wired but there's no
   `FirebaseMessagingService` subclass to receive tokens and push notifications.
   Add `com.orchestratepay.consumer.realtime.ConsumerFcmService` and register it in
   the consumer-wallet manifest.

8. **Biometric gate integration** — `BiometricGate.kt` exists but is not called before
   high-value payments. Wire it into `TapToPayFragment` and `P2PPayActivity` for
   amounts > KSh 5,000.

9. **Loyalty redemption UI** — `LoyaltyFragment` shows balances but has no redemption
   flow. The backend has a `POST /api/v1/loyalty/redeem` endpoint (in `loyalty.ts`).

10. **Dispute filing UI** — backend has `POST /api/v1/disputes`. No consumer-wallet
    screen for it yet. Add a "Report issue" action to the transaction detail screen.

### Priority 3 — Polish

11. **Error states in consumer-wallet** — many activities likely show no error UI.
    Follow the `MerchantDashboardActivity` pattern: sealed `ScreenState` enum,
    explicit `showState()` method.

12. **nfc-core build.gradle** — if it doesn't exist, add it (library plugin, no
    `applicationId`).

13. **ProGuard rules** — `app/proguard-rules.pro` likely needs rules for Retrofit,
    Gson, Room, and Sentry. Add these before release build.

---

## Architecture Patterns to Follow

### Payment trigger pattern (merchant app)
```
UI (amount entered) → NfcReaderManager detects tap
  → PaymentOrchestrator.process(PaymentIntent, amountCents, onStkSent, onResult)
    → validates amount
    → generates idempotency key
    → writes audit event
    → calls OrchestrateApiClient.initiatePayment()
    → waits via WebSocket (primary) or polling (fallback)
    → returns PaymentResult to UI on Main thread
```

### Payment trigger pattern (consumer wallet)
```
UI (tap / QR scan / P2P) → ConsumerApiClient.payMerchant() or p2pPay()
  → backend fires STK Push
  → consumer polls ConsumerApiClient.getTransactionStatus() or listens on WebSocket
```

### Sealed result pattern
All payment operations return sealed classes. Never use nullable/boolean returns
for payment outcomes. Use:
```kotlin
sealed class PaymentResult {
    data class Success(...) : PaymentResult()
    data class Declined(val reason: String) : PaymentResult()
    data class Failed(val reason: String, val retryable: Boolean) : PaymentResult()
    object Pending : PaymentResult()
}
```

### Threading
- Network and DB calls: `Dispatchers.IO`
- UI updates: `Dispatchers.Main`
- Use `withContext()` to switch, never `runBlocking` on the Main thread
- CoroutineScope: tie to `viewModelScope` (ViewModels) or `lifecycleScope` (Activities)

---

## Build Environment

```bash
# Run JVM unit tests (no device needed)
./gradlew :app:test
./gradlew :consumer-wallet:test

# Run instrumented tests (requires emulator or device)
./gradlew :app:connectedAndroidTest

# Build debug APK
./gradlew :app:assembleDebug
./gradlew :consumer-wallet:assembleDebug

# Install on connected device/emulator
./gradlew :app:installDebug
```

Debug builds talk to `http://10.0.2.2:3000/api/v1/` — start the backend first:
```bash
cd Tap2Pay/backend && npm run dev
```

---

## Key Files Quick Reference

| File | What it does |
|---|---|
| `app/src/main/java/com/orchestratepay/api/OrchestaApiClient.kt` | All merchant API calls, `ApiResponse` sealed class |
| `app/src/main/java/com/orchestratepay/payment/PaymentOrchestrator.kt` | Full payment lifecycle |
| `app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt` | NFC tag dispatch |
| `app/src/main/java/com/orchestratepay/nfc/NfcSignatureVerifier.kt` | HMAC tag validation |
| `app/src/main/java/com/orchestratepay/hce/MerchantHceSession.kt` | Merchant phone-as-card state |
| `app/src/main/java/com/orchestratepay/ui/MerchantDashboardActivity.kt` | Main merchant screen (reference implementation) |
| `consumer-wallet/.../api/ConsumerApiClient.kt` | All consumer API calls |
| `consumer-wallet/.../hce/ConsumerHceService.kt` | Consumer HCE card emulation |
| `nfc-core/.../ApduProtocol.kt` | APDU command/response framing |
| `softpos/.../integrity/PlayIntegrityChecker.kt` | Play Integrity attestation |

---

## NFC Tap Scenarios

| # | Scenario | Who taps what | Payment path |
|---|---|---|---|
| 1 | Consumer taps merchant sticker | Consumer phone → NTAG215 | NFC_TAG → STK Push to consumer |
| 2 | Merchant scans consumer QR | Merchant camera → consumer QR | CONSUMER_QR → STK Push |
| 3 | Consumer taps to pay (HCE) | Consumer phone → merchant terminal | HCE_PHONE → consumer wallet sees token → STK Push |
| 4 | Merchant holds phone to consumer | Merchant phone (HCE) → consumer wallet | MERCHANT_HCE → STK Push |
| 5 | P2P NFC | Consumer phone → consumer phone | P2P_NFC → wallet-to-wallet |
| 6 | P2P QR | QR scan between consumers | P2P_QR → wallet-to-wallet |

---

## AID (HCE)

AID: `F04F52434845535441` — registered in `app/src/main/res/xml/apduservice.xml`
and `consumer-wallet/src/main/res/xml/apduservice.xml`.

APDU protocol details: `nfc-core/src/main/java/com/orchestratepay/nfccore/ApduProtocol.kt`

---

## Contacts / Coordination

The VS Code Claude Code instance handles:
- Backend TypeScript (`Tap2Pay/backend/src/`)
- Next.js web (`Tap2Pay/web/`)
- K8s infra (`infra/k8s/`)
- This CLAUDE.md file (kept up to date)

If you discover a missing backend endpoint or an API contract mismatch, note it
here in a "## Backend Gaps" section — the VS Code instance will pick it up.

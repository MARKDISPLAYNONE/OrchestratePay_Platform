# OrchestratePay SoftPOS

Authoritative reference for the SoftPOS module. Covers what SoftPOS is, how it differs from the Sunmi terminal app, the Play Integrity attestation flow, the payment processing pipeline, the Android module structure, and security requirements.

## What SoftPOS Is

SoftPOS ("Software Point of Sale") lets a merchant use their **own Android smartphone** as a payment terminal — no dedicated Sunmi P2 Pro hardware required. The merchant installs the SoftPOS app (`com.orchestratepay.softpos`), and their phone's NFC antenna reads the consumer's HCE-emulated card (from the consumer wallet app).

This unlocks two use cases:
1. **Low-cost onboarding** — merchants who cannot afford the Sunmi P2 Pro can accept NFC payments immediately
2. **Mobile merchants** — food vendors, market traders, and field sales who move around cannot carry a fixed terminal

The tradeoff is security: a standard Android phone is not an MDM-enrolled, hardened device. The consumer's payment token (`hceToken`) arrives at a device that could be rooted, running a tampered app, or controlled by a "ghost merchant" (an attacker presenting a fake payment screen). Play Integrity attestation is the primary mitigation.

## Difference from the Merchant Terminal App (`app/`)

| Dimension | Terminal app (`app/`) | SoftPOS (`softpos/`) |
|---|---|---|
| Target device | Sunmi P2 Pro (dedicated POS hardware) | Any NFC-capable Android 9+ phone |
| NFC mode | **Reader** (reads physical NFC tags) | **Reader** (reads HCE-emulated phone cards) |
| Hardware printer | Yes — `SunmiPrinterManager` via AIDL | No printer; receipt via SMS/push notification |
| Attestation | None required (MDM-enrolled device) | Play Integrity mandatory in production |
| App distribution | Sideloaded via MDM | Google Play (required for Play Integrity) |
| Payment source | `NFC_TAG`, `HCE_PHONE`, `QR_CODE`, `SOFTPOS_MOBILE` | `SOFTPOS_MOBILE` only |
| Security boundary | Physical device control | Play Integrity + server-side ghost merchant check |

## Android Module Structure

```
Tap2Pay/android/softpos/
├── build.gradle.kts
└── src/
    ├── main/java/com/orchestratepay/softpos/
    │   ├── integrity/
    │   │   └── PlayIntegrityChecker.kt      — obtains integrity token from Google Play API
    │   ├── orchestrator/
    │   │   └── SoftPosOrchestrator.kt       — end-to-end payment pipeline
    │   └── ui/
    │       ├── SoftPosDashboardActivity.kt  — amount entry + session management
    │       └── TapGuideActivity.kt          — NFC tap instruction screen
    └── test/java/com/orchestratepay/softpos/
        └── orchestrator/
            └── SoftPosOrchestratorTest.kt
```

The `softpos` module depends on:
- `nfc-core` AAR — shared NFC read/write logic (`NfcReadResult.HceRead`)
- OkHttp — for API calls
- Google Play Integrity library (`com.google.android.play:integrity`)

## Play Integrity Attestation Flow

### Overview

```
SoftPOS app                    Backend                     Google Play API
     │                            │                              │
     │── build nonce ─────────────┤                              │
     │   SHA-256(merchantId:ts)   │                              │
     │                            │                              │
     │── IntegrityManager ────────┼──────────────────────────────►│
     │   .requestIntegrityToken() │                              │
     │◄─ integrityToken ──────────┼──────────────────────────────┤
     │                            │                              │
     │── POST /api/v1/attestation/verify                         │
     │   { integrityToken, deviceSerial, nonce }                 │
     │                            │                              │
     │                            │── POST playintegrity.googleapis.com
     │                            │   /v1/com.orchestratepay.softpos
     │                            │   :decodeIntegrityToken      │
     │                            │◄─ tokenPayloadExternal ──────┤
     │                            │                              │
     │                            │── check deviceRecognitionVerdict
     │                            │── check appRecognitionVerdict
     │                            │                              │
     │                            │── UPDATE devices SET
     │                            │   device_integrity_verified_at = NOW()
     │◄─ { ok: true, attested: true } ──────────────────────────┤
```

### Client Side: `PlayIntegrityChecker`

File: `Tap2Pay/android/softpos/src/main/java/com/orchestratepay/softpos/integrity/PlayIntegrityChecker.kt`

```kotlin
object PlayIntegrityChecker {
    suspend fun getIntegrityToken(context: Context, nonce: String): String? {
        val integrityManager = IntegrityManagerFactory.create(context)
        // Returns token string on success, null on failure
        // Failure is non-fatal in sandbox builds
    }
}
```

Nonce construction (in `SoftPosOrchestrator.buildNonce`):
```kotlin
private fun buildNonce(merchantId: String): String {
    val input  = "$merchantId:${System.currentTimeMillis()}"
    val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
    return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
}
```

The nonce is bound to `merchantId` + current timestamp. This prevents replay attacks: an attacker who captures a token cannot reuse it for a different merchant account or a later session.

### Server Side: `POST /api/v1/attestation/verify`

File: `Tap2Pay/backend/src/routes/attestation.ts`

Auth: Merchant JWT (`requireAuth`).

Request body:
```json
{
  "integrityToken": "<google-integrity-token>",
  "deviceSerial":   "SN123456",
  "nonce":          "<base64url-encoded-sha256>"
}
```

The backend calls Google's Play Integrity decode endpoint:
```
POST https://playintegrity.googleapis.com/v1/com.orchestratepay.softpos:decodeIntegrityToken
Authorization: Bearer <google-access-token>
{ "integrity_token": "<token>" }
```

Two verdicts are checked from `tokenPayloadExternal`:

| Check | Field | Required value |
|---|---|---|
| Device integrity | `deviceIntegrity.deviceRecognitionVerdict` | Must include `'MEETS_BASIC_INTEGRITY'` |
| App integrity | `appIntegrity.appRecognitionVerdict` | Must equal `'PLAY_RECOGNIZED'` |

If both pass, the backend updates the device record:
```sql
UPDATE devices
SET device_type = 'SOFTPOS_MOBILE',
    device_integrity_verified_at = NOW()
WHERE device_serial = $1 AND merchant_id = $2
```

The transaction route checks `device_integrity_verified_at` before accepting `SOFTPOS_MOBILE` payments. Attestation must be fresh — the intent is `< 24h`, though the current route code does not yet enforce a TTL on this timestamp (a gap to address before production).

### Sandbox Bypass

```bash
PLAY_INTEGRITY_REQUIRED=false  # set in .env for local dev
```

When `PLAY_INTEGRITY_REQUIRED=false`, the attestation endpoint skips all Google API calls and marks the device attested immediately. The response includes `"sandbox": true` to distinguish it from real attestation. Never set this in production.

### Required Environment Variables

| Variable | Description |
|---|---|
| `PLAY_INTEGRITY_DECRYPTION_KEY` | Base64 decryption key from Play Console → Play Integrity API |
| `PLAY_INTEGRITY_VERIFICATION_KEY` | Base64 verification key from Play Console |
| `GOOGLE_ACCESS_TOKEN` | OAuth2 bearer token for calling Google APIs (use service account ADC in production) |
| `PLAY_INTEGRITY_REQUIRED` | Set to `'false'` to skip in dev/sandbox |

In production, `GOOGLE_ACCESS_TOKEN` should be obtained dynamically via Google Application Default Credentials (ADC) using `google-auth-library`, not stored as a static env var.

## Payment Processing Pipeline (`SoftPosOrchestrator`)

File: `Tap2Pay/android/softpos/src/main/java/com/orchestratepay/softpos/orchestrator/SoftPosOrchestrator.kt`

```kotlin
class SoftPosOrchestrator(
    private val context:       Context,
    private val apiBaseUrl:    String,
    private val merchantToken: String,
    private val merchantId:    String,
    private val scope:         CoroutineScope,
)
```

The `process()` function is the public entry point. It takes an `NfcReadResult.HceRead` (from the `nfc-core` module) and an amount, fires the pipeline on an IO coroutine, then dispatches the result back to the main thread.

### Steps

```
Step 1: Build nonce = SHA-256(merchantId:timestamp), base64url-encode
Step 2: Call PlayIntegrityChecker.getIntegrityToken(context, nonce)
        → may return null in debug builds (server ignores if PLAY_INTEGRITY_REQUIRED=false)
Step 3: Generate idempotency key = UUID (fresh per payment attempt)
Step 4: POST /api/v1/transactions
        {
          merchantId, amountCents, source: "SOFTPOS_MOBILE",
          idempotencyKey, timestamp, consumerPhone, hceToken, hceExp,
          deviceType: "SOFTPOS_MOBILE",
          integrityToken  (omitted if null)
        }
Step 5: Fire onStkSent() callback on main thread
        (UI shows "Waiting for consumer to approve payment")
Step 6: Poll GET /api/v1/transactions/:txnId/status every 2.5 seconds
        Deadline: 3 minutes
        CONFIRMED → SoftPosResult.Confirmed(txnId, mpesaRef, amountCents)
        DECLINED  → SoftPosResult.Declined(reason)
        FAILED    → SoftPosResult.Failed("Payment could not be processed")
        EXPIRED   → SoftPosResult.Failed("Payment timed out")
        No result in 3 min → SoftPosResult.Failed("Timed out waiting for confirmation")
```

### Result Types

```kotlin
sealed class SoftPosResult {
    data class StkSent(val txnId: String)                                  // not returned to caller — intermediate
    data class Confirmed(val txnId: String, val mpesaRef: String, val amountCents: Long)
    data class Declined(val reason: String)
    data class Failed(val reason: String, val retryable: Boolean = true)
}
```

HTTP 5xx from the server → `Failed(retryable = true)` (transient, safe to retry)
HTTP 4xx from the server → `Failed(retryable = false)` (bad request or auth issue)

## AID (Application Identifier)

The HCE consumer wallet emulates an NFC card using AID `F04F52434845535441`. This AID is selected by the SoftPOS reader when the consumer taps. The `nfc-core` module handles AID selection and APDU exchange — SoftPOS consumes the result as `NfcReadResult.HceRead` which already contains the decrypted `consumerPhone`, `hceToken`, and `hceExp` fields.

## UI Activities

### `SoftPosDashboardActivity`

The main merchant-facing screen. Displays:
- Merchant name and current balance (from Z-report or daily summary)
- Amount keypad for entering the payment amount
- "Ready to accept payment" button → launches `TapGuideActivity`

### `TapGuideActivity`

Displayed while waiting for the consumer to tap. Shows the payment amount and guides the merchant to hold the consumer's phone at the correct position for NFC reading.

NFC antenna position is derived from the device model:
```kotlin
private val ANTENNA_POSITION = mapOf(
  "pixel"   to AntennaPosition.CENTER,
  "samsung" to AntennaPosition.TOP,
  "xiaomi"  to AntennaPosition.CENTER,
  "tecno"   to AntennaPosition.CENTER,
  "infinix" to AntennaPosition.CENTER,
  // ... etc.
)
```

Unknown models default to `CENTER`. The activity shows a pulsing ring animation at the correct screen position (TOP/CENTER/BOTTOM). Back navigation is suppressed during active payment — the merchant must use an explicit cancel button.

## Security Requirements

### Why Attestation Cannot Be Optional in Production

The SoftPOS transaction source is `SOFTPOS_MOBILE`. A merchant on a rooted device could:
1. Intercept the NFC read and steal the consumer's `hceToken`
2. Replay it from another device
3. Receive payment without the consumer actually tapping

Play Integrity prevents this by confirming:
- The device has not been rooted or tampered with (`MEETS_BASIC_INTEGRITY`)
- The exact app binary is the same one distributed via Google Play (`PLAY_RECOGNIZED`)

The server must reject `SOFTPOS_MOBILE` transactions from devices where `device_integrity_verified_at IS NULL` or older than 24 hours. This enforcement gap (the current route does not check freshness) must be closed before production.

### Ghost Merchant Check

A "ghost merchant" sets up a fake payment terminal and intercepts payments meant for a legitimate merchant. The server-side defense is to verify that the `merchantId` in the JWT matches the `merchantId` in the transaction body. This is already handled by `requireAuth` attaching `req.merchant.sub` — route handlers should always use `req.merchant.sub`, never `req.body.merchantId`.

### HCE Token Single-Use Enforcement

The consumer's `hceToken` has a 90-second TTL and is single-use (enforced in `src/util/hce-token.ts` via Redis). The SoftPOS orchestrator's 2.5-second polling interval means the server will receive the token well within its validity window, but a network-partitioned retry could present an already-consumed token. The server returns a distinct error for expired/consumed tokens — the SoftPOS app should surface this as "Consumer payment expired — ask them to re-tap" rather than a generic failure.

## Known Gaps Before Production

| Gap | Impact | Fix |
|---|---|---|
| `device_integrity_verified_at` freshness not checked in transaction route | Attested-once device can process payments indefinitely even if later compromised | Add `AND device_integrity_verified_at > NOW() - INTERVAL '24 hours'` to SOFTPOS_MOBILE transaction guard |
| `GOOGLE_ACCESS_TOKEN` is a static env var | Token expires; API calls will fail in production after expiry | Replace with google-auth-library ADC (Application Default Credentials) |
| No receipt mechanism | Consumer has no proof of payment (no printer on SoftPOS) | Implement SMS/push receipt via Africa's Talking or Firebase |
| `TapGuideActivity` animation is a stub | Merchant has no visual guidance for NFC positioning | Implement pulsing ring animation at correct antenna position |

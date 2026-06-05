---
name: orchestratepay-android-kotlin
description: >
  Develop, extend, and debug the OrchestratePay Android codebase — merchant terminal app
  (android/app), consumer wallet (android/consumer-wallet), and shared NFC core library
  (android/nfc-core). Covers the three-module architecture, Retrofit/OkHttp API client
  patterns, coroutine threading model, SessionManager (EncryptedSharedPreferences), the
  ApiResponse sealed class, offline payment queue, payment flow from tap to confirmation,
  BiometricGate, QrTokenManager, pure-JVM unit testing patterns, and build variants.
  Use this skill when adding a new API endpoint, changing the payment flow, adding a new
  payment source, working with SessionManager, debugging auth/token issues, writing tests
  for Android logic, or understanding how the terminal and consumer wallet differ.
---

# OrchestratePay — Android / Kotlin

## Module structure
```
android/
  app/                      ← Merchant terminal (Sunmi P2 Pro POS)
    api/OrchestaApiClient   ← Retrofit client + request/response models + ApiResponse
    nfc/NfcReaderManager    ← NFC reader mode (tag detection)
    nfc/NfcSignatureVerifier← HMAC-SHA256 tag verification (pure JVM, no Android)
    nfc/TagWriterActivity   ← NFC sticker programming at merchant onboarding
    hce/MerchantHceSession  ← Reads consumer HCE tap via IsoDep APDU
    payment/PaymentOrchestrator ← Coordinates tap → API → polling/WebSocket
    payment/IdempotencyKeyGen   ← UUID-based idempotency keys (prevents duplicate STK)
    db/SessionManager       ← Encrypted persistent storage for JWT, keys, merchantId
    telemetry/              ← Fleet device health heartbeat

  consumer-wallet/          ← Consumer Android wallet (standard phone)
    api/ConsumerApiClient   ← Consumer-facing API calls (Retrofit)
    hce/ConsumerHceService  ← Exposes consumer phone as an HCE card (HostApduService)
    hce/P2PHceSession       ← P2P tap session via HCE (APDU protocol)
    nfc/ConsumerP2PReader   ← Consumer reading another consumer's NFC tag
    payment/QrTokenManager  ← 90-second rotating QR code (lazy fetch + auto-refresh)
    util/BiometricGate      ← Biometric/PIN prompt before payment dispatch

  nfc-core/                 ← Shared library (used by both modules)
    ApduProtocol            ← ISO-DEP APDU handshake implementation
    NfcPaymentReader        ← Top-level NFC dispatch (NDEF vs HCE detection)
    NdefTagParser           ← Parses orchestratepay:// URI + validates params
    TapFeedback             ← Haptic + sound feedback after tap
```

## Payment sources — full list
| Source constant | Physical method | Who initiates |
|---|---|---|
| `NFC_TAG` | Signed NTAG215 sticker | Merchant terminal reads sticker |
| `HCE_PHONE` | Consumer taps phone to terminal | Terminal reads HCE card via APDU |
| `QR_CODE` | Merchant scans consumer QR | ZXing scanner on terminal |
| `ISO_CARD` | Bank card (future) | Terminal ISO-DEP APDU |
| `SOFTPOS_MOBILE` | Certified softPOS on consumer phone | Consumer-side payment |
| `CONSUMER_TAG` | Consumer NFC sticker → merchant scans | Merchant terminal reads HTTPS URL |
| `P2P_HCE` | Consumer wallet taps merchant reader | P2P consumer-to-consumer |

## API client (`OrchestrateApiClient`)

### Pattern
- Retrofit + OkHttp singleton; initialised in `Application.onCreate()`
- Auth injected automatically by `OkHttp Interceptor` — reads from `SessionManager.getToken()`
- HTTP logging: `Level.BODY` in DEBUG builds, `Level.NONE` in RELEASE (PII in request bodies)
- All calls wrapped in `safeCall()` — maps HTTP responses to `ApiResponse` sealed types

### Timeouts
| Timeout | Value | Rationale |
|---|---|---|
| Connect | 10 s | TCP handshake on Kenyan 3G |
| Read | 30 s | Daraja round-trip can be slow |
| Write | 15 s | Request body transmission |

### ApiResponse sealed class
```kotlin
sealed class ApiResponse {
    data class Success(txnId, mpesaRef, amountCents, merchantName, consumerPhone) : ApiResponse()
    data class Pending(val txnId: String) : ApiResponse()
    data class Declined(val reason: String) : ApiResponse()
    data class NetworkError(val message: String) : ApiResponse()
    data class ServerError(val message: String) : ApiResponse()
}
```
`PaymentOrchestrator` exhaustively pattern-matches on this. Never add raw HTTP status
codes to UI logic — always go through `ApiResponse`.

### Adding a new endpoint
1. Add a `suspend fun` to `OrchestrateService` (Retrofit interface) with the correct HTTP method
2. Add request/response data classes with `@SerializedName` annotations
3. Add a public method to `OrchestrateApiClient` — use `safeCall { }` for transactional endpoints; use a direct try/catch for non-transactional (profile, Z-report, etc.)
4. Expose via `OrchestrateApiClient.current` from call sites

## SessionManager (`db/SessionManager.kt`)

Wraps Android `EncryptedSharedPreferences` (AES-256-GCM key in KeyStore).

```kotlin
SessionManager.saveSession(
    token         = body.token,        // merchant JWT (8h)
    merchantId    = body.merchantId,
    merchantName  = body.merchantName,
    expiresAt     = body.expiresAt,
    nfcSigningKey = body.nfcSigningKey, // 32-hex per-merchant HMAC key
    kraPin        = body.kraPin         // KRA PIN for fiscal receipts
)

SessionManager.getToken()        // String? — null if not logged in
SessionManager.getMerchantId()   // String?
SessionManager.getNfcSigningKey()// String? — needed by NfcSignatureVerifier
SessionManager.clearSession()    // call on logout
```

**The NFC signing key lives here.** `NfcSignatureVerifier` reads it from `SessionManager` on every tap — never hardcode it or put it in a resource file.

## Threading model
```
UI thread:   Fragment/Activity — update views, start coroutines (lifecycleScope)
IO thread:   Dispatchers.IO — network calls, DB reads, NFC IsoDep I/O (BLOCKING)
Main thread: Dispatchers.Main — results back to UI
```

Standard pattern:
```kotlin
lifecycleScope.launch {
    val result = withContext(Dispatchers.IO) {
        apiClient.initiatePayment(request)
    }
    // back on Main thread
    when (result) {
        is ApiResponse.Success  -> showSuccess(result)
        is ApiResponse.Pending  -> startPolling(result.txnId)
        is ApiResponse.Declined -> showDecline(result.reason)
        is ApiResponse.NetworkError -> showRetry(result.message)
        is ApiResponse.ServerError  -> showError(result.message)
    }
}
```

NFC `onTagDiscovered` fires on a **background NFC thread** — call `activity.runOnUiThread { }` before touching UI.

## Idempotency (`IdempotencyKeyGen.kt`)
```kotlin
val key = IdempotencyKeyGen.generate()  // UUID without dashes, lowercase hex — 32 chars
```
Pass as `Idempotency-Key` header on every `POST /transactions` call. The backend de-duplicates using this key for 120 s (PENDING) or 3600 s (CONFIRMED). This prevents duplicate STK Pushes when the app retries after a network timeout.

## Offline queue
`PaymentOrchestrator` writes the request to an offline queue (SQLite) on `NetworkError`. A background sync job flushes the queue when connectivity returns, using the same `idempotencyKey` as the original attempt. The backend's idempotency cache ensures only one STK Push fires even if the queue flushes multiple times.

## BiometricGate (`consumer-wallet/util/BiometricGate.kt`)
```kotlin
if (BiometricGate.isAvailable(this)) {
    BiometricGate.prompt(
        activity   = this,
        onSuccess  = { dispatchPayment() },
        onFailure  = { msg -> showError(msg) },
        onCancel   = { /* user cancelled, stay on payment screen */ }
    )
} else {
    dispatchPayment()  // M-Pesa PIN is the fallback security layer
}
```
**Do NOT call `onFailure` from `onAuthenticationFailed`** — that fires on a single bad scan; the native UI lets the user retry. Only call `onFailure` from `onAuthenticationError` for unrecoverable errors (lockout, hardware missing).
Must be called from the **main thread** (`ContextCompat.getMainExecutor`).

## Testing patterns

### Pure JVM tests (`src/test/`)
Use for: all deterministic logic — HMAC verification, URL parsing, state machines, caching logic, APDU protocol, idempotency key format.
- `NfcSignatureVerifierTest` — HMAC test vectors computed with `javax.crypto.Mac`
- `QrTokenManagerTest` — cache freshness and auto-refresh delay logic
- `BiometricGateTest` — callback semantics, authenticator policy constants
- Avoid `android.util.Log.*` calls in code under test (use a custom logger instead)

### Instrumented tests (`src/androidTest/`)
Use for: anything that requires Android runtime — Activity navigation, NFC dispatch, Biometric prompt, real Bitmap generation, `EncryptedSharedPreferences`.
- `LoginActivityTest` — end-to-end login flow on emulator
- `NfcTagPaymentFlowTest` — NFC read → PaymentOrchestrator on device/emulator

### Test naming convention
Use backtick names:
```kotlin
@Test
fun `amount above threshold for first-time consumer adds 25 points`() { ... }
```

## Build variants
| Variant | `BuildConfig.DEBUG` | API base URL | NFC signing | Log level |
|---|---|---|---|---|
| `debug` | `true` | `http://10.0.2.2:3000/api/v1/` | sandbox key | `Level.BODY` |
| `release` | `false` | `https://api.orchestratepay.co.ke/api/v1/` | production key | `Level.NONE` |

**Never ship a release build with `Level.BODY` logging** — request bodies contain phone numbers (PII) and token values.

## Common bugs
| Symptom | Root cause | Fix |
|---|---|---|
| `OrchestrateApiClient not initialised` | `init()` not called in `Application.onCreate()` | Call `OrchestrateApiClient.init(baseUrl)` on app start |
| Token missing from requests | `SessionManager.getToken()` returns null | Check `saveSession()` was called after login |
| Biometric prompt crashes | Called from background thread | Wrap in `runOnUiThread { }` or use `lifecycleScope.launch` |
| Double charge on retry | New `idempotencyKey` generated per retry | Reuse the same key from the original attempt |
| `IllegalStateException` on NFC | Reader mode not disabled in `onPause()` | Always call `nfcManager.disable()` in `onPause()` |
| QR code rejected as expired | Auto-refresh fired too late | Reduce `REFRESH_MARGIN_MS` or increase backend token TTL |

## See also
- `orchestratepay-android-nfc` — deep NFC/NDEF/APDU/HCE implementation
- `orchestratepay-biometric-authorization` — BiometricGate policy and callback contract
- `orchestratepay-backend-api` — API endpoint reference and PaymentOrchestrator server side

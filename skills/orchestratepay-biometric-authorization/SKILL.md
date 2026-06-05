---
name: orchestratepay-biometric-authorization
description: >
  Add biometric pre-authorization to OrchestratePay consumer wallet payments — how
  BiometricGate.kt wraps AndroidX BiometricPrompt, BIOMETRIC_STRONG OR DEVICE_CREDENTIAL
  fallback, which payment activities call it and when, handling success/failure/cancel
  callbacks, and availability detection. Use this skill when implementing fingerprint/face
  confirmation before paying, when the biometric prompt is not appearing, when adding
  biometric auth to a new payment flow, or when the device falls back to device PIN.
---

# OrchestratePay — Biometric Authorization (`util/BiometricGate.kt`)

## Why it exists
Consumer payments are authorized by M-Pesa PIN — the STK Push requires PIN entry.
But on high-value transactions or when the phone itself initiates (P2P, payment links),
an additional in-app biometric confirmation ensures the person holding the phone is the
account owner, not someone who picked up an unlocked device.

This is the "tap and face/fingerprint" UX that makes OrchestratePay feel premium.

## Integration — calling BiometricGate
```kotlin
import com.orchestratepay.consumer.util.BiometricGate

// Before dispatching any payment API call:
if (BiometricGate.isAvailable(this)) {
    BiometricGate.prompt(
        activity = this,
        title    = "Confirm Payment",
        subtitle = "KSh ${amountFormatted} to ${merchantName}",
        onSuccess = { initiatePayment() },
        onFailure = { msg -> showError("Authentication failed: $msg") },
        onCancel  = { /* user cancelled — stay on payment screen */ }
    )
} else {
    // No biometric enrolled — proceed directly (M-Pesa PIN is still required)
    initiatePayment()
}
```

## Authenticator policy
```kotlin
BiometricManager.Authenticators.BIOMETRIC_STRONG or
BiometricManager.Authenticators.DEVICE_CREDENTIAL
```
- `BIOMETRIC_STRONG` — fingerprint or 3D face recognition
- `DEVICE_CREDENTIAL` — device PIN/pattern/password as fallback
- This means the prompt never blocks if the user has no biometric enrolled

## Authentication callbacks
| Callback | When it fires | Recommended action |
|---|---|---|
| `onSuccess` | Biometric or PIN accepted | Proceed with payment API call |
| `onFailure(msg)` | All retry attempts exhausted | Show error; let user try again |
| `onCancel` | User dismissed the prompt | Stay on payment screen; do nothing |
| (internal) `onAuthenticationFailed` | Single attempt failed | Do NOT call `onFailure` — BiometricPrompt handles retry UI natively |

## Availability check
```kotlin
BiometricGate.isAvailable(context)  // returns false if no biometric/PIN is enrolled
```
When `isAvailable` returns false, the app should proceed without biometric (not block).
M-Pesa PIN is still the financial security backstop.

## Payment activities that should call BiometricGate
| Activity | Call before | Threshold |
|---|---|---|
| `NfcTagPaymentActivity` | Submitting payment to `/transactions` | All amounts |
| `MerchantHcePayActivity` | Submitting payment to `/consumers/pay/:merchantId` | All amounts |
| `P2PPayActivity` | Calling `/consumers/p2p-pay` | All amounts |
| `P2PQrScannerActivity` | Calling `/consumers/p2p-pay` | All amounts |

## AndroidManifest.xml requirement
```xml
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
```

## BiometricPrompt threading note
`BiometricGate.prompt()` must be called from the **main thread** (UI thread).
The `ContextCompat.getMainExecutor(activity)` ensures callbacks fire on main thread.
Do NOT call from a coroutine or background thread without switching to `Dispatchers.Main`.

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| Biometric prompt never shows | `isAvailable()` returns false (no enrollment) | Expected — proceed without biometric |
| `onFailure` fires immediately | Device has no PIN/password set | Prompt user to set a screen lock in Android Settings |
| Prompt shows but `onSuccess` not called | `onAuthenticationFailed` being treated as final failure | Remove any `onFailure` call from `onAuthenticationFailed` |
| Crash: `Can't start activity on non-main thread` | Calling `prompt()` from background coroutine | Switch to `withContext(Dispatchers.Main)` before calling |

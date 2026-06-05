---
name: orchestratepay-device-attestation
description: >
  Understand the Play Integrity attestation flow for SOFTPOS_MOBILE transactions —
  why it exists, how routes/attestation.ts verifies integrity tokens, what the
  device_integrity_verified_at DB column gates, and how to debug attestation failures
  in production or sandbox. Use this skill when SOFTPOS_MOBILE transactions are rejected
  with "Device integrity check failed", when onboarding a new SoftPOS merchant, when
  configuring Play Integrity API keys, or when testing without a production Play Store build.
---

# OrchestratePay — Device Attestation (Play Integrity)

## Why SoftPOS needs attestation (other sources do not)
`SOFTPOS_MOBILE` (Scenario 4) uses a **merchant's personal Android phone** as the payment
terminal. Unlike a fixed Sunmi POS:
- Can be rooted
- Can run sideloaded or modified APKs
- Can run on an emulator

This creates the **ghost merchant** attack: a fraudster creates a fake SoftPOS terminal,
receives consumer payments, and provides no goods. Play Integrity attestation blocks this
by cryptographically verifying:
1. The device has not been tampered with (`MEETS_BASIC_INTEGRITY`)
2. The app was installed from Google Play (`PLAY_RECOGNIZED`)

## Attestation flow
```
SoftPOS app launches
      │
      ▼
PlayIntegrityChecker.kt
  StandardIntegrityManager.requestIntegrityToken(nonce)
      │
      ▼
POST /api/v1/attestation/verify
  { integrityToken, deviceSerial, nonce }
      │
      ▼
verifyWithGoogle()
  POST https://playintegrity.googleapis.com/v1/{pkg}:decodeIntegrityToken
      │
      ├── deviceRecognitionVerdict includes "MEETS_BASIC_INTEGRITY" ✓
      └── appRecognitionVerdict == "PLAY_RECOGNIZED"               ✓
      │
      ▼
UPDATE devices SET device_integrity_verified_at = NOW()
WHERE device_serial = $1 AND merchant_id = $2
```

## Freshness gate
The transaction route for `SOFTPOS_MOBILE` checks `device_integrity_verified_at`.
Attestation must be **< 24 hours old**. Re-attestation is triggered on every app launch.
If the device has not been attested or the record is stale → `400 Device integrity not verified`.

## Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `PLAY_INTEGRITY_DECRYPTION_KEY` | Production only | Base64 decryption key from Play Console |
| `PLAY_INTEGRITY_VERIFICATION_KEY` | Production only | Base64 verification key from Play Console |
| `PLAY_INTEGRITY_REQUIRED` | Optional | Set to `'false'` to skip verification in dev/sandbox |
| `GOOGLE_ACCESS_TOKEN` | Production | OAuth2 bearer token for Play Integrity API |

## Sandbox mode
Set `PLAY_INTEGRITY_REQUIRED=false`. The route marks the device as attested without
calling Google. Response includes `"sandbox": true` — never use this in production.

## Verdict fields checked
```json
{
  "deviceIntegrity": {
    "deviceRecognitionVerdict": ["MEETS_BASIC_INTEGRITY"]   ← required
  },
  "appIntegrity": {
    "appRecognitionVerdict": "PLAY_RECOGNIZED"              ← required
  }
}
```

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| `Device does not meet basic integrity` | Rooted device, emulator, or custom ROM | Use unmodified device with production Play build |
| `App not recognized by Google Play` | Sideloaded APK or debug build | Install from Play Store, or use `PLAY_INTEGRITY_REQUIRED=false` for dev |
| `Attestation service unavailable` (503) | Google API keys not configured | Set `PLAY_INTEGRITY_DECRYPTION_KEY` and `PLAY_INTEGRITY_VERIFICATION_KEY` |
| SOFTPOS_MOBILE transactions rejected with 400 | `device_integrity_verified_at` > 24h ago | Re-launch SoftPOS app to trigger fresh attestation |
| `Empty verdict` | Play Integrity API returned no payload | Check `GOOGLE_ACCESS_TOKEN` is valid and not expired |

## Nonce replay protection
The server should issue a unique nonce per attestation request (stored in Redis for 5 minutes).
The Android app binds this nonce into the integrity token. The verify endpoint checks the nonce
before accepting — this prevents replaying a captured token from a different device.

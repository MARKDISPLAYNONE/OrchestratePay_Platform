---
name: orchestratepay-hce-crypto
description: >
  Build and extend OrchestratePay's HCE cryptographic handshake layer.
  Covers HMAC-SHA256 session tokens, APDU protocol (SELECT/GET DATA/CONFIRM),
  AID registration, single-use token enforcement, replay attack prevention,
  proximity enforcement, secure enclave storage, and token rotation.
  Use this skill for: HCE token issuance/verification, APDU command handling,
  replay attack defence, phone-swap attack prevention, token TTL tuning,
  AID routing, session lifecycle, and NFC security auditing.
---

# OrchestratePay — HCE Cryptographic Handshaking

## The threat model

When a customer taps their phone to a POS, three attacks are possible:

| Attack | Description | Defence |
|--------|-------------|---------|
| **Replay** | Attacker records the NFC signal and re-taps later | 60s TTL + single-use CONFIRM |
| **Phone-swap** | Attacker presents a valid token but swaps their own phone number | HMAC binds token to phone |
| **Forgery** | Attacker crafts a token without knowing the secret | HMAC-SHA256 with 256-bit secret |
| **Eavesdrop** | Attacker reads the NFC payload (ISO-DEP is not encrypted at the RF layer) | TTL + single-use make captured tokens worthless |
| **MITM relay** | Attacker relays the APDU exchange through a longer distance | Android 4.1+ requires screen-on, device-unlocked |

## The protocol

```
Customer opens wallet app → taps "Ready to Pay"
  App calls: POST /api/v1/wallet/session { phone: "254712345678" }
  Backend responds: { token: "a1b2c3...32hex", exp: 1716100060000 }
  App stores in WalletSessionManager (volatile memory, not disk)

Customer taps phone to Sunmi POS:
  POS → SELECT AID F04F52434845535441
  Phone → 90 00  (session active)

  POS → 80 C0 00 00 00  (GET DATA)
  Phone → { "phone":"254712345678", "token":"a1b2c3...32hex", "exp":1716100060000 } + 90 00

  POS → 80 C1 00 00 00  (CONFIRM — session cleared, single-use)
  Phone → 90 00

POS sends { consumerPhone, hceToken, hceExp } to backend
  Backend: verifyHceToken(phone, token, exp) → true/false
  If true: look up consumer, fire STK Push
  If false: 401 { error: "Invalid or expired HCE session" }
```

## AID

```
F0 4F 52 43 48 45 53 54 41   (9 bytes)
│  └─────────────────────── ASCII: "ORCHESTAT"
└─ F0 = proprietary range (no EMVCo registration required for non-bank apps)
```

Registered in `apduservice.xml` with `requireDeviceUnlock="true"`.
`CATEGORY_OTHER` (not `CATEGORY_PAYMENT`) — avoids Google Tap & Pay conflicts.

## Token cryptography

```typescript
// backend: src/util/hce-token.ts
const TTL_MS = 60_000  // 60 seconds

export function issueHceToken(phone: string): { token: string; exp: number } {
  const exp   = Date.now() + TTL_MS
  const token = crypto
    .createHmac('sha256', process.env.HCE_TOKEN_SECRET!)
    .update(`${phone}:${exp}`)
    .digest('hex')
    .slice(0, 32)           // 32 hex chars = 128 bits of HMAC output
  return { token, exp }
}

export function verifyHceToken(phone: string, token: string, exp: number): boolean {
  try {
    const secret = process.env.HCE_TOKEN_SECRET
    if (!secret) return false
    if (token.length !== 32 || !/^[0-9a-f]{32}$/.test(token)) return false
    if (Date.now() > exp) return false

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${phone}:${exp}`)
      .digest('hex')
      .slice(0, 32)

    // Constant-time comparison — prevents timing oracle attacks
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  } catch {
    return false   // never throw — missing secret degrades gracefully
  }
}
```

**Why 32 hex chars (not the full 64)?** 128 bits of HMAC is cryptographically
indistinguishable from 256 bits for a MAC with a 256-bit key. Shorter payload
fits comfortably in a single APDU response without fragmentation.

## Android — WalletHceService APDU handling

```kotlin
// APDU status words
private val SW_OK         = byteArrayOf(0x90.toByte(), 0x00)
private val SW_NOT_FOUND  = byteArrayOf(0x6A.toByte(), 0x82.toByte())  // no active session
private val SW_CONDITIONS = byteArrayOf(0x69.toByte(), 0x85.toByte())  // session expired

override fun processCommandApdu(apdu: ByteArray, extras: Bundle?): ByteArray {
    if (apdu.size < 4) return SW_UNKNOWN
    return when (apdu[1]) {
        INS_SELECT   -> handleSelect()    // 0xA4
        INS_GET_DATA -> handleGetData()   // 0xC0
        INS_CONFIRM  -> handleConfirm()   // 0xC1 — clears session
        else         -> SW_UNKNOWN
    }
}

private fun handleGetData(): ByteArray {
    val session = WalletSessionManager.get() ?: return SW_NOT_FOUND
    if (System.currentTimeMillis() > session.exp) {
        WalletSessionManager.clear()
        return SW_CONDITIONS  // expired — customer must re-activate
    }
    val json = """{"phone":"${session.phone}","token":"${session.token}","exp":${session.exp}}"""
    return json.toByteArray(Charsets.UTF_8) + SW_OK
}

private fun handleConfirm(): ByteArray {
    WalletSessionManager.clear()  // single-use enforcement
    return SW_OK
}

// onDeactivated does NOT clear the session — phone moved away before CONFIRM
// means customer can tap again within the TTL window
override fun onDeactivated(reason: Int) { /* session preserved for retry */ }
```

## WalletSessionManager thread safety

```kotlin
object WalletSessionManager {
    // @Volatile ensures the write in ActivatePaymentActivity (main thread coroutine)
    // is immediately visible to WalletHceService (NFC binder thread)
    @Volatile private var activeSession: HceSession? = null

    fun set(phone: String, token: String, exp: Long) {
        activeSession = HceSession(phone, token, exp)
    }

    fun get(): HceSession? {
        val s = activeSession ?: return null
        if (System.currentTimeMillis() > s.exp) {
            activeSession = null
            return null
        }
        return s
    }
}
```

`@Volatile` is sufficient here because there is only one writer (the Activity)
and one reader (the Service). If multiple writers were possible, a `synchronized`
block or `AtomicReference` would be required.

## Token rotation strategy

Tokens are not rotated mid-session — the 60-second TTL makes rotation unnecessary.
If a longer session window is ever needed (e.g. 5 minutes for a queue scenario):
1. Increase `TTL_MS` on both backend and Android
2. The CONFIRM APDU already makes tokens single-use regardless of TTL
3. The backend's `verifyHceToken` TTL check is the authoritative enforcement

## Secure enclave consideration

For maximum security, the phone number and token should be stored in Android
Keystore, not volatile memory. Current architecture uses `@Volatile` which:
- **Does** survive screen-off/on events (memory is retained)
- **Does not** survive process death (app killed = session cleared — acceptable)
- **Does not** survive device restart (by design — no persistent payment sessions)

To upgrade to Keystore: wrap `WalletSessionManager` with `EncryptedSharedPreferences`
(already a dependency in `build.gradle`). Set `MODE_PRIVATE` and clear on app start.

## Key invariants

1. Token is HMAC-SHA256(phone:exp) — phone is cryptographically bound to the token
2. `crypto.timingSafeEqual` — never use `===` for token comparison (timing oracle)
3. CONFIRM APDU clears the session — one tap, one payment, no replay
4. `onDeactivated` does NOT clear — allows retry within TTL if phone lifted too fast
5. `requireDeviceUnlock="true"` in apduservice.xml — NFC dead on locked screen
6. Expired sessions return `SW_CONDITIONS` (6985) — POS surfaces TOKEN_EXPIRED error
7. Backend re-verifies the HMAC — never trust the POS to have verified it

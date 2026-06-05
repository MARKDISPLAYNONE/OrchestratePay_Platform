---
name: orchestratepay-android-nfc
description: >
  Build and extend the Android NFC layer for the OrchestratePay tap-to-pay platform.
  Covers NFC hardware management (NfcAdapter, enableReaderMode, enableWriterMode, tag technologies),
  NDEF tag parsing with the signed orchestratepay:// URI scheme (mid, tid, v, sign),
  HMAC signature verification (backend nfc-signing.ts verifyTagSignature), PaymentIntent
  construction, HCE (Host Card Emulation) APDU service, QR fallback scanning, the
  clean boundary between the hardware layer and the PaymentOrchestrator, and the
  NFC tag writer utility (uses buildSignedUri — never writes unsigned URIs).
  Use this skill whenever the user is working on NFC tag reading, NFC tag programming
  at merchant onboarding, HMAC tag signing/verification, cross-merchant signature
  reuse prevention, tag cloning attacks, HCE consumer wallet, the NfcReaderManager
  class, tag registration, testing NFC on a Sunmi P2 Pro, handling NFC errors gracefully,
  or wiring up NFC lifecycle (onResume/onPause enableReaderMode). Also triggers for
  questions about NTAG215 tag programming, Android NFC intents, IsoDep EMV stubs,
  OrchestratePay-specific URI scheme parsing, or per-merchant signing key derivation.
---

# OrchestratePay — Android NFC Layer

## Architecture principle
The NFC layer is a **hardware identity resolver only**. It reads a tag, verifies its signature, resolves who tapped, and emits a `PaymentIntent`. It never touches money, network calls, or UI state directly. This boundary is load-bearing for security audits and unit testing.

```
Physical tap
  → NfcReaderManager (this layer)
    → HMAC signature verified on backend (nfc-signing.ts verifyTagSignature)
      → PaymentIntent(merchantId, tagId, rawUid, source, timestamp)
        → PaymentOrchestrator (separate layer — see orchestratepay-backend-api skill)
```

## Tag format — signed URI

OrchestratePay NFC stickers (NTAG215) carry one NDEF URI record:
```
orchestratepay://pay?mid={merchantId}&tid={tagId}&v=1&sign={16-hex-signature}
```
- `mid` — merchant UUID (from DB)
- `tid` — tag UUID (written at onboarding, stored in `nfc_tags` table)
- `v=1` — version gate; reject anything not `v=1` until migration logic is written
- `sign` — 16-character lowercase hex HMAC (see Signing section below)

**A tag without a valid `sign` parameter is always rejected.** The `sign` parameter is what prevents an attacker from writing a cheap blank sticker with any `merchantId` they choose.

## NFC tag signing (HMAC-SHA256)

Backend utility: `Tap2Pay/backend/src/util/nfc-signing.ts`

```typescript
// Key derivation — per-merchant, isolated
export function deriveMerchantSigningKey(merchantId: string): string {
    const secret = process.env.NFC_SIGNING_SECRET  // must be set in production
    if (!secret) throw new Error('NFC_SIGNING_SECRET not set')
    return crypto.createHmac('sha256', secret)
        .update(merchantId, 'utf8')
        .digest('hex')
        .slice(0, 32)
}

// Sign — used when programming a new sticker
export function signTag(merchantId: string, tagId: string, key: string): string {
    return crypto.createHmac('sha256', key)
        .update(`${merchantId}:${tagId}`, 'utf8')
        .digest('hex')
        .slice(0, 16)
}

// Verify — called on every tap from the backend transaction route
export function verifyTagSignature(merchantId: string, tagId: string, sign: string): boolean {
    try {
        const key = deriveMerchantSigningKey(merchantId)
        const expected = signTag(merchantId, tagId, key)
        // Constant-time comparison — prevents timing oracle attacks
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sign))
    } catch {
        return false  // NFC_SIGNING_SECRET absent or sign is wrong length — safe failure
    }
}

// Build the full URI for writing to a sticker
export function buildSignedUri(merchantId: string, tagId: string): string {
    const key  = deriveMerchantSigningKey(merchantId)
    const sign = signTag(merchantId, tagId, key)
    return `orchestratepay://pay?mid=${merchantId}&tid=${tagId}&v=1&sign=${sign}`
}
```

**Key properties enforced by tests:**
- `deriveMerchantSigningKey` produces a deterministic 32-hex string
- Different merchants get different keys (isolation — one terminal cannot forge another)
- `signTag` changes when either `merchantId` or `tagId` changes
- `verifyTagSignature` rejects: forged signatures, all-zero signatures, one-digit-off, cross-merchant reuse, changed merchantId, changed tagId, too-short, empty, uppercase hex
- When `NFC_SIGNING_SECRET` is absent: `deriveMerchantSigningKey` throws; `verifyTagSignature` returns `false` (does not throw)

`NFC_SIGNING_SECRET` must be at least 32 characters. Rotate it only with a planned re-programming window for all deployed stickers.

## NfcReaderManager — key patterns

### Enabling reader mode
Always use `enableReaderMode` (not foreground dispatch). It gives finer control, suppresses system sounds, and avoids the foreground dispatch race condition.

```kotlin
val flags = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or
            NfcAdapter.FLAG_READER_NFC_V or
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK  // we handle NDEF ourselves

val extras = Bundle().apply {
    putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 250)
}
nfcAdapter.enableReaderMode(activity, this, flags, extras)
```

Call `enable()` in `onResume()`, `disable()` in `onPause()`. Failing to call `disable()` crashes the next activity.

### Threading
`onTagDiscovered` fires on a **background thread**. Always `activity.runOnUiThread { ... }` before touching any UI or calling the orchestrator callback.

### NDEF parsing
```kotlin
val record = message.records[0]
val raw = String(record.payload, Charsets.UTF_8)
// NDEF URI records have a 1-byte prefix (identifier code):
//   0x00 = no prefix → full URI in payload after drop(1)
//   0x04 = "https://"
val uriString = if (raw[0].code == 0) raw.substring(1) else raw
val uri = Uri.parse(uriString)
// Extract and pass sign to backend for verification
val sign = uri.getQueryParameter("sign")
if (sign == null) { onError(NfcError.UNRECOGNISED_TAG); return }
```

### Error taxonomy
| NfcError | Cause | UI action |
|---|---|---|
| `NOT_SUPPORTED` | Device has no NFC | Show QR fallback permanently |
| `READ_FAILED` | Tag moved during read | "Tap again — hold steady" |
| `UNRECOGNISED_TAG` | Not an OrchestratePay tag (missing params or wrong scheme) | "Tag not registered" |
| `PARSE_ERROR` | NDEF content malformed | "Tag read error — tap again" |
| `INVALID_SIGNATURE` | Backend rejected the HMAC signature | "Tag not valid — contact support" |

## PaymentIntent — the handoff contract

```kotlin
data class PaymentIntent(
    val source: PaymentSource,    // NFC_TAG | QR_CODE | ISO_CARD
    val merchantId: String,
    val tagId: String? = null,
    val rawUid: String? = null,   // hex UID — audit log only, never used for routing
    val timestamp: Long = System.currentTimeMillis()
)
```

Never add financial fields (amount, account) here. Amount is entered by the merchant after the tap. The orchestrator owns the combination of identity + amount.

## enableWriterMode — NFC tag programming at merchant onboarding

Tag writing is a distinct operating mode from reading. The Sunmi POS switches into
writer mode during merchant onboarding (a back-office flow, not the live payment screen).

### Why a separate mode matters

`enableReaderMode` (payment mode) and foreground dispatch (write mode) are mutually
exclusive. If `enableReaderMode` is active when you try to write, Android intercepts
the tag for reading before the write Activity can see it. Always disable reader mode
before enabling writer mode.

### Enabling foreground dispatch for writing

```kotlin
// TagWriterActivity.kt — dedicated activity for the onboarding tool
override fun onResume() {
    super.onResume()
    // 1. Must NOT call nfcManager.enable() here — no reader mode during writing
    // 2. Use foreground dispatch so this activity gets tag intents first
    val intent  = Intent(this, TagWriterActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    // FLAG_IMMUTABLE: the PendingIntent is never modified at runtime.
    // FLAG_MUTABLE is a security anti-pattern on API 31+ and will trigger a lint error.
    val pending = PendingIntent.getActivity(this, 0, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    val techFilter = arrayOf(arrayOf(
        Ndef::class.java.name,
        NdefFormatable::class.java.name   // blank factory tags need formatting first
    ))

    nfcAdapter?.enableForegroundDispatch(this, pending, null, techFilter)
}

override fun onPause() {
    super.onPause()
    nfcAdapter?.disableForegroundDispatch(this)
}

override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    if (NfcAdapter.ACTION_TECH_DISCOVERED == intent.action ||
        NfcAdapter.ACTION_NDEF_DISCOVERED == intent.action) {
        // getParcelableExtra(String) is deprecated on API 33+; use the two-arg form
        @Suppress("DEPRECATION")
        val tag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            intent.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag::class.java)
        else
            intent.getParcelableExtra(NfcAdapter.EXTRA_TAG)
        tag ?: return
        writeSignedTag(tag)
    }
}
```

### Writing a signed URI to an NTAG215

```kotlin
private fun writeSignedTag(tag: Tag) {
    lifecycleScope.launch(Dispatchers.IO) {
        try {
            // 1. Fetch signed URI from backend (POST /api/v1/tags/sign)
            //    Backend calls buildSignedUri(merchantId, tagId) → orchestratepay://pay?...&sign=...
            val uri = apiClient.getSignedTagUri(merchantId = merchantId, tagId = tagId)

            val record  = NdefRecord.createUri(uri)
            val message = NdefMessage(arrayOf(record))

            // 2. Try NDEF first (tag already formatted, most common case)
            val ndef = Ndef.get(tag)
            if (ndef != null) {
                ndef.connect()
                if (!ndef.isWritable) {
                    withContext(Dispatchers.Main) { showError("Tag is read-only — cannot reprogram") }
                    ndef.close(); return@launch
                }
                if (ndef.maxSize < message.toByteArray().size) {
                    withContext(Dispatchers.Main) { showError("Tag too small for this URI") }
                    ndef.close(); return@launch
                }
                ndef.writeNdefMessage(message)
                ndef.makeReadOnly()   // lock after writing — prevents consumer overwrite
                ndef.close()

            } else {
                // 3. NdefFormatable: blank factory tag — format then write in one operation
                val formatable = NdefFormatable.get(tag)
                if (formatable != null) {
                    formatable.connect()
                    formatable.format(message)   // format + write atomically
                    formatable.close()
                    // NdefFormatable.format() does NOT lock the tag.
                    // Reconnect as Ndef immediately to call makeReadOnly().
                    val ndefa = Ndef.get(tag)
                    if (ndefa != null) {
                        ndefa.connect()
                        ndefa.makeReadOnly()
                        ndefa.close()
                    }
                } else {
                    withContext(Dispatchers.Main) { showError("Unsupported tag type") }
                    return@launch
                }
            }

            withContext(Dispatchers.Main) { showSuccess("Tag programmed — tap to verify") }

        } catch (e: TagLostException) {
            withContext(Dispatchers.Main) { showError("Tag moved too soon — tap again") }
        } catch (e: IOException) {
            withContext(Dispatchers.Main) { showError("Write failed: ${e.message}") }
        }
    }
}
```

### Never write unsigned URIs

```kotlin
// WRONG — a physical sticker with no sign param will be accepted by legacy code
// but rejected by the production verifyTagSignature check and logged as a warning.
val badUri = "orchestratepay://pay?mid=$merchantId&tid=$tagId&v=1"

// CORRECT — always go through the backend signing endpoint
val goodUri = apiClient.getSignedTagUri(merchantId, tagId)
// Returns: "orchestratepay://pay?mid=...&tid=...&v=1&sign=<16hex>"
```

### makeReadOnly() — why it's mandatory after programming

An unlocked NTAG215 in the wild can be overwritten by anyone with a compatible Android
device. Even with signature verification as a second line of defence, a tampered tag
creates a confusing error for the merchant ("Invalid payment tag"). `makeReadOnly()` is
the first line of defence — it is irreversible, costs a single NDEF command, and takes
< 100ms.

### Tag write vs. tag read lifecycle summary

| Phase | Activity | NFC mode | API |
|-------|----------|----------|-----|
| Live payment | `MerchantDashboardActivity` | `enableReaderMode` | `NfcAdapter.ReaderCallback` |
| Tag programming | `TagWriterActivity` | Foreground dispatch | `NfcAdapter.enableForegroundDispatch` |
| Both must `disable` their mode in `onPause()` — failure causes `IllegalStateException` on the next `onResume()`. |

## HCE service (Phase 2 — consumer wallet)
`OrchestrateHceService extends HostApduService`

AID: `F04F52434845535441` (F0 prefix = proprietary range, no EMVCo registration needed)
Declared in `res/xml/apduservice.xml` with `android:category="other"`.

APDU flow:
1. Terminal → `SELECT AID` → respond `9000`
2. Terminal → `INS=0xC0` (GET DATA) → respond `<token bytes> + 9000`
3. Terminal → `INS=0xC1` (COMPLETE) → respond `9000`, null the token

Token TTL: 30 seconds. Generate at SELECT time. The token is a short-lived JWT containing `consumerId` only — never phone number or PIN.

Clear `sessionToken = null` in `onDeactivated(reason)` regardless of reason.

## QR fallback
When `NfcError.NOT_SUPPORTED` fires, or when the merchant explicitly taps "Use QR":
- Launch ZXing scanner: `IntentIntegrator(activity).initiateScan()`
- Parse the same signed URI scheme from the QR content
- Emit `PaymentIntent(source = PaymentSource.QR_CODE, ...)`

The orchestrator doesn't care whether the intent came from NFC or QR.

## AndroidManifest.xml checklist
- `<uses-permission android:name="android.permission.NFC" />`
- `<uses-feature android:name="android.hardware.nfc" android:required="true" />`
- `MerchantDashboardActivity` has `android:launchMode="singleTop"` (prevents double-instantiation on NFC intent)
- NDEF intent filter: `<data android:scheme="orchestratepay" />`
- TECH intent filter: references `res/xml/tech_list.xml`
- HCE service: `android:permission="android.permission.BIND_NFC_SERVICE"` + metadata pointing to `apduservice.xml`

## res/xml/tech_list.xml
```xml
<tech-list><tech>android.nfc.tech.IsoDep</tech></tech-list>
<tech-list><tech>android.nfc.tech.Ndef</tech></tech-list>
<tech-list><tech>android.nfc.tech.NdefFormatable</tech></tech-list>
```

## res/xml/apduservice.xml
```xml
<host-apdu-service android:requireDeviceUnlock="true">
  <aid-group android:category="other">
    <aid-filter android:name="F04F52434845535441" />
  </aid-group>
</host-apdu-service>
```

## Common bugs
- **Crash on resume**: forgot `nfcManager.disable()` in `onPause()` → `IllegalStateException`
- **Silent no-read**: `enableReaderMode` called before `setContentView` → activity not fully created yet
- **Double-tap charges**: missing check `if (currentState == PROCESSING) return` in `onTagDetected`
- **Wrong URI**: NDEF URI prefix byte not stripped → `Uri.parse("orchestratepay://pay?...")` fails because the string starts with a null byte
- **Signature always fails in prod**: `NFC_SIGNING_SECRET` in production differs from the secret used to program the stickers — re-program stickers after rotating the secret
- **Uppercase signature rejected**: `signTag` produces lowercase hex; verify the NFC writer doesn't capitalise the `sign` param when encoding the URI
- **HCE never fires**: AID in `apduservice.xml` doesn't match what the terminal selects — use `adb logcat | grep HCE` to see which AID the terminal is sending

## See also
- `orchestratepay-backend-api` skill — PaymentOrchestrator, idempotency, retry logic
- `orchestratepay-daraja` skill — M-Pesa STK Push, callbacks, reconciliation

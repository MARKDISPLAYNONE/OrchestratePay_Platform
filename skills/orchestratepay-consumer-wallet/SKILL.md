---
name: orchestratepay-consumer-wallet
description: >
  Implement and debug the consumer wallet session layer — how POST /api/v1/wallet/session
  issues a 60-second HMAC-signed HCE token, what the token encodes, how it is embedded in
  the NFC APDU payload, and the phone number format requirements. Use this skill when
  consumers cannot tap to pay (expired or invalid HCE token), when setting up the wallet
  session endpoint on a new deployment, when HCE_TOKEN_SECRET is missing, or when the
  Sunmi terminal rejects the consumer's token.
---

# OrchestratePay — Consumer Wallet (`routes/wallet.ts`, `util/hce-token.ts`)

## Purpose
The consumer wallet app issues itself a short-lived HCE token before presenting the phone
for payment. This token is embedded in the NFC APDU `GET DATA` response and verified by
the Sunmi terminal / merchant app when processing the transaction.

Without this token, the terminal cannot verify that the consumer has an active session —
the token is the authentication credential transmitted over NFC.

## POST /api/v1/wallet/session
```
Request body:  { "phone": "254712345678" }
Response:      { "token": "...", "exp": 1748436000000 }
```

### Validation
- `phone` must match `/^254[0-9]{9}$/` — 12 digits starting with `254`
- This is Safaricom E.164 format (no leading `+`, no `07` prefix)

### Token properties
- HMAC-SHA256 signed using `HCE_TOKEN_SECRET`
- Expires in **60 seconds**
- Encodes: `{ phone, exp }` — the terminal extracts `phone` from the token to know which
  M-Pesa number to send the STK Push to
- Token is written into the APDU payload by `ConsumerHceService.buildSessionPayload()`

## HCE payload structure (CONSUMER_PAYMENT mode)
```json
{
  "type":          "CONSUMER_PAYMENT",
  "phone":         "254712345678",
  "token":         "<hmac-signed-token>",
  "exp":           1748436000000,
  "deviceType":    "CONSUMER_PHONE",
  "walletVersion": 2
}
```

## Security model
- Without `HCE_TOKEN_SECRET`, any string could be passed as a "token" and the terminal
  would extract any phone number, billing arbitrary people
- The HMAC signature ties the phone number to the issuing server
- The 60-second TTL limits the replay window — the consumer taps within seconds of
  pressing "Ready to Pay"

## Phase 1 limitation
Currently accepts phone number without OTP verification. The comment in `routes/wallet.ts`
documents the production upgrade path: issue a 6-digit OTP via M-Pesa USSDpush before
issuing the token. This is out of scope for Phase 1 — the HMAC still protects against
phone spoofing since an attacker cannot forge a valid token without `HCE_TOKEN_SECRET`.

## Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `HCE_TOKEN_SECRET` | Yes | HMAC signing key for wallet session tokens |

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| `Session service temporarily unavailable` (503) | `HCE_TOKEN_SECRET` not set | Set the env var |
| Terminal rejects consumer token | Token expired (> 60s) | Consumer must tap within 60s of pressing "Ready to Pay" |
| `Phone must be in 254XXXXXXXXX format` | App sending `07XXXXXXXX` or `+254XXXXXXXXX` | Normalise to `254XXXXXXXXX` before calling the endpoint |
| STK Push sent to wrong number | Token payload tampered | `HCE_TOKEN_SECRET` leaked — rotate immediately |

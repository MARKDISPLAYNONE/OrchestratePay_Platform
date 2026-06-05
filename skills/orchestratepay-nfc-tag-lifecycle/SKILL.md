---
name: orchestratepay-nfc-tag-lifecycle
description: >
  Provision, sign, verify, and revoke OrchestratePay NFC sticker tags — NDEF URI format,
  HMAC signing (util/nfc-signing.ts), routes/tags.ts endpoints, the TagWriterActivity
  onboarding tool, the distinction between merchant-provisioned tags (NFC_TAG, Scenario 1)
  and consumer-programmed stickers (CONSUMER_TAG, Scenario 2), and signing key rotation.
  Use this skill when setting up new merchant stickers, debugging signature verification
  failures, rotating the signing secret, or explaining why CONSUMER_TAG has no signature.
---

# OrchestratePay — NFC Tag Lifecycle (`routes/tags.ts`, `util/nfc-signing.ts`)

## Two tag types — key distinction
| Property | Merchant tag (NFC_TAG) | Consumer sticker (CONSUMER_TAG) |
|---|---|---|
| NDEF URI | `orchestratepay://{tagId}?sign={hmac}` | `https://pay.orchestratepay.co.ke/c/{consumerId}` |
| Signed | Yes — HMAC-SHA256 | No |
| Written by | OrchestratePay onboarding tool | Consumer's own device |
| Transaction source | `NFC_TAG` (Scenario 1) | `CONSUMER_TAG` (Scenario 2) |
| Verification | Offline — HMAC checked on terminal | Online — `consumerId` resolved via API |

## Merchant tag provisioning flow
```
1. Merchant opens TagWriterActivity on their Sunmi terminal
2. TagWriterActivity calls POST /api/v1/tags/sign { merchantId, tagId }
3. Server checks:
     - JWT sub == merchantId  (merchant can only sign own tags)
     - tagId exists in nfc_tags table and is active
4. Server builds signed URI via buildSignedUri(merchantId, tagId)
   Result: orchestratepay://{tagId}?sign={6-char HMAC}
5. TagWriterActivity writes the URI to the NTAG215 sticker via NFC
6. Tag is now live — every tap reads this URI
7. NfcReaderManager verifies signature offline before submitting the transaction
```

## HMAC signature details
```
key   = deriveMerchantSigningKey(merchantId)  // HMAC-SHA256 of merchantId using NFC_SIGNING_SECRET
data  = "{merchantId}:{tagId}"
sign  = HMAC-SHA256(key, data).hex().slice(0, 6)
```
- 6 hex characters = ~3 bytes = ~281 trillion possible values
- Sufficient trust for NFC tap where the attacker must physically handle the tag
- The terminal caches the signing key from `GET /api/v1/tags/signing-key` for offline use

## Offline verification (important for reliability)
The terminal fetches and caches the merchant signing key at login via:
```
GET /api/v1/tags/signing-key
```
Every subsequent tap verifies the HMAC **without a network call**. Only the payment
submission itself requires connectivity. This is how payments work even during brief
network outages.

## Tag revocation
Set `active = false` on the row in `nfc_tags`. The server returns 404 on `/tags/sign`,
and a re-programmed tag with the old URI will still pass HMAC (signatures don't expire),
so physical tag replacement is also needed in high-security scenarios.

## Signing key rotation
```
WARNING: rotating NFC_SIGNING_SECRET invalidates ALL existing tag signatures immediately.
All physical stickers must be re-provisioned (re-written) after rotation.
Only rotate in a planned maintenance window with merchant coordination.
```
Steps:
1. Set new `NFC_SIGNING_SECRET` in env
2. Deploy
3. Re-run TagWriterActivity for every active merchant tag
4. Update the signing key cache on all terminals

## Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `NFC_SIGNING_SECRET` | Yes | Master secret for per-merchant HMAC key derivation |

## API endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/tags/sign` | Merchant JWT | Generate signed URI for a tag |
| GET | `/api/v1/tags/signing-key` | Merchant JWT | Get/refresh merchant signing key |
| POST | `/api/v1/tags/verify` | None | Dev-only: verify a signature without writing |

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| `Tag not found or not active` (404) | Tag not in DB or `active=false` | Check `nfc_tags` table; reprovision if needed |
| `You can only sign tags for your own merchant` (403) | JWT sub ≠ body merchantId | Verify JWT and request body use same merchant ID |
| Signature fails offline but passes online | Stale cached signing key | Call `GET /api/v1/tags/signing-key` to refresh |
| All tags suddenly invalid after deploy | `NFC_SIGNING_SECRET` rotated | Re-provision all tags — physical sticker re-write required |
| `NFC signing not configured` (503) | `NFC_SIGNING_SECRET` env var missing | Set the secret in deployment environment |

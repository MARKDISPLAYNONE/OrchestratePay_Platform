---
name: orchestratepay-merchant-api-keys
description: >
  Merchant API key management for OrchestratePay — creating, listing, and revoking
  long-lived API keys (X-API-Key header) as an alternative to short-lived Bearer JWTs.
  Use this skill when implementing server-to-server integrations, when a merchant needs
  to authenticate from a backend service rather than an Android terminal, when debugging
  401 errors from the X-API-Key auth path, or when rotating keys.
---

# OrchestratePay — Merchant API Keys (`routes/api-keys.ts`)

## Purpose

API keys let merchants authenticate server-to-server requests without managing JWT
refresh tokens. A merchant generates an API key from the OrchestratePay dashboard or
API, stores it securely, and then passes it as an `X-API-Key` header on any endpoint
that accepts `requireAuthOrApiKey`.

## Key format

```
op_<64 lowercase hex characters>
```

Total length: **67 characters**. Generated server-side using
`'op_' + crypto.randomBytes(32).toString('hex')`.

The first 12 characters (e.g. `op_a1b2c3d4e5`) are stored as `key_prefix` and returned
on every list/get call so a merchant can identify keys without seeing the secret.

## Security model

| Property | Detail |
|---|---|
| Storage | SHA-256 hash of the full key (`key_hash`) — plaintext never stored |
| Visibility | Full key returned **once** at creation; never retrievable again |
| Transport | Must be sent over HTTPS only via `X-API-Key` request header |
| Key management | Requires a **Merchant JWT** (`requireAuth`) — an API key cannot create or revoke other API keys |
| Limit | Max **10 active keys** per merchant (409 Conflict if at limit) |
| Revocation | Soft-delete (`active = FALSE`) — immediate effect on next request |

## Usage

Pass the key as an HTTP header on any endpoint that accepts `requireAuthOrApiKey`:

```
X-API-Key: op_a1b2c3d4e5f6...
```

The middleware (`requireApiKey` in `src/middleware/auth.ts`) hashes the incoming key
and looks it up in `merchant_api_keys`. On match it sets `req.merchant` and calls
`next()`. On any error it fails **closed** (401) — never fails open.

## Restrictions

- **Cannot use an API key to manage API keys.** All four management endpoints use
  `requireAuth` (Merchant JWT), not `requireAuthOrApiKey`. This prevents a compromised
  key from creating more keys or revoking other keys.
- API keys do not carry a `deviceId` — device-binding checks are skipped for API key
  requests (the middleware sets `deviceId: ''` in the synthetic merchant payload).

## Key rotation

1. Create a new key: `POST /api/v1/api-keys`
2. Update your integration to use the new `fullKey`
3. Revoke the old key: `DELETE /api/v1/api-keys/:id`

There is no grace period — revocation takes effect immediately.

## Expiry

Pass `expiresInDays` (1–365) at creation to set a hard expiry. Keys without an expiry
are valid until explicitly revoked. Expired keys are rejected with HTTP 401 even if
`active = TRUE`; the `requireApiKey` middleware checks `expires_at` on every request.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/api-keys` | Merchant JWT | Create a new API key (returns `fullKey` once) |
| GET | `/api/v1/api-keys` | Merchant JWT | List active keys (no secrets) |
| DELETE | `/api/v1/api-keys/:id` | Merchant JWT | Revoke (soft-delete) a key |
| GET | `/api/v1/api-keys/:id` | Merchant JWT | Get single key metadata |

### POST /api/v1/api-keys — request body

```json
{
  "name": "Production server key",
  "expiresInDays": 90
}
```

- `name`: string, max 100 chars, required
- `expiresInDays`: integer, 1–365, optional (omit for no expiry)

### POST response (201)

```json
{
  "id":        "uuid",
  "name":      "Production server key",
  "keyPrefix": "op_a1b2c3d4e5",
  "fullKey":   "op_a1b2c3d4e5f6...64-hex-chars-total",
  "expiresAt": "2026-09-15T00:00:00.000Z",
  "createdAt": "2026-06-15T12:00:00.000Z"
}
```

`fullKey` is only present on this response. Save it immediately.

### GET /api/v1/api-keys — response

```json
{
  "keys": [
    {
      "id":         "uuid",
      "name":       "Production server key",
      "keyPrefix":  "op_a1b2c3d4e5",
      "lastUsedAt": "2026-06-14T08:30:00.000Z",
      "expiresAt":  "2026-09-15T00:00:00.000Z",
      "createdAt":  "2026-06-15T12:00:00.000Z"
    }
  ]
}
```

## Database table

```sql
CREATE TABLE merchant_api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES merchants(id),
  key_hash     TEXT NOT NULL UNIQUE,   -- SHA-256 hex of the full key
  key_prefix   TEXT NOT NULL,          -- first 12 chars of the full key
  name         TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| 401 `Missing or invalid X-API-Key header` | Header absent or value doesn't start with `op_` | Ensure header is `X-API-Key: op_...` |
| 401 `Invalid or revoked API key` | Key was revoked or hash mismatch | Generate a new key |
| 401 `API key has expired` | `expires_at` is in the past | Rotate: create new key, revoke old one |
| 401 `Authentication failed` | DB error during key lookup | Check DB connectivity |
| 409 `Maximum of 10 active API keys reached` | Merchant is at the hard cap | Revoke an unused key first |
| 403 on key management endpoint | Authenticated with API key instead of JWT | Use a Bearer JWT to manage keys |

---
name: orchestratepay-security-middleware
description: >
  Configure and maintain OrchestratePay's request security layer — Safaricom IP allowlist
  (middleware/safaricom-ip.ts) and correlation ID injection (middleware/request-id.ts).
  Use this skill when M-Pesa callbacks are blocked or allowed incorrectly, the IP list needs
  updating after a Safaricom maintenance window, request tracing is broken, or you are setting
  up a new deployment and need to configure trust proxy correctly.
---

# OrchestratePay — Security Middleware

## Safaricom IP Allowlist (`middleware/safaricom-ip.ts`)

### Why it exists
Safaricom does NOT sign M-Pesa callbacks with an HMAC or shared secret.
IP filtering is the only mechanism to authenticate incoming callbacks.
Without it, any attacker who knows your callback URL can POST a fake "payment confirmed"
and receive goods or services for free.

### Known Safaricom egress IPs (last verified 2024-Q4)
```
196.201.214.200   196.201.214.206   196.201.213.114
196.201.214.207   196.201.214.208   196.201.213.44
196.201.212.127   196.201.212.128   196.201.212.129
196.201.212.132   196.201.212.136   196.201.212.138
```
Subscribe to **developer.safaricom.co.ke** announcements — these IPs change occasionally.

### Behaviour by environment
| Environment | Behaviour |
|---|---|
| `production` | Rejects requests not on the allowlist with `403 Forbidden` |
| `development` / `test` | Allows all IPs — you cannot control ngrok tunnel source IPs |

### IPv4-mapped IPv6
Node/Express may represent an IPv4 address as `::ffff:196.201.x.x`.
The middleware strips the `::ffff:` prefix before checking the set.

### Express trust proxy requirement
For `req.ip` to reflect the real client IP (not the load balancer), `index.ts` must set:
```typescript
app.set('trust proxy', 1)  // trust first proxy (nginx / AWS ALB)
```
Without this, `req.ip` is always the load balancer IP and every production callback is blocked.

### Nginx pass-through
```nginx
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Real-IP       $remote_addr;
```

### Updating the IP list
1. Receive notification from the Safaricom developer portal
2. Update `SAFARICOM_IPS` in `middleware/safaricom-ip.ts`
3. Update the "Last verified" comment with the new date
4. Redeploy — no DB change needed

### Response on block
Returns `403 Forbidden` (not 200). If the source is really Safaricom it will never hit
this branch. Returning 403 prevents spoofed callbacks from silently disappearing;
Safaricom retry logic only applies to their own egress IPs.

---

## Request ID (`middleware/request-id.ts`)

Every HTTP request gets a UUID at entry. This ties all log lines for a request together,
making post-incident investigation possible even across multiple service instances.

### Header behaviour
- If `X-Request-Id` is present in the incoming request, that value is reused
  (enables retry correlation — the Android app resends the same ID on retries)
- If absent, a new UUIDv4 is generated
- The ID is echoed in the `X-Request-Id` **response** header

### Type augmentation
`middleware/request-id.ts` extends the Express `Request` type globally:
```typescript
declare global {
  namespace Express {
    interface Request { id: string }
  }
}
```
Any route file can safely use `req.id` without casting.

### Logging pattern
```typescript
logger.info('STK Push sent', { txnId, requestId: req.id })
```

### Android correlation
The consumer wallet logs the `X-Request-Id` from every API response.
Support can ask the user for this value and find the exact server log line instantly.

### Mount order — critical
`requestId` must be mounted **before** the logger and all routes:
```typescript
app.use(requestId)        // 1st — assigns req.id
app.use(requestLogger)    // 2nd — can now include req.id
app.use('/api/v1', router) // routes last
```

---

## Common Failures

| Symptom | Cause | Fix |
|---|---|---|
| All callbacks `403` in production | `trust proxy` not set → `req.ip` is load balancer IP | Add `app.set('trust proxy', 1)` |
| Callbacks blocked after Safaricom maintenance | IP list stale | Update `SAFARICOM_IPS` and redeploy |
| Dev callbacks blocked | `NODE_ENV=production` set on staging | Check environment variable on staging server |
| `req.id` is `undefined` in a route | `requestId` middleware not mounted or mounted after the route | Verify mount order in `index.ts` |

---
name: orchestratepay-split-payments
description: >
  Implement group/bill-split payment sessions via OrchestratePay — how POST
  /api/v1/split-payments creates a session, how consumers join, how the initiating party
  triggers simultaneous STK Pushes, Redis session storage (split:{id}, 300s TTL), share
  amount validation, and participant limits. Use this skill when building a table restaurant
  split, shared matatu fare, or group utility bill feature, or when debugging session expiry,
  share sum mismatches, or the 10-participant limit.
---

# OrchestratePay — Split Payments (`routes/split-payments.ts`)

## Use case
One merchant transaction, N consumers each paying their share simultaneously.
Examples: restaurant table splits, shared transport fares, group utility bills.

## Session lifecycle
```
POST /api/v1/split-payments (merchant creates session)
  { totalAmountCents: 500000, description: "Table 7", participants: [...] }
        │ Returns: { sessionId, session }
        ▼
POST /api/v1/split-payments/:id/join (additional consumers join)
  { phone: "254712345678", shareCents: 12500 }
        │
        ▼
GET /api/v1/split-payments/:id (poll session status)
        │
        ▼
POST /api/v1/split-payments/:id/initiate (creator triggers STK pushes)
  → status: INITIATING → STK Pushes fire to all participants
  → each participant's status: PENDING → STK_SENT → CONFIRMED | DECLINED | FAILED
        │
        ▼
Session status becomes COMPLETE (all confirmed) | PARTIAL (some failed) | EXPIRED (TTL hit)
```

## Constraints
- Minimum 2 participants, maximum 10
- Share amounts must sum exactly to `totalAmountCents` — server enforces this on create
- Session TTL: 300 seconds (5 minutes) — enough for a table to confirm payment
- Only the session creator (authenticated merchant) can call `/initiate`

## Redis session shape
```json
{
  "id": "uuid",
  "merchantId": "uuid",
  "totalCents": 500000,
  "description": "Table 7",
  "participants": [
    { "phone": "254712345678", "shareCents": 250000, "status": "CONFIRMED", "txnId": "uuid" },
    { "phone": "254798765432", "shareCents": 250000, "status": "DECLINED" }
  ],
  "status": "PARTIAL",
  "createdAt": "2026-05-28T10:00:00.000Z"
}
```

## Session statuses
| Status | Meaning |
|---|---|
| `OPEN` | Session accepting joins; not yet initiated |
| `INITIATING` | STK Pushes dispatched; waiting for confirmations |
| `COMPLETE` | All participants confirmed |
| `PARTIAL` | Session closed; some participants failed or declined |
| `EXPIRED` | TTL elapsed before initiation |

## API endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/split-payments` | Merchant JWT | Create session |
| POST | `/api/v1/split-payments/:id/join` | None | Consumer joins |
| GET | `/api/v1/split-payments/:id` | None | Poll status |
| POST | `/api/v1/split-payments/:id/initiate` | Merchant JWT | Trigger all STK Pushes |

## Share amount validation
```typescript
const computedTotal = participants.reduce((s, p) => s + p.shareCents, 0)
if (computedTotal !== totalAmountCents) → 400 error
```
Prevents floating-point drift — all amounts must be integer cents.

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| `Session not found or expired` | TTL elapsed (5 minutes) | Increase TTL for slow dining scenarios |
| `Share amounts sum to X but totalAmountCents is Y` (400) | Rounding when splitting | Assign remainder to one participant; all must be integer cents |
| `Session already INITIATING` | Double-click on initiate button | Client-side debounce; server is idempotent for this |
| Participant can't join | `status !== OPEN` (already initiated) | Cannot join after initiation starts |
| 10-participant limit hit | Large group | Split into two sessions or increase limit |

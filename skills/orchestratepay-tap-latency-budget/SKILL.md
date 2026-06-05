---
name: orchestratepay-tap-latency-budget
description: >
  Define, measure, and enforce the end-to-end tap-to-confirmation latency budget for
  OrchestratePay — from NFC tap on the consumer's phone to M-Pesa PIN prompt delivered,
  and from PIN approval to transaction confirmed on the terminal. Covers util/latency-tracker.ts,
  the X-Tap-Timestamp header protocol, the payment_latency DB table, and how latency
  percentiles are surfaced via GET /api/v1/admin/stats. Use this skill when payments feel
  slow, when setting SLA targets, when investigating a latency regression, or when tuning
  Daraja dispatch performance.
---

# OrchestratePay — Tap Latency Budget (`util/latency-tracker.ts`)

## Why latency is a product feature
A payment that takes > 5 seconds from tap to STK Push delivery feels broken to Kenyan
merchants and consumers. Sub-3-second is the expectation at a busy till — matching or
beating M-Pesa's own USSD flow. Measuring and monitoring latency is what separates a
"working" payment platform from a world-class one.

## End-to-end latency segments
```
Consumer taps phone (NFC)
    │
    ▼ [NFC read: ~100–200ms — hardware, not controllable]
    │
    ▼ [API round trip: < 500ms budget]
    │  POST /consumers/pay or /transactions
    │  ← Server validates, writes DB, returns 202 with txnId
    │
    ▼ [Daraja dispatch: < 1,000ms budget]
    │  OAuth token fetch (cached) + STK Push request to Safaricom
    │
    ▼ [STK Push delivery: < 2,000ms median, < 5,000ms p95]
    │  Safaricom delivers PIN prompt to consumer's phone
    │
    ▼ Consumer enters PIN (not measurable — user action)
    │
    ▼ [STK confirmation: < 3,500ms from consumer PIN press]
    │  Safaricom POSTs callback → server processes → publishes to Redis
    │
    ▼ Terminal/consumer receives WebSocket push (~100ms from Redis event)
```

## Budget targets (world-class)
| Segment | Target p50 | Target p95 |
|---|---|---|
| API round trip | < 300ms | < 500ms |
| Daraja dispatch | < 600ms | < 1,000ms |
| STK to PIN prompt | < 2,000ms | < 4,000ms |
| **Total tap-to-confirmation** | **< 5,000ms** | **< 10,000ms** |

## X-Tap-Timestamp header
The Android app sends the NFC tap timestamp (ms since epoch) in every payment request:
```
X-Tap-Timestamp: 1748436000000
```
The server records `Date.now() - tapTimestamp` as `api_round_trip_ms` in `payment_latency`.

```typescript
import { parseTapTimestamp } from '../util/latency-tracker'

const tapTs = parseTapTimestamp(req.headers['x-tap-timestamp'] as string)
const apiRoundTripMs = tapTs ? Date.now() - tapTs : null
```

## `payment_latency` table schema
```sql
CREATE TABLE payment_latency (
  id                   BIGSERIAL PRIMARY KEY,
  txn_id               UUID NOT NULL UNIQUE REFERENCES transactions(id),
  api_round_trip_ms    INT,
  daraja_dispatch_ms   INT,
  stk_confirm_ms       INT,
  total_ms             INT,
  source               VARCHAR(20),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
```

## Recording latency
```typescript
import { recordLatency } from '../util/latency-tracker'

// In mpesa-callback.ts, after CONFIRMED:
await recordLatency({
  txnId:            txnId,
  apiRoundTripMs:   apiRoundTripMs,  // from X-Tap-Timestamp
  darajaDispatchMs: darajaEndMs - darajaStartMs,
  stkConfirmMs:     Date.now() - stkSentAt,
  totalMs:          tapTs ? Date.now() - tapTs : null,
  source:           source,
})
```

## Surfacing in admin/stats
`GET /api/v1/admin/stats` includes a `latency` section using `getLatencyStats()`:
```json
{
  "latency": {
    "p50TotalMs": 4200,
    "p95TotalMs": 8100,
    "p99TotalMs": 14000,
    "avgApiRoundTripMs": 280,
    "avgDarajaDispatchMs": 590,
    "avgStkConfirmMs": 3200,
    "sampleCount": 1247
  }
}
```

## Latency regression investigation
1. Check `GET /admin/stats` latency section — which segment increased?
2. `api_round_trip_ms` spike → DB slow query or high CPU on API server
3. `daraja_dispatch_ms` spike → Daraja OAuth token expired or Safaricom congestion
4. `stk_confirm_ms` spike → Safaricom callback delays (common on weekends/public holidays)
5. `total_ms` spike with others stable → Android tap timestamp clock drift

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| `p50TotalMs` consistently > 8s | Daraja OAuth token not cached | Verify Redis caching of Daraja token |
| `api_round_trip_ms` > 1,000ms | DB query slow (missing index) | Add index on `transactions.consumer_id` and `merchant_id` |
| `stk_confirm_ms` null for all rows | Callback not updating `payment_latency` | Verify `recordLatency()` is called in mpesa-callback.ts |
| `sampleCount` = 0 | `payment_latency` table not created | Run DB migration to add the table |

---
name: orchestratepay-circuit-breaker
description: >
  Understand and tune the CircuitBreaker class (util/circuit-breaker.ts) that wraps all
  Daraja and external service calls. Use this skill when Daraja is down and requests are
  piling up (OPEN state), the circuit is not recovering after Daraja comes back (HALF_OPEN
  probe failing), you need to tune threshold/resetMs for a new integration, you are handling
  CircuitOpenError in a route handler, or you need to surface circuit state to the admin
  dashboard.
---

# OrchestratePay — Circuit Breaker (`util/circuit-breaker.ts`)

## State machine
```
CLOSED ──(≥ threshold failures)──► OPEN
  ▲                                  │
  │                           (resetMs elapsed)
  │                                  ▼
  └──(probe succeeds)───── HALF_OPEN
                                  │
         OPEN ◄──(probe fails)────┘
```

## States explained
| State | Behaviour | Entry condition |
|---|---|---|
| `CLOSED` | All requests pass through normally | Default; any success |
| `OPEN` | Requests fail immediately with `CircuitOpenError` | `threshold` consecutive failures |
| `HALF_OPEN` | One probe request allowed through | `resetMs` ms elapsed since last failure |

## Default parameters
```typescript
new CircuitBreaker('daraja', 5, 30_000)
//                  name     failures  reset ms
```
- `threshold = 5` — trips OPEN after 5 consecutive failures
- `resetMs = 30_000` — waits 30 seconds before probing (HALF_OPEN)

## Using it
```typescript
import { darajaCircuit } from '../integrations/daraja'

const result = await darajaCircuit.fire(() => callSafaricom(payload))
```

## Handling `CircuitOpenError` in routes
```typescript
import { CircuitOpenError } from '../util/circuit-breaker'

try {
  await darajaCircuit.fire(() => sendStkPush(payload))
} catch (err) {
  if (err instanceof CircuitOpenError) {
    return res.status(503).json({
      error: 'Payment service temporarily unavailable. Please try again in 30 seconds.',
      code: 'CIRCUIT_OPEN',
    })
  }
  throw err
}
```

## Admin visibility
```
GET /api/v1/admin/circuit    → { daraja: 'CLOSED' | 'OPEN' | 'HALF_OPEN', description: '...' }
GET /api/v1/admin/stats      → infrastructure.darajaCircuit (embedded in stats response)
```

## Key invariants
- `failures` counts **consecutive** failures — a single success resets it to 0
- `lastFailedAt` is only updated on failure — the reset timer starts from the **last** failure,
  not the first (window slides with failures)
- State is **in-memory** — a server restart resets to CLOSED. This is intentional:
  a fresh deploy should probe the service rather than start OPEN
- `CircuitOpenError.code = 'CIRCUIT_OPEN'` — Android distinguishes this from other 503s
  and shows a "try again in 30s" message rather than "payment failed"

## Tuning for new integrations
| Integration | threshold | resetMs | Rationale |
|---|---|---|---|
| Daraja STK Push | 5 | 30,000 | Payment-critical — trip fast, recover fast |
| Africa's Talking SMS | 10 | 60,000 | SMS is best-effort, not payment-critical |
| OpenExchangeRates API | 3 | 120,000 | Rate data stales slowly; two minutes is fine |
| Play Integrity API | 5 | 30,000 | Security-critical but recovers quickly |

## Inspecting live state
```typescript
const cb = new CircuitBreaker('my-service')
cb.status        // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
cb.failureCount  // consecutive failures since last success
```

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| All requests instant-fail with `CircuitOpenError` | Circuit OPEN after outage | Check `GET /admin/circuit`; wait for probe or restart server |
| Circuit stays OPEN after Daraja recovers | Probe is also failing | Check OAuth token, sandbox vs production URL, Daraja dashboard |
| Circuit trips in test runs | Tests call real Daraja | Mock `darajaCircuit.fire()` in tests |
| `HALF_OPEN` probe never fires | Clock drift on server | Check system time; `resetMs` comparison uses `Date.now()` |

/**
 * k6 load test — OrchestratePay backend
 *
 * Run:
 *   k6 run load-test.js                          # default (smoke)
 *   k6 run --env SCENARIO=soak load-test.js      # 30-min soak
 *   k6 run --env SCENARIO=stress load-test.js    # ramp to 200 VUs
 *   k6 run --env BASE_URL=https://api.orchestratepay.co.ke load-test.js
 *
 * Install k6:  https://k6.io/docs/get-started/installation/
 *
 * Budget targets (from SKILL.md tap-latency-budget):
 *   /health              p95 < 50 ms
 *   POST /transactions   p50 < 500 ms (API round-trip, before Daraja)
 *   GET  /transactions   p95 < 200 ms
 *   FX rates             p95 < 100 ms
 */

import http   from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const BASE_URL  = __ENV.BASE_URL  || 'http://localhost:3000'
const SCENARIO  = __ENV.SCENARIO  || 'smoke'
const JWT_TOKEN = __ENV.JWT_TOKEN || 'replace-with-a-valid-merchant-jwt'

// ── Custom metrics ────────────────────────────────────────────────────────────

const errorRate         = new Rate('errors')
const healthLatency     = new Trend('health_latency',       true)
const txnListLatency    = new Trend('txn_list_latency',     true)
const fxLatency         = new Trend('fx_latency',           true)

// ── Scenario profiles ─────────────────────────────────────────────────────────

const SCENARIOS = {
  smoke: {
    executor:   'constant-vus',
    vus:        2,
    duration:   '30s',
  },
  load: {
    executor:   'ramping-vus',
    startVUs:   0,
    stages: [
      { duration: '2m', target: 50  },  // ramp up
      { duration: '5m', target: 50  },  // hold
      { duration: '1m', target: 0   },  // ramp down
    ],
  },
  stress: {
    executor:   'ramping-vus',
    startVUs:   0,
    stages: [
      { duration: '2m', target: 100  },
      { duration: '5m', target: 100  },
      { duration: '2m', target: 200  },
      { duration: '5m', target: 200  },
      { duration: '2m', target: 0    },
    ],
  },
  soak: {
    executor:   'constant-vus',
    vus:        30,
    duration:   '30m',
  },
}

export const options = {
  scenarios: { main: SCENARIOS[SCENARIO] || SCENARIOS.smoke },

  thresholds: {
    'http_req_failed':      ['rate<0.01'],        // < 1% error rate
    'http_req_duration':    ['p(95)<500'],         // 95th pct under 500 ms
    'health_latency':       ['p(95)<50'],          // health endpoint must be fast
    'txn_list_latency':     ['p(95)<200'],         // list transactions < 200 ms
    'fx_latency':           ['p(95)<100'],         // FX rates < 100 ms
  },
}

const HEADERS = {
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${JWT_TOKEN}`,
}

// ── Virtual user script ───────────────────────────────────────────────────────

export default function () {
  // 1. Shallow health check
  {
    const res = http.get(`${BASE_URL}/health`)
    healthLatency.add(res.timings.duration)
    errorRate.add(!check(res, {
      'health 200':          (r) => r.status === 200,
      'health status ok':    (r) => JSON.parse(r.body).status === 'ok',
    }))
  }

  sleep(0.5)

  // 2. FX rates (unauthenticated — public endpoint)
  {
    const res = http.get(`${BASE_URL}/api/v1/fx/rates?from=KES&to=USD`)
    fxLatency.add(res.timings.duration)
    errorRate.add(!check(res, {
      'fx 200 or 401': (r) => [200, 401].includes(r.status),
    }))
  }

  sleep(0.5)

  // 3. List transactions (authenticated)
  {
    const res = http.get(`${BASE_URL}/api/v1/transactions?limit=20`, { headers: HEADERS })
    txnListLatency.add(res.timings.duration)
    errorRate.add(!check(res, {
      'txn list 200 or 401': (r) => [200, 401].includes(r.status),
    }))
  }

  sleep(1)
}

export function handleSummary(data) {
  return {
    'load-test-results.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  }
}

// Inline summary formatter (avoids external import)
function textSummary(data, opts) {
  const { metrics } = data
  const lines = ['', '── OrchestratePay Load Test Summary ──────────────────────────']
  for (const [name, m] of Object.entries(metrics)) {
    if (m.type === 'trend') {
      lines.push(`  ${name.padEnd(28)} p50=${m.values['p(50)']?.toFixed(0)}ms  p95=${m.values['p(95)']?.toFixed(0)}ms`)
    }
    if (m.type === 'rate') {
      lines.push(`  ${name.padEnd(28)} rate=${(m.values.rate * 100).toFixed(2)}%`)
    }
  }
  lines.push('───────────────────────────────────────────────────────────────', '')
  return lines.join('\n')
}

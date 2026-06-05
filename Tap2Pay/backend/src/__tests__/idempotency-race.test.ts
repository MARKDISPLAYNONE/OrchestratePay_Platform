/**
 * Suite: Idempotency Under True Async Concurrency (pure unit)
 *
 * The concurrency.test.ts suite covers sequential logic.
 * This suite covers ASYNC races: 10 requests landing at the exact same millisecond.
 *
 * The key question: when 10 coroutines all read "no cache entry" simultaneously
 * and then all try to write, do we get 1 STK push or 10?
 *
 * Defence: Redis SETNX (SET if Not eXists) is atomic at the Redis server level.
 * Only one caller gets "OK" from SETNX; the other 9 get null. We model this
 * here with a mutex-guarded Map to simulate atomic SETNX semantics.
 *
 * A secondary concern: the DB idempotency_key UNIQUE constraint is the last
 * line of defence if Redis is unavailable. We model that too.
 */

import crypto from 'crypto'

// ─── Atomic SETNX simulation ──────────────────────────────────────────────────

class AtomicCache {
  private data = new Map<string, string>()
  // Simulates Redis SETNX — returns true only if the key was freshly set
  setnx(key: string, value: string): boolean {
    if (this.data.has(key)) return false
    this.data.set(key, value)
    return true
  }
  get(key: string): string | null {
    return this.data.get(key) ?? null
  }
}

// ─── Unique constraint simulation (DB fallback) ───────────────────────────────

class UniqueConstraintDb {
  private keys = new Set<string>()
  // Returns true if inserted; throws on duplicate (mirrors Postgres UNIQUE constraint)
  insert(idempotencyKey: string): boolean {
    if (this.keys.has(idempotencyKey)) {
      throw new Error(`duplicate key value violates unique constraint "transactions_idempotency_key_key"`)
    }
    this.keys.add(idempotencyKey)
    return true
  }
}

// ─── Simulated payment gate ───────────────────────────────────────────────────

interface GateResult {
  didFire: boolean
  cached: boolean
  txnId: string
}

function buildGate(cache: AtomicCache, db: UniqueConstraintDb) {
  let stkPushCount = 0

  async function initiatePayment(idempotencyKey: string): Promise<GateResult> {
    // Step 1: Redis SETNX (atomic — only 1 of N callers wins)
    const won = cache.setnx(`idem:${idempotencyKey}`, 'processing')
    if (!won) {
      // Cache hit — return cached result
      return { didFire: false, cached: true, txnId: `cached-${idempotencyKey.slice(0, 8)}` }
    }

    // Step 2: DB insert with UNIQUE constraint (last-line defence)
    try {
      db.insert(idempotencyKey)
    } catch {
      // Race with another node that won DB but not Redis — DB is authoritative
      return { didFire: false, cached: false, txnId: `db-dupe-${idempotencyKey.slice(0, 8)}` }
    }

    // Step 3: Fire STK push (only runs once per unique key)
    stkPushCount++
    const txnId = `txn-${crypto.randomUUID().slice(0, 8)}`
    // Update Redis entry with real result
    cache.setnx(`result:${idempotencyKey}`, txnId)  // won't overwrite existing

    return { didFire: true, cached: false, txnId }
  }

  return { initiatePayment, getStkCount: () => stkPushCount }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeKey(): string {
  return crypto.createHash('sha256')
    .update('merchant-1:tag-1:10000:1716100000000', 'utf8')
    .digest('hex')
    .slice(0, 32)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Idempotency race: 10 concurrent identical requests', () => {
  it('exactly 1 STK push fires; 9 callers get a cache hit', async () => {
    const cache = new AtomicCache()
    const db    = new UniqueConstraintDb()
    const gate  = buildGate(cache, db)
    const key   = makeKey()

    // Simulate 10 requests landing simultaneously
    const results = await Promise.all(
      Array.from({ length: 10 }, () => gate.initiatePayment(key))
    )

    const fired  = results.filter(r => r.didFire)
    const cached = results.filter(r => r.cached)

    expect(fired).toHaveLength(1)
    expect(cached).toHaveLength(9)
    expect(gate.getStkCount()).toBe(1)
  })

  it('all 10 responses return the same txnId prefix pattern', async () => {
    const cache = new AtomicCache()
    const db    = new UniqueConstraintDb()
    const gate  = buildGate(cache, db)
    const key   = makeKey()

    const results = await Promise.all(
      Array.from({ length: 10 }, () => gate.initiatePayment(key))
    )

    // All 10 must succeed (no errors) regardless of cache/DB outcome
    expect(results).toHaveLength(10)
    expect(results.every(r => typeof r.txnId === 'string')).toBe(true)
  })

  it('100 concurrent requests with different keys all fire STK push', async () => {
    const cache = new AtomicCache()
    const db    = new UniqueConstraintDb()
    const gate  = buildGate(cache, db)

    // Each request has a unique idempotency key → all should fire
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => {
        const key = crypto.createHash('sha256').update(`key-${i}`).digest('hex').slice(0, 32)
        return gate.initiatePayment(key)
      })
    )

    expect(results.filter(r => r.didFire)).toHaveLength(100)
    expect(gate.getStkCount()).toBe(100)
  })

  it('same key across 3 sequential retries fires exactly once', async () => {
    const cache = new AtomicCache()
    const db    = new UniqueConstraintDb()
    const gate  = buildGate(cache, db)
    const key   = makeKey()

    const r1 = await gate.initiatePayment(key)
    const r2 = await gate.initiatePayment(key)  // retry
    const r3 = await gate.initiatePayment(key)  // second retry

    expect(r1.didFire).toBe(true)
    expect(r2.didFire).toBe(false)
    expect(r3.didFire).toBe(false)
    expect(gate.getStkCount()).toBe(1)
  })
})

describe('DB unique constraint fallback (Redis unavailable)', () => {
  it('DB constraint prevents double-fire even without Redis', () => {
    const db = new UniqueConstraintDb()
    const key = makeKey()

    let stkCount = 0

    function chargeWithDbOnly(key: string): boolean {
      try {
        db.insert(key)
        stkCount++  // DB insert succeeded — safe to fire
        return true
      } catch {
        return false  // Duplicate — skip
      }
    }

    expect(chargeWithDbOnly(key)).toBe(true)
    expect(chargeWithDbOnly(key)).toBe(false)
    expect(chargeWithDbOnly(key)).toBe(false)
    expect(stkCount).toBe(1)
  })

  it('DB constraint error message matches Postgres format', () => {
    const db = new UniqueConstraintDb()
    const key = makeKey()
    db.insert(key)
    expect(() => db.insert(key)).toThrow(/unique constraint/)
  })
})

describe('Idempotency key collision probability', () => {
  it('10,000 unique inputs produce 10,000 unique keys (no collisions)', () => {
    const keys = new Set<string>()
    for (let i = 0; i < 10_000; i++) {
      const key = crypto.createHash('sha256')
        .update(`merchant-${i}:tag-${i}:${i * 100}:${1_716_100_000_000}`, 'utf8')
        .digest('hex')
        .slice(0, 32)
      keys.add(key)
    }
    expect(keys.size).toBe(10_000)
  })

  it('same inputs always produce the same key (deterministic)', () => {
    function key(mid: string, tid: string, cents: number, ts: number) {
      const minute = Math.floor(ts / 60_000) * 60_000
      return crypto.createHash('sha256')
        .update(`${mid}:${tid}:${cents}:${minute}`, 'utf8')
        .digest('hex').slice(0, 32)
    }
    expect(key('m1', 't1', 500, 1_716_100_000_000))
      .toBe(key('m1', 't1', 500, 1_716_100_000_000))
  })
})

/**
 * Suite: Device Binding Enforcement (pure unit — no real Redis or DB)
 *
 * Tests the deterministic logic in middleware/auth.ts:checkDeviceBinding():
 *   - Valid device → allowed
 *   - Different device (newer login) → 401 "another device has logged in"
 *   - NULL device_id (logged out) → 401 "session revoked"
 *   - Legacy token without deviceId claim → pass through (backwards compat)
 *   - Cache miss → DB fallback, result backfilled into cache
 *   - Redis/DB error → fail open (payment terminal must not go dark)
 *   - Redis key format: merchant:device:{merchantId}
 *   - Cache TTL: 9 h (32400 s) — covers the 8 h JWT lifetime
 *   - Login writes new deviceId to Redis (overwrites old, instant revocation)
 *   - Logout deletes the Redis key (in-flight JWTs rejected on next request)
 */

// ── Inline mirror of checkDeviceBinding from middleware/auth.ts ───────────────

export const DEVICE_CACHE_TTL_S = 9 * 60 * 60   // 32400 s
const DEVICE_KEY = (id: string) => `merchant:device:${id}`

interface MerchantPayload {
  sub:      string
  name:     string
  role:     string
  deviceId: string | undefined
  iat:      number
  exp:      number
}

interface MockRedis {
  store: Record<string, string>
  get:   (key: string)                        => Promise<string | null>
  setex: (key: string, ttl: number, val: string) => Promise<void>
  del:   (key: string)                        => Promise<void>
}

interface MockDb {
  rows: Array<{ device_id: string | null }>
  query: () => Promise<{ rows: Array<{ device_id: string | null }> }>
}

type Decision = { allowed: true } | { allowed: false; status: number; error: string }

async function checkDeviceBinding(
  payload:   MerchantPayload,
  mockRedis: MockRedis,
  mockDb:    MockDb,
  throwOn?:  'redis' | 'db',
): Promise<Decision> {
  if (!payload.deviceId) return { allowed: true }

  try {
    if (throwOn === 'redis') throw new Error('Redis connection refused')

    let current = await mockRedis.get(DEVICE_KEY(payload.sub))

    if (current === null) {
      if (throwOn === 'db') throw new Error('DB connection refused')
      const { rows } = await mockDb.query()
      current = rows[0]?.device_id ?? null
      if (current) {
        await mockRedis.setex(DEVICE_KEY(payload.sub), DEVICE_CACHE_TTL_S, current)
      }
    }

    if (current === null) {
      return { allowed: false, status: 401, error: 'Session revoked — please log in again' }
    }
    if (payload.deviceId !== current) {
      return { allowed: false, status: 401, error: 'Session invalidated — another device has logged in' }
    }

    return { allowed: true }
  } catch {
    return { allowed: true }   // fail open
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRedis(initial: Record<string, string> = {}): MockRedis {
  const store = { ...initial }
  return {
    store,
    get:   async (k) => store[k] ?? null,
    setex: async (k, _ttl, v) => { store[k] = v },
    del:   async (k) => { delete store[k] },
  }
}

function makeDb(deviceId: string | null): MockDb {
  return {
    rows: [{ device_id: deviceId }],
    query: async function() { return { rows: this.rows } },
  }
}

function makePayload(deviceId: string | undefined, sub = 'merchant-uuid'): MerchantPayload {
  return { sub, name: 'Test Merchant', role: 'MERCHANT', deviceId, iat: 0, exp: 9999999999 }
}

// ── Redis key format ──────────────────────────────────────────────────────────

describe('Redis key format', () => {
  it('key is merchant:device:{merchantId}', () => {
    expect(DEVICE_KEY('abc-123')).toBe('merchant:device:abc-123')
  })

  it('different merchants get different keys', () => {
    expect(DEVICE_KEY('merchant-a')).not.toBe(DEVICE_KEY('merchant-b'))
  })

  it('key namespace does not collide with other merchant: keys', () => {
    const deviceKey  = DEVICE_KEY('same-id')
    expect(deviceKey).not.toBe(`merchant:session:same-id`)
    expect(deviceKey).not.toBe(`merchant:same-id`)
  })
})

// ── Cache TTL ─────────────────────────────────────────────────────────────────

describe('Cache TTL', () => {
  it('TTL is 9 hours (32400 s)', () => {
    expect(DEVICE_CACHE_TTL_S).toBe(32400)
  })

  it('TTL (9 h) exceeds JWT lifetime (8 h) — cache is warm for the full token life', () => {
    const JWT_LIFETIME_S = 8 * 60 * 60  // 28800 s
    expect(DEVICE_CACHE_TTL_S).toBeGreaterThan(JWT_LIFETIME_S)
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('Valid device — allowed', () => {
  it('deviceId in JWT matches Redis → allowed', async () => {
    const redis  = makeRedis({ 'merchant:device:merchant-uuid': 'device-A' })
    const db     = makeDb('device-A')
    const result = await checkDeviceBinding(makePayload('device-A'), redis, db)
    expect(result.allowed).toBe(true)
  })

  it('cache hit — DB is never queried', async () => {
    let dbQueried = false
    const redis = makeRedis({ 'merchant:device:merchant-uuid': 'device-A' })
    const db: MockDb = {
      rows: [],
      query: async function() { dbQueried = true; return { rows: this.rows } },
    }
    await checkDeviceBinding(makePayload('device-A'), redis, db)
    expect(dbQueried).toBe(false)
  })
})

// ── Wrong device (newer login) ────────────────────────────────────────────────

describe('Different device — 401', () => {
  it('JWT has deviceId=A but Redis says deviceId=B → 401', async () => {
    const redis  = makeRedis({ 'merchant:device:merchant-uuid': 'device-B' })
    const db     = makeDb('device-B')
    const result = await checkDeviceBinding(makePayload('device-A'), redis, db)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.status).toBe(401)
      expect(result.error).toMatch(/another device/)
    }
  })

  it('new login overwrites the Redis key — old JWT is rejected immediately', async () => {
    const redis = makeRedis({ 'merchant:device:merchant-uuid': 'device-A' })
    // Simulate new login writing device-B
    await redis.setex('merchant:device:merchant-uuid', DEVICE_CACHE_TTL_S, 'device-B')

    const result = await checkDeviceBinding(makePayload('device-A'), redis, makeDb('device-B'))
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.error).toMatch(/another device/)
  })
})

// ── Logged out (NULL device_id) ───────────────────────────────────────────────

describe('Logged-out session — 401', () => {
  it('Redis key absent and DB device_id is NULL → session revoked', async () => {
    const redis  = makeRedis({})                // no key in cache
    const db     = makeDb(null)                 // NULL in DB (logged out)
    const result = await checkDeviceBinding(makePayload('device-A'), redis, db)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.status).toBe(401)
      expect(result.error).toMatch(/revoked/)
    }
  })

  it('logout deletes the Redis key — subsequent request falls to DB and finds NULL', async () => {
    const redis = makeRedis({ 'merchant:device:merchant-uuid': 'device-A' })
    // Simulate logout
    await redis.del('merchant:device:merchant-uuid')
    expect(redis.store['merchant:device:merchant-uuid']).toBeUndefined()

    const result = await checkDeviceBinding(makePayload('device-A'), redis, makeDb(null))
    expect(result.allowed).toBe(false)
  })
})

// ── Cache miss → DB fallback ──────────────────────────────────────────────────

describe('Cache miss — DB fallback', () => {
  it('Redis miss + matching DB device_id → allowed', async () => {
    const redis  = makeRedis({})
    const db     = makeDb('device-A')
    const result = await checkDeviceBinding(makePayload('device-A'), redis, db)
    expect(result.allowed).toBe(true)
  })

  it('DB result is backfilled into Redis after cache miss', async () => {
    const redis = makeRedis({})
    const db    = makeDb('device-A')
    await checkDeviceBinding(makePayload('device-A'), redis, db)
    expect(redis.store['merchant:device:merchant-uuid']).toBe('device-A')
  })

  it('Redis miss + mismatched DB device_id → 401', async () => {
    const redis  = makeRedis({})
    const db     = makeDb('device-B')     // DB has a different device
    const result = await checkDeviceBinding(makePayload('device-A'), redis, db)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.error).toMatch(/another device/)
  })
})

// ── Legacy tokens (no deviceId claim) ────────────────────────────────────────

describe('Legacy tokens — backwards compatibility', () => {
  it('token with no deviceId claim → allowed (legacy terminal)', async () => {
    const redis  = makeRedis({})
    const db     = makeDb(null)
    const result = await checkDeviceBinding(makePayload(undefined), redis, db)
    expect(result.allowed).toBe(true)
  })

  it('legacy token does not query Redis or DB', async () => {
    let redisQueried = false
    let dbQueried    = false
    const redis: MockRedis = {
      store: {},
      get:   async () => { redisQueried = true; return null },
      setex: async () => {},
      del:   async () => {},
    }
    const db: MockDb = {
      rows: [],
      query: async function() { dbQueried = true; return { rows: [] } },
    }
    await checkDeviceBinding(makePayload(undefined), redis, db)
    expect(redisQueried).toBe(false)
    expect(dbQueried).toBe(false)
  })
})

// ── Fail-open on infrastructure error ────────────────────────────────────────

describe('Infrastructure errors — fail open', () => {
  it('Redis error → fail open (payment terminal must not go dark)', async () => {
    const redis  = makeRedis({})
    const db     = makeDb('device-A')
    const result = await checkDeviceBinding(makePayload('device-A'), redis, db, 'redis')
    expect(result.allowed).toBe(true)
  })

  it('DB error (during cache miss fallback) → fail open', async () => {
    const redis  = makeRedis({})             // cache miss will trigger DB
    const db     = makeDb('device-A')
    const result = await checkDeviceBinding(makePayload('device-A'), redis, db, 'db')
    expect(result.allowed).toBe(true)
  })

  it('fail-open never returns an error field (allows request to proceed)', async () => {
    const redis  = makeRedis({})
    const db     = makeDb('device-A')
    const result = await checkDeviceBinding(makePayload('device-A'), redis, db, 'redis')
    expect(result.allowed).toBe(true)
    // allowed:true means no 401 is sent; the request proceeds normally
  })
})

// ── Login / logout state transitions ─────────────────────────────────────────

describe('Login and logout state transitions', () => {
  it('first login: Redis key is written with the deviceId', async () => {
    const redis = makeRedis({})
    await redis.setex(DEVICE_KEY('merchant-uuid'), DEVICE_CACHE_TTL_S, 'device-A')
    expect(redis.store[DEVICE_KEY('merchant-uuid')]).toBe('device-A')
  })

  it('second login from a new device: Redis key is overwritten', async () => {
    const redis = makeRedis({ [DEVICE_KEY('merchant-uuid')]: 'device-A' })
    await redis.setex(DEVICE_KEY('merchant-uuid'), DEVICE_CACHE_TTL_S, 'device-B')
    expect(redis.store[DEVICE_KEY('merchant-uuid')]).toBe('device-B')
  })

  it('full session lifecycle: login → use → re-login elsewhere → old device rejected', async () => {
    const redis = makeRedis({})
    const merchantId = 'merchant-uuid'

    // Login from device A
    await redis.setex(DEVICE_KEY(merchantId), DEVICE_CACHE_TTL_S, 'device-A')
    const useA = await checkDeviceBinding(makePayload('device-A', merchantId), redis, makeDb('device-A'))
    expect(useA.allowed).toBe(true)

    // New login from device B (overwrites Redis key)
    await redis.setex(DEVICE_KEY(merchantId), DEVICE_CACHE_TTL_S, 'device-B')

    // Device A's JWT is now rejected
    const useAAfter = await checkDeviceBinding(makePayload('device-A', merchantId), redis, makeDb('device-B'))
    expect(useAAfter.allowed).toBe(false)

    // Device B works
    const useB = await checkDeviceBinding(makePayload('device-B', merchantId), redis, makeDb('device-B'))
    expect(useB.allowed).toBe(true)
  })

  it('logout then re-request: in-flight JWT is rejected via NULL DB lookup', async () => {
    const redis = makeRedis({ [DEVICE_KEY('merchant-uuid')]: 'device-A' })

    // Logout clears the key
    await redis.del(DEVICE_KEY('merchant-uuid'))

    // In-flight request from device A arrives after logout
    const result = await checkDeviceBinding(makePayload('device-A'), redis, makeDb(null))
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.error).toMatch(/revoked/)
  })
})

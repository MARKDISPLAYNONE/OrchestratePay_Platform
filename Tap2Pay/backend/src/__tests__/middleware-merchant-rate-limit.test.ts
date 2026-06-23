/**
 * middleware-merchant-rate-limit.test.ts — Full coverage for src/middleware/merchant-rate-limit.ts
 *
 * The rate limiter uses a Redis sorted-set sliding window via MULTI/EXEC pipeline.
 * Key is `rate:merchant:{merchantId}` when req.merchant.sub exists, else `rate:ip:{ip}`.
 *
 * Covers:
 *   - Returns 429 with Retry-After header when count > max
 *   - Calls next() when under limit
 *   - Uses merchantId as key when req.merchant.sub is present
 *   - Falls back to IP when req.merchant is absent
 *   - Fails open (calls next()) on Redis pipeline error
 *   - Sets X-RateLimit-Limit, X-RateLimit-Remaining headers
 */
import { Request, Response, NextFunction } from 'express'

process.env.NODE_ENV = 'test'

// ── Mock Redis multi/exec pipeline ────────────────────────────────────────────
const mockExec   = jest.fn()
const mockPipeline = {
  zremrangebyscore: jest.fn().mockReturnThis(),
  zadd:             jest.fn().mockReturnThis(),
  zcard:            jest.fn().mockReturnThis(),
  pexpire:          jest.fn().mockReturnThis(),
  exec:             mockExec,
}

jest.mock('../db/redis', () => ({
  redis: { multi: jest.fn(() => mockPipeline) },
}))

// ── Mock logger ───────────────────────────────────────────────────────────────
jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { merchantRateLimit } from '../middleware/merchant-rate-limit'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'

function makeReq(overrides: Record<string, any> = {}): Partial<Request> {
  return {
    ip:       '127.0.0.1',
    merchant: undefined,
    ...overrides,
  }
}

function makeRes(): { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock } {
  const res: any = {}
  res.status    = jest.fn().mockReturnValue(res)
  res.json      = jest.fn().mockReturnValue(res)
  res.setHeader = jest.fn().mockReturnValue(res)
  return res
}

beforeEach(() => {
  jest.clearAllMocks()
  mockExec.mockReset()
  mockPipeline.zremrangebyscore.mockClear().mockReturnThis()
  mockPipeline.zadd.mockClear().mockReturnThis()
  mockPipeline.zcard.mockClear().mockReturnThis()
  mockPipeline.pexpire.mockClear().mockReturnThis()
})

// ─── Shared helper: make exec return a count as results[2][1] ─────────────────
function execWithCount(count: number) {
  mockExec.mockResolvedValueOnce([
    [null, 1],   // zremrangebyscore result
    [null, 1],   // zadd result
    [null, count],  // zcard result
    [null, 1],   // pexpire result
  ])
}

// ═════════════════════════════════════════════════════════════════════════════
// Core rate-limiting logic
// ═════════════════════════════════════════════════════════════════════════════

describe('merchantRateLimit — core behaviour', () => {
  it('calls next() when count is below max', async () => {
    execWithCount(5)

    const middleware = merchantRateLimit({ max: 10, windowMs: 60_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('calls next() when count equals max (not strictly over)', async () => {
    execWithCount(10)  // count === max → not blocked

    const middleware = merchantRateLimit({ max: 10, windowMs: 60_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 429 with Retry-After header when count exceeds max', async () => {
    execWithCount(11)  // count > max(10) → blocked

    const middleware = merchantRateLimit({ max: 10, windowMs: 60_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    )
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 60)  // Math.ceil(60000/1000)
  })

  it('uses custom message in 429 response', async () => {
    execWithCount(99)

    const middleware = merchantRateLimit({ max: 10, windowMs: 30_000, message: 'Slow down, please' })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(res.json).toHaveBeenCalledWith({ error: 'Slow down, please' })
  })

  it('uses default message when message option is not provided', async () => {
    execWithCount(99)

    const middleware = merchantRateLimit({ max: 10, windowMs: 30_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(res.json).toHaveBeenCalledWith({ error: 'Too many requests — please slow down' })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Key selection: merchantId vs IP
// ═════════════════════════════════════════════════════════════════════════════

describe('merchantRateLimit — Redis key selection', () => {
  it('uses merchant-scoped key when req.merchant.sub is present', async () => {
    execWithCount(1)

    const middleware = merchantRateLimit({ max: 100, windowMs: 60_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    // zremrangebyscore is called with the key as first arg
    const keyUsed = mockPipeline.zremrangebyscore.mock.calls[0][0]
    expect(keyUsed).toBe(`rate:merchant:${MERCHANT_ID}`)
  })

  it('uses IP-scoped key when req.merchant is absent', async () => {
    execWithCount(1)

    const middleware = merchantRateLimit({ max: 100, windowMs: 60_000 })
    const req  = makeReq({ merchant: undefined, ip: '192.168.1.100' })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    const keyUsed = mockPipeline.zremrangebyscore.mock.calls[0][0]
    expect(keyUsed).toBe('rate:ip:192.168.1.100')
  })

  it('uses "unknown" when req.merchant is absent and req.ip is undefined', async () => {
    execWithCount(1)

    const middleware = merchantRateLimit({ max: 100, windowMs: 60_000 })
    const req  = makeReq({ merchant: undefined, ip: undefined })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    const keyUsed = mockPipeline.zremrangebyscore.mock.calls[0][0]
    expect(keyUsed).toBe('rate:ip:unknown')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Response headers
// ═════════════════════════════════════════════════════════════════════════════

describe('merchantRateLimit — response headers', () => {
  it('sets X-RateLimit-Limit header to the configured max', async () => {
    execWithCount(3)

    const middleware = merchantRateLimit({ max: 50, windowMs: 60_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 50)
  })

  it('sets X-RateLimit-Remaining header to max - count', async () => {
    execWithCount(3)

    const middleware = merchantRateLimit({ max: 50, windowMs: 60_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 47)  // 50 - 3
  })

  it('sets X-RateLimit-Remaining to 0 (not negative) when count > max', async () => {
    execWithCount(200)

    const middleware = merchantRateLimit({ max: 50, windowMs: 60_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0)
  })

  it('sets X-RateLimit-Window-Ms header', async () => {
    execWithCount(1)

    const middleware = merchantRateLimit({ max: 50, windowMs: 30_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Window-Ms', 30_000)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Pipeline structure
// ═════════════════════════════════════════════════════════════════════════════

describe('merchantRateLimit — Redis pipeline structure', () => {
  it('executes all 4 pipeline commands in order', async () => {
    execWithCount(1)

    const middleware = merchantRateLimit({ max: 100, windowMs: 60_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(mockPipeline.zremrangebyscore).toHaveBeenCalledTimes(1)
    expect(mockPipeline.zadd).toHaveBeenCalledTimes(1)
    expect(mockPipeline.zcard).toHaveBeenCalledTimes(1)
    expect(mockPipeline.pexpire).toHaveBeenCalledTimes(1)
    expect(mockExec).toHaveBeenCalledTimes(1)
  })

  it('passes windowMs as pexpire TTL', async () => {
    execWithCount(1)

    const middleware = merchantRateLimit({ max: 100, windowMs: 45_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(mockPipeline.pexpire).toHaveBeenCalledWith(
      expect.any(String),
      45_000
    )
  })

  it('uses 0 for count when exec returns null results', async () => {
    mockExec.mockResolvedValueOnce(null)  // exec returns null

    const middleware = merchantRateLimit({ max: 100, windowMs: 60_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    // count = 0 → should pass through
    expect(next).toHaveBeenCalledTimes(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Fail-open on Redis error
// ═════════════════════════════════════════════════════════════════════════════

describe('merchantRateLimit — fail open on Redis error', () => {
  it('calls next() and logs warning when Redis pipeline throws', async () => {
    mockExec.mockRejectedValueOnce(new Error('Redis connection refused'))

    const middleware = merchantRateLimit({ max: 100, windowMs: 60_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()

    const { logger } = require('../util/logger')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Merchant rate limit Redis error'),
      expect.objectContaining({ error: 'Redis connection refused' })
    )
  })

  it('includes the rate limit key in the warning log', async () => {
    mockExec.mockRejectedValueOnce(new Error('Timeout'))

    const middleware = merchantRateLimit({ max: 100, windowMs: 60_000 })
    const req  = makeReq({ merchant: { sub: MERCHANT_ID } })
    const res  = makeRes()
    const next = jest.fn()

    await middleware(req as Request, res as unknown as Response, next as NextFunction)

    const { logger } = require('../util/logger')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ key: `rate:merchant:${MERCHANT_ID}` })
    )
  })
})

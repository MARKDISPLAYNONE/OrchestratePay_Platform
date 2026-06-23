/**
 * merchant-rate-limit.ts — Redis sliding-window rate limiter keyed on merchantId.
 *
 * Why Redis instead of the express-rate-limit memory store:
 *   The memory store is per-process. With 2+ backend pods, a merchant can
 *   make 100 req/min to pod A AND 100 req/min to pod B — effectively doubling
 *   the limit. The Redis sorted-set approach counts across all pods.
 *
 * Algorithm: sorted set where each member is a unique request stamp (ms + random).
 * On every request:
 *   1. Remove members older than the window (ZREMRANGEBYSCORE).
 *   2. Add the current request.
 *   3. Count members (ZCARD) — if > max, return 429.
 *   4. Set key TTL to the window duration so idle keys expire automatically.
 * All four steps run in a single Redis MULTI/EXEC pipeline (atomic).
 */
import { Request, Response, NextFunction } from 'express'
import { redis } from '../db/redis'
import { logger } from '../util/logger'

interface RateLimitOptions {
  /** Maximum requests allowed in the window. */
  max: number
  /** Window size in milliseconds. */
  windowMs: number
  /** Human-readable description for the 429 message. */
  message?: string
}

export function merchantRateLimit(opts: RateLimitOptions) {
  const { max, windowMs, message = 'Too many requests — please slow down' } = opts

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Prefer merchantId (post-auth) over IP so all terminals of the same merchant
    // share one bucket, and an unauthenticated flood from one IP doesn't pollute
    // another merchant's bucket.
    const key = req.merchant?.sub
      ? `rate:merchant:${req.merchant.sub}`
      : `rate:ip:${req.ip ?? 'unknown'}`

    try {
      const now    = Date.now()
      const cutoff = now - windowMs
      const stamp  = `${now}-${Math.random().toString(36).slice(2)}`

      const pipeline = redis.multi()
      pipeline.zremrangebyscore(key, '-inf', cutoff)
      pipeline.zadd(key, now, stamp)
      pipeline.zcard(key)
      pipeline.pexpire(key, windowMs)
      const results = await pipeline.exec()

      const count = (results?.[2]?.[1] as number) ?? 0
      const remaining = Math.max(0, max - count)

      res.setHeader('X-RateLimit-Limit',     max)
      res.setHeader('X-RateLimit-Remaining', remaining)
      res.setHeader('X-RateLimit-Window-Ms', windowMs)

      if (count > max) {
        res.setHeader('Retry-After', Math.ceil(windowMs / 1000))
        res.status(429).json({ error: message })
        return
      }

      next()
    } catch (err: unknown) {
      // Redis failure → fail open rather than block legitimate traffic.
      logger.warn('Merchant rate limit Redis error — failing open', {
        key,
        error: (err as Error).message,
      })
      next()
    }
  }
}

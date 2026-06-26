/**
 * merchant-rate-limit.ts — Redis sliding-window rate limiter keyed on source IP.
 *
 * Why Redis instead of the express-rate-limit memory store:
 *   The memory store is per-process. With 2+ backend pods, the same IP can
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
    // Key on IP address. This middleware runs before requireAuth so req.merchant
    // is not yet populated; using an unverified JWT sub for keying would allow
    // any caller to forge another merchant's rate-limit bucket (targeted DoS).
    // IP-based limiting is the safe pre-auth choice — post-auth merchant-scoped
    // limiting can be layered inside individual routers after requireAuth runs.
    const key = `rate:ip:${req.ip ?? 'unknown'}`

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

/**
 * db/redis.ts — Redis connection and helper utilities.
 *
 * Redis roles in OrchestratePay:
 *
 * 1. OAuth token cache (Daraja access tokens, 1hr TTL)
 *    Key: "daraja:token"
 *    Why: Daraja rate-limits token requests. Cache avoids hitting the limit
 *         when many transactions come in at once.
 *
 * 2. Idempotency cache (prevent duplicate STK Pushes)
 *    Key: "idempotency:{key}"
 *    TTL: 120s for PENDING, 3600s for CONFIRMED
 *    Why: If the Android app retries the same payment request (network dropout),
 *         we return the cached result instead of sending a second STK Push.
 *
 * 3. Pending transaction index (for fast status lookups)
 *    Key: "txn:pending:{txnId}"
 *    Why: The Android app polls every 2.5s. Reading from Redis is sub-millisecond
 *         vs. a Postgres query which might take 5-20ms. At 50 terminals × 12 polls
 *         per payment = 600 req/min — Redis handles this trivially.
 *
 * 4. Pub/Sub for real-time callback notification (future upgrade)
 *    Channel: "txn:{txnId}"
 *    Why: When the M-Pesa callback lands, we publish to the channel. The polling
 *         endpoint can subscribe and unblock immediately instead of waiting 2.5s.
 */
import Redis from 'ioredis'
import { logger } from '../util/logger'

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),  // backoff up to 3s
  enableReadyCheck: true,
  // lazyConnect: true defers the TCP connection until the first command is issued.
  // In production the startup health check (redis.ping()) triggers connection immediately.
  // In tests that never issue a real Redis command, no connection is attempted and
  // ioredis never schedules a retry Timeout — allowing Jest workers to exit cleanly.
  lazyConnect: true
})

redis.on('connect', () => logger.info('Redis connected'))
redis.on('error', (err) => logger.error('Redis error', { error: err.message }))

export async function redisHealthCheck(): Promise<void> {
  await redis.ping()
  logger.info('Redis connection healthy')
}

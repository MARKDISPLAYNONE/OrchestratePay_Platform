/**
 * util/distributed-lock.ts — Redis-based distributed lock (single-node Redlock).
 *
 * Uses SET key value NX EX seconds — atomic acquire in one round trip.
 * Safe for a single Redis node (which is our current topology).
 * If Redis is unavailable the lock degrades to in-process: the callback
 * still runs on all pods but the risk is bounded (reconciliation double-runs
 * are idempotent — they may fire duplicate Daraja STK Queries but cannot
 * double-charge because the DB uses optimistic locking).
 *
 * Usage:
 *   const released = await withDistributedLock('reconciliation', 300, async () => {
 *     await runReconciliation()
 *   })
 *   // released === false means lock was held by another pod
 */
import { redis } from '../db/redis'
import { logger } from './logger'
import crypto from 'crypto'

/**
 * Attempt to acquire a lock and run fn if successful.
 * Returns true if fn ran, false if the lock was already held.
 */
export async function withDistributedLock(
  lockName: string,
  ttlSeconds: number,
  fn: () => Promise<void>
): Promise<boolean> {
  const key   = `lock:${lockName}`
  const token = crypto.randomBytes(16).toString('hex')  // unique owner token

  let acquired = false
  try {
    // NX = only set if not exists, EX = expire after ttlSeconds
    const result = await redis.set(key, token, 'EX', ttlSeconds, 'NX')
    acquired = result === 'OK'
  } catch (err: unknown) {
    // Redis unavailable — fail open so the job still runs on at least one pod
    logger.warn('Distributed lock: Redis unavailable, running without lock', {
      lockName, error: (err as Error).message,
    })
    await fn()
    return true
  }

  if (!acquired) {
    logger.debug('Distributed lock: already held by another instance', { lockName })
    return false
  }

  try {
    await fn()
    return true
  } finally {
    // Release only if we still own the lock (compare-and-delete)
    try {
      const current = await redis.get(key)
      if (current === token) {
        await redis.del(key)
      }
    } catch (err: unknown) {
      logger.warn('Distributed lock: failed to release', { lockName, error: (err as Error).message })
    }
  }
}

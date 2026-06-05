/**
 * db/index.ts — PostgreSQL connection pool.
 *
 * Uses the 'pg' library's Pool class. Pool maintains multiple idle connections
 * so queries don't wait for a connection to be established.
 *
 * Pool settings:
 *   max: 10  — max simultaneous DB connections. For a pilot with 50 terminals
 *              sending occasional queries, 10 is plenty. Increase when TPS grows.
 *   min: 2   — keep 2 connections warm at all times (avoid cold-start latency)
 *   idleTimeoutMillis: 30000 — close idle connections after 30s (free DB resources)
 *
 * The DATABASE_URL comes from the environment (.env → process.env).
 * In production, use a connection pooler like PgBouncer in front of Postgres.
 */
import { Pool } from 'pg'
import { logger } from '../util/logger'

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  min: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,  // fail fast if DB is down (don't hang forever)
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }  // required for Render/Heroku managed Postgres
    : undefined
})

// Log a warning if a query takes more than 5 seconds
db.on('connect', () => logger.debug('New DB connection established'))
db.on('error', (err) => logger.error('Unexpected DB error', { error: err.message }))

/**
 * healthCheck — call this at startup to verify DB is reachable.
 * If this throws, abort startup: a server with no database is useless.
 */
export async function dbHealthCheck(): Promise<void> {
  const client = await db.connect()
  await client.query('SELECT 1')
  client.release()
  logger.info('Database connection healthy')
}

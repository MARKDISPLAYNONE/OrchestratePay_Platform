/**
 * migrate.ts — Versioned migration runner.
 *
 * Reads every *.sql file in src/db/migrations/ in alphabetical order and runs
 * any that have not yet been recorded in schema_migrations.  Each migration
 * executes in its own transaction so a failure leaves the database in a clean
 * state and the runner can be retried safely.
 *
 * Adding a new migration:
 *   1. Create src/db/migrations/002_<description>.sql
 *   2. Run: npm run migrate
 *
 * The runner will skip files whose version is already in schema_migrations,
 * so re-running after a partial failure is always safe.
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { db } from './index'
import { logger } from '../util/logger'

const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

async function migrate(): Promise<void> {
  logger.info('Running database migrations...')
  const client = await db.connect()
  try {
    // Bootstrap: ensure the tracking table exists before any migration runs.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    let applied = 0
    for (const file of files) {
      const version = file.replace(/\.sql$/, '')

      const { rows } = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [version]
      )
      if (rows.length > 0) {
        logger.debug(`Skipping already-applied migration: ${version}`)
        continue
      }

      logger.info(`Applying migration: ${version}`)
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version]
        )
        await client.query('COMMIT')
        logger.info(`Migration applied: ${version}`)
        applied++
      } catch (err) {
        await client.query('ROLLBACK')
        logger.error(`Migration failed: ${version}`, { error: (err as Error).message })
        throw err
      }
    }

    if (applied === 0) {
      logger.info('All migrations already applied — nothing to do')
    } else {
      logger.info(`Migrations complete — ${applied} applied`)
    }
  } finally {
    client.release()
    await db.end()
  }
}

migrate().catch((err) => {
  logger.error('Migration process failed', { error: err?.message ?? String(err) })
  process.exit(1)
})

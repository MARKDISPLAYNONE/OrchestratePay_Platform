/**
 * index.ts — Express server entry point.
 *
 * Startup sequence:
 *   1. Load environment variables from .env
 *   2. Health-check database and Redis connections
 *   3. Configure Express middleware (security, CORS, logging, rate limiting)
 *   4. Register routes
 *   5. Start reconciliation cron job
 *   6. Listen on PORT
 *
 * MIDDLEWARE ORDER MATTERS:
 *   Helmet (security headers) → CORS → Rate limiter → Morgan (request logging)
 *   → JSON parser → Routes → Error handler
 *
 * The reconciliation job runs independently of HTTP requests. It's registered
 * with node-cron which runs it on a schedule in the same process.
 * In production with multiple server instances, use a distributed lock (Redlock)
 * to ensure only one instance runs the reconciliation job at a time.
 */
import 'dotenv/config'  // must be first — loads .env before anything else imports process.env

import http from 'http'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import cron from 'node-cron'

import { dbHealthCheck } from './db/index'
import { redisHealthCheck } from './db/redis'
import { logger } from './util/logger'
import { runReconciliation } from './jobs/reconciliation'
import { requestId } from './middleware/request-id'
import { requireSafaricomIp } from './middleware/safaricom-ip'
import { initWsServer } from './realtime/ws-server'

import authRouter          from './routes/auth'
import transactionsRouter  from './routes/transactions'
import mpesaCallbackRouter from './routes/mpesa-callback'
import merchantsRouter     from './routes/merchants'
import tagsRouter          from './routes/tags'
import adminRouter         from './routes/admin'
import walletRouter        from './routes/wallet'
import devicesRouter, { adminFleetRouter } from './routes/devices'
import loyaltyRouter       from './routes/loyalty'
import fxRouter, { adminFxRouter } from './routes/fx'
import accountingRouter             from './routes/accounting'
import consumersRouter              from './routes/consumers'
import attestationRouter            from './routes/attestation'
import { refreshAllRates }          from './util/fx'
import { runGlPostingJob }          from './jobs/gl-posting'
import { db }                       from './db/index'
import paymentLinksRouter           from './routes/payment-links'
import splitPaymentsRouter          from './routes/split-payments'

const app = express()
const PORT = parseInt(process.env.PORT || '3000')

// Trust the first proxy in the chain (nginx/load balancer).
// This makes req.ip reflect the real client IP from X-Forwarded-For,
// which is required for the Safaricom IP allowlist to work correctly.
app.set('trust proxy', 1)

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

// Correlation ID — must be first so every subsequent log line can include it
app.use(requestId)

// Helmet sets security headers: X-Frame-Options, X-XSS-Protection, etc.
// Protects against clickjacking, content sniffing, and other common web attacks.
app.use(helmet())

// CORS: only allow requests from our Android app's domain (not from browsers)
// In production, restrict to your specific domains
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://orchestratepay.co.ke']
    : '*',
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key']
}))

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────────────────────────────────────

// General API rate limit: 100 requests per minute per IP
// This prevents a malfunctioning terminal from overwhelming the server
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down' }
})

// Transaction endpoint: stricter limit (prevents rapid-fire duplicate payment attempts)
const transactionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,  // 30 payment initiations per minute per IP
  message: { error: 'Transaction rate limit exceeded' }
})

// M-Pesa callback: no rate limit (Safaricom controls this)
// We trust Safaricom's servers and don't want to accidentally block their callbacks

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST PARSING AND LOGGING
// ─────────────────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }))  // parse JSON bodies, reject anything >1MB

// Morgan HTTP request logger
// Format: [timestamp] METHOD /path - STATUS - response_time ms
app.use(morgan(
  process.env.NODE_ENV === 'production' ? 'combined' : 'dev',
  { stream: { write: (msg) => logger.http(msg.trim()) } }
))

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.use(generalLimiter)

// Shallow health check — used by load balancers (fast, no DB/Redis hit)
app.get('/health', (_, res) => res.json({
  status:    'ok',
  timestamp: new Date().toISOString(),
  version:   process.env.npm_package_version || '1.0.0',
}))

// Deep health check — used by monitoring/alerting (Grafana, UptimeRobot, etc.)
// Returns per-component status so on-call can see exactly what is degraded.
app.get('/health/deep', async (_, res) => {
  const checks: Record<string, 'ok' | 'degraded' | 'down'> = {}
  let httpStatus = 200

  await Promise.allSettled([
    dbHealthCheck()
      .then(()  => { checks.database = 'ok' })
      .catch(() => { checks.database = 'down'; httpStatus = 503 }),

    redisHealthCheck()
      .then(()  => { checks.redis = 'ok' })
      .catch(() => { checks.redis = 'degraded'; httpStatus = Math.max(httpStatus, 207) }),
  ])

  res.status(httpStatus).json({
    status:    httpStatus === 200 ? 'ok' : httpStatus === 503 ? 'down' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
    version:   process.env.npm_package_version || '1.0.0',
    uptime:    Math.floor(process.uptime()),
  })
})

// API routes
app.use('/api/v1/auth',           authRouter)
app.use('/api/v1/merchants',      merchantsRouter)
app.use('/api/v1/transactions',   transactionLimiter, transactionsRouter)
app.use('/api/v1/tags',           tagsRouter)
app.use('/api/v1/admin',          adminRouter)
app.use('/api/v1/wallet',         walletRouter)  // customer HCE session tokens
app.use('/api/v1/devices',        devicesRouter)  // fleet telemetry ingest
app.use('/api/v1/loyalty',        loyaltyRouter)  // consumer loyalty balance + redemption
app.use('/api/v1/fx',             fxRouter)        // exchange rates (public)
app.use('/api/v1/accounting',     accountingRouter) // accounting integrations + GL postings
app.use('/api/v1/consumers',      consumersRouter)  // consumer portal
app.use('/api/v1/attestation',    attestationRouter)    // SoftPOS device attestation
app.use('/api/v1/admin/fleet',    adminFleetRouter)
app.use('/api/v1/admin/fx',       adminFxRouter)        // FX admin (force refresh)
app.use('/api/v1/payment-links',  paymentLinksRouter)   // shareable single-use payment links
app.use('/api/v1/split-payments', splitPaymentsRouter)  // group bill splitting
// requireSafaricomIp blocks non-Safaricom IPs in production (bypass in dev/test)
app.use('/api/v1/mpesa-callback', requireSafaricomIp, mpesaCallbackRouter)

// 404 handler — must come after all routes
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` })
})

// Global error handler — catches any unhandled errors in route handlers
// Must have 4 parameters for Express to treat it as an error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled route error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    requestId: req.id
  })
  res.status(500).json({ error: 'Internal server error', requestId: req.id })
})

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────────────────────────────────────

async function start() {
  try {
    // Verify external dependencies before accepting traffic
    logger.info('Checking database connection...')
    await dbHealthCheck()

    logger.info('Checking Redis connection...')
    await redisHealthCheck()

    // Verify required environment variables
    const required = ['DATABASE_URL', 'REDIS_URL', 'DARAJA_CONSUMER_KEY',
                      'DARAJA_CONSUMER_SECRET', 'DARAJA_SHORTCODE',
                      'DARAJA_PASSKEY', 'DARAJA_CALLBACK_BASE_URL', 'JWT_SECRET',
                      'ADMIN_SECRET']
    const missing = required.filter(k => !process.env[k])
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
    }

    // Create HTTP server and attach WebSocket server on the same port.
    // The WebSocket server intercepts requests to /ws; everything else goes to Express.
    const httpServer = http.createServer(app)
    initWsServer(httpServer)

    httpServer.listen(PORT, () => {
      logger.info(`OrchestratePay backend running on port ${PORT}`, {
        env: process.env.NODE_ENV,
        port: PORT,
        daraja: process.env.DARAJA_ENV === 'production' ? 'production' : 'sandbox'
      })
    })

    // Schedule reconciliation job: every 5 minutes
    // Cron expression: "*/5 * * * *" = every 5th minute
    cron.schedule('*/5 * * * *', async () => {
      try {
        await runReconciliation()
      } catch (err: any) {
        logger.error('Scheduled reconciliation failed', { error: err.message })
      }
    })

    logger.info('Reconciliation job scheduled (every 5 minutes)')

    // Refresh the hourly-revenue materialized view every 15 minutes.
    // CONCURRENTLY avoids locking the transactions table during analytics reads.
    cron.schedule('*/15 * * * *', async () => {
      try {
        await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_revenue')
        logger.info('mv_hourly_revenue refreshed')
      } catch (err: any) {
        logger.error('Materialized view refresh failed', { error: err.message })
      }
    })

    // Refresh FX rates every hour (top of the hour)
    cron.schedule('0 * * * *', async () => {
      try {
        const count = await refreshAllRates()
        logger.info('Hourly FX rate refresh complete', { count })
      } catch (err: any) {
        logger.error('Hourly FX rate refresh failed', { error: err.message })
      }
    })

    // Drain pending GL postings every 2 minutes
    cron.schedule('*/2 * * * *', async () => {
      try {
        await runGlPostingJob()
      } catch (err: any) {
        logger.error('GL posting job failed', { error: err.message })
      }
    })

    // Run reconciliation once at startup to handle any stuck transactions
    // from before the server was restarted
    setTimeout(() => runReconciliation(), 10_000)

  } catch (err: any) {
    logger.error('Server startup failed', { error: err.message })
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down gracefully')
  process.exit(0)
})

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise rejection', { reason })
})

start()

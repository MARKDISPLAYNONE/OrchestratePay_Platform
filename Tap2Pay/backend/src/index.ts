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
import { initSentry } from './util/sentry'
initSentry()  // initialise before any other import that could throw

import http from 'http'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import cron from 'node-cron'

import { dbHealthCheck, db } from './db/index'
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
import paymentLinksRouter           from './routes/payment-links'
import splitPaymentsRouter          from './routes/split-payments'
import paymentRailsRouter           from './routes/payment-rails'
import webhooksRouter               from './routes/webhooks'
import apiKeysRouter                from './routes/api-keys'
import disputesRouter               from './routes/disputes'
import refundsRouter                from './routes/refunds'
import subscriptionsRouter          from './routes/subscriptions'
import settlementRouter, { adminSettlementRouter } from './routes/settlement'
import kycRouter, { adminKycRouter } from './routes/kyc'
import { merchantRateLimit }        from './middleware/merchant-rate-limit'
import { swaggerRouter }            from './util/swagger'
import { runWebhookDeliveryJob }    from './jobs/webhook-delivery'
import { runSubscriptionBillingJob, runTrialExpiry } from './jobs/subscription-billing'
import { runSettlementJob }         from './jobs/settlement'

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

// Helmet sets security headers + Content-Security-Policy.
// CSP restricts what scripts/styles/frames the dashboard can load.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],  // Tailwind inline styles
      imgSrc:         ["'self'", 'data:', 'blob:'],    // QR code data URIs
      connectSrc:     ["'self'", 'wss:'],              // WebSocket connection
      fontSrc:        ["'self'"],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,  // required for QR code generation in canvas
}))

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

// Readiness probe — used by Kubernetes before routing traffic.
// Returns 503 if either DB or Redis is not reachable.
app.get('/readiness', async (_, res) => {
  try {
    await Promise.all([
      db.query('SELECT 1'),          // verify Postgres connection
      redisHealthCheck(),            // verify Redis connection
    ])
    res.json({ status: 'ready', timestamp: new Date().toISOString() })
  } catch (err: unknown) {
    logger.warn('Readiness check failed', { error: (err as Error).message })
    res.status(503).json({
      status:    'not_ready',
      error:     (err as Error).message,
      timestamp: new Date().toISOString(),
    })
  }
})

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
app.use('/api/v1/transactions',   transactionLimiter, merchantRateLimit({ max: 50, windowMs: 60_000 }), transactionsRouter)
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
app.use('/api/v1/rails',          paymentRailsRouter)   // multi-currency payment rail routing
app.use('/api/v1/webhooks',       webhooksRouter)        // merchant webhook subscriptions
app.use('/api/v1/api-keys',       apiKeysRouter)         // merchant API key management
app.use('/api/v1/disputes',       disputesRouter)        // payment dispute lifecycle
app.use('/api/v1/refunds',        refundsRouter)         // B2C refund initiation
app.use('/api/v1/subscriptions',  subscriptionsRouter)   // recurring subscription plans
app.use('/api/v1/settlements',    merchantRateLimit({ max: 60, windowMs: 60_000 }), settlementRouter)
app.use('/api/v1/kyc',            merchantRateLimit({ max: 30, windowMs: 60_000 }), kycRouter)
app.use('/api/v1/admin/settlements', adminSettlementRouter)
app.use('/api/v1/admin/kyc',         adminKycRouter)
// requireSafaricomIp blocks non-Safaricom IPs in production (bypass in dev/test)
app.use('/api/v1/mpesa-callback', requireSafaricomIp, mpesaCallbackRouter)

// API documentation — not gated behind auth so integrators can explore
app.use('/api-docs', swaggerRouter)

// 404 handler — must come after all routes
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` })
})

// Global error handler — catches any unhandled errors in route handlers
// Must have 4 parameters for Express to treat it as an error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
      } catch (err: unknown) {
        logger.error('Scheduled reconciliation failed', { error: (err as Error).message })
      }
    })

    logger.info('Reconciliation job scheduled (every 5 minutes)')

    // Refresh the hourly-revenue materialized view every 15 minutes.
    // CONCURRENTLY avoids locking the transactions table during analytics reads.
    cron.schedule('*/15 * * * *', async () => {
      try {
        await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_revenue')
        logger.info('mv_hourly_revenue refreshed')
      } catch (err: unknown) {
        logger.error('Materialized view refresh failed', { error: (err as Error).message })
      }
    })

    // Refresh FX rates every hour (top of the hour)
    cron.schedule('0 * * * *', async () => {
      try {
        const count = await refreshAllRates()
        logger.info('Hourly FX rate refresh complete', { count })
      } catch (err: unknown) {
        logger.error('Hourly FX rate refresh failed', { error: (err as Error).message })
      }
    })

    // Drain pending GL postings every 2 minutes
    cron.schedule('*/2 * * * *', async () => {
      try {
        await runGlPostingJob()
      } catch (err: unknown) {
        logger.error('GL posting job failed', { error: (err as Error).message })
      }
    })

    // Deliver queued webhook events every minute
    cron.schedule('* * * * *', async () => {
      try {
        await runWebhookDeliveryJob()
      } catch (err: unknown) {
        logger.error('Webhook delivery job failed', { error: (err as Error).message })
      }
    })

    // Fire subscription billing every minute (job is internally idempotent)
    cron.schedule('* * * * *', async () => {
      try {
        await runSubscriptionBillingJob()
      } catch (err: unknown) {
        logger.error('Subscription billing job failed', { error: (err as Error).message })
      }
    })

    // Expire trials daily at 02:00
    cron.schedule('0 2 * * *', async () => {
      try {
        await runTrialExpiry()
      } catch (err: unknown) {
        logger.error('Trial expiry job failed', { error: (err as Error).message })
      }
    })

    // Nightly settlement job at 23:50 Africa/Nairobi — after last business transactions
    cron.schedule('50 23 * * *', async () => {
      try {
        await runSettlementJob()
      } catch (err: unknown) {
        logger.error('Settlement job failed', { error: (err as Error).message })
      }
    }, { timezone: 'Africa/Nairobi' })

    // Run reconciliation once at startup to handle any stuck transactions
    // from before the server was restarted
    setTimeout(() => runReconciliation(), 10_000)

  } catch (err: unknown) {
    logger.error('Server startup failed', { error: (err as Error).message })
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
  process.exit(1)
})

void start()

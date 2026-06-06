/**
 * util/sentry.ts — Sentry error-tracking initialisation.
 *
 * Auto-activates when SENTRY_DSN is set. No-op in test/dev if unset.
 * Must be called as early as possible in index.ts (before any other imports
 * that could throw) so Sentry captures startup errors too.
 */
import { logger } from './logger'

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('SENTRY_DSN not set — error tracking disabled in production')
    }
    return
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/node')
    Sentry.init({
      dsn,
      environment:        process.env.NODE_ENV ?? 'development',
      release:            process.env.npm_package_version,
      tracesSampleRate:   process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      // Never send PII — phone numbers, emails, NFC UIDs, etc.
      sendDefaultPii: false,
      beforeSend(event: any) {
        // Scrub anything that looks like a phone number (254XXXXXXXXX)
        const str = JSON.stringify(event)
        if (/254\d{9}/.test(str)) {
          return null
        }
        return event
      },
    })
    logger.info('Sentry initialised', { environment: process.env.NODE_ENV })
  } catch (err: any) {
    logger.warn('Sentry initialisation failed — continuing without error tracking', {
      error: err.message,
    })
  }
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/node')
    Sentry.withScope((scope: any) => {
      if (context) scope.setExtras(context)
      Sentry.captureException(err)
    })
  } catch {
    // Sentry unavailable — already logged at init time
  }
}

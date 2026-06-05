/**
 * logger.ts — Winston logger configuration.
 *
 * Why Winston over console.log:
 *   1. Structured JSON output — log aggregators (Datadog, CloudWatch) can parse fields
 *   2. Log levels — filter noise in production (info+), verbose in development (debug+)
 *   3. Timestamps — automatically included in every line
 *   4. Transport flexibility — console now, file/remote later without changing call sites
 *
 * CBK requirement: retain logs for 7 years. In production, ship logs to S3/GCS via
 * a log forwarder — don't rely on local file retention.
 */
import winston from 'winston'

const { combine, timestamp, errors, json, colorize, simple } = winston.format

// Human-readable format for development, JSON for production (machine-parseable)
const devFormat  = combine(colorize(), timestamp({ format: 'HH:mm:ss' }), simple())
const prodFormat = combine(timestamp(), errors({ stack: true }), json())

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  defaultMeta: { service: 'orchestratepay-backend' },
  transports: [
    new winston.transports.Console(),
    // Production: add file or remote transport here
    // new winston.transports.File({ filename: 'error.log', level: 'error' }),
  ],
})

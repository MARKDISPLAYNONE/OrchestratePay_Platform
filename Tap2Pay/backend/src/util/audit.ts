/**
 * util/audit.ts — server_audit_log helper.
 *
 * Centralises all writes to server_audit_log so every call site
 * uses the same schema and never misses required fields.
 * Failures are non-fatal — a logging error must never block a payment.
 */
import { db } from '../db/index'
import { logger } from './logger'

export type AuditEvent =
  | 'MERCHANT_REGISTERED'
  | 'MERCHANT_LOGIN'
  | 'MERCHANT_LOGIN_FAILED'
  | 'MERCHANT_LOCKED_OUT'
  | 'MERCHANT_LOGOUT'
  | 'MERCHANT_APPROVED'
  | 'MERCHANT_REJECTED'
  | 'MERCHANT_SUSPENDED'
  | 'MERCHANT_REFRESH_TOKEN_ISSUED'
  | 'CONSUMER_REGISTERED'
  | 'CONSUMER_LOGIN'
  | 'CONSUMER_LOGIN_FAILED'
  | 'CONSUMER_OTP_REQUESTED'
  | 'CONSUMER_OTP_VERIFIED'
  | 'CONSUMER_LOGOUT'
  | 'TRANSACTION_CREATED'
  | 'TRANSACTION_CONFIRMED'
  | 'TRANSACTION_DECLINED'
  | 'TRANSACTION_EXPIRED'
  | 'RECONCILIATION_RUN'
  | 'ADMIN_ACTION'
  | 'KYC_APPROVED'
  | 'KYC_REJECTED'
  | 'SETTLEMENT_COMPLETED'
  | 'SETTLEMENT_FAILED'

export interface AuditParams {
  event:      AuditEvent
  entityType?: string
  entityId?:   string
  detail?:     Record<string, unknown>
  ip?:         string
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    await db.query(
      `INSERT INTO server_audit_log (event, entity_type, entity_id, detail, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.event,
        params.entityType ?? null,
        params.entityId   ?? null,
        params.detail ? JSON.stringify(params.detail) : null,
        params.ip         ?? null,
      ]
    )
  } catch (err: unknown) {
    // Non-fatal — log and continue
    logger.error('Audit log write failed', { event: params.event, error: (err as Error).message })
  }
}

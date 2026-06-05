/**
 * middleware/validate.ts — Joi request validation middleware factory.
 *
 * Usage: router.post('/route', validate(schema), handler)
 *
 * Joi validates the request body against a schema and returns a 400 with
 * a human-readable error if validation fails. This prevents bad data from
 * ever reaching the database or M-Pesa.
 *
 * Why validate in middleware (not in the handler):
 *   - DRY: validation logic is reusable across routes
 *   - Separation of concerns: handlers assume valid data
 *   - Consistent error format: all validation errors look the same
 */
import { Request, Response, NextFunction } from 'express'
import Joi from 'joi'

export function validate(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,     // return ALL errors, not just the first
      stripUnknown: true     // remove unexpected fields (security: prevents field injection)
    })

    if (error) {
      const messages = error.details.map(d => d.message).join('; ')
      return res.status(400).json({ error: 'Validation failed', details: messages })
    }

    req.body = value  // use the Joi-coerced/stripped version
    next()
  }
}

// ─── Schemas ────────────────────────────────────────────────────────────────

export const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  deviceId: Joi.string().required()
})

// KSh 1,000,000 maximum — matches PaymentOrchestrator.kt MAX_AMOUNT_CENTS
// Bug fix: was 10_000_000_00 (KSh 10M), 10× over the intended limit
const MAX_TRANSACTION_CENTS = 100_000_000  // 100,000,000 cents = KSh 1,000,000

// Timestamps must be a plausible Unix epoch millis (year 2020–2100).
// Prevents malformed idempotency keys from out-of-range values.
const TS_MIN = 1_577_836_800_000  // 2020-01-01 UTC
const TS_MAX = 4_102_444_800_000  // 2100-01-01 UTC

export const transactionSchema = Joi.object({
  merchantId:     Joi.string().uuid().required(),
  amountCents:    Joi.number().integer().min(100).max(MAX_TRANSACTION_CENTS).required(),
  source:         Joi.string().valid(
    'NFC_TAG',        // merchant terminal reads consumer NDEF sticker
    'QR_CODE',        // consumer scans merchant QR (consumer-initiated via web/app)
    'ISO_CARD',       // bank card via IsoDep (future)
    'HCE_PHONE',      // consumer HCE phone tapped by Sunmi terminal
    'SOFTPOS_MOBILE', // consumer HCE phone tapped by SoftPOS merchant phone
    'CONSUMER_TAG',   // merchant reads consumer-written identity sticker
    'CONSUMER_QR',    // merchant scans consumer wallet QR token
    'MERCHANT_HCE'    // consumer wallet reads merchant phone HCE payment request
  ).required(),
  tagId:          Joi.string().optional().allow(null),
  nfcUid:         Joi.string().optional().allow(null),
  idempotencyKey: Joi.string().length(32).hex().required(),
  timestamp:      Joi.number().integer().min(TS_MIN).max(TS_MAX).required(),
  currency:       Joi.string().valid('KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX', 'RWF').optional().default('KES'),
  // HCE_PHONE / SOFTPOS_MOBILE / MERCHANT_HCE fields
  consumerPhone:    Joi.string().pattern(/^254[0-9]{9}$/).optional().allow(null),
  hceToken:         Joi.string().length(32).hex().optional().allow(null),
  hceExp:           Joi.number().integer().optional().allow(null),
  // CONSUMER_QR: single-use Redis-backed token from POST /consumers/qr-token
  consumerQrToken:  Joi.string().uuid().optional().allow(null),
  // CONSUMER_TAG: consumerId from https://orchestratepay.co.ke/c/{consumerId}
  consumerTagId:    Joi.string().uuid().optional().allow(null),
  // MERCHANT_HCE: token the merchant's HCE emitted (resolves merchantId + amount server-side)
  merchantHceToken: Joi.string().uuid().optional().allow(null),
  // SoftPOS attestation
  deviceType:       Joi.string().optional().allow(null),
  integrityToken:   Joi.string().optional().allow(null),
})

// P2P payment schemas (consumer-to-consumer)
export const p2pPaySchema = Joi.object({
  // Supply either a p2pToken (from /consumers/p2p-token) or a direct payeeConsumerId
  p2pToken:        Joi.string().uuid().optional().allow(null),
  payeeConsumerId: Joi.string().uuid().optional().allow(null),
  amountCents:     Joi.number().integer().min(100).max(MAX_TRANSACTION_CENTS).required(),
  idempotencyKey:  Joi.string().length(32).hex().required(),
  timestamp:       Joi.number().integer().min(TS_MIN).max(TS_MAX).required(),
  currency:        Joi.string().valid('KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX', 'RWF').optional().default('KES'),
  source:          Joi.string().valid('P2P_NFC', 'P2P_QR').required(),
}).or('p2pToken', 'payeeConsumerId')  // at least one identity field required

export const merchantHceTokenSchema = Joi.object({
  amountCents: Joi.number().integer().min(100).max(MAX_TRANSACTION_CENTS).required(),
})

/**
 * routes/payment-rails.ts — multi-currency payment rail routing.
 *
 * Active rails:
 *   MPESA        — M-Pesa STK Push (redirects to /api/v1/transactions)
 *   AIRTEL_MONEY — Airtel Money collection (Airtel Africa Merchant API v2)
 *   TKASH        — Telkom T-Kash collection
 *
 * Stub rails (501 until acquirer credentials + PCI DSS compliance):
 *   VISA / MASTERCARD — card-present via ISO 14443 / NFC
 *   EQUITY_MOBILE     — Equity Bank EazzyPay
 *   COOP_MOBILE       — Co-operative Bank MCo-op Cash
 *   PESALINK          — interbank real-time transfer
 *
 * GET  /api/v1/rails           — list all rails and their current status
 * POST /api/v1/rails/:method   — route a payment to the specified rail
 */
import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { airtelCollect } from '../integrations/airtel'
import { tkashCollect }  from '../integrations/telkom'
import { logger }        from '../util/logger'

const router = Router()
router.use(requireAuth)

const AIRTEL_ACTIVE = !!(process.env.AIRTEL_CLIENT_ID && process.env.AIRTEL_CLIENT_SECRET)
const TKASH_ACTIVE  = !!(process.env.TKASH_CONSUMER_KEY && process.env.TKASH_CONSUMER_SECRET)

const RAILS: Record<string, { name: string; active: boolean; description: string }> = {
  MPESA: {
    name:        'M-Pesa STK Push',
    active:      true,
    description: 'Safaricom M-Pesa — STK Push to consumer phone. Use POST /api/v1/transactions.',
  },
  AIRTEL_MONEY: {
    name:        'Airtel Money',
    active:      AIRTEL_ACTIVE,
    description: 'Airtel Money Kenya — collection via Airtel Africa Merchant API v2.',
  },
  TKASH: {
    name:        'T-Kash',
    active:      TKASH_ACTIVE,
    description: 'Telkom Kenya T-Kash — mobile money collection.',
  },
  VISA: {
    name:        'Visa Card',
    active:      false,
    description: 'Card-present Visa via NFC ISO 14443. Requires PCI DSS MPoC certification.',
  },
  MASTERCARD: {
    name:        'Mastercard',
    active:      false,
    description: 'Card-present Mastercard via NFC ISO 14443. Requires PCI DSS MPoC certification.',
  },
  EQUITY_MOBILE: {
    name:        'Equity EazzyPay',
    active:      false,
    description: 'Equity Bank mobile money via EazzyPay API.',
  },
  COOP_MOBILE: {
    name:        'MCo-op Cash',
    active:      false,
    description: 'Co-operative Bank MCo-op Cash.',
  },
  PESALINK: {
    name:        'PesaLink',
    active:      false,
    description: 'Interbank real-time transfer via IPSL PesaLink.',
  },
}

// GET /api/v1/rails
router.get('/', (_req: Request, res: Response) => {
  res.json({
    rails: Object.entries(RAILS).map(([method, info]) => ({ method, ...info })),
  })
})

// POST /api/v1/rails/:method
router.post('/:method', async (req: Request, res: Response) => {
  const method = req.params.method.toUpperCase()
  const rail   = RAILS[method]

  if (!rail) {
    return res.status(400).json({
      error:     `Unknown payment rail: ${method}`,
      supported: Object.keys(RAILS),
    })
  }

  if (method === 'MPESA') {
    return res.status(301).json({
      message:  'MPESA rail routes through /api/v1/transactions',
      redirect: '/api/v1/transactions',
    })
  }

  if (!rail.active) {
    return res.status(503).json({
      error:       `${rail.name} is not configured on this platform`,
      rail:        method,
      description: rail.description,
      hint:        'Contact support@orchestratepay.co.ke for integration timeline',
    })
  }

  const { phone, amountCents, reference, description } = req.body
  if (!phone || !amountCents || !reference) {
    return res.status(400).json({ error: 'phone, amountCents, and reference are required' })
  }
  if (typeof amountCents !== 'number' || amountCents < 100) {
    return res.status(400).json({ error: 'amountCents must be a number ≥ 100' })
  }

  const transactionId = req.headers['idempotency-key'] as string ?? crypto.randomUUID()

  try {
    if (method === 'AIRTEL_MONEY') {
      const result = await airtelCollect({ transactionId, phone, amountCents, reference })
      if (!result.success) {
        return res.status(422).json({ error: result.errorMessage ?? 'Airtel collection failed' })
      }
      logger.info('Airtel Money collection initiated', {
        transactionId, merchantId: req.merchant!.sub,
      })
      return res.status(202).json({
        status:        'PENDING',
        rail:          'AIRTEL_MONEY',
        transactionId: result.transactionId,
        message:       'Payment request sent to consumer — awaiting confirmation',
      })
    }

    if (method === 'TKASH') {
      const result = await tkashCollect({
        transactionId,
        phone,
        amountCents,
        reference,
        description: description ?? reference,
      })
      if (!result.success) {
        return res.status(422).json({ error: result.errorMessage ?? 'T-Kash collection failed' })
      }
      logger.info('T-Kash collection initiated', {
        transactionId, merchantId: req.merchant!.sub,
      })
      return res.status(202).json({
        status:         'PENDING',
        rail:           'TKASH',
        conversationId: result.conversationId,
        message:        'Payment request sent to consumer — awaiting confirmation',
      })
    }
  } catch (err: unknown) {
    logger.error('Payment rail error', { method, error: (err as Error).message, transactionId })
    return res.status(502).json({ error: (err as Error).message })
  }
})

export default router

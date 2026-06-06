/**
 * routes/payment-rails.ts — multi-currency payment rail routing.
 *
 * Currently active rail:
 *   MPESA — M-Pesa STK Push (fully implemented in routes/transactions.ts)
 *
 * Stub rails (returns 501 with a clear message until acquirer credentials
 * and PCI DSS compliance are in place):
 *   VISA / MASTERCARD — card-present via ISO 14443 / NFC
 *   EQUITY_MOBILE     — Equity Bank EazzyPay mobile money
 *   COOP_MOBILE       — Co-operative Bank MCo-op Cash
 *   PESALINK          — interbank real-time transfer
 *
 * GET /api/v1/rails             — list all rails and their current status
 * POST /api/v1/rails/:method    — route a payment to the specified rail
 */
import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

// Supported rails and their current availability
const RAILS: Record<string, { name: string; active: boolean; description: string }> = {
  MPESA: {
    name:        'M-Pesa STK Push',
    active:      true,
    description: 'Safaricom M-Pesa — STK Push to consumer phone. Use POST /api/v1/transactions.',
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
    description: 'Equity Bank mobile money via EazzyPay API. Requires Equity merchant agreement.',
  },
  COOP_MOBILE: {
    name:        'MCo-op Cash',
    active:      false,
    description: 'Co-operative Bank mobile money. Requires Co-op merchant agreement.',
  },
  PESALINK: {
    name:        'PesaLink',
    active:      false,
    description: 'Interbank real-time transfer via IPSL PesaLink. Requires IPSL membership.',
  },
}

// GET /api/v1/rails — list all rails
router.get('/', (_req: Request, res: Response) => {
  const list = Object.entries(RAILS).map(([method, info]) => ({
    method, ...info,
  }))
  res.json({ rails: list })
})

// POST /api/v1/rails/:method — attempt to route to a specific rail
router.post('/:method', (req: Request, res: Response) => {
  const method = req.params.method.toUpperCase()
  const rail   = RAILS[method]

  if (!rail) {
    return res.status(400).json({
      error:   `Unknown payment rail: ${method}`,
      supported: Object.keys(RAILS),
    })
  }

  if (method === 'MPESA') {
    return res.status(301).json({
      error:    'MPESA rail is routed through /api/v1/transactions',
      redirect: '/api/v1/transactions',
    })
  }

  if (!rail.active) {
    return res.status(501).json({
      error:       `${rail.name} is not yet active on this platform`,
      rail:        method,
      description: rail.description,
      eta:         'Contact support@orchestratepay.co.ke for integration timeline',
    })
  }
})

export default router

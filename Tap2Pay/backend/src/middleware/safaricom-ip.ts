/**
 * middleware/safaricom-ip.ts — Safaricom callback IP allowlist.
 *
 * WHY THIS EXISTS:
 * Safaricom does not sign M-Pesa callbacks with an HMAC or shared secret.
 * The only reliable way to authenticate a callback is to verify it originated
 * from Safaricom's known servers. Without this check, any attacker who knows
 * your callback URL can POST a fake "payment confirmed" and get goods/services
 * for free.
 *
 * HOW IT WORKS:
 * - In production: reject any request not from a known Safaricom IP
 * - In development/test: allow all IPs (you can't control ngrok endpoints)
 *
 * IMPORTANT — keep this list up to date:
 * Safaricom occasionally updates their egress IPs. Subscribe to their developer
 * mailing list at developer.safaricom.co.ke and update this list when notified.
 * Last verified: 2024-Q4
 *
 * NGINX / LOAD BALANCER:
 * For this to work, Express must know the real client IP. Set trust proxy in
 * index.ts and configure nginx to pass X-Forwarded-For correctly.
 */
import { Request, Response, NextFunction } from 'express'
import { logger } from '../util/logger'

// Safaricom's known egress IPs for M-Pesa callbacks
// Source: https://developer.safaricom.co.ke/docs#ip-filtering
const SAFARICOM_IPS = new Set([
  '196.201.214.200',
  '196.201.214.206',
  '196.201.213.114',
  '196.201.214.207',
  '196.201.214.208',
  '196.201.213.44',
  '196.201.212.127',
  '196.201.212.128',
  '196.201.212.129',
  '196.201.212.132',
  '196.201.212.136',
  '196.201.212.138',
])

export function requireSafaricomIp(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== 'production') {
    return next()
  }

  const raw = req.ip ?? ''
  // Express/Node may represent IPv4 as IPv4-mapped IPv6 (::ffff:196.201.x.x)
  const ip = raw.replace(/^::ffff:/, '')

  if (!SAFARICOM_IPS.has(ip)) {
    logger.warn('M-Pesa callback rejected — non-Safaricom IP', {
      ip,
      requestId: req.id,
      path: req.path
    })
    // 403, not 200: if the source is really Safaricom, it will never reach this branch.
    // Returning 403 (rather than 200) prevents spoofed callbacks from silently disappearing.
    // Safaricom retry logic only applies to their own egress IPs, which are in the allowlist.
    return res.status(403).json({ error: 'Forbidden' })
  }

  next()
}

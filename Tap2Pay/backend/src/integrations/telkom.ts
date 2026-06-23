/**
 * telkom.ts — Telkom Kenya T-Kash payment collection integration.
 *
 * T-Kash (formerly Orange Money Kenya) Merchant API:
 *   Base URL: https://developer.telkom.co.ke/api (production)
 *             https://sandbox.telkom.co.ke/api    (sandbox)
 *   Auth:     Basic auth (consumer key + secret) → access token
 *   Payment:  POST /tkash/payment/v1/collect
 *
 * Required env vars:
 *   TKASH_CONSUMER_KEY    — from Telkom Developer Portal
 *   TKASH_CONSUMER_SECRET — from Telkom Developer Portal
 *   TKASH_SHORTCODE       — merchant shortcode
 *   TKASH_ENV             — 'production' | 'sandbox' (default: sandbox)
 *   TKASH_CALLBACK_URL    — HTTPS endpoint for T-Kash to POST results
 */
import axios from 'axios'
import { redis } from '../db/redis'
import { logger } from '../util/logger'

const TKASH_BASE = process.env.TKASH_ENV === 'production'
  ? 'https://developer.telkom.co.ke/api'
  : 'https://sandbox.telkom.co.ke/api'

const REDIS_TOKEN_KEY = 'tkash:access_token'

export interface TkashPaymentRequest {
  transactionId: string
  phone:         string    // 07XXXXXXXX or 254XXXXXXXXX (Telkom prefix 077/078/079)
  amountCents:   number
  reference:     string
  description:   string
}

export interface TkashPaymentResult {
  success:        boolean
  conversationId: string
  errorMessage?:  string
}

async function getTkashToken(): Promise<string> {
  const cached = await redis.get(REDIS_TOKEN_KEY)
  if (cached) return cached

  const key    = process.env.TKASH_CONSUMER_KEY
  const secret = process.env.TKASH_CONSUMER_SECRET
  if (!key || !secret) {
    throw new Error('T-Kash credentials not configured — set TKASH_CONSUMER_KEY and TKASH_CONSUMER_SECRET')
  }

  const credentials = Buffer.from(`${key}:${secret}`).toString('base64')

  const response = await axios.get(
    `${TKASH_BASE}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${credentials}` },
      timeout: 10_000,
    }
  )

  const token:     string = response.data.access_token
  const expiresIn: number = parseInt(response.data.expires_in) || 3600

  await redis.setex(REDIS_TOKEN_KEY, expiresIn - 60, token)
  logger.info('Fetched new T-Kash access token', { expiresIn })

  return token
}

export async function tkashCollect(req: TkashPaymentRequest): Promise<TkashPaymentResult> {
  const shortcode   = process.env.TKASH_SHORTCODE
  const callbackUrl = process.env.TKASH_CALLBACK_URL
  if (!shortcode || !callbackUrl) {
    throw new Error('T-Kash not fully configured — set TKASH_SHORTCODE and TKASH_CALLBACK_URL')
  }

  const token     = await getTkashToken()
  const amountKes = Math.ceil(req.amountCents / 100)
  const phone     = normaliseTkashPhone(req.phone)

  logger.info('Initiating T-Kash collection', {
    transactionId: req.transactionId,
    phone:         phone.slice(0, 6) + '****',
    amountKes,
  })

  const response = await axios.post(`${TKASH_BASE}/tkash/payment/v1/collect`, {
    MerchantCode:    shortcode,
    PhoneNumber:     phone,
    Amount:          amountKes,
    AccountReference: req.reference.slice(0, 12),
    TransactionDesc:  req.description.slice(0, 20),
    CallbackURL:     callbackUrl,
    TransactionID:   req.transactionId,
  }, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  })

  const data = response.data
  if (data.ResponseCode !== '0') {
    logger.warn('T-Kash collection declined', { response: data, transactionId: req.transactionId })
    return {
      success:        false,
      conversationId: req.transactionId,
      errorMessage:   data.ResponseDescription ?? 'T-Kash collection failed',
    }
  }

  return {
    success:        true,
    conversationId: data.ConversationID ?? req.transactionId,
  }
}

function normaliseTkashPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('254') && digits.length === 12) return digits
  if (digits.startsWith('0')   && digits.length === 10) return '254' + digits.slice(1)
  if (digits.length === 9) return '254' + digits
  return digits
}

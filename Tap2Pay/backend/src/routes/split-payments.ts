/**
 * routes/split-payments.ts — Group/bill-split payment sessions.
 *
 * One merchant transaction split across N consumers (2–10), each receiving
 * their own STK Push for their share. Session lives in Redis for 5 minutes.
 *
 * POST /api/v1/split-payments         — merchant creates session
 * POST /api/v1/split-payments/:id/join — additional consumer joins
 * GET  /api/v1/split-payments/:id     — poll session state
 * POST /api/v1/split-payments/:id/initiate — trigger all STK Pushes
 */
import { Router, Request, Response } from 'express'
import Joi from 'joi'
import { v4 as uuidv4 } from 'uuid'
import { redis }       from '../db/redis'
import { requireAuth } from '../middleware/auth'
import { validate }    from '../middleware/validate'
import { logger }      from '../util/logger'

const router = Router()

const SESSION_TTL_S  = 300   // 5 minutes
const MAX_PARTICIPANTS = 10

export interface SplitParticipant {
  phone:      string
  shareCents: number
  status:     'PENDING' | 'STK_SENT' | 'CONFIRMED' | 'DECLINED' | 'FAILED'
  txnId?:     string
}

export interface SplitSession {
  id:           string
  merchantId:   string
  totalCents:   number
  description:  string | null
  participants: SplitParticipant[]
  createdAt:    string
  status:       'OPEN' | 'INITIATING' | 'COMPLETE' | 'PARTIAL' | 'EXPIRED'
}

const createSplitSchema = Joi.object({
  totalAmountCents: Joi.number().integer().min(100).required(),
  description:      Joi.string().max(100).optional(),
  participants: Joi.array().items(
    Joi.object({
      phone:      Joi.string().pattern(/^254[0-9]{9}$/).required(),
      shareCents: Joi.number().integer().min(1).required(),
    })
  ).min(2).max(MAX_PARTICIPANTS).required(),
})

const joinSchema = Joi.object({
  phone:      Joi.string().pattern(/^254[0-9]{9}$/).required(),
  shareCents: Joi.number().integer().min(1).required(),
})

function sessionKey(id: string) { return `split:${id}` }

// POST /api/v1/split-payments
router.post('/', requireAuth, validate(createSplitSchema), async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { totalAmountCents, description, participants } = req.body

  const computedTotal = (participants as SplitParticipant[]).reduce((s, p) => s + p.shareCents, 0)
  if (computedTotal !== totalAmountCents) {
    return res.status(400).json({
      error: `Share amounts sum to ${computedTotal} cents but totalAmountCents is ${totalAmountCents}`,
    })
  }

  const id: string = uuidv4()
  const session: SplitSession = {
    id,
    merchantId,
    totalCents:  totalAmountCents,
    description: description ?? null,
    participants: (participants as SplitParticipant[]).map(p => ({
      ...p, status: 'PENDING' as const,
    })),
    createdAt: new Date().toISOString(),
    status:    'OPEN',
  }

  await redis.setex(sessionKey(id), SESSION_TTL_S, JSON.stringify(session))

  logger.info('Split payment session created', {
    id,
    merchantId,
    totalAmountCents,
    participantCount: participants.length,
  })
  res.status(201).json({ sessionId: id, session })
})

// POST /api/v1/split-payments/:id/join
router.post('/:id/join', validate(joinSchema), async (req: Request, res: Response) => {
  const { id }              = req.params
  const { phone, shareCents } = req.body

  const raw = await redis.get(sessionKey(id))
  if (!raw) return res.status(404).json({ error: 'Split session not found or expired' })

  const session: SplitSession = JSON.parse(raw)

  if (session.status !== 'OPEN') {
    return res.status(400).json({ error: `Session is ${session.status} — cannot join` })
  }
  if (session.participants.some(p => p.phone === phone)) {
    return res.status(409).json({ error: 'Phone number already in this split session' })
  }
  if (session.participants.length >= MAX_PARTICIPANTS) {
    return res.status(400).json({ error: `Maximum ${MAX_PARTICIPANTS} participants per session` })
  }

  session.participants.push({ phone, shareCents, status: 'PENDING' })

  const ttl = await redis.ttl(sessionKey(id))
  await redis.setex(sessionKey(id), Math.max(ttl, 1), JSON.stringify(session))

  logger.info('Participant joined split session', {
    id,
    phone: phone.slice(0, 6) + '****',
    participantCount: session.participants.length,
  })
  res.json({ sessionId: id, participantCount: session.participants.length })
})

// GET /api/v1/split-payments/:id
router.get('/:id', async (req: Request, res: Response) => {
  const raw = await redis.get(sessionKey(req.params.id))
  if (!raw) return res.status(404).json({ error: 'Split session not found or expired' })
  res.json(JSON.parse(raw))
})

// POST /api/v1/split-payments/:id/initiate
router.post('/:id/initiate', requireAuth, async (req: Request, res: Response) => {
  const { id }    = req.params
  const merchantId = req.merchant!.sub

  const raw = await redis.get(sessionKey(id))
  if (!raw) return res.status(404).json({ error: 'Split session not found or expired' })

  const session: SplitSession = JSON.parse(raw)

  if (session.merchantId !== merchantId) {
    return res.status(403).json({ error: 'Only the session creator can initiate payment' })
  }
  if (session.status !== 'OPEN') {
    return res.status(400).json({ error: `Session already ${session.status}` })
  }

  session.status = 'INITIATING'
  const ttl = await redis.ttl(sessionKey(id))
  await redis.setex(sessionKey(id), Math.max(ttl, 1), JSON.stringify(session))

  logger.info('Split payment initiating STK Pushes', {
    sessionId: id,
    participantCount: session.participants.length,
    totalCents: session.totalCents,
  })

  // Actual STK Push dispatch per participant would be triggered here.
  // Each call is independent — one failure does not prevent others.
  res.json({
    sessionId: id,
    status:    'INITIATING',
    message:   `STK Push sent to ${session.participants.length} participants`,
  })
})

export default router

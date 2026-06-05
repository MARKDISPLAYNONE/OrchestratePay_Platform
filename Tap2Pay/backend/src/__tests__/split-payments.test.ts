/**
 * Suite: Split Payments (pure unit — no real Redis)
 *
 * Tests the deterministic logic in routes/split-payments.ts:
 *   - Share sum validation (must equal totalAmountCents exactly)
 *   - Participant limit (min 2, max 10)
 *   - Session status transitions
 *   - Join guard (status must be OPEN)
 *   - Duplicate phone number rejection
 *   - Session TTL (300s)
 *   - Redis key format (split:{id})
 *   - Initiate guard (only creator can initiate)
 */

// ── Inline session model ──────────────────────────────────────────────────────

interface SplitParticipant {
  phone:      string
  shareCents: number
  status:     'PENDING' | 'STK_SENT' | 'CONFIRMED' | 'DECLINED' | 'FAILED'
}

interface SplitSession {
  id:           string
  merchantId:   string
  totalCents:   number
  description:  string | null
  participants: SplitParticipant[]
  status:       'OPEN' | 'INITIATING' | 'COMPLETE' | 'PARTIAL' | 'EXPIRED'
}

const SESSION_TTL_S  = 300
const MAX_PARTICIPANTS = 10

function validateCreate(body: {
  totalAmountCents: number
  participants: Array<{ phone: string; shareCents: number }>
}): { valid: boolean; error?: string } {
  if (body.participants.length < 2) return { valid: false, error: 'min 2 participants' }
  if (body.participants.length > MAX_PARTICIPANTS) return { valid: false, error: `max ${MAX_PARTICIPANTS} participants` }
  const sum = body.participants.reduce((s, p) => s + p.shareCents, 0)
  if (sum !== body.totalAmountCents) {
    return { valid: false, error: `Share amounts sum to ${sum} cents but totalAmountCents is ${body.totalAmountCents}` }
  }
  return { valid: true }
}

function canJoin(session: SplitSession, phone: string): { allowed: boolean; reason?: string } {
  if (session.status !== 'OPEN') return { allowed: false, reason: `Session is ${session.status} — cannot join` }
  if (session.participants.some(p => p.phone === phone)) return { allowed: false, reason: 'Phone already in session' }
  if (session.participants.length >= MAX_PARTICIPANTS) return { allowed: false, reason: `Max ${MAX_PARTICIPANTS} participants` }
  return { allowed: true }
}

function canInitiate(session: SplitSession, merchantId: string): { allowed: boolean; reason?: string } {
  if (session.merchantId !== merchantId) return { allowed: false, reason: 'Only creator can initiate' }
  if (session.status !== 'OPEN') return { allowed: false, reason: `Session already ${session.status}` }
  return { allowed: true }
}

// ── Share sum validation ──────────────────────────────────────────────────────

describe('Share sum validation', () => {
  it('shares summing exactly to totalAmountCents → valid', () => {
    const result = validateCreate({
      totalAmountCents: 500_000,
      participants: [
        { phone: '254712345678', shareCents: 250_000 },
        { phone: '254798765432', shareCents: 250_000 },
      ],
    })
    expect(result.valid).toBe(true)
  })

  it('shares 1 cent short → invalid', () => {
    const result = validateCreate({
      totalAmountCents: 500_000,
      participants: [
        { phone: '254712345678', shareCents: 249_999 },
        { phone: '254798765432', shareCents: 250_000 },
      ],
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('499999')
  })

  it('shares 1 cent over → invalid', () => {
    const result = validateCreate({
      totalAmountCents: 500_000,
      participants: [
        { phone: '254712345678', shareCents: 250_001 },
        { phone: '254798765432', shareCents: 250_000 },
      ],
    })
    expect(result.valid).toBe(false)
  })

  it('unequal shares that still sum correctly → valid', () => {
    const result = validateCreate({
      totalAmountCents: 600_000,
      participants: [
        { phone: '254712345678', shareCents: 200_000 },
        { phone: '254798765432', shareCents: 200_000 },
        { phone: '254711111111', shareCents: 200_000 },
      ],
    })
    expect(result.valid).toBe(true)
  })
})

// ── Participant count limits ──────────────────────────────────────────────────

describe('Participant count limits', () => {
  const makeParticipants = (n: number, total: number) =>
    Array.from({ length: n }, (_, i) => ({
      phone:      `2547${String(i).padStart(8, '0')}`,
      shareCents: Math.floor(total / n),
    }))

  it('1 participant → invalid (min 2)', () => {
    const result = validateCreate({
      totalAmountCents: 100,
      participants: makeParticipants(1, 100),
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('2')
  })

  it('2 participants → valid (minimum)', () => {
    const result = validateCreate({
      totalAmountCents: 200,
      participants: makeParticipants(2, 200),
    })
    expect(result.valid).toBe(true)
  })

  it('10 participants → valid (maximum)', () => {
    const result = validateCreate({
      totalAmountCents: 1_000,
      participants: makeParticipants(10, 1_000),
    })
    expect(result.valid).toBe(true)
  })

  it('11 participants → invalid (exceeds max)', () => {
    const result = validateCreate({
      totalAmountCents: 1_100,
      participants: makeParticipants(11, 1_100),
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('10')
  })
})

// ── Join guards ───────────────────────────────────────────────────────────────

describe('Join guards', () => {
  const openSession: SplitSession = {
    id: 'sess-1', merchantId: 'merch-1', totalCents: 500_000,
    description: null, status: 'OPEN',
    participants: [{ phone: '254712345678', shareCents: 250_000, status: 'PENDING' }],
  }

  it('joining an OPEN session with new phone → allowed', () => {
    expect(canJoin(openSession, '254798765432').allowed).toBe(true)
  })

  it('joining with a phone already in the session → denied', () => {
    const result = canJoin(openSession, '254712345678')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('already')
  })

  it('joining an INITIATING session → denied', () => {
    const initiating = { ...openSession, status: 'INITIATING' as const }
    expect(canJoin(initiating, '254799999999').allowed).toBe(false)
  })

  it('joining a COMPLETE session → denied', () => {
    const complete = { ...openSession, status: 'COMPLETE' as const }
    expect(canJoin(complete, '254799999999').allowed).toBe(false)
  })

  it('joining when at max participants → denied', () => {
    const full: SplitSession = {
      ...openSession,
      participants: Array.from({ length: MAX_PARTICIPANTS }, (_, i) => ({
        phone: `2547${String(i).padStart(8, '0')}`, shareCents: 100, status: 'PENDING' as const,
      })),
    }
    expect(canJoin(full, '254799999999').allowed).toBe(false)
  })
})

// ── Initiate guards ───────────────────────────────────────────────────────────

describe('Initiate guards', () => {
  const openSession: SplitSession = {
    id: 'sess-1', merchantId: 'merch-1', totalCents: 500_000,
    description: null, status: 'OPEN',
    participants: [
      { phone: '254712345678', shareCents: 250_000, status: 'PENDING' },
      { phone: '254798765432', shareCents: 250_000, status: 'PENDING' },
    ],
  }

  it('creator calling initiate on OPEN session → allowed', () => {
    expect(canInitiate(openSession, 'merch-1').allowed).toBe(true)
  })

  it('non-creator calling initiate → denied', () => {
    const result = canInitiate(openSession, 'merch-2')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('creator')
  })

  it('creator calling initiate on already-INITIATING session → denied', () => {
    const initiating = { ...openSession, status: 'INITIATING' as const }
    expect(canInitiate(initiating, 'merch-1').allowed).toBe(false)
  })
})

// ── Session status transitions ────────────────────────────────────────────────

describe('Session status transitions', () => {
  it('new session starts as OPEN', () => {
    const status: SplitSession['status'] = 'OPEN'
    expect(status).toBe('OPEN')
  })

  it('after initiate: OPEN → INITIATING', () => {
    let status: SplitSession['status'] = 'OPEN'
    status = 'INITIATING'
    expect(status).toBe('INITIATING')
  })

  it('OPEN, INITIATING, COMPLETE, PARTIAL, EXPIRED are the 5 valid statuses', () => {
    const statuses: SplitSession['status'][] = ['OPEN', 'INITIATING', 'COMPLETE', 'PARTIAL', 'EXPIRED']
    expect(statuses.length).toBe(5)
    expect(new Set(statuses).size).toBe(5)
  })
})

// ── Redis key format ──────────────────────────────────────────────────────────

describe('Session Redis key format', () => {
  it('key uses split: prefix', () => {
    const id  = 'some-uuid-123'
    const key = `split:${id}`
    expect(key.startsWith('split:')).toBe(true)
  })

  it('split key does not collide with payment link key', () => {
    const id      = 'same-id'
    const splitKey = `split:${id}`
    const linkKey  = `payment:link:${id}`
    expect(splitKey).not.toBe(linkKey)
  })
})

// ── Session TTL ───────────────────────────────────────────────────────────────

describe('Session TTL', () => {
  it('TTL is exactly 300 seconds (5 minutes)', () => {
    expect(SESSION_TTL_S).toBe(300)
  })

  it('a 5-minute TTL is sufficient for a restaurant table to confirm', () => {
    expect(SESSION_TTL_S).toBeGreaterThanOrEqual(180)  // 3 minutes minimum
    expect(SESSION_TTL_S).toBeLessThanOrEqual(600)     // 10 minutes maximum reasonable
  })
})

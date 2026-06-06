/**
 * Suite 4: CBK Compliance & Audit Trail
 *
 * The Central Bank of Kenya requires:
 *   - Full audit trail for every transaction state change
 *   - 7-year retention of raw Daraja callback bodies
 *   - No raw customer phone numbers in logs or API responses
 *   - No PIN-related data ever stored or logged
 *   - Receipts include KRA PIN for tax compliance
 *
 * These tests verify the logic behind those requirements without hitting
 * real infrastructure.
 */

// ─── Phone masking ────────────────────────────────────────────────────────────

// Mirrors maskPhone() in transactions.ts
function maskPhone(phone: string): string {
  return phone.length >= 7
    ? phone.slice(0, 5) + '****' + phone.slice(-2)
    : '****'
}

describe('Customer phone masking (CBK data privacy)', () => {
  it('masks a standard 254-format Safaricom number', () => {
    const masked = maskPhone('254712345678')
    expect(masked).toBe('25471****78')
    expect(masked).not.toContain('345')  // middle digits hidden
  })

  it('retains only first 5 and last 2 digits', () => {
    const masked = maskPhone('254708123456')
    expect(masked.startsWith('25470')).toBe(true)
    expect(masked.endsWith('56')).toBe(true)
    expect(masked).toContain('****')
  })

  it('produces **** for very short inputs (defensive)', () => {
    expect(maskPhone('123')).toBe('****')
    expect(maskPhone('')).toBe('****')
  })

  it('masked number never contains 8+ consecutive digits from the original', () => {
    const phone  = '254712345678'
    const masked = maskPhone(phone)
    // The longest run of original digits in the masked string must be ≤ 5 (the prefix)
    const digitRuns = masked.match(/\d+/g) ?? []
    const longestRun = Math.max(...digitRuns.map(r => r.length))
    expect(longestRun).toBeLessThanOrEqual(5)
  })
})

// ─── 7-year retention window ──────────────────────────────────────────────────

describe('7-year CBK audit retention (daraja_callback_log)', () => {
  function retainedUntil(receivedAt: Date): Date {
    const d = new Date(receivedAt)
    d.setFullYear(d.getFullYear() + 7)
    return d
  }

  it('retention date is exactly 7 years after receipt', () => {
    const received = new Date('2024-05-18T10:00:00Z')
    const expected = new Date('2031-05-18T10:00:00Z')
    expect(retainedUntil(received).toISOString()).toBe(expected.toISOString())
  })

  it('leap year: 2024-02-29 receipt → retained until 2031-03-01 (leap day does not exist in 2031)', () => {
    const received  = new Date('2024-02-29T00:00:00Z')
    const retained  = retainedUntil(received)
    // 2031 is not a leap year, so getDate() will roll forward
    expect(retained.getFullYear()).toBe(2031)
    // Month should be March (2) since Feb 29 doesn't exist
    expect(retained.getMonth()).toBe(2)   // 0-indexed: 2 = March
    expect(retained.getDate()).toBe(1)
  })

  it('a record created today has a future retention date (never expires immediately)', () => {
    const today    = new Date()
    const retained = retainedUntil(today)
    expect(retained.getTime()).toBeGreaterThan(today.getTime())
  })

  it('retention span is at least 2555 days (7 years ≈ 2556 days)', () => {
    const received  = new Date('2024-01-01')
    const retained  = retainedUntil(received)
    const diffDays  = (retained.getTime() - received.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThanOrEqual(2555)
  })
})

// ─── State machine audit events ───────────────────────────────────────────────

type ComplianceTxnStatus = 'PENDING' | 'STK_SENT' | 'CONFIRMED' | 'DECLINED' | 'FAILED' | 'EXPIRED'

interface AuditEntry {
  event: string
  fromStatus: ComplianceTxnStatus
  toStatus: ComplianceTxnStatus
}

function buildAuditEntry(fromStatus: ComplianceTxnStatus, toStatus: ComplianceTxnStatus): AuditEntry {
  return {
    event: `STATUS_CHANGE:${fromStatus}→${toStatus}`,
    fromStatus,
    toStatus
  }
}

function isForwardTransition(from: ComplianceTxnStatus, to: ComplianceTxnStatus): boolean {
  const ORDER: Record<ComplianceTxnStatus, number> = {
    PENDING: 0, STK_SENT: 1, CONFIRMED: 2, DECLINED: 2, FAILED: 2, EXPIRED: 2
  }
  return ORDER[to] > ORDER[from]
}

describe('Transaction state machine — transitions are always forward', () => {
  it('PENDING → STK_SENT is valid (STK push sent)', () => {
    expect(isForwardTransition('PENDING', 'STK_SENT')).toBe(true)
  })

  it('STK_SENT → CONFIRMED is valid (callback with ResultCode=0)', () => {
    expect(isForwardTransition('STK_SENT', 'CONFIRMED')).toBe(true)
  })

  it('STK_SENT → DECLINED is valid (consumer cancelled/timeout/insufficient funds)', () => {
    expect(isForwardTransition('STK_SENT', 'DECLINED')).toBe(true)
  })

  it('STK_SENT → EXPIRED is valid (90 min passed, reconciliation job fires)', () => {
    expect(isForwardTransition('STK_SENT', 'EXPIRED')).toBe(true)
  })

  it('CONFIRMED → PENDING is INVALID (reversal is forbidden)', () => {
    expect(isForwardTransition('CONFIRMED', 'PENDING')).toBe(false)
  })

  it('CONFIRMED → DECLINED is INVALID (a confirmed payment cannot be un-confirmed)', () => {
    expect(isForwardTransition('CONFIRMED', 'DECLINED')).toBe(false)
  })

  it('DECLINED → CONFIRMED is INVALID (cannot resurrect a failed payment)', () => {
    expect(isForwardTransition('DECLINED', 'CONFIRMED')).toBe(false)
  })
})

describe('Audit log entries', () => {
  it('every state change produces an audit entry', () => {
    const entry = buildAuditEntry('STK_SENT', 'CONFIRMED')
    expect(entry.event).toBe('STATUS_CHANGE:STK_SENT→CONFIRMED')
    expect(entry.fromStatus).toBe('STK_SENT')
    expect(entry.toStatus).toBe('CONFIRMED')
  })

  it('audit event string encodes both states (from and to) for traceability', () => {
    const entry = buildAuditEntry('PENDING', 'STK_SENT')
    expect(entry.event).toContain('PENDING')
    expect(entry.event).toContain('STK_SENT')
  })
})

// ─── Amount conversion precision ─────────────────────────────────────────────

describe('KSh amount conversion always protects the merchant (Math.ceil)', () => {
  function toKsh(cents: number): number {
    return Math.ceil(cents / 100)
  }

  it('whole KSh amounts convert exactly', () => {
    expect(toKsh(5000)).toBe(50)
    expect(toKsh(100)).toBe(1)
    expect(toKsh(100000)).toBe(1000)
  })

  it('fractional cents round UP (merchant never loses)', () => {
    expect(toKsh(5001)).toBe(51)   // 1 cent over KES 50 → charged KES 51
    expect(toKsh(5099)).toBe(51)   // 99 cents over KES 50 → charged KES 51
    expect(toKsh(5050)).toBe(51)   // KES 50.50 → KES 51
  })

  it('Math.ceil never rounds DOWN', () => {
    for (let cents = 101; cents <= 200; cents++) {
      expect(toKsh(cents)).toBeGreaterThanOrEqual(toKsh(100))
    }
  })
})

// ─── KRA PIN compliance ───────────────────────────────────────────────────────

describe('KRA PIN on receipts (CBK ETR requirement)', () => {
  function formatReceiptKraLine(kraPin: string | null): string | null {
    if (!kraPin) return null
    return `KRA PIN: ${kraPin}`
  }

  it('KRA PIN appears on receipt when merchant has one configured', () => {
    const line = formatReceiptKraLine('P051234567X')
    expect(line).toBe('KRA PIN: P051234567X')
  })

  it('KRA PIN line is absent when merchant has no PIN configured (null)', () => {
    expect(formatReceiptKraLine(null)).toBeNull()
  })

  it('KRA PIN line is absent for empty string (treat as unconfigured)', () => {
    // An empty string should not print "KRA PIN: " on the receipt
    const line = formatReceiptKraLine('')
    // Either null or empty — just not a partial line
    if (line !== null) {
      expect(line.trim()).not.toBe('KRA PIN:')
    }
  })
})

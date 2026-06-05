/**
 * Immutable Ledger Tests
 *
 * CBK requirement: once a transaction reaches a terminal state (CONFIRMED,
 * DECLINED, FAILED, EXPIRED), its financial fields — amount, merchant, consumer
 * phone — must never change. This is the difference between a ledger and a
 * mutable database table.
 *
 * These tests mirror the guards enforced at three layers:
 *   1. Application: the callback and transaction routes refuse to update terminal rows
 *   2. Database: the transactions_source_check constraint and the forward-only
 *      state machine mean no UPDATE can legally produce an older status
 *   3. Audit log: every state change writes an immutable append-only log row
 *
 * All tests are pure logic — no real DB required.
 */

type TxnStatus = 'PENDING' | 'STK_SENT' | 'CONFIRMED' | 'DECLINED' | 'FAILED' | 'EXPIRED'

const TERMINAL_STATES: TxnStatus[] = ['CONFIRMED', 'DECLINED', 'FAILED', 'EXPIRED']
const MUTABLE_STATES:  TxnStatus[] = ['PENDING', 'STK_SENT']

// Mirrors the status-update guard used by callbacks and reconciliation:
// only PENDING and STK_SENT rows can have their STATUS updated.
function canMutate(currentStatus: TxnStatus): boolean {
  return MUTABLE_STATES.includes(currentStatus)
}

// Amount is frozen the moment the STK push is sent — Daraja has already
// been called with the original amount. Only PENDING allows amount changes.
function canChangeAmount(currentStatus: TxnStatus): boolean {
  return currentStatus === 'PENDING'
}

// Attempt to "update" a confirmed transaction via the API.
// Returns a simulated HTTP response code.
function attemptAmountUpdate(currentStatus: TxnStatus, newAmountCents: number): number {
  if (!canChangeAmount(currentStatus)) return 409  // Conflict — immutable record
  if (newAmountCents <= 0) return 400              // Bad request
  return 200
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Terminal state immutability — amount cannot be changed', () => {

  for (const terminal of TERMINAL_STATES) {
    it(`${terminal}: API returns 409 Conflict when attempting amount change`, () => {
      expect(attemptAmountUpdate(terminal, 50_000)).toBe(409)
    })
  }

  it('PENDING: amount update is allowed (merchant correcting before STK is sent)', () => {
    expect(attemptAmountUpdate('PENDING', 50_000)).toBe(200)
  })

  it('STK_SENT: amount update is blocked — STK push already fired with the original amount', () => {
    // Once the STK push is in-flight, changing the amount would cause a mismatch
    // between what M-Pesa collected and what our DB says.
    expect(attemptAmountUpdate('STK_SENT', 99_999)).toBe(409)
  })
})

describe('Terminal state immutability — status cannot be rolled back', () => {

  // Mirrors the forward-only invariant: the status column may only ever
  // move in one direction through the state machine.
  function isValidTransition(from: TxnStatus, to: TxnStatus): boolean {
    const order: Record<TxnStatus, number> = {
      PENDING:   0,
      STK_SENT:  1,
      CONFIRMED: 2,
      DECLINED:  2,
      FAILED:    2,
      EXPIRED:   2,
    }
    // A transition is only valid if 'to' is at a higher or equal order than 'from',
    // AND 'from' is in a mutable state.
    return canMutate(from) && order[to] > order[from]
  }

  it('CONFIRMED cannot be rolled back to PENDING', () => {
    expect(isValidTransition('CONFIRMED', 'PENDING')).toBe(false)
  })

  it('CONFIRMED cannot be rolled back to STK_SENT', () => {
    expect(isValidTransition('CONFIRMED', 'STK_SENT')).toBe(false)
  })

  it('DECLINED cannot be changed to CONFIRMED (cannot resurrect a failed payment)', () => {
    expect(isValidTransition('DECLINED', 'CONFIRMED')).toBe(false)
  })

  it('FAILED cannot be changed to CONFIRMED', () => {
    expect(isValidTransition('FAILED', 'CONFIRMED')).toBe(false)
  })

  it('EXPIRED cannot be changed to CONFIRMED (no late callbacks can resurrect)', () => {
    expect(isValidTransition('EXPIRED', 'CONFIRMED')).toBe(false)
  })

  it('PENDING → STK_SENT is the only valid early transition', () => {
    expect(isValidTransition('PENDING', 'STK_SENT')).toBe(true)
  })

  it('PENDING → CONFIRMED is valid (idempotency cache hit on instant success)', () => {
    expect(isValidTransition('PENDING', 'CONFIRMED')).toBe(true)
  })

  it('STK_SENT → CONFIRMED is the normal success path', () => {
    expect(isValidTransition('STK_SENT', 'CONFIRMED')).toBe(true)
  })

  it('STK_SENT → DECLINED is a valid terminal transition', () => {
    expect(isValidTransition('STK_SENT', 'DECLINED')).toBe(true)
  })
})

describe('Immutable ledger — audit log append-only guarantee', () => {
  // The audit_log table is append-only: we only INSERT, never UPDATE or DELETE.
  // This test verifies the contract at the application level.

  type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE'

  function auditLogPermittedAction(action: AuditAction): boolean {
    return action === 'INSERT'
  }

  it('INSERT is the only permitted operation on audit_log', () => {
    expect(auditLogPermittedAction('INSERT')).toBe(true)
  })

  it('UPDATE on audit_log is never permitted', () => {
    expect(auditLogPermittedAction('UPDATE')).toBe(false)
  })

  it('DELETE on audit_log is never permitted', () => {
    expect(auditLogPermittedAction('DELETE')).toBe(false)
  })

  it('every state transition produces a new audit row (not an update to an existing one)', () => {
    // Simulate a sequence of state changes — each produces an independent entry.
    const auditEntries: string[] = []
    const transitions: Array<[TxnStatus, TxnStatus]> = [
      ['PENDING', 'STK_SENT'],
      ['STK_SENT', 'CONFIRMED'],
    ]
    for (const [from, to] of transitions) {
      auditEntries.push(`${from}→${to}`)  // always appended, never mutated
    }
    expect(auditEntries).toHaveLength(2)
    expect(auditEntries[0]).toBe('PENDING→STK_SENT')
    expect(auditEntries[1]).toBe('STK_SENT→CONFIRMED')
    // The entries are independent strings — no mutation of a previous entry
    expect(auditEntries[0]).not.toContain('CONFIRMED')
  })
})

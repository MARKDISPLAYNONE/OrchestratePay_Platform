// Tests for the writeAuditLog helper
import { writeAuditLog } from '../util/audit'

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

describe('writeAuditLog', () => {
  beforeEach(() => jest.clearAllMocks())

  it('inserts a row into server_audit_log', async () => {
    mockQuery.mockResolvedValue({ rows: [] })

    await writeAuditLog({
      event:      'MERCHANT_LOGIN',
      entityType: 'merchant',
      entityId:   'mid-1',
      detail:     { deviceId: 'dev-1' },
      ip:         '1.2.3.4',
    })

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO server_audit_log/)
    expect(params[0]).toBe('MERCHANT_LOGIN')
    expect(params[1]).toBe('merchant')
    expect(params[2]).toBe('mid-1')
    expect(JSON.parse(params[3])).toEqual({ deviceId: 'dev-1' })
    expect(params[4]).toBe('1.2.3.4')
  })

  it('does not throw when DB insert fails (non-fatal)', async () => {
    mockQuery.mockRejectedValue(new Error('DB write failed'))

    await expect(
      writeAuditLog({ event: 'MERCHANT_LOGIN_FAILED', detail: { email: 'test@test.com' } })
    ).resolves.toBeUndefined()
  })

  it('handles undefined optional fields gracefully', async () => {
    mockQuery.mockResolvedValue({ rows: [] })

    await writeAuditLog({ event: 'RECONCILIATION_RUN' })

    const [, params] = mockQuery.mock.calls[0]
    expect(params[1]).toBeNull()  // entityType
    expect(params[2]).toBeNull()  // entityId
    expect(params[3]).toBeNull()  // detail
    expect(params[4]).toBeNull()  // ip
  })

  it('covers all expected audit event types', () => {
    // Compile-time type check — this test just enumerates the events to
    // ensure they can be referenced without TypeScript errors
    const events: Array<Parameters<typeof writeAuditLog>[0]['event']> = [
      'MERCHANT_REGISTERED', 'MERCHANT_LOGIN', 'MERCHANT_LOGIN_FAILED',
      'MERCHANT_LOCKED_OUT', 'MERCHANT_LOGOUT', 'MERCHANT_APPROVED',
      'MERCHANT_REJECTED', 'MERCHANT_SUSPENDED', 'MERCHANT_REFRESH_TOKEN_ISSUED',
      'CONSUMER_REGISTERED', 'CONSUMER_LOGIN', 'CONSUMER_LOGIN_FAILED',
      'CONSUMER_OTP_REQUESTED', 'CONSUMER_OTP_VERIFIED', 'CONSUMER_LOGOUT',
      'TRANSACTION_CREATED', 'TRANSACTION_CONFIRMED', 'TRANSACTION_DECLINED',
      'TRANSACTION_EXPIRED', 'RECONCILIATION_RUN', 'ADMIN_ACTION',
    ]
    expect(events.length).toBeGreaterThan(0)
  })
})

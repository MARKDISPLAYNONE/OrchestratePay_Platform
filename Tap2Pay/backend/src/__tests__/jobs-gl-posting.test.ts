/**
 * Tests for jobs/gl-posting.ts — deferred GL posting job.
 * Covers: enqueueGlPosting, runGlPostingJob, processPosting (via job),
 *         refreshToken_ (via token-expiry path), all 4 accounting platforms.
 */
process.env.NODE_ENV = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockPostToQuickBooks  = jest.fn()
const mockRefreshQBToken    = jest.fn()
jest.mock('../integrations/quickbooks', () => ({
  postToQuickBooks:      (...args: any[]) => mockPostToQuickBooks(...args),
  refreshQuickBooksToken: (...args: any[]) => mockRefreshQBToken(...args),
}))

const mockPostToXero      = jest.fn()
const mockRefreshXeroToken = jest.fn()
jest.mock('../integrations/xero', () => ({
  postToXero:        (...args: any[]) => mockPostToXero(...args),
  refreshXeroToken:  (...args: any[]) => mockRefreshXeroToken(...args),
}))

const mockPostToSage       = jest.fn()
const mockRefreshSageToken = jest.fn()
jest.mock('../integrations/sage', () => ({
  postToSage:        (...args: any[]) => mockPostToSage(...args),
  refreshSageToken:  (...args: any[]) => mockRefreshSageToken(...args),
}))

const mockPostToWave = jest.fn()
jest.mock('../integrations/wave', () => ({
  postToWave: (...args: any[]) => mockPostToWave(...args),
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { enqueueGlPosting, runGlPostingJob } from '../jobs/gl-posting'

// ── Shared fixtures ───────────────────────────────────────────────────────────

function makePendingRow(overrides: Record<string, any> = {}) {
  return {
    id:                        'gl-1',
    accounting_integration_id: 'integ-1',
    platform:                  'quickbooks',
    transaction_id:            'txn-1',
    merchant_id:               'merchant-1',
    amount_cents:              5000,
    currency:                  'KES',
    description:               'Test payment',
    journal_date:              '2026-06-01',
    attempt_count:             0,
    access_token:              'at-tok',
    refresh_token:             'rt-tok',
    token_expires_at:          null,          // not expired by default
    realm_id:                  'realm-1',
    settings:                  {},
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// enqueueGlPosting
// ─────────────────────────────────────────────────────────────────────────────

describe('enqueueGlPosting', () => {
  it('returns early when merchant has no active integrations', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await enqueueGlPosting('txn-1', 'merchant-1', 5000, 'KES', 'QGH123', '2026-06-01')

    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockQuery.mock.calls[0][0]).toContain('accounting_integrations')
  })

  it('creates a gl_postings row for each active integration', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'integ-1', platform: 'xero' }] })
      .mockResolvedValue({ rows: [] })

    await enqueueGlPosting('txn-1', 'merchant-1', 5000, 'KES', 'QGH123', '2026-06-01')

    const insertCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO gl_postings')
    )
    expect(insertCall).toBeTruthy()
  })

  it('logs and continues when gl_postings INSERT fails', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'integ-1', platform: 'xero' }] })
      .mockRejectedValue(new Error('DB write failed'))

    // Should not throw — enqueueGlPosting catches insertion errors
    await expect(
      enqueueGlPosting('txn-2', 'merchant-1', 5000, 'KES', 'QGH456', '2026-06-01')
    ).resolves.not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runGlPostingJob — empty queue
// ─────────────────────────────────────────────────────────────────────────────

describe('runGlPostingJob — empty queue', () => {
  it('returns immediately without processing anything', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await runGlPostingJob()

    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockPostToQuickBooks).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runGlPostingJob — QuickBooks platform
// ─────────────────────────────────────────────────────────────────────────────

describe('runGlPostingJob — QuickBooks', () => {
  it('marks posting POSTED on success', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow()] })   // SELECT pending
      .mockResolvedValue({ rows: [] })                        // UPDATE attempt + UPDATE posted + UPDATE last_sync
    mockPostToQuickBooks.mockResolvedValue({ success: true, externalId: 'qb-entry-1' })

    await runGlPostingJob()

    expect(mockPostToQuickBooks).toHaveBeenCalled()
    const postedUpdate = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'POSTED'")
    )
    expect(postedUpdate).toBeTruthy()
  })

  it('keeps posting PENDING on transient failure (attempt_count < MAX_RETRIES)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ attempt_count: 1 })] })
      .mockResolvedValue({ rows: [] })
    mockPostToQuickBooks.mockResolvedValue({ success: false, error: 'Rate limit' })

    await runGlPostingJob()

    const pendingUpdate = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = $1") && String(c[1]).includes('PENDING')
    )
    expect(pendingUpdate).toBeTruthy()
  })

  it('marks posting FAILED after max retries (attempt_count >= 4)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ attempt_count: 4 })] })
      .mockResolvedValue({ rows: [] })
    mockPostToQuickBooks.mockResolvedValue({ success: false, error: 'Persistent error' })

    await runGlPostingJob()

    const failedUpdate = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = $1") && String(c[1]).includes('FAILED')
    )
    expect(failedUpdate).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runGlPostingJob — Xero platform
// ─────────────────────────────────────────────────────────────────────────────

describe('runGlPostingJob — Xero', () => {
  it('calls postToXero and marks POSTED on success', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ platform: 'xero' })] })
      .mockResolvedValue({ rows: [] })
    mockPostToXero.mockResolvedValue({ success: true, externalId: 'xero-entry-1' })

    await runGlPostingJob()

    expect(mockPostToXero).toHaveBeenCalled()
    const postedCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'POSTED'")
    )
    expect(postedCall).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runGlPostingJob — Sage platform
// ─────────────────────────────────────────────────────────────────────────────

describe('runGlPostingJob — Sage', () => {
  it('calls postToSage and marks POSTED on success', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ platform: 'sage' })] })
      .mockResolvedValue({ rows: [] })
    mockPostToSage.mockResolvedValue({ success: true, externalId: 'sage-entry-1' })

    await runGlPostingJob()

    expect(mockPostToSage).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runGlPostingJob — Wave platform
// ─────────────────────────────────────────────────────────────────────────────

describe('runGlPostingJob — Wave', () => {
  it('calls postToWave and marks POSTED on success', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ platform: 'wave' })] })
      .mockResolvedValue({ rows: [] })
    mockPostToWave.mockResolvedValue({ success: true, externalId: 'wave-entry-1' })

    await runGlPostingJob()

    expect(mockPostToWave).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runGlPostingJob — Unknown platform
// ─────────────────────────────────────────────────────────────────────────────

describe('runGlPostingJob — unknown platform', () => {
  it('marks posting FAILED and logs an error for unrecognised platform', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ platform: 'freshbooks' })] })
      .mockResolvedValue({ rows: [] })

    await runGlPostingJob()

    const failedCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FAILED') && String(c[0]).includes("last_error='Unknown platform'")
    )
    expect(failedCall).toBeTruthy()
    expect(mockPostToQuickBooks).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runGlPostingJob — Token refresh path
// ─────────────────────────────────────────────────────────────────────────────

describe('runGlPostingJob — token refresh (expired token)', () => {
  it('refreshes QB token when within 5 minutes of expiry', async () => {
    const expiringAt = new Date(Date.now() + 2 * 60 * 1000).toISOString()  // 2 min from now
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ token_expires_at: expiringAt })] })
      .mockResolvedValue({ rows: [] })
    mockRefreshQBToken.mockResolvedValue({
      accessToken:  'new-at',
      refreshToken: 'new-rt',
      expiresAt:    new Date(Date.now() + 3600 * 1000).toISOString(),
    })
    mockPostToQuickBooks.mockResolvedValue({ success: true, externalId: 'qb-2' })

    await runGlPostingJob()

    expect(mockRefreshQBToken).toHaveBeenCalled()
    expect(mockPostToQuickBooks).toHaveBeenCalled()
  })

  it('refreshes Xero token when expired', async () => {
    const expiringAt = new Date(Date.now() + 1 * 60 * 1000).toISOString()
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ platform: 'xero', token_expires_at: expiringAt })] })
      .mockResolvedValue({ rows: [] })
    mockRefreshXeroToken.mockResolvedValue({
      accessToken: 'xero-at-new', refreshToken: 'xero-rt-new',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    })
    mockPostToXero.mockResolvedValue({ success: true, externalId: 'xero-2' })

    await runGlPostingJob()

    expect(mockRefreshXeroToken).toHaveBeenCalled()
  })

  it('refreshes Sage token when expired', async () => {
    const expiringAt = new Date(Date.now() + 1 * 60 * 1000).toISOString()
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ platform: 'sage', token_expires_at: expiringAt })] })
      .mockResolvedValue({ rows: [] })
    mockRefreshSageToken.mockResolvedValue({
      accessToken: 'sage-at-new', refreshToken: 'sage-rt-new',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    })
    mockPostToSage.mockResolvedValue({ success: true, externalId: 'sage-2' })

    await runGlPostingJob()

    expect(mockRefreshSageToken).toHaveBeenCalled()
  })

  it('skips token refresh for Wave (uses API key, not OAuth)', async () => {
    const expiringAt = new Date(Date.now() + 1 * 60 * 1000).toISOString()
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ platform: 'wave', token_expires_at: expiringAt })] })
      .mockResolvedValue({ rows: [] })
    mockPostToWave.mockResolvedValue({ success: true })

    await runGlPostingJob()

    // No QB/Xero/Sage refresh should be called for wave
    expect(mockRefreshQBToken).not.toHaveBeenCalled()
    expect(mockRefreshXeroToken).not.toHaveBeenCalled()
    expect(mockRefreshSageToken).not.toHaveBeenCalled()
  })

  it('continues without refreshed token when refresh returns null', async () => {
    const expiringAt = new Date(Date.now() + 1 * 60 * 1000).toISOString()
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ token_expires_at: expiringAt })] })
      .mockResolvedValue({ rows: [] })
    mockRefreshQBToken.mockResolvedValue(null)  // refresh failed
    mockPostToQuickBooks.mockResolvedValue({ success: true, externalId: 'qb-3' })

    await runGlPostingJob()

    expect(mockPostToQuickBooks).toHaveBeenCalled()
  })

  it('line 126: db.query catch swallows token UPDATE failure after successful refresh', async () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString()  // already expired
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow({ token_expires_at: expiredAt })] })
      .mockResolvedValueOnce({ rows: [] })                              // UPDATE attempt_count
      .mockRejectedValueOnce(new Error('UPDATE accounting_integrations failed'))  // line 126 catch
      .mockResolvedValue({ rows: [] })                                  // remaining (POSTED update, last_sync_at)
    mockRefreshQBToken.mockResolvedValue({
      accessToken:  'new-at',
      refreshToken: 'new-rt',
      expiresAt:    new Date(Date.now() + 3600 * 1000),
    })
    mockPostToQuickBooks.mockResolvedValue({ success: true, externalId: 'qb-catch-126' })

    await runGlPostingJob()

    const tokenUpdate = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('accounting_integrations') && String(c[0]).includes('access_token')
    )
    expect(tokenUpdate).toBeTruthy()
    expect(mockPostToQuickBooks).toHaveBeenCalled()
  })

  it('line 163: db.query catch swallows last_sync_at UPDATE failure after successful posting', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingRow()] })  // SELECT pending
      .mockResolvedValueOnce({ rows: [] })                   // UPDATE attempt_count
      .mockResolvedValueOnce({ rows: [] })                   // UPDATE gl_postings POSTED
      .mockRejectedValueOnce(new Error('last_sync_at UPDATE failed'))  // line 163 catch
    mockPostToQuickBooks.mockResolvedValue({ success: true, externalId: 'qb-catch-163' })

    await runGlPostingJob()

    const syncUpdate = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('last_sync_at')
    )
    expect(syncUpdate).toBeTruthy()
    expect(mockPostToQuickBooks).toHaveBeenCalled()
  })
})

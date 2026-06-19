/**
 * Focused integration tests for integrations/xero.ts
 *
 * Tests postToXero and refreshXeroToken in isolation.
 * Mocks global.fetch — no network calls or real credentials required.
 */
process.env.NODE_ENV = 'test'

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockFetch = jest.fn()
global.fetch = mockFetch as any

import { postToXero, refreshXeroToken } from '../integrations/xero'
import { logger } from '../util/logger'

// ─── shared fixture ───────────────────────────────────────────────────────────

const BASE_PAYLOAD = {
  transactionId: 'txn-xero-001',
  merchantId:    'merchant-xero',
  amountCents:   15_000,        // KES 150.00
  currency:      'KES',
  description:   'OrchestratePay Xero test',
  journalDate:   '2026-06-17',
  mpesaReceipt:  'XR0T1EXAMPLE',
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: jest.fn().mockResolvedValue(body) }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: jest.fn().mockResolvedValue(body) }
}

// ─────────────────────────────────────────────────────────────────────────────
// postToXero
// ─────────────────────────────────────────────────────────────────────────────

describe('postToXero', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    delete process.env.XERO_CLIENT_ID
    delete process.env.XERO_CLIENT_SECRET
  })

  // ── success path ────────────────────────────────────────────────────────────

  it('returns { success: true, externalId } when ManualJournalID is present', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'xero-jnl-99' }] })
    )

    const result = await postToXero(BASE_PAYLOAD, 'at-tok', 'tenant-abc', {})

    expect(result.success).toBe(true)
    expect(result.externalId).toBe('xero-jnl-99')
    expect(result.error).toBeUndefined()
  })

  it('logs info with txnId and externalId on success', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'xero-log-id' }] })
    )

    await postToXero(BASE_PAYLOAD, 'at-tok', 'tenant-abc', {})

    expect(logger.info).toHaveBeenCalledWith(
      'Xero manual journal posted',
      expect.objectContaining({ txnId: 'txn-xero-001', externalId: 'xero-log-id' })
    )
  })

  // ── HTTP method and URL ─────────────────────────────────────────────────────

  it('uses HTTP PUT method', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'x' }] })
    )

    await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.method).toBe('PUT')
  })

  it('targets the Xero ManualJournals endpoint', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'x' }] })
    )

    await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.xero.com/api.xro/2.0/ManualJournals')
  })

  // ── request headers ─────────────────────────────────────────────────────────

  it('sends Bearer token in Authorization header', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'x' }] })
    )

    await postToXero(BASE_PAYLOAD, 'bearer-token-xyz', 'tenant-1', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Authorization']).toBe('Bearer bearer-token-xyz')
  })

  it('sends Xero-tenant-id header', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'x' }] })
    )

    await postToXero(BASE_PAYLOAD, 'tok', 'my-tenant-id', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Xero-tenant-id']).toBe('my-tenant-id')
  })

  it('sends Content-Type: application/json', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'x' }] })
    )

    await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('sends Accept: application/json', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'x' }] })
    )

    await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Accept']).toBe('application/json')
  })

  // ── request body ───────────────────────────────────────────────────────────

  it('wraps journal inside ManualJournals array in request body', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'x' }] })
    )

    await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(Array.isArray(body.ManualJournals)).toBe(true)
    expect(body.ManualJournals).toHaveLength(1)
  })

  it('sets Narration from description and Date from journalDate', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'x' }] })
    )

    await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    const [, options] = mockFetch.mock.calls[0]
    const journal = JSON.parse(options.body).ManualJournals[0]
    expect(journal.Narration).toBe('OrchestratePay Xero test')
    expect(journal.Date).toBe('2026-06-17')
  })

  it('produces debit line with positive amount and credit line with negative amount', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'x' }] })
    )

    await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    const [, options] = mockFetch.mock.calls[0]
    const lines = JSON.parse(options.body).ManualJournals[0].JournalLines
    expect(lines).toHaveLength(2)

    const positive = lines.find((l: any) => l.LineAmount > 0)
    const negative = lines.find((l: any) => l.LineAmount < 0)

    expect(positive).toBeDefined()
    expect(negative).toBeDefined()
    expect(positive.LineAmount).toBe(150)   // 15000 / 100
    expect(negative.LineAmount).toBe(-150)
  })

  it('uses default account codes (200 debit, 400 credit) when settings are empty', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'x' }] })
    )

    await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    const [, options] = mockFetch.mock.calls[0]
    const lines = JSON.parse(options.body).ManualJournals[0].JournalLines
    const codes = lines.map((l: any) => l.AccountCode)

    expect(codes).toContain('200')
    expect(codes).toContain('400')
  })

  it('uses custom debitAccountCode and creditAccountCode from settings', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ ManualJournals: [{ ManualJournalID: 'x' }] })
    )

    await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {
      debitAccountCode: '300',
      creditAccountCode: '500',
    })

    const [, options] = mockFetch.mock.calls[0]
    const lines = JSON.parse(options.body).ManualJournals[0].JournalLines
    const codes = lines.map((l: any) => l.AccountCode)

    expect(codes).toContain('300')
    expect(codes).toContain('500')
  })

  // ── error responses ────────────────────────────────────────────────────────

  it('extracts ValidationErrors[0].Message on 400 from Elements array', async () => {
    mockFetch.mockResolvedValue(
      errorResponse(400, {
        Elements: [{ ValidationErrors: [{ Message: 'Account not found' }] }],
      })
    )

    const result = await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toBe('Account not found')
  })

  it('falls back to "HTTP <status>" when Elements array is absent', async () => {
    mockFetch.mockResolvedValue(errorResponse(422, {}))

    const result = await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toBe('HTTP 422')
  })

  it('falls back to "HTTP <status>" when json() rejects on error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: jest.fn().mockRejectedValue(new Error('malformed body')),
    })

    const result = await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/HTTP 500/)
  })

  it('returns failure when response is ok but ManualJournalID is missing', async () => {
    // ok=true but empty ManualJournals array — no ManualJournalID → failure path
    mockFetch.mockResolvedValue(okResponse({ ManualJournals: [{}] }))

    const result = await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    expect(result.success).toBe(false)
  })

  it('logs warning on non-ok response', async () => {
    mockFetch.mockResolvedValue(errorResponse(401, {}))

    await postToXero(BASE_PAYLOAD, 'bad-tok', 'tenant-1', {})

    expect(logger.warn).toHaveBeenCalledWith(
      'Xero posting failed',
      expect.objectContaining({ txnId: 'txn-xero-001' })
    )
  })

  // ── network / timeout errors ───────────────────────────────────────────────

  it('returns { success: false, error } when fetch throws a network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toBe('ECONNREFUSED')
  })

  it('returns { success: false } on AbortError (timeout)', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    mockFetch.mockRejectedValue(abortErr)

    const result = await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toContain('aborted')
  })

  it('logs error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('TLS error'))

    await postToXero(BASE_PAYLOAD, 'tok', 'tenant-1', {})

    expect(logger.error).toHaveBeenCalledWith(
      'Xero PUT threw',
      expect.objectContaining({ txnId: 'txn-xero-001' })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// refreshXeroToken
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshXeroToken', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    delete process.env.XERO_CLIENT_ID
    delete process.env.XERO_CLIENT_SECRET
  })

  it('returns null when XERO_CLIENT_ID is not set', async () => {
    const result = await refreshXeroToken('any-rt')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null when XERO_CLIENT_SECRET is not set (but CLIENT_ID is)', async () => {
    process.env.XERO_CLIENT_ID = 'xero-id'
    const result = await refreshXeroToken('any-rt')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('calls the Xero identity token endpoint', async () => {
    process.env.XERO_CLIENT_ID     = 'xero-client-id'
    process.env.XERO_CLIENT_SECRET = 'xero-client-secret'
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'new-at', expires_in: 1800 }),
    })

    await refreshXeroToken('old-rt')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('identity.xero.com')
    expect(url).toContain('token')
  })

  it('returns { accessToken, refreshToken, expiresAt } on success', async () => {
    process.env.XERO_CLIENT_ID     = 'xero-client-id'
    process.env.XERO_CLIENT_SECRET = 'xero-client-secret'
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({
        access_token:  'fresh-xero-at',
        refresh_token: 'fresh-xero-rt',
        expires_in:    1800,
      }),
    })

    const result = await refreshXeroToken('old-rt')

    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe('fresh-xero-at')
    expect(result!.refreshToken).toBe('fresh-xero-rt')
    expect(result!.expiresAt).toBeInstanceOf(Date)
    expect(result!.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('preserves the old refreshToken when server omits refresh_token', async () => {
    process.env.XERO_CLIENT_ID     = 'xero-client-id'
    process.env.XERO_CLIENT_SECRET = 'xero-client-secret'
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'at', expires_in: 3600 }),
    })

    const result = await refreshXeroToken('my-original-xero-rt')

    expect(result!.refreshToken).toBe('my-original-xero-rt')
  })

  it('sends Basic Auth with base64-encoded clientId:clientSecret', async () => {
    process.env.XERO_CLIENT_ID     = 'xero-id-abc'
    process.env.XERO_CLIENT_SECRET = 'xero-secret-xyz'
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'at', expires_in: 3600 }),
    })

    await refreshXeroToken('rt')

    const [, options] = mockFetch.mock.calls[0]
    const expected = Buffer.from('xero-id-abc:xero-secret-xyz').toString('base64')
    expect(options.headers.Authorization).toBe(`Basic ${expected}`)
  })

  it('sends grant_type=refresh_token in form body', async () => {
    process.env.XERO_CLIENT_ID     = 'xero-client-id'
    process.env.XERO_CLIENT_SECRET = 'xero-client-secret'
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'at', expires_in: 3600 }),
    })

    await refreshXeroToken('xero-refresh-tok')

    const [, options] = mockFetch.mock.calls[0]
    const params = new URLSearchParams(options.body)
    expect(params.get('grant_type')).toBe('refresh_token')
    expect(params.get('refresh_token')).toBe('xero-refresh-tok')
  })

  it('returns null when token endpoint returns 401', async () => {
    process.env.XERO_CLIENT_ID     = 'xero-client-id'
    process.env.XERO_CLIENT_SECRET = 'xero-client-secret'
    mockFetch.mockResolvedValue({
      ok: false, status: 401,
      json: jest.fn().mockResolvedValue({ error: 'invalid_client' }),
    })

    const result = await refreshXeroToken('expired-rt')

    expect(result).toBeNull()
  })

  it('returns null when fetch throws (network failure)', async () => {
    process.env.XERO_CLIENT_ID     = 'xero-client-id'
    process.env.XERO_CLIENT_SECRET = 'xero-client-secret'
    mockFetch.mockRejectedValue(new Error('EHOSTUNREACH'))

    const result = await refreshXeroToken('rt')

    expect(result).toBeNull()
  })

  it('returns null when json() fails on error response', async () => {
    process.env.XERO_CLIENT_ID     = 'xero-client-id'
    process.env.XERO_CLIENT_SECRET = 'xero-client-secret'
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: jest.fn().mockRejectedValue(new Error('not json')),
    })

    const result = await refreshXeroToken('rt')

    expect(result).toBeNull()
  })
})

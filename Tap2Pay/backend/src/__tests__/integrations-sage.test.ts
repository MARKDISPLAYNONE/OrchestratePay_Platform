/**
 * Focused integration tests for integrations/sage.ts
 *
 * Tests postToSage and refreshSageToken in isolation.
 * Mocks global.fetch — no network calls or real credentials required.
 */
process.env.NODE_ENV = 'test'

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockFetch = jest.fn()
global.fetch = mockFetch as any

import { postToSage, refreshSageToken } from '../integrations/sage'
import { logger } from '../util/logger'

// ─── shared fixture ───────────────────────────────────────────────────────────

const BASE_PAYLOAD = {
  transactionId: 'txn-sage-001',
  merchantId:    'merchant-sage',
  amountCents:   50_000,        // KES 500.00
  currency:      'KES',
  description:   'OrchestratePay Sage test',
  journalDate:   '2026-06-17',
  mpesaReceipt:  'SG0T1EXAMPLE',
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: jest.fn().mockResolvedValue(body) }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: jest.fn().mockResolvedValue(body) }
}

// ─────────────────────────────────────────────────────────────────────────────
// postToSage
// ─────────────────────────────────────────────────────────────────────────────

describe('postToSage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    delete process.env.SAGE_CLIENT_ID
    delete process.env.SAGE_CLIENT_SECRET
  })

  // ── success path ────────────────────────────────────────────────────────────

  it('returns { success: true, externalId } when response has an id', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'sage-journal-77' }))

    const result = await postToSage(BASE_PAYLOAD, 'access-tok', '', {})

    expect(result.success).toBe(true)
    expect(result.externalId).toBe('sage-journal-77')
    expect(result.error).toBeUndefined()
  })

  it('coerces numeric id to string', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 123 }))

    const result = await postToSage(BASE_PAYLOAD, 'tok', '', {})

    expect(result.success).toBe(true)
    expect(result.externalId).toBe('123')
    expect(typeof result.externalId).toBe('string')
  })

  it('logs info with txnId and externalId on success', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'sage-log-id' }))

    await postToSage(BASE_PAYLOAD, 'tok', '', {})

    expect(logger.info).toHaveBeenCalledWith(
      'Sage journal posted',
      expect.objectContaining({ txnId: 'txn-sage-001', externalId: 'sage-log-id' })
    )
  })

  // ── HTTP method and URL ─────────────────────────────────────────────────────

  it('uses HTTP POST method', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'x' }))

    await postToSage(BASE_PAYLOAD, 'tok', '', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.method).toBe('POST')
  })

  it('targets the Sage Business Cloud journals endpoint', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'x' }))

    await postToSage(BASE_PAYLOAD, 'tok', '', {})

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.accounting.sage.com/v3.1/journals')
  })

  // ── request headers ─────────────────────────────────────────────────────────

  it('sends Bearer token in Authorization header', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'x' }))

    await postToSage(BASE_PAYLOAD, 'sage-bearer-token', '', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Authorization']).toBe('Bearer sage-bearer-token')
  })

  it('sends Content-Type: application/json', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'x' }))

    await postToSage(BASE_PAYLOAD, 'tok', '', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('sends Accept: application/json', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'x' }))

    await postToSage(BASE_PAYLOAD, 'tok', '', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Accept']).toBe('application/json')
  })

  // ── request body ───────────────────────────────────────────────────────────

  it('wraps content in { journal: { ... } } structure', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'x' }))

    await postToSage(BASE_PAYLOAD, 'tok', '', {})

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body).toHaveProperty('journal')
    expect(body.journal).toHaveProperty('journal_lines')
  })

  it('sets date and description on the journal object', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'x' }))

    await postToSage(BASE_PAYLOAD, 'tok', '', {})

    const [, options] = mockFetch.mock.calls[0]
    const { journal } = JSON.parse(options.body)
    expect(journal.date).toBe('2026-06-17')
    expect(journal.description).toBe('OrchestratePay Sage test')
  })

  it('produces two journal lines — one debit, one credit', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'x' }))

    await postToSage(BASE_PAYLOAD, 'tok', '', {})

    const [, options] = mockFetch.mock.calls[0]
    const lines = JSON.parse(options.body).journal.journal_lines
    expect(lines).toHaveLength(2)

    const debitLine  = lines.find((l: any) => l.debit > 0)
    const creditLine = lines.find((l: any) => l.credit > 0)

    expect(debitLine).toBeDefined()
    expect(creditLine).toBeDefined()
    // 50000 cents → 500.00
    expect(debitLine.debit).toBe(500)
    expect(debitLine.credit).toBe(0)
    expect(creditLine.credit).toBe(500)
    expect(creditLine.debit).toBe(0)
  })

  it('uses default ledger codes (DEBTORS debit, SALES credit) when settings are empty', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'x' }))

    await postToSage(BASE_PAYLOAD, 'tok', '', {})

    const [, options] = mockFetch.mock.calls[0]
    const lines = JSON.parse(options.body).journal.journal_lines
    const displayIds = lines.map((l: any) => l.ledger_account.display_id)

    expect(displayIds).toContain('DEBTORS')
    expect(displayIds).toContain('SALES')
  })

  it('uses custom debitLedgerCode and creditLedgerCode from settings', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'x' }))

    await postToSage(BASE_PAYLOAD, 'tok', '', {
      debitLedgerCode:  'MPESA_CLEARING',
      creditLedgerCode: 'REVENUE',
    })

    const [, options] = mockFetch.mock.calls[0]
    const lines = JSON.parse(options.body).journal.journal_lines
    const displayIds = lines.map((l: any) => l.ledger_account.display_id)

    expect(displayIds).toContain('MPESA_CLEARING')
    expect(displayIds).toContain('REVENUE')
  })

  it('ignores the _realmId argument (Sage does not use it)', async () => {
    // Sage ignores realmId — calling with a non-empty value should still hit /journals
    mockFetch.mockResolvedValue(okResponse({ id: 'x' }))

    await postToSage(BASE_PAYLOAD, 'tok', 'irrelevant-realm', {})

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.accounting.sage.com/v3.1/journals')
  })

  // ── error responses ────────────────────────────────────────────────────────

  it('returns { success: false, error } with json.message on HTTP error', async () => {
    mockFetch.mockResolvedValue(
      errorResponse(401, { message: 'Unauthorized access' })
    )

    const result = await postToSage(BASE_PAYLOAD, 'bad-tok', '', {})

    expect(result.success).toBe(false)
    expect(result.error).toBe('Unauthorized access')
  })

  it('falls back to "HTTP <status>" when message is absent', async () => {
    mockFetch.mockResolvedValue(errorResponse(404, {}))

    const result = await postToSage(BASE_PAYLOAD, 'tok', '', {})

    expect(result.success).toBe(false)
    expect(result.error).toBe('HTTP 404')
  })

  it('falls back to "HTTP <status>" when json() rejects on error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: jest.fn().mockRejectedValue(new Error('malformed json')),
    })

    const result = await postToSage(BASE_PAYLOAD, 'tok', '', {})

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/HTTP 500/)
  })

  it('returns failure when response is ok but id is missing', async () => {
    mockFetch.mockResolvedValue(okResponse({}))

    const result = await postToSage(BASE_PAYLOAD, 'tok', '', {})

    expect(result.success).toBe(false)
  })

  it('logs warning on non-ok response', async () => {
    mockFetch.mockResolvedValue(errorResponse(403, { message: 'Forbidden' }))

    await postToSage(BASE_PAYLOAD, 'bad-tok', '', {})

    expect(logger.warn).toHaveBeenCalledWith(
      'Sage posting failed',
      expect.objectContaining({ txnId: 'txn-sage-001', error: 'Forbidden' })
    )
  })

  // ── network / timeout errors ───────────────────────────────────────────────

  it('returns { success: false, error } when fetch throws a network error', async () => {
    mockFetch.mockRejectedValue(new Error('connection refused'))

    const result = await postToSage(BASE_PAYLOAD, 'tok', '', {})

    expect(result.success).toBe(false)
    expect(result.error).toBe('connection refused')
  })

  it('returns { success: false } on AbortError (timeout)', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    mockFetch.mockRejectedValue(abortErr)

    const result = await postToSage(BASE_PAYLOAD, 'tok', '', {})

    expect(result.success).toBe(false)
    expect(result.error).toContain('aborted')
  })

  it('logs error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('TLS handshake timeout'))

    await postToSage(BASE_PAYLOAD, 'tok', '', {})

    expect(logger.error).toHaveBeenCalledWith(
      'Sage POST threw',
      expect.objectContaining({ txnId: 'txn-sage-001', error: 'TLS handshake timeout' })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// refreshSageToken
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshSageToken', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    delete process.env.SAGE_CLIENT_ID
    delete process.env.SAGE_CLIENT_SECRET
  })

  it('returns null when SAGE_CLIENT_ID is not set', async () => {
    const result = await refreshSageToken('any-rt')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null when SAGE_CLIENT_SECRET is not set (but CLIENT_ID is)', async () => {
    process.env.SAGE_CLIENT_ID = 'sage-id'
    const result = await refreshSageToken('any-rt')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('calls the Sage OAuth token endpoint when both credentials are set', async () => {
    process.env.SAGE_CLIENT_ID     = 'sage-client-id'
    process.env.SAGE_CLIENT_SECRET = 'sage-client-secret'
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'new-sage-at', expires_in: 3600 }),
    })

    await refreshSageToken('old-rt')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('oauth.accounting.sage.com')
    expect(url).toContain('token')
  })

  it('returns { accessToken, refreshToken, expiresAt } on success', async () => {
    process.env.SAGE_CLIENT_ID     = 'sage-client-id'
    process.env.SAGE_CLIENT_SECRET = 'sage-client-secret'
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({
        access_token:  'fresh-sage-at',
        refresh_token: 'fresh-sage-rt',
        expires_in:    7200,
      }),
    })

    const result = await refreshSageToken('old-rt')

    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe('fresh-sage-at')
    expect(result!.refreshToken).toBe('fresh-sage-rt')
    expect(result!.expiresAt).toBeInstanceOf(Date)
    expect(result!.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('preserves old refreshToken when server omits refresh_token', async () => {
    process.env.SAGE_CLIENT_ID     = 'sage-client-id'
    process.env.SAGE_CLIENT_SECRET = 'sage-client-secret'
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'at', expires_in: 3600 }),
    })

    const result = await refreshSageToken('original-sage-rt')

    expect(result!.refreshToken).toBe('original-sage-rt')
  })

  it('sends Basic Auth with base64-encoded clientId:clientSecret', async () => {
    process.env.SAGE_CLIENT_ID     = 'sage-id-abc'
    process.env.SAGE_CLIENT_SECRET = 'sage-secret-xyz'
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'at', expires_in: 3600 }),
    })

    await refreshSageToken('rt')

    const [, options] = mockFetch.mock.calls[0]
    const expected = Buffer.from('sage-id-abc:sage-secret-xyz').toString('base64')
    expect(options.headers.Authorization).toBe(`Basic ${expected}`)
  })

  it('sends grant_type=refresh_token with the provided refreshToken', async () => {
    process.env.SAGE_CLIENT_ID     = 'sage-client-id'
    process.env.SAGE_CLIENT_SECRET = 'sage-client-secret'
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'at', expires_in: 3600 }),
    })

    await refreshSageToken('sage-specific-rt')

    const [, options] = mockFetch.mock.calls[0]
    const params = new URLSearchParams(options.body)
    expect(params.get('grant_type')).toBe('refresh_token')
    expect(params.get('refresh_token')).toBe('sage-specific-rt')
  })

  it('returns null when token endpoint returns 400', async () => {
    process.env.SAGE_CLIENT_ID     = 'sage-client-id'
    process.env.SAGE_CLIENT_SECRET = 'sage-client-secret'
    mockFetch.mockResolvedValue({
      ok: false, status: 400,
      json: jest.fn().mockResolvedValue({ error: 'invalid_grant' }),
    })

    const result = await refreshSageToken('expired-rt')

    expect(result).toBeNull()
  })

  it('returns null when fetch throws (network failure)', async () => {
    process.env.SAGE_CLIENT_ID     = 'sage-client-id'
    process.env.SAGE_CLIENT_SECRET = 'sage-client-secret'
    mockFetch.mockRejectedValue(new Error('socket hang up'))

    const result = await refreshSageToken('rt')

    expect(result).toBeNull()
  })

  it('returns null when json() fails on error response', async () => {
    process.env.SAGE_CLIENT_ID     = 'sage-client-id'
    process.env.SAGE_CLIENT_SECRET = 'sage-client-secret'
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: jest.fn().mockRejectedValue(new Error('not json')),
    })

    const result = await refreshSageToken('rt')

    expect(result).toBeNull()
  })
})

/**
 * Focused integration tests for integrations/quickbooks.ts
 *
 * Tests postToQuickBooks and refreshQuickBooksToken in isolation.
 * Mocks global.fetch — no network calls or real credentials required.
 */
process.env.NODE_ENV = 'test'

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockFetch = jest.fn()
global.fetch = mockFetch as any

import { postToQuickBooks, refreshQuickBooksToken } from '../integrations/quickbooks'
import { logger } from '../util/logger'

// ─── shared fixture ───────────────────────────────────────────────────────────

const BASE_PAYLOAD = {
  transactionId: 'txn-qbo-001',
  merchantId:    'merchant-qbo',
  amountCents:   25_000,        // KES 250.00
  currency:      'KES',
  description:   'OrchestratePay QBO test',
  journalDate:   '2026-06-17',
  mpesaReceipt:  'QB0T1EXAMPLE',
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function okResponse(body: unknown) {
  return {
    ok:   true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  }
}

function errorResponse(status: number, body: unknown) {
  return {
    ok:   false,
    status,
    json: jest.fn().mockResolvedValue(body),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// postToQuickBooks
// ─────────────────────────────────────────────────────────────────────────────

describe('postToQuickBooks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    delete process.env.QBO_SANDBOX
    delete process.env.QBO_CLIENT_ID
    delete process.env.QBO_CLIENT_SECRET
  })

  // ── success path ────────────────────────────────────────────────────────────

  it('returns { success: true, externalId } on a 200 response', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'qbo-je-42' } }))

    const result = await postToQuickBooks(BASE_PAYLOAD, 'access-tok', 'realm-123', {})

    expect(result.success).toBe(true)
    expect(result.externalId).toBe('qbo-je-42')
    expect(result.error).toBeUndefined()
  })

  it('coerces numeric JournalEntry.Id to string', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 99 } }))

    const result = await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    expect(result.success).toBe(true)
    expect(result.externalId).toBe('99')
    expect(typeof result.externalId).toBe('string')
  })

  it('logs info on successful post', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'je-log-test' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    expect(logger.info).toHaveBeenCalledWith(
      'QuickBooks journal entry posted',
      expect.objectContaining({ txnId: 'txn-qbo-001', externalId: 'je-log-test' })
    )
  })

  // ── Authorization header ────────────────────────────────────────────────────

  it('sends Bearer token in Authorization header', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'my-secret-token', 'realm-1', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer my-secret-token')
  })

  it('sends Content-Type: application/json', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('sends Accept: application/json', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Accept']).toBe('application/json')
  })

  // ── URL routing (sandbox vs production) ────────────────────────────────────

  it('uses production URL when QBO_SANDBOX is not set', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-prod', {})

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('quickbooks.api.intuit.com')
    expect(url).not.toContain('sandbox')
  })

  it('uses sandbox URL when QBO_SANDBOX=true', async () => {
    process.env.QBO_SANDBOX = 'true'
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-sb', {})

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('sandbox-quickbooks.api.intuit.com')
  })

  it('embeds realmId in the URL path', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-XYZ', {})

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('/realm-XYZ/')
  })

  it('posts to the /journalentry endpoint', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    const [url] = mockFetch.mock.calls[0]
    expect(url).toMatch(/journalentry$/)
  })

  it('uses HTTP POST method', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    const [, options] = mockFetch.mock.calls[0]
    expect(options.method).toBe('POST')
  })

  // ── request body ───────────────────────────────────────────────────────────

  it('includes JournalEntry with correct Debit/Credit lines in body', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    const lines: any[] = body.JournalEntry.Line

    const debitLine  = lines.find((l: any) => l.JournalEntryLineDetail.PostingType === 'Debit')
    const creditLine = lines.find((l: any) => l.JournalEntryLineDetail.PostingType === 'Credit')

    expect(debitLine).toBeDefined()
    expect(creditLine).toBeDefined()
    // KES 25000 cents → 250.00 KES
    expect(debitLine.Amount).toBe(250)
    expect(creditLine.Amount).toBe(250)
  })

  it('uses default account codes (57 debit, 79 credit) when settings are empty', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    const lines: any[] = body.JournalEntry.Line

    const debitLine  = lines.find((l: any) => l.JournalEntryLineDetail.PostingType === 'Debit')
    const creditLine = lines.find((l: any) => l.JournalEntryLineDetail.PostingType === 'Credit')

    expect(debitLine.JournalEntryLineDetail.AccountRef.value).toBe('57')
    expect(creditLine.JournalEntryLineDetail.AccountRef.value).toBe('79')
  })

  it('uses custom account codes from settings when provided', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {
      debitAccount:  '100',
      creditAccount: '200',
    })

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    const lines: any[] = body.JournalEntry.Line

    const debitLine  = lines.find((l: any) => l.JournalEntryLineDetail.PostingType === 'Debit')
    const creditLine = lines.find((l: any) => l.JournalEntryLineDetail.PostingType === 'Credit')

    expect(debitLine.JournalEntryLineDetail.AccountRef.value).toBe('100')
    expect(creditLine.JournalEntryLineDetail.AccountRef.value).toBe('200')
  })

  it('truncates transactionId to 20 chars for DocNumber', async () => {
    const longId = 'txn-' + 'A'.repeat(40)
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks({ ...BASE_PAYLOAD, transactionId: longId }, 'tok', 'realm-1', {})

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.JournalEntry.DocNumber.length).toBe(20)
  })

  it('sets TxnDate from journalDate', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.JournalEntry.TxnDate).toBe('2026-06-17')
  })

  it('sets PrivateNote from description', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: { Id: 'x' } }))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.JournalEntry.PrivateNote).toBe('OrchestratePay QBO test')
  })

  // ── error responses ────────────────────────────────────────────────────────

  it('returns { success: false, error } extracting Fault.Error[0].Message on 400', async () => {
    mockFetch.mockResolvedValue(
      errorResponse(400, { Fault: { Error: [{ Message: 'Invalid account ref' }] } })
    )

    const result = await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid account ref')
  })

  it('falls back to "HTTP <status>" when Fault is absent', async () => {
    mockFetch.mockResolvedValue(errorResponse(422, {}))

    const result = await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toBe('HTTP 422')
  })

  it('falls back to "HTTP <status>" when json() rejects (malformed body)', async () => {
    mockFetch.mockResolvedValue({
      ok:   false,
      status: 503,
      json: jest.fn().mockRejectedValue(new Error('not json')),
    })

    const result = await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/HTTP 503/)
  })

  it('returns failure when response is ok but JournalEntry.Id is missing', async () => {
    mockFetch.mockResolvedValue(okResponse({ JournalEntry: {} }))

    const result = await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    expect(result.success).toBe(false)
  })

  it('logs warning on HTTP error', async () => {
    mockFetch.mockResolvedValue(
      errorResponse(401, { Fault: { Error: [{ Message: 'Auth failed' }] } })
    )

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    expect(logger.warn).toHaveBeenCalledWith(
      'QuickBooks posting failed',
      expect.objectContaining({ txnId: 'txn-qbo-001' })
    )
  })

  // ── network / timeout errors ───────────────────────────────────────────────

  it('returns { success: false, error } when fetch throws a network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const result = await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toBe('Network error')
  })

  it('returns { success: false } when fetch throws a timeout (AbortError)', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    mockFetch.mockRejectedValue(abortErr)

    const result = await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toContain('aborted')
  })

  it('logs error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('ssl handshake failed'))

    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})

    expect(logger.error).toHaveBeenCalledWith(
      'QuickBooks POST threw',
      expect.objectContaining({ txnId: 'txn-qbo-001' })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// refreshQuickBooksToken
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshQuickBooksToken', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    delete process.env.QBO_CLIENT_ID
    delete process.env.QBO_CLIENT_SECRET
  })

  it('returns null when QBO_CLIENT_ID is not set', async () => {
    const result = await refreshQuickBooksToken('any-refresh-token')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null when QBO_CLIENT_SECRET is not set (but CLIENT_ID is)', async () => {
    process.env.QBO_CLIENT_ID = 'some-id'
    const result = await refreshQuickBooksToken('any-refresh-token')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('calls the Intuit token endpoint when credentials are set', async () => {
    process.env.QBO_CLIENT_ID     = 'qbo-client-id'
    process.env.QBO_CLIENT_SECRET = 'qbo-client-secret'
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'new-at', expires_in: 3600 }),
    })

    await refreshQuickBooksToken('old-rt')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('oauth.platform.intuit.com')
    expect(url).toContain('bearer')
  })

  it('returns { accessToken, refreshToken, expiresAt } on success', async () => {
    process.env.QBO_CLIENT_ID     = 'qbo-client-id'
    process.env.QBO_CLIENT_SECRET = 'qbo-client-secret'
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        access_token:  'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        expires_in:    1800,
      }),
    })

    const result = await refreshQuickBooksToken('old-rt')

    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe('fresh-access-token')
    expect(result!.refreshToken).toBe('fresh-refresh-token')
    expect(result!.expiresAt).toBeInstanceOf(Date)
    // expiresAt should be ~30 minutes in the future
    expect(result!.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('preserves the old refreshToken when the server omits refresh_token', async () => {
    process.env.QBO_CLIENT_ID     = 'qbo-client-id'
    process.env.QBO_CLIENT_SECRET = 'qbo-client-secret'
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'at', expires_in: 3600 }),
    })

    const result = await refreshQuickBooksToken('my-original-rt')

    expect(result!.refreshToken).toBe('my-original-rt')
  })

  it('sends Basic Auth header with base64-encoded clientId:clientSecret', async () => {
    process.env.QBO_CLIENT_ID     = 'id-abc'
    process.env.QBO_CLIENT_SECRET = 'secret-xyz'
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'at', expires_in: 3600 }),
    })

    await refreshQuickBooksToken('rt')

    const [, options] = mockFetch.mock.calls[0]
    const expectedCredentials = Buffer.from('id-abc:secret-xyz').toString('base64')
    expect(options.headers.Authorization).toBe(`Basic ${expectedCredentials}`)
  })

  it('sends grant_type=refresh_token in the request body', async () => {
    process.env.QBO_CLIENT_ID     = 'qbo-client-id'
    process.env.QBO_CLIENT_SECRET = 'qbo-client-secret'
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'at', expires_in: 3600 }),
    })

    await refreshQuickBooksToken('my-rt')

    const [, options] = mockFetch.mock.calls[0]
    const bodyParams = new URLSearchParams(options.body)
    expect(bodyParams.get('grant_type')).toBe('refresh_token')
    expect(bodyParams.get('refresh_token')).toBe('my-rt')
  })

  it('returns null when the token endpoint returns HTTP 400', async () => {
    process.env.QBO_CLIENT_ID     = 'qbo-client-id'
    process.env.QBO_CLIENT_SECRET = 'qbo-client-secret'
    mockFetch.mockResolvedValue({
      ok: false, status: 400,
      json: jest.fn().mockResolvedValue({ error: 'invalid_grant' }),
    })

    const result = await refreshQuickBooksToken('expired-rt')

    expect(result).toBeNull()
  })

  it('returns null when fetch itself throws (network failure)', async () => {
    process.env.QBO_CLIENT_ID     = 'qbo-client-id'
    process.env.QBO_CLIENT_SECRET = 'qbo-client-secret'
    mockFetch.mockRejectedValue(new Error('DNS resolution failed'))

    const result = await refreshQuickBooksToken('rt')

    expect(result).toBeNull()
  })

  it('returns null when json() parsing fails on error response', async () => {
    process.env.QBO_CLIENT_ID     = 'qbo-client-id'
    process.env.QBO_CLIENT_SECRET = 'qbo-client-secret'
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: jest.fn().mockRejectedValue(new Error('malformed')),
    })

    const result = await refreshQuickBooksToken('rt')

    expect(result).toBeNull()
  })
})

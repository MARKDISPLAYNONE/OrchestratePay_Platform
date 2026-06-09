/**
 * Unit tests for integrations/accounting-shared.ts, xero.ts, sage.ts, wave.ts,
 * quickbooks.ts, and etims.ts — accounting GL posting integrations.
 */
process.env.NODE_ENV = 'test'

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../util/vat', () => ({
  vatBreakdown: jest.fn().mockReturnValue({ vatCents: 1600, netCents: 8400 }),
}))

const mockFetch = jest.fn()
global.fetch = mockFetch as any

import { refreshOAuthToken } from '../integrations/accounting-shared'
import { postToXero, refreshXeroToken } from '../integrations/xero'
import { postToSage, refreshSageToken } from '../integrations/sage'
import { postToWave } from '../integrations/wave'
import { postToQuickBooks, refreshQuickBooksToken } from '../integrations/quickbooks'
import { submitFiscalInvoice } from '../integrations/etims'

const BASE_PAYLOAD = {
  transactionId: 'txn-abc123',
  merchantId:    'merchant-1',
  amountCents:   10_000,
  currency:      'KES',
  description:   'OrchestratePay txn',
  journalDate:   '2026-06-08',
  mpesaReceipt:  'QA0T5EXAMPLE',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFetch.mockReset()
  delete process.env.XERO_CLIENT_ID
  delete process.env.XERO_CLIENT_SECRET
  delete process.env.SAGE_CLIENT_ID
  delete process.env.SAGE_CLIENT_SECRET
  delete process.env.QBO_CLIENT_ID
  delete process.env.QBO_CLIENT_SECRET
  delete process.env.ETIMS_BASE_URL
  delete process.env.ETIMS_API_KEY
})

// ─────────────────────────────────────────────────────────────────────────────
// accounting-shared: refreshOAuthToken
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshOAuthToken', () => {
  const BASE_PARAMS = {
    tokenUrl:     'https://identity.example.com/token',
    clientId:     'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'old-refresh-token',
    platform:     'test',
  }

  it('returns null when clientId is missing', async () => {
    const result = await refreshOAuthToken({ ...BASE_PARAMS, clientId: '' })
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns tokens on successful refresh', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        access_token:  'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in:    3600,
      }),
    })
    const result = await refreshOAuthToken(BASE_PARAMS)
    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe('new-access-token')
    expect(result!.refreshToken).toBe('new-refresh-token')
    expect(result!.expiresAt).toBeInstanceOf(Date)
  })

  it('keeps old refreshToken when none is returned', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ access_token: 'tok', expires_in: 1800 }),
    })
    const result = await refreshOAuthToken(BASE_PARAMS)
    expect(result!.refreshToken).toBe('old-refresh-token')
  })

  it('returns null on HTTP error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 400,
      json: jest.fn().mockResolvedValue({ error: 'invalid_grant' }),
    })
    const result = await refreshOAuthToken(BASE_PARAMS)
    expect(result).toBeNull()
  })

  it('returns null when json parse fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: jest.fn().mockRejectedValue(new Error('not json')),
    })
    const result = await refreshOAuthToken(BASE_PARAMS)
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    const result = await refreshOAuthToken(BASE_PARAMS)
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// xero.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('postToXero', () => {
  it('returns success with externalId on 200', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        ManualJournals: [{ ManualJournalID: 'xero-journal-1' }],
      }),
    })
    const result = await postToXero(BASE_PAYLOAD, 'at-tok', 'tenant-1', {})
    expect(result.success).toBe(true)
    expect(result.externalId).toBe('xero-journal-1')
  })

  it('returns failure with Xero validation error message', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 400,
      json: jest.fn().mockResolvedValue({
        Elements: [{ ValidationErrors: [{ Message: 'Account not found' }] }],
      }),
    })
    const result = await postToXero(BASE_PAYLOAD, 'at-tok', 'tenant-1', {})
    expect(result.success).toBe(false)
    expect(result.error).toBe('Account not found')
  })

  it('returns failure when json parse fails (catch handler)', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: jest.fn().mockRejectedValue(new Error('malformed')),
    })
    const result = await postToXero(BASE_PAYLOAD, 'at-tok', 'tenant-1', {})
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/HTTP 500/)
  })

  it('returns failure when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))
    const result = await postToXero(BASE_PAYLOAD, 'at-tok', 'tenant-1', {})
    expect(result.success).toBe(false)
    expect(result.error).toBe('timeout')
  })

  it('uses custom account codes from settings', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        ManualJournals: [{ ManualJournalID: 'jnl-2' }],
      }),
    })
    await postToXero(BASE_PAYLOAD, 'tok', 'tenant', {
      debitAccountCode: '300', creditAccountCode: '500',
    })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.ManualJournals[0].JournalLines[0].AccountCode).toBe('300')
  })
})

describe('refreshXeroToken', () => {
  it('returns null when XERO_CLIENT_ID not set', async () => {
    const result = await refreshXeroToken('refresh-tok')
    expect(result).toBeNull()
  })

  it('calls token endpoint with xero credentials', async () => {
    process.env.XERO_CLIENT_ID     = 'xero-id'
    process.env.XERO_CLIENT_SECRET = 'xero-secret'
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        access_token: 'new-tok', expires_in: 1800,
      }),
    })
    const result = await refreshXeroToken('old-rt')
    expect(result).not.toBeNull()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('xero.com'),
      expect.anything()
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// sage.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('postToQuickBooks — json parse failure', () => {
  it('falls back to HTTP status error when json() rejects', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 503,
      json: jest.fn().mockRejectedValue(new Error('not json')),
    })
    const result = await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/HTTP 503/)
  })
})

describe('postToSage', () => {
  it('returns success with externalId', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'sage-journal-99' }),
    })
    const result = await postToSage(BASE_PAYLOAD, 'at-tok', '', {})
    expect(result.success).toBe(true)
    expect(result.externalId).toBe('sage-journal-99')
  })

  it('returns failure on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 401,
      json: jest.fn().mockResolvedValue({ message: 'Unauthorized' }),
    })
    const result = await postToSage(BASE_PAYLOAD, 'bad-tok', '', {})
    expect(result.success).toBe(false)
  })

  it('returns failure when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('connection refused'))
    const result = await postToSage(BASE_PAYLOAD, 'tok', '', {})
    expect(result.success).toBe(false)
  })
})

describe('refreshSageToken', () => {
  it('returns null when SAGE credentials not configured', async () => {
    const result = await refreshSageToken('rt')
    expect(result).toBeNull()
  })

  it('refreshes token when credentials are set', async () => {
    process.env.SAGE_CLIENT_ID     = 'sage-id'
    process.env.SAGE_CLIENT_SECRET = 'sage-secret'
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ access_token: 'sage-at', expires_in: 3600 }),
    })
    const result = await refreshSageToken('old-rt')
    expect(result!.accessToken).toBe('sage-at')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// wave.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('postToSage — json parse failure', () => {
  it('falls back to HTTP status error when json() rejects', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: jest.fn().mockRejectedValue(new Error('malformed json')),
    })
    const result = await postToSage(BASE_PAYLOAD, 'tok', '', {})
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/HTTP 500/)
  })
})

describe('postToWave', () => {
  const WAVE_SETTINGS = {
    anchorAccountId:  'wave-acc-001',
    revenueAccountId: 'wave-rev-002',
  }

  it('returns failure when anchor or revenue account not configured', async () => {
    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', {})
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/anchorAccountId/i)
  })

  it('returns success on GraphQL success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          moneyTransactionCreate: {
            didSucceed:  true,
            transaction: { id: 'wave-txn-42' },
          },
        },
      }),
    })
    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)
    expect(result.success).toBe(true)
    expect(result.externalId).toBe('wave-txn-42')
  })

  it('returns failure with input errors from GraphQL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          moneyTransactionCreate: {
            didSucceed:  false,
            inputErrors: [{ code: 'INVALID', message: 'Invalid account' }],
          },
        },
      }),
    })
    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid account')
  })

  it('returns failure when json parse throws (catch handler covered)', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 503,
      json: jest.fn().mockRejectedValue(new Error('body not JSON')),
    })
    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)
    expect(result.success).toBe(false)
  })

  it('returns failure when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))
    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)
    expect(result.success).toBe(false)
    expect(result.error).toBe('timeout')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// quickbooks.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('postToQuickBooks', () => {
  it('returns success with externalId', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        JournalEntry: { Id: 'qbo-je-7' },
      }),
    })
    const result = await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})
    expect(result.success).toBe(true)
    expect(result.externalId).toBe('qbo-je-7')
  })

  it('returns failure on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 400,
      json: jest.fn().mockResolvedValue({ Fault: { Error: [{ Message: 'Bad request' }] } }),
    })
    const result = await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('Bad request')
  })

  it('returns failure when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('ssl error'))
    const result = await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-1', {})
    expect(result.success).toBe(false)
  })

  it('uses sandbox URL when QBO_SANDBOX=true', async () => {
    process.env.QBO_SANDBOX = 'true'
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ JournalEntry: { Id: 'qbo-sb-1' } }),
    })
    await postToQuickBooks(BASE_PAYLOAD, 'tok', 'realm-2', {})
    expect(mockFetch.mock.calls[0][0]).toContain('sandbox-quickbooks')
    delete process.env.QBO_SANDBOX
  })
})

describe('refreshQuickBooksToken', () => {
  it('returns null when QBO credentials not configured', async () => {
    const result = await refreshQuickBooksToken('rt')
    expect(result).toBeNull()
  })

  it('refreshes token when credentials are set', async () => {
    process.env.QBO_CLIENT_ID     = 'qbo-id'
    process.env.QBO_CLIENT_SECRET = 'qbo-secret'
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ access_token: 'qbo-at', expires_in: 3600 }),
    })
    const result = await refreshQuickBooksToken('old-rt')
    expect(result!.accessToken).toBe('qbo-at')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// etims.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('submitFiscalInvoice', () => {
  const makeDb = (queryFn: jest.Mock) => ({ query: queryFn } as any)

  const INVOICE = {
    merchantId:    'merchant-1',
    transactionId: 'txn-xyz',
    kraPin:        'A001234567B',
    amountCents:   10_000,
    mpesaReceipt:  'QA0T5EXAMPLE',
    issuedAt:      '2026-06-08T10:00:00Z',
  }

  it('uses local invoice number when eTIMS is not configured', async () => {
    const mockDbQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ seq: 42 }] })         // nextval
      .mockResolvedValueOnce({ rows: [{ id: 'fl-1' }] })      // INSERT fiscal_log
      .mockResolvedValueOnce({ rows: [] })                     // UPDATE fiscal_log

    await submitFiscalInvoice(INVOICE, makeDb(mockDbQuery))
    // The UPDATE should have been called with success=true (LOCAL- invoice)
    const updateCall = mockDbQuery.mock.calls[2]
    expect(updateCall[1][1]).toBe('ACCEPTED')
  })

  it('skips when transaction already submitted (idempotent)', async () => {
    const mockDbQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ seq: 1 }] })   // nextval
      .mockResolvedValueOnce({ rows: [] })              // INSERT returns nothing (conflict)

    await submitFiscalInvoice(INVOICE, makeDb(mockDbQuery))
    expect(mockDbQuery).toHaveBeenCalledTimes(2)
  })

  it('records ACCEPTED status when eTIMS succeeds', async () => {
    process.env.ETIMS_BASE_URL = 'https://etims.example.com'
    process.env.ETIMS_API_KEY  = 'api-key-1'

    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-00042' }),
    })

    const mockDbQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ seq: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'fl-2' }] })
      .mockResolvedValueOnce({ rows: [] })  // UPDATE

    await submitFiscalInvoice(INVOICE, makeDb(mockDbQuery))
    const updateCall = mockDbQuery.mock.calls[2]
    expect(updateCall[1][1]).toBe('ACCEPTED')
    expect(updateCall[1][0]).toBe('KRA-2026-00042')
  })

  it('records FAILED status when eTIMS returns HTTP error', async () => {
    process.env.ETIMS_BASE_URL = 'https://etims.example.com'
    process.env.ETIMS_API_KEY  = 'api-key-1'

    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: jest.fn().mockResolvedValue({}),
    })

    const mockDbQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ seq: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'fl-3' }] })
      .mockResolvedValueOnce({ rows: [] })

    await submitFiscalInvoice(INVOICE, makeDb(mockDbQuery))
    const updateCall = mockDbQuery.mock.calls[2]
    expect(updateCall[1][1]).toBe('FAILED')
  })

  it('uses random fallback invoice number when DB sequence fails', async () => {
    const mockDbQuery = jest.fn()
      .mockRejectedValueOnce(new Error('sequence unavailable'))  // nextval throws → fallback
      .mockResolvedValueOnce({ rows: [{ id: 'fl-4' }] })
      .mockResolvedValueOnce({ rows: [] })

    await submitFiscalInvoice(INVOICE, makeDb(mockDbQuery))
    // Should have continued despite the sequence error
    const insertCall = mockDbQuery.mock.calls[1]
    expect(insertCall[1][2]).toMatch(/INV-FALLBACK-/)
  })
})

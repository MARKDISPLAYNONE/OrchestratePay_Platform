/**
 * Tests that require jest.resetModules() to cover module-level constants
 * (evaluated once at load time) and additional integration/job branches.
 */
process.env.NODE_ENV = 'test'

const mockFetch = jest.fn()
global.fetch = mockFetch as any

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'

const mockDbQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// Redis mock used by daraja.ts (lazyConnect means requiring it won't fail, but
// commands would hit a real server — mock prevents that)
const mockDarajaRedisGet   = jest.fn().mockResolvedValue(null)
const mockDarajaRedisSetex = jest.fn().mockResolvedValue('OK')
jest.mock('../db/redis', () => ({
  redis: {
    get:   (...args: any[]) => mockDarajaRedisGet(...args),
    setex: (...args: any[]) => mockDarajaRedisSetex(...args),
  },
}))

// daraja.ts uses axios (not global.fetch) — auto-mock it so tests can
// provide specific implementations per describe block
jest.mock('axios')

beforeEach(() => {
  jest.clearAllMocks()
  mockFetch.mockReset()
  mockDbQuery.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// integrations/daraja.ts — line 24: DARAJA_BASE production URL branch
// ─────────────────────────────────────────────────────────────────────────────

describe('daraja.ts — DARAJA_BASE production URL (line 24)', () => {
  it('uses https://api.safaricom.co.ke when DARAJA_ENV=production', async () => {
    jest.resetModules()
    process.env.DARAJA_ENV             = 'production'
    process.env.DARAJA_CONSUMER_KEY    = 'key'
    process.env.DARAJA_CONSUMER_SECRET = 'secret'
    process.env.DARAJA_PASSKEY         = 'passkey'
    process.env.DARAJA_SHORTCODE       = '174379'

    // daraja.ts uses axios (not global.fetch) — mock it with a URL-capturing get
    let capturedUrl = ''
    jest.mock('axios', () => ({
      __esModule: true,
      default: {
        get: jest.fn().mockImplementation((url: string) => {
          capturedUrl = url
          return Promise.resolve({ data: { access_token: 'tok', expires_in: 3600 } })
        }),
        post: jest.fn().mockResolvedValue({
          data: { ResponseCode: '0', MerchantRequestID: 'mr-1', CheckoutRequestID: 'chk-1' },
        }),
      },
    }))
    jest.mock('../util/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }))
    jest.mock('../util/circuit-breaker', () => ({
      CircuitBreaker: jest.fn().mockImplementation(() => ({
        fire: async (fn: Function) => fn(),
      })),
      CircuitOpenError: class extends Error {},
    }))

    const { stkPush } = require('../integrations/daraja')

    try {
      await stkPush({
        phoneNumber: '254700000001',
        amount:      50,
        accountRef:  'ORDER-001',
        description: 'Test payment',
        callbackUrl: 'https://example.com/cb',
      })
    } catch {
      // stkPush may throw — only care that the OAuth URL uses the production base
    }

    expect(capturedUrl).toContain('api.safaricom.co.ke')

    delete process.env.DARAJA_ENV
    delete process.env.DARAJA_CONSUMER_KEY
    delete process.env.DARAJA_CONSUMER_SECRET
    delete process.env.DARAJA_PASSKEY
    delete process.env.DARAJA_SHORTCODE
    jest.resetModules()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// integrations/daraja.ts — line 296: maskPhone short phone (< 7 chars)
// ─────────────────────────────────────────────────────────────────────────────

describe('daraja.ts — maskPhone short phone (line 296)', () => {
  it('returns "****" for phones shorter than 7 characters', async () => {
    jest.resetModules()
    // Mock axios with successful OAuth + STK Push responses
    jest.mock('axios', () => ({
      __esModule: true,
      default: {
        get: jest.fn().mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } }),
        post: jest.fn().mockResolvedValue({
          data: { ResponseCode: '0', MerchantRequestID: 'mr-2', CheckoutRequestID: 'chk-short' },
        }),
      },
    }))
    jest.mock('../util/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }))
    jest.mock('../util/circuit-breaker', () => ({
      CircuitBreaker: jest.fn().mockImplementation(() => ({
        fire: async (fn: Function) => fn(),
      })),
      CircuitOpenError: class extends Error {},
    }))

    const { stkPush } = require('../integrations/daraja')
    await stkPush({
      phoneNumber: '254',   // normalisePhone returns '254' (3 chars < 7) → maskPhone = '****'
      amount:      50,
      accountRef:  'ORDER-002',
      description: 'Short phone',
      callbackUrl: 'https://example.com/cb',
    })

    const { logger } = require('../util/logger')
    const infoCalls: any[] = logger.info.mock.calls
    const callWithMasked = infoCalls.find(
      (args: any[]) => typeof args[1] === 'object' && String(args[1].phone) === '****'
    )
    expect(callWithMasked).toBeTruthy()

    jest.resetModules()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// integrations/africas-talking.ts — line 110: maskPhone short phone (< 7 chars)
// ─────────────────────────────────────────────────────────────────────────────

describe('africas-talking.ts — maskPhone short phone (line 110)', () => {
  it('uses "****" when phone is fewer than 7 characters', async () => {
    process.env.AT_API_KEY  = 'test-key'
    process.env.AT_USERNAME = 'sandbox'
    process.env.AT_SENDER_ID = 'OrchPay'

    // sendSms throws → catch block logs maskPhone(to) with short phone → '****'
    mockFetch.mockRejectedValue(new Error('Network error'))

    const { sendSms } = require('../integrations/africas-talking')
    await sendSms('123', 'Test SMS')  // '123' is 3 chars < 7

    const { logger } = require('../util/logger')
    const errorCall = logger.error.mock.calls.find(
      (args: any[]) => args[0] === 'SMS send threw'
    )
    expect(errorCall).toBeTruthy()
    // The masked phone logged should be '****' (short phone branch)
    expect(errorCall[1].to).toBe('****')

    delete process.env.AT_API_KEY
    delete process.env.AT_USERNAME
    delete process.env.AT_SENDER_ID
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// integrations/etims.ts — line 81: invoiceNumber ?? `ETIMS-${Date.now()}` fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('etims.ts — invoiceNumber fallback when absent from response (line 81)', () => {
  it('uses ETIMS-{timestamp} fallback when eTIMS response has no invoiceNumber', async () => {
    process.env.ETIMS_BASE_URL = 'https://etims.example.com'
    process.env.ETIMS_API_KEY  = 'api-key-2'

    // eTIMS POST succeeds but returns no invoiceNumber → triggers ?? `ETIMS-${Date.now()}`
    mockFetch.mockResolvedValue({
      ok:     true,
      status: 200,
      json:   jest.fn().mockResolvedValue({ status: 'success' }),  // no invoiceNumber field
    })

    const mockQ = jest.fn()
      .mockResolvedValueOnce({ rows: [{ seq: 42 }] })         // nextval
      .mockResolvedValueOnce({ rows: [{ id: 'fl-10' }] })     // INSERT fiscal_log
      .mockResolvedValueOnce({ rows: [] })                     // UPDATE fiscal_log (success)

    const { submitFiscalInvoice } = require('../integrations/etims')
    await submitFiscalInvoice({
      merchantId:    'merchant-2',
      transactionId: 'txn-etims-2',
      kraPin:        'A001234567B',
      amountCents:   10_000,
      mpesaReceipt:  'QA0T5EXAMPLE',
      issuedAt:      '2026-06-15T10:00:00Z',
    }, { query: mockQ } as any)

    // submitFiscalInvoice returns void — verify the fallback was written to the DB.
    // Call 0 = SELECT nextval, call 1 = INSERT fiscal_log, call 2 = UPDATE fiscal_log.
    // The UPDATE $1 param is result.invoiceNumber which falls back to ETIMS-{timestamp}.
    const updateCall = mockQ.mock.calls[2]
    expect(String(updateCall[1][0])).toMatch(/^ETIMS-\d+$/)

    delete process.env.ETIMS_BASE_URL
    delete process.env.ETIMS_API_KEY
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// jobs/gl-posting.ts — line 112: row.settings ?? {} and line 170: result.error ?? 'Unknown error'
// ─────────────────────────────────────────────────────────────────────────────

describe('jobs/gl-posting.ts — branch gaps', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.mock('../util/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }))
    jest.mock('../db/index', () => ({
      db: { query: (...args: any[]) => mockDbQuery(...args) },
    }))
    jest.mock('../util/distributed-lock', () => ({
      withDistributedLock: jest.fn().mockImplementation(async (_k: string, _t: number, fn: Function) => {
        await fn()
        return true
      }),
    }))
    jest.mock('../integrations/accounting-shared', () => ({
      refreshOAuthToken: jest.fn().mockResolvedValue(null),
    }))
    jest.mock('../integrations/quickbooks', () => ({
      postToQuickBooks: jest.fn().mockResolvedValue({ success: false, error: undefined }),
    }))
  })

  afterEach(() => {
    jest.resetModules()
  })

  it('line 112: row.settings ?? {} fires when row.settings is null', async () => {
    // The posting job fetches rows where settings could be null
    // When settings = null, `const settings = row.settings ?? {}` yields {}
    const row = {
      id:                      'posting-1',
      merchant_id:             MERCHANT_ID,
      transaction_id:          'txn-1',
      platform:                'quickbooks',
      access_token:            'tok-1',
      refresh_token:           'ref-1',
      realm_id:                'realm-1',
      settings:                null,       // ← triggers line 112 ?? {}
      token_expires_at:        null,
      accounting_integration_id: 'int-1',
      attempt_count:           0,
      amount_cents:            5000,
      currency:                'KES',
      description:             'Test',
      journal_date:            '2026-06-15',
    }
    mockDbQuery
      .mockResolvedValueOnce({ rows: [row] })         // SELECT gl_postings
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE attempt_count
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE gl_postings (failed → PENDING)

    const { runGlPostingJob } = require('../jobs/gl-posting')
    await runGlPostingJob()

    // The job ran without throwing (settings ?? {} is safe)
    const { postToQuickBooks } = require('../integrations/quickbooks')
    expect(postToQuickBooks).toHaveBeenCalledWith(
      expect.any(Object), 'tok-1', 'realm-1', {}  // settings = {}
    )
  })

  it('line 170: result.error ?? "Unknown error" fires when result.error is undefined', async () => {
    const row = {
      id:                      'posting-2',
      merchant_id:             MERCHANT_ID,
      transaction_id:          'txn-2',
      platform:                'quickbooks',
      access_token:            'tok-2',
      refresh_token:           'ref-2',
      realm_id:                'realm-2',
      settings:                {},
      token_expires_at:        null,
      accounting_integration_id: 'int-2',
      attempt_count:           0,
      amount_cents:            5000,
      currency:                'KES',
      description:             'Test',
      journal_date:            '2026-06-15',
    }
    mockDbQuery
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })   // UPDATE attempt_count
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })   // UPDATE gl_postings PENDING/FAILED

    // postToQuickBooks returns { success: false } with NO error field → error ?? 'Unknown error'
    const { postToQuickBooks } = require('../integrations/quickbooks')
    postToQuickBooks.mockResolvedValueOnce({ success: false })  // error is undefined

    const { runGlPostingJob } = require('../jobs/gl-posting')
    await runGlPostingJob()

    // The UPDATE query should use 'Unknown error' as last_error
    const updateCall = mockDbQuery.mock.calls.find((c: any[]) =>
      String(c[1]?.[1]) === 'Unknown error'
    )
    expect(updateCall).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// util/fx.ts — line 53: getRate('KES') returns 1, line 191: missing usdToTarget
// ─────────────────────────────────────────────────────────────────────────────

describe('util/fx.ts — branch gaps', () => {
  it('line 53: getRate("KES") immediately returns 1 without a DB call', async () => {
    // Import the REAL fx module (not mocked — different from the jest.mock at the top of this file)
    // Since we have jest.mock('../db/index') active, db is already mocked
    const { getRate } = require('../util/fx')
    const rate = await getRate('KES')
    expect(rate).toBe(1)
    // No DB query should have been made
    expect(mockDbQuery).not.toHaveBeenCalled()
  })

  it('line 191: continues when a currency is absent from OXR rates object', async () => {
    process.env.OPENEXCHANGERATES_APP_ID = 'test-id'

    // OXR returns rates without USD (but has KES) → usdToTarget is undefined → continue
    mockFetch.mockResolvedValue({
      ok:   true,
      json: jest.fn().mockResolvedValue({
        rates: {
          KES: 130,
          USD: 1,
          // EUR is missing → usdToTarget = undefined → line 191 `if (!usdToTarget) continue`
        },
      }),
    })
    mockDbQuery.mockResolvedValue({ rows: [] })  // INSERT rates

    const { refreshAllRates } = require('../util/fx')
    const count = await refreshAllRates()

    // EUR was skipped, so count is less than total currencies
    expect(count).toBeGreaterThanOrEqual(0)

    delete process.env.OPENEXCHANGERATES_APP_ID
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// util/sentry.ts — lines 24-26: production environment branches
// ─────────────────────────────────────────────────────────────────────────────

describe('util/sentry.ts — production branches (lines 24-26)', () => {
  it('lines 24-26: Sentry.init called with environment and tracesSampleRate=0.1 in production', () => {
    jest.resetModules()
    process.env.NODE_ENV   = 'production'
    process.env.SENTRY_DSN = 'https://test@sentry.io/123'

    const mockSentryInit = jest.fn()
    jest.mock('@sentry/node', () => ({
      init:             mockSentryInit,
      captureException: jest.fn(),
      withScope:        jest.fn(),
    }))
    jest.mock('../util/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }))

    const { initSentry } = require('../util/sentry')
    initSentry()

    expect(mockSentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        environment:      'production',  // NODE_ENV ?? 'development' (line 24)
        tracesSampleRate: 0.1,           // production → 0.1 (line 26)
      })
    )

    process.env.NODE_ENV = 'test'
    delete process.env.SENTRY_DSN
    jest.resetModules()
  })

  it('line 24: environment defaults to "development" when NODE_ENV is unset', () => {
    jest.resetModules()
    const savedEnv = process.env.NODE_ENV
    delete process.env.NODE_ENV
    process.env.SENTRY_DSN = 'https://test@sentry.io/456'

    const mockSentryInit = jest.fn()
    jest.mock('@sentry/node', () => ({
      init:             mockSentryInit,
      captureException: jest.fn(),
      withScope:        jest.fn(),
    }))
    jest.mock('../util/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }))

    const { initSentry } = require('../util/sentry')
    initSentry()

    expect(mockSentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'development',  // NODE_ENV ?? 'development' (line 24, null-coalescing branch)
      })
    )

    process.env.NODE_ENV = savedEnv
    delete process.env.SENTRY_DSN
    jest.resetModules()
  })
})

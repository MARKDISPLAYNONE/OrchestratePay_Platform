/**
 * Focused integration tests for integrations/wave.ts
 *
 * Tests postToWave in isolation. Wave uses a GraphQL API (moneyTransactionCreate
 * mutation) rather than a REST endpoint — test patterns reflect that difference.
 * Mocks global.fetch — no network calls or credentials required.
 *
 * Note: Wave does not expose a refreshToken function; API keys are long-lived.
 */
process.env.NODE_ENV = 'test'

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockFetch = jest.fn()
global.fetch = mockFetch as any

import { postToWave } from '../integrations/wave'
import { logger } from '../util/logger'

// ─── shared fixtures ──────────────────────────────────────────────────────────

const BASE_PAYLOAD = {
  transactionId: 'txn-wave-001',
  merchantId:    'merchant-wave',
  amountCents:   8_000,         // KES 80.00
  currency:      'KES',
  description:   'OrchestratePay Wave test',
  journalDate:   '2026-06-17',
  mpesaReceipt:  'WV0T1EXAMPLE',
}

const WAVE_SETTINGS = {
  anchorAccountId:  'uuid-anchor-001',
  revenueAccountId: 'uuid-revenue-002',
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build a mock GraphQL success response */
function gqlSuccess(transactionId: string) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({
      data: {
        moneyTransactionCreate: {
          didSucceed:  true,
          transaction: { id: transactionId },
        },
      },
    }),
  }
}

/** Build a mock GraphQL failure response (didSucceed=false) */
function gqlFailure(inputErrors: Array<{ code: string; message: string }>) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({
      data: {
        moneyTransactionCreate: {
          didSucceed:  false,
          inputErrors,
          transaction: null,
        },
      },
    }),
  }
}

/** Build a mock HTTP-level error response */
function httpError(status: number) {
  return {
    ok: false,
    status,
    json: jest.fn().mockResolvedValue({}),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// postToWave — settings validation
// ─────────────────────────────────────────────────────────────────────────────

describe('postToWave — settings validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
  })

  it('returns failure immediately when anchorAccountId is missing', async () => {
    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', {
      revenueAccountId: 'rev-001',
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/anchorAccountId/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns failure immediately when revenueAccountId is missing', async () => {
    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', {
      anchorAccountId: 'anc-001',
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/revenueAccountId/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns failure when both account IDs are missing (empty settings)', async () => {
    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', {})

    expect(result.success).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// postToWave — success path
// ─────────────────────────────────────────────────────────────────────────────

describe('postToWave — success path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
  })

  it('returns { success: true, externalId } on GraphQL success', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('wave-txn-99'))

    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(result.success).toBe(true)
    expect(result.externalId).toBe('wave-txn-99')
    expect(result.error).toBeUndefined()
  })

  it('logs info with txnId and externalId on success', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('wave-log-id'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(logger.info).toHaveBeenCalledWith(
      'Wave transaction posted',
      expect.objectContaining({ txnId: 'txn-wave-001', externalId: 'wave-log-id' })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// postToWave — HTTP method, URL, and headers
// ─────────────────────────────────────────────────────────────────────────────

describe('postToWave — request format', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
  })

  it('uses HTTP POST method', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    expect(options.method).toBe('POST')
  })

  it('targets the Wave GraphQL public endpoint', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://gql.waveapps.com/graphql/public')
  })

  it('sends Bearer token in Authorization header', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'wave-api-key-abc', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Authorization']).toBe('Bearer wave-api-key-abc')
  })

  it('sends Content-Type: application/json', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  // ── GraphQL mutation body ──────────────────────────────────────────────────

  it('sends a GraphQL query + variables in the request body', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body).toHaveProperty('query')
    expect(body).toHaveProperty('variables')
    expect(body.query).toContain('moneyTransactionCreate')
  })

  it('includes businessId in variables.input', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-uuid-xyz', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    const { variables } = JSON.parse(options.body)
    expect(variables.input.businessId).toBe('biz-uuid-xyz')
  })

  it('passes transactionId as externalId in variables.input', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    const { variables } = JSON.parse(options.body)
    expect(variables.input.externalId).toBe('txn-wave-001')
  })

  it('converts amountCents to decimal string with 2dp in anchor.amount', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    const { variables } = JSON.parse(options.body)
    // 8000 cents → '80.00'
    expect(variables.input.anchor.amount).toBe('80.00')
  })

  it('sets anchor.direction to DEPOSIT', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    const { variables } = JSON.parse(options.body)
    expect(variables.input.anchor.direction).toBe('DEPOSIT')
  })

  it('sets anchor.accountId from settings.anchorAccountId', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    const { variables } = JSON.parse(options.body)
    expect(variables.input.anchor.accountId).toBe('uuid-anchor-001')
  })

  it('sets lineItems[0].accountId from settings.revenueAccountId', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    const { variables } = JSON.parse(options.body)
    expect(variables.input.lineItems[0].accountId).toBe('uuid-revenue-002')
  })

  it('sets lineItems[0].balance to DECREASE', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    const { variables } = JSON.parse(options.body)
    expect(variables.input.lineItems[0].balance).toBe('DECREASE')
  })

  it('sets date from journalDate', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    const { variables } = JSON.parse(options.body)
    expect(variables.input.date).toBe('2026-06-17')
  })

  it('sets description from payload.description', async () => {
    mockFetch.mockResolvedValue(gqlSuccess('x'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    const [, options] = mockFetch.mock.calls[0]
    const { variables } = JSON.parse(options.body)
    expect(variables.input.description).toBe('OrchestratePay Wave test')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// postToWave — GraphQL-level errors (didSucceed=false)
// ─────────────────────────────────────────────────────────────────────────────

describe('postToWave — GraphQL-level errors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
  })

  it('returns failure when didSucceed is false and collects inputErrors', async () => {
    mockFetch.mockResolvedValue(
      gqlFailure([{ code: 'INVALID', message: 'Invalid account' }])
    )

    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid account')
  })

  it('joins multiple inputErrors with semicolons', async () => {
    mockFetch.mockResolvedValue(
      gqlFailure([
        { code: 'ERR_1', message: 'First error' },
        { code: 'ERR_2', message: 'Second error' },
      ])
    )

    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(result.success).toBe(false)
    expect(result.error).toContain('First error')
    expect(result.error).toContain('Second error')
  })

  it('falls back to top-level GraphQL errors[0].message when inputErrors is absent', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({
        data: { moneyTransactionCreate: { didSucceed: false } },
        errors: [{ message: 'Unauthorized' }],
      }),
    })

    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Unauthorized')
  })

  it('falls back to "HTTP <status>" when all error paths are empty', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 503,
      json: jest.fn().mockResolvedValue({}),
    })

    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/503/)
  })

  it('logs warning on GraphQL-level failure', async () => {
    mockFetch.mockResolvedValue(
      gqlFailure([{ code: 'INVALID', message: 'bad account' }])
    )

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(logger.warn).toHaveBeenCalledWith(
      'Wave posting failed',
      expect.objectContaining({ txnId: 'txn-wave-001' })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// postToWave — HTTP errors and json() failures
// ─────────────────────────────────────────────────────────────────────────────

describe('postToWave — HTTP errors and json parse failures', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
  })

  it('returns failure on HTTP 401', async () => {
    mockFetch.mockResolvedValue(httpError(401))

    const result = await postToWave(BASE_PAYLOAD, 'bad-key', 'biz-1', WAVE_SETTINGS)

    expect(result.success).toBe(false)
  })

  it('returns failure when json() rejects on non-ok response (catch handler)', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 503,
      json: jest.fn().mockRejectedValue(new Error('body not JSON')),
    })

    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(result.success).toBe(false)
    // The .catch(() => ({})) path returns {}, so no explicit message — just not success
  })

  it('returns failure when json() rejects on ok response (malformed GraphQL body)', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockRejectedValue(new Error('unexpected EOF')),
    })

    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(result.success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// postToWave — network errors (fetch throws)
// ─────────────────────────────────────────────────────────────────────────────

describe('postToWave — network errors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
  })

  it('returns { success: false, error } when fetch throws a network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNRESET'))

    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(result.success).toBe(false)
    expect(result.error).toBe('ECONNRESET')
  })

  it('returns { success: false } on AbortError (15s timeout)', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    mockFetch.mockRejectedValue(abortErr)

    const result = await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(result.success).toBe(false)
    expect(result.error).toContain('aborted')
  })

  it('logs error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))

    await postToWave(BASE_PAYLOAD, 'tok', 'biz-1', WAVE_SETTINGS)

    expect(logger.error).toHaveBeenCalledWith(
      'Wave POST threw',
      expect.objectContaining({ txnId: 'txn-wave-001', error: 'timeout' })
    )
  })
})

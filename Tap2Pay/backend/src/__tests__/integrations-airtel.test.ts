/**
 * integrations-airtel.test.ts — Full coverage for src/integrations/airtel.ts
 *
 * Covers:
 *   airtelCollect() — happy path (success response, token fetched + cached)
 *   airtelCollect() — failure response (non-success code) → returns success: false
 *   airtelCollect() — missing AIRTEL_CALLBACK_URL throws
 *   getAirtelToken() — Redis cache hit (no HTTP call)
 *   getAirtelToken() — missing credentials throws
 *   airtelEnquiry() — returns status from API
 */
import axios from 'axios'

process.env.NODE_ENV = 'test'

// ── Mock axios ────────────────────────────────────────────────────────────────
jest.mock('axios')
const mockAxiosPost = jest.fn()
const mockAxiosGet  = jest.fn()
;(axios as any).post = mockAxiosPost
;(axios as any).get  = mockAxiosGet

// ── Mock Redis ────────────────────────────────────────────────────────────────
const mockRedisGet  = jest.fn()
const mockRedisSetex = jest.fn()

jest.mock('../db/redis', () => ({
  redis: {
    get:   (...a: any[]) => mockRedisGet(...a),
    setex: (...a: any[]) => mockRedisSetex(...a),
  },
}))

// ── Mock logger ───────────────────────────────────────────────────────────────
jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// ── Constants ─────────────────────────────────────────────────────────────────

const MOCK_TOKEN = 'airtel-access-token-abc123'
const MOCK_TXN_ID = 'txn-airtel-001'

// ── Helpers ───────────────────────────────────────────────────────────────────

function setEnv(overrides: Record<string, string | undefined> = {}) {
  const defaults: Record<string, string> = {
    AIRTEL_CLIENT_ID:     'test-client-id',
    AIRTEL_CLIENT_SECRET: 'test-client-secret',
    AIRTEL_CALLBACK_URL:  'https://api.example.com/airtel-callback',
    AIRTEL_ENV:           'sandbox',
    AIRTEL_COUNTRY:       'KE',
    AIRTEL_CURRENCY:      'KES',
  }
  Object.assign(process.env, { ...defaults, ...overrides })
}

function clearAirtelEnv() {
  delete process.env.AIRTEL_CLIENT_ID
  delete process.env.AIRTEL_CLIENT_SECRET
  delete process.env.AIRTEL_CALLBACK_URL
}

function makeCollectRequest(overrides: Record<string, any> = {}) {
  return {
    transactionId: MOCK_TXN_ID,
    phone:         '0712345678',
    amountCents:   5000,
    reference:     'PaymentRef',
    ...overrides,
  }
}

function mockTokenFetch() {
  mockAxiosPost.mockResolvedValueOnce({
    data: {
      access_token: MOCK_TOKEN,
      expires_in:   3600,
    },
  })
}

function mockTokenCache() {
  mockRedisGet.mockResolvedValueOnce(MOCK_TOKEN)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAxiosPost.mockReset()
  mockAxiosGet.mockReset()
  mockRedisGet.mockReset()
  mockRedisSetex.mockReset()

  // Default: no cached token
  mockRedisGet.mockResolvedValue(null)
  mockRedisSetex.mockResolvedValue('OK')
  setEnv()
})

afterEach(() => {
  clearAirtelEnv()
})

// ── Re-import after setting env (module is re-used between tests) ──────────────
// Note: We require inside tests to pick up fresh env, but jest caches modules.
// Use jest.resetModules() when testing different env scenarios.

// ═════════════════════════════════════════════════════════════════════════════
// airtelCollect — happy path
// ═════════════════════════════════════════════════════════════════════════════

describe('airtelCollect — happy path', () => {
  it('fetches token, calls Airtel API, and returns success=true', async () => {
    // Token not in cache → fetch from API
    mockTokenFetch()

    // Airtel collection API returns success
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        status: {
          code:    'DP00800001006',
          success: true,
          message: 'Accepted',
        },
        data: {
          transaction: { id: 'airtel-txn-xyz' },
        },
      },
    })

    const { airtelCollect } = require('../integrations/airtel')
    const result = await airtelCollect(makeCollectRequest())

    expect(result.success).toBe(true)
    expect(result.transactionId).toBe('airtel-txn-xyz')

    // Verify token was cached in Redis
    expect(mockRedisSetex).toHaveBeenCalledWith(
      'airtel:access_token',
      expect.any(Number),
      MOCK_TOKEN
    )
  })

  it('uses success=true status even when code is not DP00800001006', async () => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        status: { success: true, message: 'OK' },
        data:   { transaction: { id: 'airtel-txn-alt' } },
      },
    })

    const { airtelCollect } = require('../integrations/airtel')
    const result = await airtelCollect(makeCollectRequest())

    expect(result.success).toBe(true)
    expect(result.transactionId).toBe('airtel-txn-alt')
  })

  it('falls back to req.transactionId when API response has no transaction.id', async () => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        status: { code: 'DP00800001006', success: true },
        data:   {},  // no transaction.id
      },
    })

    const { airtelCollect } = require('../integrations/airtel')
    const result = await airtelCollect(makeCollectRequest({ transactionId: 'my-txn-id' }))

    expect(result.success).toBe(true)
    expect(result.transactionId).toBe('my-txn-id')  // fallback
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// airtelCollect — failure responses
// ═════════════════════════════════════════════════════════════════════════════

describe('airtelCollect — failure responses', () => {
  it('returns success=false when code is not success and status.success is false', async () => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        status: {
          code:    'DP00400001003',
          success: false,
          message: 'Subscriber not found',
        },
      },
    })

    const { airtelCollect } = require('../integrations/airtel')
    const result = await airtelCollect(makeCollectRequest())

    expect(result.success).toBe(false)
    expect(result.transactionId).toBe(MOCK_TXN_ID)
    expect(result.errorMessage).toBe('Subscriber not found')
  })

  it('falls back to default errorMessage when status.message is absent', async () => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: { status: { success: false } },  // no message
    })

    const { airtelCollect } = require('../integrations/airtel')
    const result = await airtelCollect(makeCollectRequest())

    expect(result.success).toBe(false)
    expect(result.errorMessage).toBe('Airtel collection failed')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// airtelCollect — missing env var
// ═════════════════════════════════════════════════════════════════════════════

describe('airtelCollect — missing AIRTEL_CALLBACK_URL', () => {
  it('throws when AIRTEL_CALLBACK_URL is not configured', async () => {
    delete process.env.AIRTEL_CALLBACK_URL

    const { airtelCollect } = require('../integrations/airtel')

    await expect(airtelCollect(makeCollectRequest())).rejects.toThrow(
      'AIRTEL_CALLBACK_URL not configured'
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Token fetch — Redis cache behaviour
// ═════════════════════════════════════════════════════════════════════════════

describe('getAirtelToken — Redis caching', () => {
  it('returns cached token without making an HTTP request', async () => {
    mockTokenCache()  // token is in Redis
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        status: { code: 'DP00800001006', success: true },
        data:   { transaction: { id: 'txn-cached' } },
      },
    })

    const { airtelCollect } = require('../integrations/airtel')
    await airtelCollect(makeCollectRequest())

    // Only 1 axios.post call: the collection endpoint (no token fetch)
    expect(mockAxiosPost).toHaveBeenCalledTimes(1)
    expect(mockAxiosPost.mock.calls[0][0]).toContain('/merchant/v2/payments')
  })

  it('caches token with correct TTL (expires_in - 60)', async () => {
    mockAxiosPost
      .mockResolvedValueOnce({
        data: { access_token: MOCK_TOKEN, expires_in: 7200 },  // 2h
      })
      .mockResolvedValueOnce({
        data: { status: { code: 'DP00800001006', success: true }, data: { transaction: { id: 'x' } } },
      })

    const { airtelCollect } = require('../integrations/airtel')
    await airtelCollect(makeCollectRequest())

    expect(mockRedisSetex).toHaveBeenCalledWith(
      'airtel:access_token',
      7200 - 60,  // 7140
      MOCK_TOKEN
    )
  })

  it('defaults expires_in to 3600 when not present in token response', async () => {
    mockAxiosPost
      .mockResolvedValueOnce({
        data: { access_token: MOCK_TOKEN },  // no expires_in
      })
      .mockResolvedValueOnce({
        data: { status: { success: true }, data: { transaction: { id: 'x' } } },
      })

    const { airtelCollect } = require('../integrations/airtel')
    await airtelCollect(makeCollectRequest())

    expect(mockRedisSetex).toHaveBeenCalledWith(
      'airtel:access_token',
      3600 - 60,  // 3540
      MOCK_TOKEN
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Token fetch — missing credentials
// ═════════════════════════════════════════════════════════════════════════════

describe('getAirtelToken — missing credentials', () => {
  it('throws when AIRTEL_CLIENT_ID is not set', async () => {
    delete process.env.AIRTEL_CLIENT_ID

    const { airtelCollect } = require('../integrations/airtel')

    await expect(airtelCollect(makeCollectRequest())).rejects.toThrow(
      'Airtel credentials not configured'
    )
  })

  it('throws when AIRTEL_CLIENT_SECRET is not set', async () => {
    delete process.env.AIRTEL_CLIENT_SECRET

    const { airtelCollect } = require('../integrations/airtel')

    await expect(airtelCollect(makeCollectRequest())).rejects.toThrow(
      'Airtel credentials not configured'
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// airtelEnquiry
// ═════════════════════════════════════════════════════════════════════════════

describe('airtelEnquiry', () => {
  it('returns transaction status from Airtel enquiry API', async () => {
    mockTokenCache()
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        data: { transaction: { status: 'TS' } },  // TS = Transaction Successful
      },
    })

    const { airtelEnquiry } = require('../integrations/airtel')
    const result = await airtelEnquiry('airtel-txn-xyz')

    expect(result.status).toBe('TS')
    expect(mockAxiosGet.mock.calls[0][0]).toContain('/standard/v1/payments/airtel-txn-xyz')
  })

  it('returns UNKNOWN status when response has no transaction.status', async () => {
    mockTokenCache()
    mockAxiosGet.mockResolvedValueOnce({
      data: {},  // no nested data
    })

    const { airtelEnquiry } = require('../integrations/airtel')
    const result = await airtelEnquiry('unknown-txn')

    expect(result.status).toBe('UNKNOWN')
  })

  it('passes Authorization header with Bearer token', async () => {
    mockTokenCache()
    mockAxiosGet.mockResolvedValueOnce({
      data: { data: { transaction: { status: 'TS' } } },
    })

    const { airtelEnquiry } = require('../integrations/airtel')
    await airtelEnquiry('txn-check-headers')

    const requestConfig = mockAxiosGet.mock.calls[0][1]
    expect(requestConfig.headers.Authorization).toBe(`Bearer ${MOCK_TOKEN}`)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Phone normalisation (via collect — different phone formats)
// ═════════════════════════════════════════════════════════════════════════════

describe('airtelCollect — phone normalisation', () => {
  beforeEach(() => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: { status: { code: 'DP00800001006', success: true }, data: { transaction: { id: 'x' } } },
    })
  })

  it('normalises 07xx number to 254xx', async () => {
    const { airtelCollect } = require('../integrations/airtel')
    await airtelCollect(makeCollectRequest({ phone: '0712345678' }))

    const collectCall = mockAxiosPost.mock.calls.find((c: any[]) =>
      String(c[0]).includes('/merchant/v2/payments')
    )
    expect(collectCall![1].subscriber.msisdn).toBe('254712345678')
  })

  it('passes 254xx number through as-is', async () => {
    const { airtelCollect } = require('../integrations/airtel')
    await airtelCollect(makeCollectRequest({ phone: '254712345678' }))

    const collectCall = mockAxiosPost.mock.calls.find((c: any[]) =>
      String(c[0]).includes('/merchant/v2/payments')
    )
    expect(collectCall![1].subscriber.msisdn).toBe('254712345678')
  })

  it('normalises 9-digit number to 254xx', async () => {
    const { airtelCollect } = require('../integrations/airtel')
    await airtelCollect(makeCollectRequest({ phone: '712345678' }))

    const collectCall = mockAxiosPost.mock.calls.find((c: any[]) =>
      String(c[0]).includes('/merchant/v2/payments')
    )
    expect(collectCall![1].subscriber.msisdn).toBe('254712345678')
  })
})

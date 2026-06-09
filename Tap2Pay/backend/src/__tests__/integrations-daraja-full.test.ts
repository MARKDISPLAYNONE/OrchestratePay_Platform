/**
 * Comprehensive tests for integrations/daraja.ts.
 * Covers: getAccessToken (via stkPush), generatePassword (via stkPush),
 *         stkPush, stkQuery, getDarajaCircuitStatus, maskPhone (via stkPush).
 */
process.env.NODE_ENV = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRedisGet   = jest.fn()
const mockRedisSetex = jest.fn()
jest.mock('../db/redis', () => ({
  redis: {
    get:   (...args: any[]) => mockRedisGet(...args),
    setex: (...args: any[]) => mockRedisSetex(...args),
  },
}))

jest.mock('axios')

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// Circuit breaker: default behaviour is to call fire(fn) → fn().
// Individual tests override mockFire for circuit-open scenarios.
const mockFire         = jest.fn()
const mockCircuitState = { status: 'CLOSED' as string, failureCount: 0 }
jest.mock('../util/circuit-breaker', () => {
  const actual = jest.requireActual('../util/circuit-breaker')
  return {
    CircuitBreaker: jest.fn().mockImplementation(() => ({
      fire: mockFire,
      get status()       { return mockCircuitState.status },
      get failureCount() { return mockCircuitState.failureCount },
    })),
    CircuitOpenError: actual.CircuitOpenError,
  }
})

import { stkPush, stkQuery, getDarajaCircuitStatus } from '../integrations/daraja'
import axios from 'axios'

const mockedAxios = axios as jest.Mocked<typeof axios>

// ── Helpers ───────────────────────────────────────────────────────────────────

const STK_REQ = {
  phoneNumber: '254712345678',
  amount:      100,
  accountRef:  'ORDER-001',
  description: 'Test payment',
  callbackUrl: 'https://example.com/callback',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFire.mockImplementation((fn: Function) => fn())
  mockCircuitState.status       = 'CLOSED'
  mockCircuitState.failureCount = 0
  mockRedisGet.mockResolvedValue(null)   // no cached token by default
  mockRedisSetex.mockResolvedValue('OK')

  process.env.DARAJA_CONSUMER_KEY    = 'test-ck'
  process.env.DARAJA_CONSUMER_SECRET = 'test-cs'
  process.env.DARAJA_SHORTCODE       = '174379'
  process.env.DARAJA_PASSKEY         = 'test-passkey'
})

// ─────────────────────────────────────────────────────────────────────────────
// getAccessToken  (tested indirectly via stkPush)
// ─────────────────────────────────────────────────────────────────────────────

describe('getAccessToken — Redis cache hit', () => {
  it('uses the cached token and skips Daraja OAuth call', async () => {
    mockRedisGet.mockResolvedValue('cached-daraja-token')
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: { ResponseCode: '0', MerchantRequestID: 'mr-1', CheckoutRequestID: 'co-1' },
    })

    await stkPush(STK_REQ)

    // axios.get should NOT have been called (Redis cache was used)
    expect(mockedAxios.get).not.toHaveBeenCalled()
    expect(mockedAxios.post).toHaveBeenCalled()
  })
})

describe('getAccessToken — Redis miss, fresh Daraja token', () => {
  it('fetches a new token from Daraja and caches it in Redis', async () => {
    mockRedisGet.mockResolvedValue(null)
    mockedAxios.get = jest.fn().mockResolvedValue({
      data: { access_token: 'fresh-daraja-token', expires_in: '3600' },
    })
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: { ResponseCode: '0', MerchantRequestID: 'mr-2', CheckoutRequestID: 'co-2' },
    })

    await stkPush(STK_REQ)

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('oauth'),
      expect.any(Object)
    )
    expect(mockRedisSetex).toHaveBeenCalledWith(
      'daraja:access_token',
      expect.any(Number),
      'fresh-daraja-token'
    )
  })

  it('defaults to 3600s TTL when expires_in is absent', async () => {
    mockRedisGet.mockResolvedValue(null)
    mockedAxios.get = jest.fn().mockResolvedValue({
      data: { access_token: 'tok', expires_in: undefined },
    })
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: { ResponseCode: '0', MerchantRequestID: 'mr-3', CheckoutRequestID: 'co-3' },
    })

    await stkPush(STK_REQ)
    // TTL should be 3600 - 100 = 3500
    expect(mockRedisSetex).toHaveBeenCalledWith('daraja:access_token', 3500, 'tok')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// stkPush
// ─────────────────────────────────────────────────────────────────────────────

describe('stkPush — success', () => {
  it('returns success with merchantRequestId and checkoutRequestId', async () => {
    mockRedisGet.mockResolvedValue('tok')
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: {
        ResponseCode:       '0',
        ResponseDescription: 'Success',
        MerchantRequestID:  'mr-100',
        CheckoutRequestID:  'ws_CO_001',
      },
    })

    const result = await stkPush(STK_REQ)

    expect(result.success).toBe(true)
    expect(result.merchantRequestId).toBe('mr-100')
    expect(result.checkoutRequestId).toBe('ws_CO_001')
  })

  it('truncates accountRef to 12 chars and description to 13 chars', async () => {
    mockRedisGet.mockResolvedValue('tok')
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: { ResponseCode: '0', MerchantRequestID: 'mr-1', CheckoutRequestID: 'co-1' },
    })

    await stkPush({
      ...STK_REQ,
      accountRef:  'VERY-LONG-ACCOUNT-REFERENCE',
      description: 'A Very Long Description Here',
    })

    const callBody = (mockedAxios.post as jest.Mock).mock.calls[0][1]
    expect(callBody.AccountReference.length).toBeLessThanOrEqual(12)
    expect(callBody.TransactionDesc.length).toBeLessThanOrEqual(13)
  })
})

describe('stkPush — Daraja decline (ResponseCode != "0")', () => {
  it('returns success=false with the Daraja error description', async () => {
    mockRedisGet.mockResolvedValue('tok')
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: {
        ResponseCode:       '1',
        ResponseDescription: 'Invalid initiator information',
      },
    })

    const result = await stkPush(STK_REQ)

    expect(result.success).toBe(false)
    expect(result.errorMessage).toMatch(/Invalid initiator/)
  })
})

describe('stkPush — Axios error', () => {
  it('returns success=false with the axios error message', async () => {
    mockRedisGet.mockResolvedValue('tok')
    const axiosErr: any = new Error('Network timeout')
    axiosErr.response = { data: { errorMessage: 'Daraja error detail' } }
    mockedAxios.post = jest.fn().mockRejectedValue(axiosErr)

    const result = await stkPush(STK_REQ)

    expect(result.success).toBe(false)
    expect(result.errorMessage).toBe('Daraja error detail')
  })

  it('falls back to err.message when no response body', async () => {
    mockRedisGet.mockResolvedValue('tok')
    mockedAxios.post = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await stkPush(STK_REQ)

    expect(result.success).toBe(false)
    expect(result.errorMessage).toBe('ECONNREFUSED')
  })
})

describe('stkPush — CircuitOpenError', () => {
  it('returns service-unavailable message when circuit is open', async () => {
    const { CircuitOpenError } = jest.requireActual('../util/circuit-breaker')
    mockFire.mockRejectedValue(new CircuitOpenError('daraja-api'))

    const result = await stkPush(STK_REQ)

    expect(result.success).toBe(false)
    expect(result.errorMessage).toContain('temporarily unavailable')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// stkQuery
// ─────────────────────────────────────────────────────────────────────────────

describe('stkQuery — success', () => {
  it('returns resultCode and resultDesc from Daraja', async () => {
    mockRedisGet.mockResolvedValue('tok')
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: { ResultCode: '0', ResultDesc: 'The service request is processed successfully.' },
    })

    const result = await stkQuery('ws_CO_01234567891234567')

    expect(result.resultCode).toBe(0)
    expect(result.resultDesc).toMatch(/processed successfully/)
  })

  it('parses non-zero result codes (e.g. insufficient funds = 1)', async () => {
    mockRedisGet.mockResolvedValue('tok')
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: { ResultCode: '1', ResultDesc: 'Insufficient funds' },
    })

    const result = await stkQuery('ws_CO_99999')

    expect(result.resultCode).toBe(1)
    expect(result.resultDesc).toBe('Insufficient funds')
  })
})

describe('stkQuery — Axios error', () => {
  it('returns resultCode -1 and a failure message', async () => {
    mockRedisGet.mockResolvedValue('tok')
    mockedAxios.post = jest.fn().mockRejectedValue(new Error('Read timeout'))

    const result = await stkQuery('ws_CO_00000')

    expect(result.resultCode).toBe(-1)
    expect(result.resultDesc).toMatch(/failed/i)
  })
})

describe('stkQuery — CircuitOpenError', () => {
  it('returns resultCode -1 with circuit open message', async () => {
    const { CircuitOpenError } = jest.requireActual('../util/circuit-breaker')
    mockFire.mockRejectedValue(new CircuitOpenError('daraja-api'))

    const result = await stkQuery('ws_CO_OPEN')

    expect(result.resultCode).toBe(-1)
    expect(result.resultDesc).toMatch(/circuit open/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getDarajaCircuitStatus
// ─────────────────────────────────────────────────────────────────────────────

describe('getDarajaCircuitStatus', () => {
  it('returns CLOSED state when no failures', () => {
    mockCircuitState.status       = 'CLOSED'
    mockCircuitState.failureCount = 0

    const status = getDarajaCircuitStatus()

    expect(status.state).toBe('CLOSED')
    expect(status.failureCount).toBe(0)
  })

  it('returns OPEN state when circuit has tripped', () => {
    mockCircuitState.status       = 'OPEN'
    mockCircuitState.failureCount = 5

    const status = getDarajaCircuitStatus()

    expect(status.state).toBe('OPEN')
    expect(status.failureCount).toBe(5)
  })
})

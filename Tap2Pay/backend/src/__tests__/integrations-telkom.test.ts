/**
 * integrations-telkom.test.ts — Full coverage for src/integrations/telkom.ts
 *
 * Covers:
 *   tkashCollect() — happy path (ResponseCode '0') → returns success: true
 *   tkashCollect() — non-0 ResponseCode → returns success: false
 *   tkashCollect() — missing TKASH_SHORTCODE or TKASH_CALLBACK_URL throws
 *   getTkashToken() — Redis cache hit (no HTTP call)
 *   getTkashToken() — fetches and caches new token
 *   getTkashToken() — missing credentials throws
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
const mockRedisGet   = jest.fn()
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

const MOCK_TOKEN  = 'tkash-access-token-xyz'
const MOCK_TXN_ID = 'tkash-txn-001'

// ── Helpers ───────────────────────────────────────────────────────────────────

function setEnv(overrides: Record<string, string | undefined> = {}) {
  const defaults: Record<string, string> = {
    TKASH_CONSUMER_KEY:    'test-consumer-key',
    TKASH_CONSUMER_SECRET: 'test-consumer-secret',
    TKASH_SHORTCODE:       '900900',
    TKASH_CALLBACK_URL:    'https://api.example.com/tkash-callback',
    TKASH_ENV:             'sandbox',
  }
  Object.assign(process.env, { ...defaults, ...overrides })
}

function clearTkashEnv() {
  delete process.env.TKASH_CONSUMER_KEY
  delete process.env.TKASH_CONSUMER_SECRET
  delete process.env.TKASH_SHORTCODE
  delete process.env.TKASH_CALLBACK_URL
}

function makeCollectRequest(overrides: Record<string, any> = {}) {
  return {
    transactionId: MOCK_TXN_ID,
    phone:         '0772345678',
    amountCents:   5000,
    reference:     'PayRef',
    description:   'Payment for goods',
    ...overrides,
  }
}

function mockTokenFetch() {
  mockAxiosGet.mockResolvedValueOnce({
    data: {
      access_token: MOCK_TOKEN,
      expires_in:   '3600',
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
  clearTkashEnv()
})

// ═════════════════════════════════════════════════════════════════════════════
// tkashCollect — happy path
// ═════════════════════════════════════════════════════════════════════════════

describe('tkashCollect — happy path (ResponseCode = 0)', () => {
  it('fetches token, calls T-Kash API, and returns success=true', async () => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        ResponseCode:        '0',
        ResponseDescription: 'Success',
        ConversationID:      'conv-abc123',
      },
    })

    const { tkashCollect } = require('../integrations/telkom')
    const result = await tkashCollect(makeCollectRequest())

    expect(result.success).toBe(true)
    expect(result.conversationId).toBe('conv-abc123')
    expect(result.errorMessage).toBeUndefined()
  })

  it('falls back to req.transactionId when ConversationID is absent', async () => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: { ResponseCode: '0' },  // no ConversationID
    })

    const { tkashCollect } = require('../integrations/telkom')
    const result = await tkashCollect(makeCollectRequest({ transactionId: 'my-txn-000' }))

    expect(result.success).toBe(true)
    expect(result.conversationId).toBe('my-txn-000')
  })

  it('sends correct payload including merchant shortcode and callback URL', async () => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: { ResponseCode: '0', ConversationID: 'conv-x' },
    })

    const { tkashCollect } = require('../integrations/telkom')
    await tkashCollect(makeCollectRequest())

    const payload = mockAxiosPost.mock.calls[0][1]
    expect(payload.MerchantCode).toBe('900900')
    expect(payload.CallbackURL).toBe('https://api.example.com/tkash-callback')
    expect(payload.Amount).toBe(50)  // Math.ceil(5000 / 100)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// tkashCollect — failure response
// ═════════════════════════════════════════════════════════════════════════════

describe('tkashCollect — non-0 ResponseCode', () => {
  it('returns success=false with errorMessage when ResponseCode is not 0', async () => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        ResponseCode:        '1032',
        ResponseDescription: 'Request cancelled by user',
        ConversationID:      'conv-fail',
      },
    })

    const { tkashCollect } = require('../integrations/telkom')
    const result = await tkashCollect(makeCollectRequest())

    expect(result.success).toBe(false)
    expect(result.conversationId).toBe(MOCK_TXN_ID)
    expect(result.errorMessage).toBe('Request cancelled by user')
  })

  it('uses default errorMessage when ResponseDescription is absent', async () => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: { ResponseCode: '500' },  // no ResponseDescription
    })

    const { tkashCollect } = require('../integrations/telkom')
    const result = await tkashCollect(makeCollectRequest())

    expect(result.success).toBe(false)
    expect(result.errorMessage).toBe('T-Kash collection failed')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// tkashCollect — missing env vars
// ═════════════════════════════════════════════════════════════════════════════

describe('tkashCollect — missing configuration', () => {
  it('throws when TKASH_SHORTCODE is not configured', async () => {
    delete process.env.TKASH_SHORTCODE

    const { tkashCollect } = require('../integrations/telkom')

    await expect(tkashCollect(makeCollectRequest())).rejects.toThrow(
      'T-Kash not fully configured'
    )
  })

  it('throws when TKASH_CALLBACK_URL is not configured', async () => {
    delete process.env.TKASH_CALLBACK_URL

    const { tkashCollect } = require('../integrations/telkom')

    await expect(tkashCollect(makeCollectRequest())).rejects.toThrow(
      'T-Kash not fully configured'
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// getTkashToken — Redis caching
// ═════════════════════════════════════════════════════════════════════════════

describe('getTkashToken — Redis caching', () => {
  it('returns cached token without making an HTTP request', async () => {
    mockTokenCache()  // token already in Redis
    mockAxiosPost.mockResolvedValueOnce({
      data: { ResponseCode: '0', ConversationID: 'conv-cached' },
    })

    const { tkashCollect } = require('../integrations/telkom')
    await tkashCollect(makeCollectRequest())

    // axios.get should NOT have been called (no token fetch)
    expect(mockAxiosGet).not.toHaveBeenCalled()
    // axios.post called once: the collect endpoint
    expect(mockAxiosPost).toHaveBeenCalledTimes(1)
  })

  it('fetches and caches token with correct TTL when not in Redis', async () => {
    mockTokenFetch()  // token not in cache → fetch
    mockAxiosPost.mockResolvedValueOnce({
      data: { ResponseCode: '0', ConversationID: 'conv-new' },
    })

    const { tkashCollect } = require('../integrations/telkom')
    await tkashCollect(makeCollectRequest())

    expect(mockRedisSetex).toHaveBeenCalledWith(
      'tkash:access_token',
      3600 - 60,  // expires_in - 60
      MOCK_TOKEN
    )
  })

  it('uses Basic auth header for token fetch', async () => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: { ResponseCode: '0', ConversationID: 'conv-auth' },
    })

    const { tkashCollect } = require('../integrations/telkom')
    await tkashCollect(makeCollectRequest())

    const tokenRequestConfig = mockAxiosGet.mock.calls[0][1]
    expect(tokenRequestConfig.headers.Authorization).toMatch(/^Basic /)

    // Decode to verify credentials
    const base64Part = tokenRequestConfig.headers.Authorization.replace('Basic ', '')
    const decoded = Buffer.from(base64Part, 'base64').toString('utf8')
    expect(decoded).toBe('test-consumer-key:test-consumer-secret')
  })

  it('handles string expires_in by parsing it as integer', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: { access_token: MOCK_TOKEN, expires_in: '7200' },  // string, not number
    })
    mockAxiosPost.mockResolvedValueOnce({
      data: { ResponseCode: '0', ConversationID: 'conv-str' },
    })

    const { tkashCollect } = require('../integrations/telkom')
    await tkashCollect(makeCollectRequest())

    expect(mockRedisSetex).toHaveBeenCalledWith(
      'tkash:access_token',
      7200 - 60,
      MOCK_TOKEN
    )
  })

  it('defaults to 3600 TTL when expires_in is not a valid integer', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: { access_token: MOCK_TOKEN },  // no expires_in
    })
    mockAxiosPost.mockResolvedValueOnce({
      data: { ResponseCode: '0', ConversationID: 'conv-no-exp' },
    })

    const { tkashCollect } = require('../integrations/telkom')
    await tkashCollect(makeCollectRequest())

    expect(mockRedisSetex).toHaveBeenCalledWith(
      'tkash:access_token',
      3600 - 60,
      MOCK_TOKEN
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// getTkashToken — missing credentials
// ═════════════════════════════════════════════════════════════════════════════

describe('getTkashToken — missing credentials', () => {
  it('throws when TKASH_CONSUMER_KEY is not set', async () => {
    delete process.env.TKASH_CONSUMER_KEY

    const { tkashCollect } = require('../integrations/telkom')

    await expect(tkashCollect(makeCollectRequest())).rejects.toThrow(
      'T-Kash credentials not configured'
    )
  })

  it('throws when TKASH_CONSUMER_SECRET is not set', async () => {
    delete process.env.TKASH_CONSUMER_SECRET

    const { tkashCollect } = require('../integrations/telkom')

    await expect(tkashCollect(makeCollectRequest())).rejects.toThrow(
      'T-Kash credentials not configured'
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Phone normalisation (via tkashCollect)
// ═════════════════════════════════════════════════════════════════════════════

describe('tkashCollect — phone normalisation', () => {
  beforeEach(() => {
    mockTokenFetch()
    mockAxiosPost.mockResolvedValueOnce({
      data: { ResponseCode: '0', ConversationID: 'conv-phone' },
    })
  })

  it('normalises 07xx number to 254xx', async () => {
    const { tkashCollect } = require('../integrations/telkom')
    await tkashCollect(makeCollectRequest({ phone: '0772345678' }))

    const payload = mockAxiosPost.mock.calls[0][1]
    expect(payload.PhoneNumber).toBe('254772345678')
  })

  it('passes 254xx number through unchanged', async () => {
    const { tkashCollect } = require('../integrations/telkom')
    await tkashCollect(makeCollectRequest({ phone: '254772345678' }))

    const payload = mockAxiosPost.mock.calls[0][1]
    expect(payload.PhoneNumber).toBe('254772345678')
  })

  it('normalises 9-digit number to 254xx', async () => {
    const { tkashCollect } = require('../integrations/telkom')
    await tkashCollect(makeCollectRequest({ phone: '772345678' }))

    const payload = mockAxiosPost.mock.calls[0][1]
    expect(payload.PhoneNumber).toBe('254772345678')
  })
})

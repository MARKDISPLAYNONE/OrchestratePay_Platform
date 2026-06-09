/**
 * Unit tests for integrations/africas-talking.ts — Africa's Talking SMS wrapper.
 */
process.env.NODE_ENV = 'test'

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

const mockFetch = jest.fn()
global.fetch = mockFetch as any

import { sendSms, SmsTemplate } from '../integrations/africas-talking'

beforeEach(() => {
  jest.clearAllMocks()
  mockFetch.mockReset()
  delete process.env.SMS_ENABLED
  delete process.env.AT_API_KEY
  delete process.env.AT_USERNAME
  delete process.env.AT_SENDER_ID
})

// ─────────────────────────────────────────────────────────────────────────────
// sendSms
// ─────────────────────────────────────────────────────────────────────────────

describe('sendSms', () => {
  it('returns disabled (success:true, messageId:sms-disabled) when SMS_ENABLED=false', async () => {
    process.env.SMS_ENABLED = 'false'
    const result = await sendSms('254700000001', 'Hello')
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('sms-disabled')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns error when AT_API_KEY is not configured', async () => {
    process.env.AT_USERNAME = 'sandbox'
    // AT_API_KEY not set
    const result = await sendSms('254700000001', 'Hello')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/AT credentials not configured/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns error when AT_USERNAME is not configured', async () => {
    process.env.AT_API_KEY = 'test-key'
    // AT_USERNAME not set
    const result = await sendSms('254700000001', 'Hello')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/AT credentials not configured/i)
  })

  it('returns success on successful SMS delivery', async () => {
    process.env.AT_API_KEY  = 'test-api-key'
    process.env.AT_USERNAME = 'sandbox'
    process.env.AT_SENDER_ID = 'TestSender'

    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        SMSMessageData: {
          Recipients: [{ status: 'Success', messageId: 'ATXid_12345' }],
        },
      }),
    })

    const result = await sendSms('254700000001', 'Payment confirmed')
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('ATXid_12345')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('sandbox.africastalking.com'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('uses production URL when AT_USERNAME is not sandbox', async () => {
    process.env.AT_API_KEY  = 'test-api-key'
    process.env.AT_USERNAME = 'myusername'

    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        SMSMessageData: { Recipients: [{ status: 'Success', messageId: 'prod-id' }] },
      }),
    })

    await sendSms('254700000001', 'Hello')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.africastalking.com/version1'),
      expect.anything()
    )
    // Should NOT contain 'sandbox' in the URL
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).not.toContain('sandbox')
  })

  it('returns failure when AT response status is not Success', async () => {
    process.env.AT_API_KEY  = 'test-api-key'
    process.env.AT_USERNAME = 'sandbox'

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        SMSMessageData: { Recipients: [{ status: 'InvalidPhoneNumber' }] },
      }),
    })

    const result = await sendSms('254700000001', 'Hello')
    expect(result.success).toBe(false)
    expect(result.error).toBe('InvalidPhoneNumber')
  })

  it('returns failure on non-OK HTTP response', async () => {
    process.env.AT_API_KEY  = 'test-api-key'
    process.env.AT_USERNAME = 'sandbox'

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: jest.fn().mockResolvedValue({}),
    })

    const result = await sendSms('254700000001', 'Hello')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/HTTP 401/)
  })

  it('returns failure when fetch throws (network error)', async () => {
    process.env.AT_API_KEY  = 'test-api-key'
    process.env.AT_USERNAME = 'sandbox'

    mockFetch.mockRejectedValue(new Error('connection refused'))

    const result = await sendSms('254700000001', 'Hello')
    expect(result.success).toBe(false)
    expect(result.error).toBe('connection refused')
  })

  it('handles json() parse failure gracefully', async () => {
    process.env.AT_API_KEY  = 'test-api-key'
    process.env.AT_USERNAME = 'sandbox'

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn().mockRejectedValue(new Error('invalid json')),
    })

    const result = await sendSms('254700000001', 'Hello')
    expect(result.success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SmsTemplate
// ─────────────────────────────────────────────────────────────────────────────

describe('SmsTemplate', () => {
  it('paymentConfirmed includes amount, merchant, and ref', () => {
    const msg = SmsTemplate.paymentConfirmed(150.5, 'Shop ABC', 'QA123')
    expect(msg).toContain('KSh 150.50')
    expect(msg).toContain('Shop ABC')
    expect(msg).toContain('QA123')
  })

  it('paymentDeclined includes amount and reason', () => {
    const msg = SmsTemplate.paymentDeclined(200, 'Insufficient funds')
    expect(msg).toContain('KSh 200.00')
    expect(msg).toContain('Insufficient funds')
  })

  it('deviceAlert includes the message text', () => {
    const msg = SmsTemplate.deviceAlert('Printer out of paper')
    expect(msg).toContain('Printer out of paper')
    expect(msg).toContain('OrchestratePay')
  })

  it('digitalReceipt includes all fields', () => {
    const msg = SmsTemplate.digitalReceipt(500, 'Café X', 'MP123', '2026-06-08')
    expect(msg).toContain('KSh 500.00')
    expect(msg).toContain('Café X')
    expect(msg).toContain('MP123')
    expect(msg).toContain('2026-06-08')
  })
})

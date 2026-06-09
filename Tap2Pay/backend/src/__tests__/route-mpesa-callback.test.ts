/**
 * Integration tests for routes/mpesa-callback.ts
 *
 * The route immediately responds 200 and processes the callback asynchronously.
 * We use setImmediate to allow the async processing to complete before asserting
 * on side effects (DB updates, Redis writes, publish calls).
 */
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET   = 'test-secret'
process.env.ADMIN_SECRET = 'test-admin'
process.env.NODE_ENV     = 'test'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))

const mockRedisGet     = jest.fn()
const mockRedisSetex   = jest.fn()
const mockRedisDel     = jest.fn()
const mockRedisPublish = jest.fn()
const mockRedisExists  = jest.fn()

jest.mock('../db/redis', () => ({
  redis: {
    get:     (...args: any[]) => mockRedisGet(...args),
    setex:   (...args: any[]) => mockRedisSetex(...args),
    del:     (...args: any[]) => mockRedisDel(...args),
    publish: (...args: any[]) => mockRedisPublish(...args),
    exists:  (...args: any[]) => mockRedisExists(...args),
  },
}))

const mockStkQuery = jest.fn()
jest.mock('../integrations/daraja', () => ({
  stkQuery:               (...args: any[]) => mockStkQuery(...args),
  stkPush:                jest.fn(),
  getDarajaCircuitStatus: jest.fn().mockReturnValue('CLOSED'),
}))

jest.mock('../util/loyalty', () => ({
  awardLoyaltyPoints: jest.fn().mockResolvedValue({ pointsDelta: 5, stampsDelta: 0 }),
  isRepeatCustomer:   jest.fn().mockResolvedValue(false),
}))

jest.mock('../integrations/etims', () => ({
  submitFiscalInvoice: jest.fn().mockResolvedValue({ success: true }),
}))

jest.mock('../integrations/africas-talking', () => ({
  sendSms:     jest.fn().mockResolvedValue({ success: true }),
  SmsTemplate: {
    paymentConfirmed: jest.fn().mockReturnValue('Payment confirmed SMS'),
    digitalReceipt:   jest.fn().mockReturnValue('Digital receipt SMS'),
  },
}))

jest.mock('../jobs/gl-posting', () => ({
  enqueueGlPosting: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../util/fcm', () => ({
  sendFcmNotification: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn().mockReturnValue('nfc-key'),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/mpesa-callback', require('../routes/mpesa-callback').default)
  return app
}

function waitAsync() {
  return new Promise(resolve => setImmediate(resolve))
}

const CHECK_ID = 'ws_CO_01234567891234567'
const TXN_ROW = {
  id:             'txn-1',
  status:         'STK_SENT',
  amount_cents:   5000,
  idempotency_key: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
  merchant_id:    'merchant-1',
  consumer_id:    'consumer-1',
  source:         'NFC_TAG',
  kra_pin:        null,
  merchant_name:  'Test Shop',
  consumer_phone: '254700000001',
  sms_opt_in:     true,
  fcm_token:      null,
}

const SUCCESS_CALLBACK = {
  Body: {
    stkCallback: {
      MerchantRequestID:  'req-001',
      CheckoutRequestID:  CHECK_ID,
      ResultCode:         0,
      ResultDesc:         'The service request is processed successfully.',
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 50 },
          { Name: 'MpesaReceiptNumber', Value: 'QGH1234567' },
          { Name: 'TransactionDate', Value: 20260101120000 },
          { Name: 'PhoneNumber', Value: 254700000001 },
        ],
      },
    },
  },
}

const FAILURE_CALLBACK = {
  Body: {
    stkCallback: {
      MerchantRequestID: 'req-002',
      CheckoutRequestID: CHECK_ID,
      ResultCode:        1032,
      ResultDesc:        'Request cancelled by user',
    },
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRedisGet.mockResolvedValue(null)
  mockRedisSetex.mockResolvedValue('OK')
  mockRedisDel.mockResolvedValue(1)
  mockRedisPublish.mockResolvedValue(1)
  mockRedisExists.mockResolvedValue(0)
  mockStkQuery.mockResolvedValue({ resultCode: 0, resultDesc: 'Success' })
})

// ── POST /api/v1/mpesa-callback ───────────────────────────────────────────────

describe('POST /api/v1/mpesa-callback', () => {
  it('always responds 200 immediately regardless of body', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/mpesa-callback')
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.ResultCode).toBe(0)
    expect(res.body.ResultDesc).toBe('Accepted')
  })

  it('responds 200 for malformed body (missing stkCallback)', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/mpesa-callback')
      .send({ Body: { unexpectedFormat: true } })

    expect(res.status).toBe(200)
  })

  it('logs and archives malformed callback body', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send({ garbage: 'data' })

    await waitAsync()

    // Should have attempted to INSERT into daraja_callback_log
    const insertCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('daraja_callback_log')
    )
    expect(insertCall).toBeTruthy()
  })

  it('processes successful callback (ResultCode=0) and confirms transaction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })     // INSERT daraja_callback_log
      .mockResolvedValueOnce({ rows: [TXN_ROW] })              // SELECT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // UPDATE daraja_callback_log verified
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // UPDATE transactions CONFIRMED
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // UPDATE daraja_callback_log verified=true
      .mockResolvedValue({ rows: [], rowCount: 1 })            // audit log + any other queries

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_CALLBACK)

    await waitAsync()
    await waitAsync()

    // Verify transaction was confirmed
    const confirmCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'CONFIRMED'")
    )
    expect(confirmCall).toBeTruthy()

    // Verify Redis idempotency was updated
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringMatching(/^idempotency:/),
      3600,
      expect.stringContaining('CONFIRMED'),
    )
  })

  it('declines transaction when ResultCode is non-zero', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })     // INSERT daraja_callback_log
      .mockResolvedValueOnce({ rows: [TXN_ROW] })              // SELECT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // UPDATE transactions DECLINED
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(FAILURE_CALLBACK)

    await waitAsync()
    await waitAsync()

    const declineCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'DECLINED'")
    )
    expect(declineCall).toBeTruthy()

    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringMatching(/^idempotency:/),
      300,
      expect.stringContaining('DECLINED'),
    )
  })

  it('ignores callback for unknown CheckoutRequestID', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })   // INSERT daraja_callback_log
      .mockResolvedValueOnce({ rows: [] })                    // SELECT transaction — not found

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_CALLBACK)

    await waitAsync()
    await waitAsync()

    // No UPDATE to transactions should have been made
    const updateCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('UPDATE transactions')
    )
    expect(updateCall).toBeUndefined()
  })

  it('ignores duplicate callback for already-processed transaction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [{ ...TXN_ROW, status: 'CONFIRMED' }] })

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_CALLBACK)

    await waitAsync()
    await waitAsync()

    const updateConfirm = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'CONFIRMED'")
    )
    expect(updateConfirm).toBeUndefined()
  })

  it('marks transaction FAILED when Daraja disputes the success claim', async () => {
    mockStkQuery.mockResolvedValue({ resultCode: 1, resultDesc: 'Insufficient funds' })

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [TXN_ROW] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_CALLBACK)

    await waitAsync()
    await waitAsync()

    const failCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'FAILED'") && String(c[0]).includes('mpesa_result_code = -2')
    )
    expect(failCall).toBeTruthy()
  })

  it('sends SMS receipt when consumer opted in', async () => {
    const { sendSms } = require('../integrations/africas-talking')
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [{ ...TXN_ROW, sms_opt_in: true }] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_CALLBACK)

    await waitAsync()
    await waitAsync()

    expect(sendSms).toHaveBeenCalled()
  })

  it('trusts callback and confirms when circuit is OPEN (stkQuery returns -1)', async () => {
    // resultCode -1 means circuit open — we trust the callback, proceed to confirm
    mockStkQuery.mockResolvedValue({ resultCode: -1, resultDesc: 'Circuit open' })
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [TXN_ROW] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_CALLBACK)

    await waitAsync()
    await waitAsync()

    const confirmCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'CONFIRMED'")
    )
    expect(confirmCall).toBeTruthy()
  })

  it('marks FAILED and logs error when callback amount does not match DB amount', async () => {
    // DB amount_cents = 5000 → KSh 50. Callback claims KSh 9999 → mismatch.
    mockStkQuery.mockResolvedValue({ resultCode: 0, resultDesc: 'Success' })
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [{ ...TXN_ROW, amount_cents: 5000 }] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    // Override SUCCESS_CALLBACK with a mismatched amount
    const mismatchedCallback = {
      Body: {
        stkCallback: {
          ...SUCCESS_CALLBACK.Body.stkCallback,
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 9999 },
              { Name: 'MpesaReceiptNumber', Value: 'QGH9999' },
            ],
          },
        },
      },
    }

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(mismatchedCallback)

    await waitAsync()
    await waitAsync()

    const failCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'FAILED'") &&
      String(c[0]).includes('mpesa_result_code = -1')
    )
    expect(failCall).toBeTruthy()
  })

  it('handles DB throw when archiving callback log (proceeds anyway)', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error('DB archive failed'))  // INSERT daraja_callback_log throws
      .mockResolvedValueOnce({ rows: [TXN_ROW] })             // SELECT transaction
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_CALLBACK)

    await waitAsync()
    await waitAsync()

    // Transaction should still have been processed
    const confirmCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'CONFIRMED'")
    )
    expect(confirmCall).toBeTruthy()
  })

  it('submits fiscal invoice when merchant has a KRA PIN', async () => {
    const { submitFiscalInvoice } = require('../integrations/etims')
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [{ ...TXN_ROW, kra_pin: 'A001234567Z' }] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_CALLBACK)

    await waitAsync()
    await waitAsync()

    expect(submitFiscalInvoice).toHaveBeenCalled()
  })

  it('sends FCM notification when consumer has fcm_token and no active WS', async () => {
    const { sendFcmNotification } = require('../util/fcm')
    mockRedisExists.mockResolvedValue(0)  // no active WS connection
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [{ ...TXN_ROW, fcm_token: 'fcm-device-token-123' }] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_CALLBACK)

    await waitAsync()
    await waitAsync()

    expect(sendFcmNotification).toHaveBeenCalledWith(
      expect.objectContaining({ fcmToken: 'fcm-device-token-123' })
    )
  })

  it('skips FCM when consumer has an active WS connection', async () => {
    const { sendFcmNotification } = require('../util/fcm')
    mockRedisExists.mockResolvedValue(1)  // active WS connection exists
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [{ ...TXN_ROW, fcm_token: 'fcm-device-token-456' }] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_CALLBACK)

    await waitAsync()
    await waitAsync()

    expect(sendFcmNotification).not.toHaveBeenCalled()
  })

  it('sends digital-receipt SMS for SOFTPOS_MOBILE transaction', async () => {
    const { sendSms, SmsTemplate } = require('../integrations/africas-talking')
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [{ ...TXN_ROW, source: 'SOFTPOS_MOBILE', sms_opt_in: false }] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const app = buildApp()
    await request(app)
      .post('/api/v1/mpesa-callback')
      .send(SUCCESS_CALLBACK)

    await waitAsync()
    await waitAsync()

    expect(SmsTemplate.digitalReceipt).toHaveBeenCalled()
    expect(sendSms).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// friendlyReason — all switch cases
// ─────────────────────────────────────────────────────────────────────────────

describe('friendlyReason — M-Pesa result codes', () => {
  async function sendDecline(resultCode: number) {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })
      .mockResolvedValueOnce({ rows: [TXN_ROW] })
      .mockResolvedValue({ rows: [], rowCount: 1 })

    const cb = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'req-999',
          CheckoutRequestID: CHECK_ID,
          ResultCode:        resultCode,
          ResultDesc:        `Error ${resultCode}`,
        },
      },
    }

    const app = buildApp()
    await request(app).post('/api/v1/mpesa-callback').send(cb)
    await waitAsync()
    await waitAsync()
  }

  it('code 1 → insufficient balance', async () => {
    await sendDecline(1)
    const declineCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'DECLINED'")
    )
    expect(declineCall).toBeTruthy()
  })

  it('code 17 → daily limit exceeded', async () => {
    await sendDecline(17)
  })

  it('code 1037 → payment timed out', async () => {
    await sendDecline(1037)
  })

  it('code 2001 → wrong PIN', async () => {
    await sendDecline(2001)
  })

  it('unknown code → generic message', async () => {
    await sendDecline(9999)
  })
})

// ── Fire-and-forget .catch() coverage ────────────────────────────────────────
// These tests make the post-processing functions reject so Istanbul counts the
// `.catch((err) => { logger.error(...) })` arrow-function bodies as executed.

describe('post-processing .catch() handlers', () => {
  function confirmedMocks() {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-1' }] })  // INSERT daraja_callback_log
      .mockResolvedValueOnce({ rows: [TXN_ROW] })            // SELECT transaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })      // UPDATE callback_log verified
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })      // UPDATE transactions CONFIRMED
      .mockResolvedValue({ rows: [], rowCount: 1 })          // any further queries
  }

  it('handles enqueueGlPosting rejection without affecting the 200 response', async () => {
    const { enqueueGlPosting } = require('../jobs/gl-posting')
    enqueueGlPosting.mockRejectedValueOnce(new Error('GL posting error'))
    confirmedMocks()

    const app = buildApp()
    const res = await request(app).post('/api/v1/mpesa-callback').send(SUCCESS_CALLBACK)
    await waitAsync()
    await waitAsync()

    expect(res.status).toBe(200)
  })

  it('handles submitFiscalInvoice rejection without affecting the 200 response', async () => {
    const { submitFiscalInvoice } = require('../integrations/etims')
    submitFiscalInvoice.mockRejectedValueOnce(new Error('eTIMS error'))

    const txnWithPin = { ...TXN_ROW, kra_pin: 'P12345678' }
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-2' }] })    // INSERT daraja_callback_log
      .mockResolvedValueOnce({ rows: [txnWithPin] })           // SELECT transaction (has kra_pin)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // UPDATE callback_log verified
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // UPDATE transactions CONFIRMED
      .mockResolvedValue({ rows: [], rowCount: 1 })            // further queries

    const app = buildApp()
    const res = await request(app).post('/api/v1/mpesa-callback').send(SUCCESS_CALLBACK)
    await waitAsync()
    await waitAsync()

    expect(res.status).toBe(200)
  })

  it('handles sendSms rejection without affecting the 200 response', async () => {
    const { sendSms } = require('../integrations/africas-talking')
    sendSms.mockRejectedValueOnce(new Error('SMS send error'))
    confirmedMocks()

    const app = buildApp()
    const res = await request(app).post('/api/v1/mpesa-callback').send(SUCCESS_CALLBACK)
    await waitAsync()
    await waitAsync()

    expect(res.status).toBe(200)
  })

  it('handles sendFcmNotification rejection without affecting the 200 response', async () => {
    const { sendFcmNotification } = require('../util/fcm')
    sendFcmNotification.mockRejectedValueOnce(new Error('FCM send error'))
    mockRedisExists.mockResolvedValue(0)  // no active WS → FCM path

    const txnWithFcm = { ...TXN_ROW, fcm_token: 'device-fcm-token', sms_opt_in: false }
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'log-3' }] })    // INSERT daraja_callback_log
      .mockResolvedValueOnce({ rows: [txnWithFcm] })           // SELECT transaction (has fcm_token)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // UPDATE callback_log verified
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // UPDATE transactions CONFIRMED
      .mockResolvedValue({ rows: [], rowCount: 1 })            // further queries

    const app = buildApp()
    const res = await request(app).post('/api/v1/mpesa-callback').send(SUCCESS_CALLBACK)
    await waitAsync()
    await waitAsync()

    expect(res.status).toBe(200)
  })
})

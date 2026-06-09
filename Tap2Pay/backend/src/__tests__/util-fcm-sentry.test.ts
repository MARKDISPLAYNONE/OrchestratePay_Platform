/**
 * Unit tests for util/fcm.ts and util/sentry.ts.
 *
 * Both modules use dynamic require() for optional heavy deps (firebase-admin, @sentry/node)
 * so we use jest.resetModules() + jest.doMock() to get fresh state between tests.
 */
process.env.NODE_ENV = 'test'

// ─────────────────────────────────────────────────────────────────────────────
// util/fcm.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('util/fcm — sendFcmNotification', () => {
  beforeEach(() => {
    jest.resetModules()
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    jest.doMock('../util/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }))
  })

  it('returns false when FIREBASE_SERVICE_ACCOUNT_JSON is not set', async () => {
    const { sendFcmNotification } = require('../util/fcm')
    const result = await sendFcmNotification({ fcmToken: 'tok', title: 'T', body: 'B' })
    expect(result).toBe(false)
  })

  it('returns true when messaging.send succeeds', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account","project_id":"test"}'
    const mockSend = jest.fn().mockResolvedValue('msg-id-1')
    jest.doMock('firebase-admin', () => ({
      apps: [],
      initializeApp: jest.fn(),
      credential: { cert: jest.fn().mockReturnValue('cred') },
      messaging: jest.fn().mockReturnValue({ send: mockSend }),
    }), { virtual: true })
    const { sendFcmNotification } = require('../util/fcm')
    const result = await sendFcmNotification({
      fcmToken: 'fcm-tok',
      title: 'Payment',
      body: 'KSh 500 received',
      data: { txnId: 'txn-1' },
    })
    expect(result).toBe(true)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      token: 'fcm-tok',
      notification: { title: 'Payment', body: 'KSh 500 received' },
    }))
  })

  it('returns false when messaging.send throws', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account"}'
    jest.doMock('firebase-admin', () => ({
      apps: [],
      initializeApp: jest.fn(),
      credential: { cert: jest.fn().mockReturnValue('cred') },
      messaging: jest.fn().mockReturnValue({
        send: jest.fn().mockRejectedValue(new Error('FCM quota exceeded')),
      }),
    }), { virtual: true })
    const { sendFcmNotification } = require('../util/fcm')
    const result = await sendFcmNotification({ fcmToken: 'tok', title: 'T', body: 'B' })
    expect(result).toBe(false)
  })

  it('returns false when firebase-admin init throws', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account"}'
    jest.doMock('firebase-admin', () => ({
      apps: [],
      initializeApp: jest.fn().mockImplementation(() => { throw new Error('init failed') }),
      credential: { cert: jest.fn().mockReturnValue('cred') },
      messaging: jest.fn(),
    }), { virtual: true })
    const { sendFcmNotification } = require('../util/fcm')
    const result = await sendFcmNotification({ fcmToken: 'tok', title: 'T', body: 'B' })
    expect(result).toBe(false)
  })

  it('skips initializeApp when admin.apps already has entries', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account"}'
    const mockInitializeApp = jest.fn()
    jest.doMock('firebase-admin', () => ({
      apps: ['already-initialized'],
      initializeApp: mockInitializeApp,
      credential: { cert: jest.fn().mockReturnValue('cred') },
      messaging: jest.fn().mockReturnValue({ send: jest.fn().mockResolvedValue('ok') }),
    }), { virtual: true })
    const { sendFcmNotification } = require('../util/fcm')
    await sendFcmNotification({ fcmToken: 'tok', title: 'T', body: 'B' })
    expect(mockInitializeApp).not.toHaveBeenCalled()
  })

  it('reuses cached _messaging on second call', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account"}'
    const mockMessaging = jest.fn().mockReturnValue({ send: jest.fn().mockResolvedValue('ok') })
    jest.doMock('firebase-admin', () => ({
      apps: [],
      initializeApp: jest.fn(),
      credential: { cert: jest.fn().mockReturnValue('cred') },
      messaging: mockMessaging,
    }), { virtual: true })
    const { sendFcmNotification } = require('../util/fcm')
    await sendFcmNotification({ fcmToken: 't1', title: 'T', body: 'B' })
    await sendFcmNotification({ fcmToken: 't2', title: 'T', body: 'B' })
    expect(mockMessaging).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// util/sentry.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('util/sentry — initSentry', () => {
  let mockLoggerWarn: jest.Mock
  let mockLoggerInfo: jest.Mock

  beforeEach(() => {
    jest.resetModules()
    delete process.env.SENTRY_DSN
    process.env.NODE_ENV = 'test'
    mockLoggerWarn = jest.fn()
    mockLoggerInfo = jest.fn()
    jest.doMock('../util/logger', () => ({
      logger: { warn: mockLoggerWarn, info: mockLoggerInfo, error: jest.fn() },
    }))
  })

  it('does nothing when SENTRY_DSN is not set in test env', () => {
    const { initSentry } = require('../util/sentry')
    expect(() => initSentry()).not.toThrow()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('logs a warning in production when SENTRY_DSN is not set', () => {
    process.env.NODE_ENV = 'production'
    const { initSentry } = require('../util/sentry')
    initSentry()
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('SENTRY_DSN')
    )
  })

  it('initialises Sentry when SENTRY_DSN is set', () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/123'
    const mockSentryInit = jest.fn()
    jest.doMock('@sentry/node', () => ({
      init: mockSentryInit,
      withScope: jest.fn(),
      captureException: jest.fn(),
    }))
    const { initSentry } = require('../util/sentry')
    initSentry()
    expect(mockSentryInit).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://test@sentry.io/123',
      sendDefaultPii: false,
    }))
  })

  it('swallows Sentry init failure and continues', () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/123'
    jest.doMock('@sentry/node', () => ({
      init: jest.fn().mockImplementation(() => { throw new Error('network error') }),
    }))
    const { initSentry } = require('../util/sentry')
    expect(() => initSentry()).not.toThrow()
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('Sentry initialisation failed'),
      expect.any(Object)
    )
  })

  it('beforeSend scrubs phone numbers from events', () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/123'
    let capturedBeforeSend: ((event: any) => any) | undefined
    jest.doMock('@sentry/node', () => ({
      init: jest.fn().mockImplementation((opts: any) => {
        capturedBeforeSend = opts.beforeSend
      }),
      withScope: jest.fn(),
    }))
    const { initSentry } = require('../util/sentry')
    initSentry()
    expect(capturedBeforeSend).toBeDefined()
    // Event containing a Kenyan phone number → scrubbed (returns null)
    const phoneEvent = { user: { phone: '254700123456' } }
    expect(capturedBeforeSend!(phoneEvent)).toBeNull()
    // Event with no phone → passes through
    const safeEvent = { message: 'DB error' }
    expect(capturedBeforeSend!(safeEvent)).toEqual(safeEvent)
  })
})

describe('util/sentry — captureException', () => {
  beforeEach(() => {
    jest.resetModules()
    delete process.env.SENTRY_DSN
    jest.doMock('../util/logger', () => ({
      logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
    }))
  })

  it('is a no-op when SENTRY_DSN is not set', () => {
    const { captureException } = require('../util/sentry')
    expect(() => captureException(new Error('test'))).not.toThrow()
  })

  it('calls Sentry.withScope when SENTRY_DSN is set and invokes the scope callback', () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/123'
    const mockSetExtras  = jest.fn()
    const mockCapture    = jest.fn()
    const mockWithScope  = jest.fn().mockImplementation((cb: Function) =>
      cb({ setExtras: mockSetExtras })
    )
    jest.doMock('@sentry/node', () => ({
      init: jest.fn(),
      withScope: mockWithScope,
      captureException: mockCapture,
    }))
    const { captureException } = require('../util/sentry')
    captureException(new Error('db error'), { txnId: 'txn-1' })
    expect(mockWithScope).toHaveBeenCalled()
    expect(mockSetExtras).toHaveBeenCalledWith({ txnId: 'txn-1' })
    expect(mockCapture).toHaveBeenCalledWith(expect.any(Error))
  })

  it('calls captureException without context extras', () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/123'
    const mockSetExtras  = jest.fn()
    const mockCapture    = jest.fn()
    const mockWithScope  = jest.fn().mockImplementation((cb: Function) =>
      cb({ setExtras: mockSetExtras })
    )
    jest.doMock('@sentry/node', () => ({
      init: jest.fn(),
      withScope: mockWithScope,
      captureException: mockCapture,
    }))
    const { captureException } = require('../util/sentry')
    captureException(new Error('bare error'))
    expect(mockSetExtras).not.toHaveBeenCalled()
    expect(mockCapture).toHaveBeenCalledWith(expect.any(Error))
  })

  it('swallows Sentry.withScope errors silently', () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/123'
    jest.doMock('@sentry/node', () => ({
      init: jest.fn(),
      withScope: jest.fn().mockImplementation(() => { throw new Error('sentry error') }),
    }))
    const { captureException } = require('../util/sentry')
    expect(() => captureException(new Error('test'))).not.toThrow()
  })
})

/**
 * Tests for lib/api.ts — typed API client.
 *
 * Full coverage of all API namespaces: auth, merchants, consumers,
 * transactions, fx, devices, accounting, loyalty, admin.
 */

import {
  ApiError,
  saveAdminSecret, clearAdminSecret, hasAdminSecret, verifyAdminSecret,
  auth, merchants, consumers, transactions, fx, devices, accounting, loyalty, admin,
  settlement, kyc,
} from '../api'

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

function mockOk(body: object = {}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok:     true,
    status: 200,
    json:   () => Promise.resolve(body),
  } as Response)
}

function mockError(status: number, errorMsg: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok:     false,
    status,
    json:   () => Promise.resolve({ error: errorMsg }),
  } as unknown as Response)
}

function lastCallUrl()  { return (global.fetch as jest.Mock).mock.calls[0][0] as string }
function lastCallOpts() { return (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit & { headers: Record<string,string> } }
function lastCallBody() { return JSON.parse(lastCallOpts().body as string) }

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  jest.resetAllMocks()
})

// ─── ApiError ─────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('carries status and message', () => {
    const err = new ApiError(401, 'Unauthorized')
    expect(err.status).toBe(401)
    expect(err.message).toBe('Unauthorized')
  })

  it('has name "ApiError"', () => {
    expect(new ApiError(400, 'Bad').name).toBe('ApiError')
  })

  it('is an instance of Error', () => {
    expect(new ApiError(500, 'Oops')).toBeInstanceOf(Error)
  })

  it('throws with fallback message when response body is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok:     false,
      status: 503,
      json:   () => Promise.reject(new Error('not json')),
    } as unknown as Response)
    await expect(auth.merchantLogin('a@b.com', 'p', 'd')).rejects.toMatchObject({ status: 503 })
  })

  it('uses HTTP status as message when error response has no error field', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok:     false,
      status: 422,
      json:   () => Promise.resolve({ detail: 'Validation failed' }), // no .error field
    } as unknown as Response)
    await expect(auth.merchantLogin('a@b.com', 'p', 'd'))
      .rejects.toMatchObject({ status: 422, message: 'HTTP 422' })
  })
})

// ─── Admin secret helpers ─────────────────────────────────────────────────────

describe('admin secret helpers', () => {
  it('hasAdminSecret returns false when nothing is stored', () => {
    expect(hasAdminSecret()).toBe(false)
  })

  it('hasAdminSecret returns true after saving', () => {
    saveAdminSecret('super-secret-123')
    expect(hasAdminSecret()).toBe(true)
  })

  it('clearAdminSecret removes the secret', () => {
    saveAdminSecret('secret')
    clearAdminSecret()
    expect(hasAdminSecret()).toBe(false)
  })

  it('saveAdminSecret stores in sessionStorage', () => {
    saveAdminSecret('my-secret')
    expect(sessionStorage.getItem('admin_secret')).toBe('my-secret')
  })

  it('clearAdminSecret removes from sessionStorage', () => {
    sessionStorage.setItem('admin_secret', 'x')
    clearAdminSecret()
    expect(sessionStorage.getItem('admin_secret')).toBeNull()
  })
})

// ─── Authorization header ─────────────────────────────────────────────────────

describe('Authorization header', () => {
  it('attaches Bearer token from sessionStorage', async () => {
    sessionStorage.setItem('token', 'my-jwt')
    mockOk({ status: 'CONFIRMED', txnId: 'x' })
    await transactions.getStatus('t')
    expect(lastCallOpts().headers['Authorization']).toBe('Bearer my-jwt')
  })

  it('attaches Bearer token from localStorage fallback', async () => {
    localStorage.setItem('token', 'local-jwt')
    mockOk({ status: 'CONFIRMED', txnId: 'x' })
    await transactions.getStatus('t')
    expect(lastCallOpts().headers['Authorization']).toBe('Bearer local-jwt')
  })

  it('omits Authorization for auth:false endpoints', async () => {
    mockOk({ token: 't', consumerId: 'c' })
    await auth.consumerLogin('c@t.com', 'p')
    expect(lastCallOpts().headers['Authorization']).toBeUndefined()
  })

  it('injects X-Admin-Secret when adminAuth is true and secret is stored', async () => {
    saveAdminSecret('admin-key-123')
    mockOk({ pending: [] })
    await admin.getPendingMerchants()
    expect(lastCallOpts().headers['X-Admin-Secret']).toBe('admin-key-123')
  })

  it('omits X-Admin-Secret when no admin secret is stored', async () => {
    mockOk({ stats: {} })
    await admin.getStats()
    expect(lastCallOpts().headers['X-Admin-Secret']).toBeUndefined()
  })

  it('sets Content-Type to application/json by default', async () => {
    mockOk({ token: 't', merchantId: 'm', merchantName: 'N', expiresAt: 0 })
    await auth.merchantLogin('a@b.com', 'p', 'd')
    expect(lastCallOpts().headers['Content-Type']).toBe('application/json')
  })
})

// ─── auth namespace ───────────────────────────────────────────────────────────

describe('auth.merchantLogin', () => {
  it('POSTs credentials to /api/v1/auth/login', async () => {
    mockOk({ token: 'jwt', merchantId: 'mid', merchantName: 'M', expiresAt: 9999 })
    const r = await auth.merchantLogin('m@t.com', 'pass', 'dev-1')
    expect(lastCallUrl()).toContain('/api/v1/auth/login')
    expect(lastCallOpts().method).toBe('POST')
    expect(lastCallBody()).toMatchObject({ email: 'm@t.com', password: 'pass', deviceId: 'dev-1' })
    expect(r.token).toBe('jwt')
  })

  it('throws ApiError on 401', async () => {
    mockError(401, 'Invalid credentials')
    await expect(auth.merchantLogin('x@x.com', 'wrong', 'd')).rejects.toMatchObject({ status: 401 })
  })
})

describe('auth.merchantRegister', () => {
  it('POSTs to /api/v1/auth/register without auth header', async () => {
    mockOk({ merchantId: 'mid-1', status: 'pending' })
    const r = await auth.merchantRegister({
      name: 'Shop A', email: 'a@b.com', password: 'pass', phone: '254700000000',
    })
    expect(lastCallUrl()).toContain('/api/v1/auth/register')
    expect(lastCallOpts().method).toBe('POST')
    expect(lastCallOpts().headers['Authorization']).toBeUndefined()
    expect(r.status).toBe('pending')
  })

  it('includes optional businessRegNumber and mpesaShortcode', async () => {
    mockOk({ merchantId: 'm', status: 'pending' })
    await auth.merchantRegister({
      name: 'B', email: 'b@b.com', password: 'p', phone: '254711111111',
      businessRegNumber: 'REG-001', mpesaShortcode: '174379',
    })
    expect(lastCallBody()).toMatchObject({ businessRegNumber: 'REG-001', mpesaShortcode: '174379' })
  })
})

describe('auth.consumerRegister', () => {
  it('POSTs to /api/v1/auth/consumer/register without auth header', async () => {
    mockOk({ token: 'ctok', consumerId: 'cid-1' })
    const r = await auth.consumerRegister({ phone: '254712345678' })
    expect(lastCallUrl()).toContain('/api/v1/auth/consumer/register')
    expect(lastCallOpts().headers['Authorization']).toBeUndefined()
    expect(r.consumerId).toBe('cid-1')
  })
})

describe('auth.consumerLogin', () => {
  it('POSTs to /api/v1/auth/consumer/login without auth header', async () => {
    mockOk({ token: 'ctok', consumerId: 'cid' })
    const r = await auth.consumerLogin('c@t.com', 'pass')
    expect(lastCallUrl()).toContain('/api/v1/auth/consumer/login')
    expect(lastCallOpts().headers['Authorization']).toBeUndefined()
    expect(r.token).toBe('ctok')
  })
})

// ─── merchants namespace ──────────────────────────────────────────────────────

describe('merchants.getProfile', () => {
  it('GETs /api/v1/merchants/me', async () => {
    mockOk({ name: 'Baridi Café' })
    const r = await merchants.getProfile()
    expect(lastCallUrl()).toContain('/api/v1/merchants/me')
    expect(lastCallOpts().method).toBe('GET')
    expect(r.name).toBe('Baridi Café')
  })
})

describe('merchants.updateProfile', () => {
  it('PUTs to /api/v1/merchants/me with updated fields', async () => {
    mockOk({ name: 'New Name' })
    await merchants.updateProfile({ name: 'New Name', kraPin: 'P051X' })
    expect(lastCallUrl()).toContain('/api/v1/merchants/me')
    expect(lastCallOpts().method).toBe('PUT')
    expect(lastCallBody()).toMatchObject({ name: 'New Name', kraPin: 'P051X' })
  })
})

describe('merchants.getWeekly', () => {
  it('GETs /api/v1/merchants/me/analytics/weekly', async () => {
    mockOk({ days: [] })
    const r = await merchants.getWeekly()
    expect(lastCallUrl()).toContain('/analytics/weekly')
    expect(r.days).toEqual([])
  })
})

describe('merchants.getPeakHours', () => {
  it('GETs /api/v1/merchants/me/analytics/peak-hours', async () => {
    mockOk({ hours: [] })
    await merchants.getPeakHours()
    expect(lastCallUrl()).toContain('/analytics/peak-hours')
  })
})

describe('merchants.getSources', () => {
  it('GETs /api/v1/merchants/me/analytics/sources', async () => {
    mockOk({ sources: [] })
    await merchants.getSources()
    expect(lastCallUrl()).toContain('/analytics/sources')
  })
})

describe('merchants.getTransactions', () => {
  it('GETs with default limit=25 and offset=0', async () => {
    mockOk({ transactions: [] })
    await merchants.getTransactions()
    expect(lastCallUrl()).toContain('limit=25&offset=0')
  })

  it('GETs with custom limit and offset', async () => {
    mockOk({ transactions: [] })
    await merchants.getTransactions(50, 100)
    expect(lastCallUrl()).toContain('limit=50&offset=100')
  })
})

describe('merchants.getTransaction', () => {
  it('GETs /api/v1/transactions/:txnId/status', async () => {
    mockOk({ status: 'CONFIRMED', id: 'txn-1' })
    await merchants.getTransaction('txn-1')
    expect(lastCallUrl()).toContain('/transactions/txn-1/status')
  })
})

describe('merchants.getLoyaltyProgramme', () => {
  it('GETs /api/v1/loyalty/programme', async () => {
    mockOk({ programme_type: 'POINTS' })
    await merchants.getLoyaltyProgramme()
    expect(lastCallUrl()).toContain('/loyalty/programme')
  })
})

describe('merchants.saveLoyaltyProgramme', () => {
  it('POSTs to /api/v1/loyalty/programme', async () => {
    mockOk({ success: true })
    await merchants.saveLoyaltyProgramme({ programme_type: 'STAMPS', stamps_for_reward: 10 })
    expect(lastCallOpts().method).toBe('POST')
    expect(lastCallBody()).toMatchObject({ programme_type: 'STAMPS', stamps_for_reward: 10 })
  })
})

// ─── consumers namespace ──────────────────────────────────────────────────────

describe('consumers.getProfile', () => {
  it('GETs /api/v1/consumers/me', async () => {
    mockOk({ displayName: 'Jane' })
    const r = await consumers.getProfile()
    expect(lastCallUrl()).toContain('/api/v1/consumers/me')
    expect(r.displayName).toBe('Jane')
  })
})

describe('consumers.updateProfile', () => {
  it('PUTs to /api/v1/consumers/me', async () => {
    mockOk({})
    await consumers.updateProfile({ displayName: 'New Name', smsOptIn: true })
    expect(lastCallOpts().method).toBe('PUT')
    expect(lastCallBody()).toMatchObject({ displayName: 'New Name', smsOptIn: true })
  })
})

describe('consumers.getTransactions', () => {
  it('GETs with default limit=50 and offset=0', async () => {
    mockOk({ transactions: [] })
    await consumers.getTransactions()
    expect(lastCallUrl()).toContain('limit=50&offset=0')
  })

  it('GETs with custom pagination', async () => {
    mockOk({ transactions: [] })
    await consumers.getTransactions(20, 40)
    expect(lastCallUrl()).toContain('limit=20&offset=40')
  })
})

describe('consumers.getLoyalty', () => {
  it('GETs /api/v1/consumers/me/loyalty', async () => {
    mockOk({ points: 120 })
    const r = await consumers.getLoyalty()
    expect(lastCallUrl()).toContain('/consumers/me/loyalty')
    expect(r.points).toBe(120)
  })
})

describe('consumers.getMerchantForPay', () => {
  it('GETs /api/v1/consumers/pay/:merchantId without auth header', async () => {
    mockOk({ name: 'Shop A', amountRequired: false })
    await consumers.getMerchantForPay('mid-abc')
    expect(lastCallUrl()).toContain('/consumers/pay/mid-abc')
    expect(lastCallOpts().headers['Authorization']).toBeUndefined()
  })
})

describe('consumers.lookupByTagId', () => {
  it('GETs /api/v1/consumers/c/:consumerId', async () => {
    mockOk({ consumerId: 'cid-1', displayName: 'Jane', maskedPhone: '2547****78' })
    const r = await consumers.lookupByTagId('cid-1')
    expect(lastCallUrl()).toContain('/consumers/c/cid-1')
    expect(r.maskedPhone).toBe('2547****78')
  })
})

describe('consumers.requestPayment', () => {
  it('POSTs to /api/v1/consumers/pay/:merchantId', async () => {
    mockOk({ transactionId: 'txn-1', status: 'STK_SENT' })
    const r = await consumers.requestPayment('mid-xyz', {
      amountCents: 5000, idempotencyKey: 'key-123', timestamp: Date.now(),
    })
    expect(lastCallUrl()).toContain('/consumers/pay/mid-xyz')
    expect(lastCallOpts().method).toBe('POST')
    expect(r.transactionId).toBe('txn-1')
  })
})

// ─── transactions namespace ───────────────────────────────────────────────────

describe('transactions.initiate', () => {
  it('POSTs to /api/v1/transactions', async () => {
    mockOk({ status: 'STK_SENT', txnId: 'txn-abc' })
    const r = await transactions.initiate({
      merchantId: 'mid-1', amountCents: 5000, source: 'NFC_TAG',
      idempotencyKey: 'idem-key', timestamp: Date.now(),
    })
    expect(lastCallUrl()).toContain('/api/v1/transactions')
    expect(lastCallOpts().method).toBe('POST')
    expect(r.txnId).toBe('txn-abc')
  })

  it('includes optional consumerTagId and tagId', async () => {
    mockOk({ status: 'STK_SENT', txnId: 't' })
    await transactions.initiate({
      merchantId: 'm', amountCents: 100, source: 'CONSUMER_TAG',
      idempotencyKey: 'k', timestamp: 0,
      consumerTagId: 'ctag-1', tagId: 'tag-1',
    })
    expect(lastCallBody()).toMatchObject({ consumerTagId: 'ctag-1', tagId: 'tag-1' })
  })
})

describe('transactions.getStatus', () => {
  it('GETs /api/v1/transactions/:txnId/status', async () => {
    mockOk({ status: 'CONFIRMED', txnId: 'txn-123', mpesaRef: 'NLJ7RT61SV', amountCents: 5000 })
    const r = await transactions.getStatus('txn-123')
    expect(lastCallUrl()).toContain('/transactions/txn-123/status')
    expect(r.status).toBe('CONFIRMED')
  })

  it('throws ApiError on 404', async () => {
    mockError(404, 'Transaction not found')
    await expect(transactions.getStatus('bad-id')).rejects.toMatchObject({ status: 404 })
  })
})

// ─── fx namespace ─────────────────────────────────────────────────────────────

describe('fx.getRates', () => {
  it('GETs /api/v1/fx/rates without auth header', async () => {
    mockOk({ USD: 130.5, EUR: 143.2 })
    const r = await fx.getRates()
    expect(lastCallUrl()).toContain('/api/v1/fx/rates')
    expect(lastCallOpts().headers['Authorization']).toBeUndefined()
    expect(r.USD).toBe(130.5)
  })
})

// ─── devices namespace ────────────────────────────────────────────────────────

describe('devices', () => {
  it('getFleet GETs /api/v1/devices', async () => {
    mockOk([])
    await devices.getFleet()
    expect(lastCallUrl()).toContain('/api/v1/devices')
    expect(lastCallOpts().method).toBe('GET')
  })

  it('getDevice GETs /api/v1/admin/fleet/:deviceId', async () => {
    mockOk({ deviceId: 'dev-1', status: 'online' })
    const r = await devices.getDevice('dev-1')
    expect(lastCallUrl()).toContain('/admin/fleet/dev-1')
    expect(r.deviceId).toBe('dev-1')
  })

  it('getAlerts GETs /api/v1/admin/fleet/alerts', async () => {
    mockOk({ alerts: [] })
    await devices.getAlerts()
    expect(lastCallUrl()).toContain('/fleet/alerts')
  })
})

// ─── accounting namespace ─────────────────────────────────────────────────────

describe('accounting', () => {
  it('getIntegrations GETs /api/v1/accounting/integrations', async () => {
    mockOk({ integrations: [] })
    await accounting.getIntegrations()
    expect(lastCallUrl()).toContain('/accounting/integrations')
  })

  it('connect POSTs to /api/v1/accounting/integrations/:platform/connect', async () => {
    mockOk({ connected: true })
    await accounting.connect('xero', { apiKey: 'key-123' })
    expect(lastCallUrl()).toContain('/accounting/integrations/xero/connect')
    expect(lastCallOpts().method).toBe('POST')
    expect(lastCallBody()).toMatchObject({ apiKey: 'key-123' })
  })

  it('disconnect DELETEs /api/v1/accounting/integrations/:platform', async () => {
    mockOk({})
    await accounting.disconnect('xero')
    expect(lastCallUrl()).toContain('/accounting/integrations/xero')
    expect(lastCallOpts().method).toBe('DELETE')
  })

  it('getPostings GETs with default limit=50 and no status filter', async () => {
    mockOk({ postings: [] })
    await accounting.getPostings()
    expect(lastCallUrl()).toContain('limit=50')
    expect(lastCallUrl()).not.toContain('status=')
  })

  it('getPostings appends status filter when provided', async () => {
    mockOk({ postings: [] })
    await accounting.getPostings('FAILED', 25)
    expect(lastCallUrl()).toContain('limit=25')
    expect(lastCallUrl()).toContain('status=FAILED')
  })

  it('retryPosting POSTs to /api/v1/accounting/gl-postings/:id/retry', async () => {
    mockOk({ retried: true })
    await accounting.retryPosting('posting-abc')
    expect(lastCallUrl()).toContain('/gl-postings/posting-abc/retry')
    expect(lastCallOpts().method).toBe('POST')
  })
})

// ─── loyalty namespace ────────────────────────────────────────────────────────

describe('loyalty', () => {
  it('getProgramme GETs /api/v1/loyalty/programme', async () => {
    mockOk({ programme_type: 'POINTS', points_per_ksh: 1 })
    const r = await loyalty.getProgramme()
    expect(lastCallUrl()).toContain('/loyalty/programme')
    expect(r.programme_type).toBe('POINTS')
  })

  it('getBalance GETs /api/v1/loyalty/balance', async () => {
    mockOk({ points: 350, stamps: 0 })
    const r = await loyalty.getBalance()
    expect(lastCallUrl()).toContain('/loyalty/balance')
    expect(r.points).toBe(350)
  })
})

// ─── verifyAdminSecret ────────────────────────────────────────────────────────

describe('verifyAdminSecret', () => {
  it('GETs /api/v1/admin/stats with X-Admin-Secret extraHeader', async () => {
    mockOk({ valid: true })
    await verifyAdminSecret('test-secret-key')
    expect(lastCallUrl()).toContain('/api/v1/admin/stats')
    expect(lastCallOpts().method).toBe('GET')
    expect(lastCallOpts().headers['X-Admin-Secret']).toBe('test-secret-key')
  })

  it('omits the Bearer Authorization header (auth: false)', async () => {
    sessionStorage.setItem('token', 'some-jwt')
    mockOk({})
    await verifyAdminSecret('secret')
    expect(lastCallOpts().headers['Authorization']).toBeUndefined()
  })

  it('does not inject stored admin secret (adminAuth: false, only extraHeaders)', async () => {
    saveAdminSecret('stored-admin-secret')
    mockOk({})
    await verifyAdminSecret('override-secret')
    // The stored admin secret should NOT be injected (adminAuth: false)
    // Only the explicitly passed secret via extraHeaders is used
    expect(lastCallOpts().headers['X-Admin-Secret']).toBe('override-secret')
  })
})

// ─── admin namespace ──────────────────────────────────────────────────────────

describe('admin', () => {
  beforeEach(() => saveAdminSecret('admin-secret-key'))

  it('getStats GETs /api/v1/admin/stats with X-Admin-Secret', async () => {
    mockOk({ totalMerchants: 42, totalTransactions: 1000 })
    const r = await admin.getStats()
    expect(lastCallUrl()).toContain('/admin/stats')
    expect(lastCallOpts().headers['X-Admin-Secret']).toBe('admin-secret-key')
    expect(r.totalMerchants).toBe(42)
  })

  it('getPendingMerchants GETs /api/v1/auth/admin/pending with X-Admin-Secret', async () => {
    mockOk({ pending: [{ merchantId: 'mid-1', name: 'Shop A' }] })
    const r = await admin.getPendingMerchants()
    expect(lastCallUrl()).toContain('/auth/admin/pending')
    expect(lastCallOpts().headers['X-Admin-Secret']).toBe('admin-secret-key')
    expect(r.pending).toHaveLength(1)
  })

  it('approveMerchant POSTs to /api/v1/auth/admin/approve/:merchantId', async () => {
    mockOk({ approved: true })
    await admin.approveMerchant('mid-1', 'approve', 'Looks good')
    expect(lastCallUrl()).toContain('/auth/admin/approve/mid-1')
    expect(lastCallOpts().method).toBe('POST')
    expect(lastCallBody()).toMatchObject({ action: 'approve', notes: 'Looks good' })
  })

  it('getFleet GETs /api/v1/admin/fleet with X-Admin-Secret', async () => {
    mockOk({ devices: [] })
    await admin.getFleet()
    expect(lastCallUrl()).toContain('/admin/fleet')
    expect(lastCallOpts().headers['X-Admin-Secret']).toBe('admin-secret-key')
  })

  it('getFleetAlerts GETs fleet alerts with X-Admin-Secret', async () => {
    mockOk({ alerts: [] })
    await admin.getFleetAlerts()
    expect(lastCallUrl()).toContain('/fleet/alerts')
    expect(lastCallOpts().headers['X-Admin-Secret']).toBe('admin-secret-key')
  })
})

// ─── auth.googleLogin ─────────────────────────────────────────────────────────

describe('auth.googleLogin', () => {
  it('POSTs credential and role to /api/v1/auth/google', async () => {
    mockOk({ token: 'gtok', consumerId: 'cid', role: 'consumer', expiresAt: 9999, refreshToken: 'rt' })
    await auth.googleLogin('google-credential', 'consumer')
    expect(lastCallUrl()).toContain('/auth/google')
    expect(lastCallBody()).toMatchObject({ credential: 'google-credential', role: 'consumer' })
  })

  it('includes phone when provided', async () => {
    mockOk({ token: 'gtok', consumerId: 'cid', role: 'consumer', expiresAt: 9999, refreshToken: 'rt' })
    await auth.googleLogin('google-credential', 'consumer', '254712345678')
    expect(lastCallBody()).toMatchObject({ phone: '254712345678' })
  })
})

// ─── settlement ───────────────────────────────────────────────────────────────

describe('settlement', () => {
  it('list GETs /api/v1/settlements with page and limit', async () => {
    mockOk({ settlements: [], total: 0 })
    await settlement.list(2, 10)
    expect(lastCallUrl()).toContain('/settlements?page=2&limit=10')
  })

  it('list uses default page=1 and limit=20 when called with no args', async () => {
    mockOk({ settlements: [], total: 0 })
    await settlement.list()
    expect(lastCallUrl()).toContain('/settlements?page=1&limit=20')
  })

  it('get GETs /api/v1/settlements/:id', async () => {
    mockOk({ id: 's-1' })
    await settlement.get('s-1')
    expect(lastCallUrl()).toContain('/settlements/s-1')
  })

  it('getAccount GETs /api/v1/settlements/account/me', async () => {
    mockOk({ accountType: 'MPESA' })
    await settlement.getAccount()
    expect(lastCallUrl()).toContain('/settlements/account/me')
  })

  it('setAccount POSTs to /api/v1/settlements/account', async () => {
    mockOk({ id: 'acc-1', accountType: 'MPESA' })
    await settlement.setAccount({ accountType: 'MPESA', mpesaPhone: '254712345678' })
    expect(lastCallUrl()).toContain('/settlements/account')
    expect(lastCallOpts().method).toBe('POST')
    expect(lastCallBody()).toMatchObject({ accountType: 'MPESA', mpesaPhone: '254712345678' })
  })
})

// ─── kyc ─────────────────────────────────────────────────────────────────────

describe('kyc', () => {
  it('status GETs /api/v1/kyc/status', async () => {
    mockOk({ status: 'PENDING' })
    await kyc.status()
    expect(lastCallUrl()).toContain('/kyc/status')
  })

  it('documents GETs /api/v1/kyc/documents', async () => {
    mockOk({ documents: [] })
    await kyc.documents()
    expect(lastCallUrl()).toContain('/kyc/documents')
  })

  it('uploadDocument POSTs to /api/v1/kyc/documents', async () => {
    mockOk({ id: 'doc-1' })
    await kyc.uploadDocument({ docType: 'NATIONAL_ID', fileUrl: 'https://example.com/doc.pdf' })
    expect(lastCallUrl()).toContain('/kyc/documents')
    expect(lastCallOpts().method).toBe('POST')
    expect(lastCallBody()).toMatchObject({ docType: 'NATIONAL_ID', fileUrl: 'https://example.com/doc.pdf' })
  })

  it('businessDetails GETs /api/v1/kyc/business-details', async () => {
    mockOk({ kra_pin: 'A001234567B' })
    await kyc.businessDetails()
    expect(lastCallUrl()).toContain('/kyc/business-details')
  })

  it('updateBusinessDetails PUTs to /api/v1/kyc/business-details', async () => {
    mockOk({})
    await kyc.updateBusinessDetails({ kraPin: 'A001234567B' })
    expect(lastCallUrl()).toContain('/kyc/business-details')
    expect(lastCallOpts().method).toBe('PUT')
    expect(lastCallBody()).toMatchObject({ kraPin: 'A001234567B' })
  })
})

// ─── admin namespace ──────────────────────────────────────────────────────────

describe('admin.getAllMerchants', () => {
  it('GETs /api/v1/admin/merchants', async () => {
    mockOk([{ id: 'merch-1', name: 'Baridi Café' }])
    const r = await admin.getAllMerchants()
    expect(lastCallUrl()).toContain('/api/v1/admin/merchants')
    expect(lastCallOpts().method).toBe('GET')
    expect(r).toHaveLength(1)
  })
})

describe('admin.getConsumers', () => {
  it('GETs /api/v1/admin/consumers', async () => {
    mockOk([{ id: 'con-1', email: 'alice@example.com' }])
    const r = await admin.getConsumers()
    expect(lastCallUrl()).toContain('/api/v1/admin/consumers')
    expect(lastCallOpts().method).toBe('GET')
    expect(r).toHaveLength(1)
  })
})

describe('admin.amlFlags', () => {
  it('GETs /api/v1/admin/aml/flags without status filter', async () => {
    mockOk([])
    await admin.amlFlags()
    expect(lastCallUrl()).toContain('/api/v1/admin/aml/flags')
    expect(lastCallUrl()).not.toContain('status=')
  })

  it('GETs /api/v1/admin/aml/flags with status filter', async () => {
    mockOk([])
    await admin.amlFlags('OPEN')
    expect(lastCallUrl()).toContain('status=OPEN')
  })
})

describe('admin.updateAmlFlag', () => {
  it('PATCHes /api/v1/admin/aml/flags/:id', async () => {
    mockOk({ id: 'flag-1', status: 'RESOLVED' })
    const r = await admin.updateAmlFlag('flag-1', { status: 'RESOLVED', notes: 'Cleared' })
    expect(lastCallUrl()).toContain('/api/v1/admin/aml/flags/flag-1')
    expect(lastCallOpts().method).toBe('PATCH')
    expect(lastCallBody()).toMatchObject({ status: 'RESOLVED', notes: 'Cleared' })
    expect(r.status).toBe('RESOLVED')
  })
})

describe('admin.screenMerchant', () => {
  it('POSTs to /api/v1/admin/kyc/:merchantId/screen', async () => {
    mockOk({ status: 'CLEAR', matches: [], riskLevel: 'LOW', reasons: [] })
    const r = await admin.screenMerchant('merch-abc')
    expect(lastCallUrl()).toContain('/api/v1/admin/kyc/merch-abc/screen')
    expect(lastCallOpts().method).toBe('POST')
    expect(r.riskLevel).toBe('LOW')
  })
})

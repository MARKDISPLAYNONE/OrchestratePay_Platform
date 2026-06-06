// Tests that merchant approval/rejection/suspension writes audit logs
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET   = 'test-secret'
process.env.ADMIN_SECRET = 'test-admin-secret'
process.env.NODE_ENV     = 'test'

const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...args: any[]) => mockQuery(...args) },
}))
jest.mock('../db/redis', () => ({
  redis: { get: jest.fn(), setex: jest.fn(), incr: jest.fn(), expire: jest.fn(), del: jest.fn() },
}))
jest.mock('../integrations/africas-talking', () => ({
  sendSms: jest.fn(), SmsTemplate: {},
}))
jest.mock('../util/nfc-signing', () => ({
  deriveMerchantSigningKey: jest.fn(),
}))

const mockWriteAuditLog = jest.fn().mockResolvedValue(undefined)
jest.mock('../util/audit', () => ({
  writeAuditLog: (...args: any[]) => mockWriteAuditLog(...args),
}))

function buildApp() {
  const app = express()
  app.use(express.json())
  const authRouter = require('../routes/auth').default
  app.use('/api/v1/auth', authRouter)
  return app
}

describe('POST /api/v1/auth/admin/approve/:merchantId', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 })
  })

  it('writes MERCHANT_APPROVED audit event on approve', async () => {
    const app = buildApp()
    await request(app)
      .post('/api/v1/auth/admin/approve/mid-1')
      .set('x-admin-secret', 'test-admin-secret')
      .send({ action: 'approve', notes: 'KYC verified' })

    const approveCall = mockWriteAuditLog.mock.calls.find(
      (c: any[]) => c[0].event === 'MERCHANT_APPROVED'
    )
    expect(approveCall).toBeTruthy()
    expect(approveCall[0].entityId).toBe('mid-1')
  })

  it('writes MERCHANT_REJECTED audit event on reject', async () => {
    const app = buildApp()
    await request(app)
      .post('/api/v1/auth/admin/approve/mid-2')
      .set('x-admin-secret', 'test-admin-secret')
      .send({ action: 'reject', notes: 'Incomplete documents' })

    const rejectCall = mockWriteAuditLog.mock.calls.find(
      (c: any[]) => c[0].event === 'MERCHANT_REJECTED'
    )
    expect(rejectCall).toBeTruthy()
  })

  it('writes MERCHANT_SUSPENDED audit event on suspend', async () => {
    const app = buildApp()
    await request(app)
      .post('/api/v1/auth/admin/approve/mid-3')
      .set('x-admin-secret', 'test-admin-secret')
      .send({ action: 'suspend', notes: 'Fraud investigation' })

    const suspendCall = mockWriteAuditLog.mock.calls.find(
      (c: any[]) => c[0].event === 'MERCHANT_SUSPENDED'
    )
    expect(suspendCall).toBeTruthy()
  })

  it('returns 403 without admin secret', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/admin/approve/mid-1')
      .send({ action: 'approve' })

    expect(res.status).toBe(403)
    expect(mockWriteAuditLog).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid action', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/auth/admin/approve/mid-1')
      .set('x-admin-secret', 'test-admin-secret')
      .send({ action: 'delete' })

    expect(res.status).toBe(400)
  })
})

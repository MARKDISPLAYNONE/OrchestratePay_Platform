/**
 * routes-kyc.test.ts — Full coverage for src/routes/kyc.ts
 *
 * Covers:
 *   GET  /api/v1/kyc/status          — kyc status + missing docs, DB error
 *   GET  /api/v1/kyc/documents       — list docs, DB error
 *   POST /api/v1/kyc/documents       — save doc (upsert = delete+insert), auto-advances to SUBMITTED, DB error
 *   adminKycRouter GET /pending      — pending KYC list, DB error
 *   adminKycRouter PATCH /:id        — APPROVE, REJECT, 404, DB error
 */
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV   = 'test'

// ── Mock requireAuth ──────────────────────────────────────────────────────────
const mockRequireAuth = jest.fn()
jest.mock('../middleware/auth', () => ({
  requireAuth:  (...args: any[]) => mockRequireAuth(...args),
  requireRole:  jest.fn().mockImplementation(() => (_req: any, _res: any, next: any) => next()),
  DEVICE_CACHE_TTL_S: 32400,
}))

// ── Mock DB ───────────────────────────────────────────────────────────────────
const mockQuery = jest.fn()
jest.mock('../db/index', () => ({
  db: { query: (...a: any[]) => mockQuery(...a) },
}))

// ── Mock Redis ────────────────────────────────────────────────────────────────
const mockRedisGet = jest.fn()
jest.mock('../db/redis', () => ({
  redis: { get: (...a: any[]) => mockRedisGet(...a) },
}))

// ── Mock audit log ────────────────────────────────────────────────────────────
jest.mock('../util/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

// ── Mock logger ───────────────────────────────────────────────────────────────
jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import kycRouter, { adminKycRouter } from '../routes/kyc'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MERCHANT_ID = 'a1a2a3a4-b1b2-4c1c-d1d2-e1e2e3e4e5e6'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/kyc', kycRouter)
  return app
}

function buildAdminApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/admin/kyc', adminKycRouter)
  return app
}

const SAMPLE_MERCHANT = {
  kyc_status:       'SUBMITTED',
  kyc_notes:        null,
  kyc_submitted_at: '2026-06-20T10:00:00Z',
  approval_status:  'PENDING_REVIEW',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery.mockReset()
  mockRedisGet.mockResolvedValue(null)

  mockRequireAuth.mockImplementation((req: any, _res: any, next: any) => {
    req.merchant = { sub: MERCHANT_ID, name: 'Test Merchant', role: 'MERCHANT', deviceId: 'dev-1' }
    next()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/v1/kyc/status
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/kyc/status', () => {
  it('returns KYC status and lists missing required docs', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SAMPLE_MERCHANT] })  // merchant status
      .mockResolvedValueOnce({ rows: [                     // existing docs
        { doc_type: 'NATIONAL_ID', uploaded_at: new Date(), verified: false },
      ] })

    const res = await request(buildApp()).get('/api/v1/kyc/status')

    expect(res.status).toBe(200)
    expect(res.body.kycStatus).toBe('SUBMITTED')
    expect(res.body.approvalStatus).toBe('PENDING_REVIEW')
    expect(res.body.documents).toHaveLength(1)
    // NATIONAL_ID submitted, BUSINESS_REG and KRA_CERT missing
    expect(res.body.requiredMissing).toContain('BUSINESS_REG')
    expect(res.body.requiredMissing).toContain('KRA_CERT')
    expect(res.body.requiredMissing).not.toContain('NATIONAL_ID')
  })

  it('returns empty requiredMissing when all required docs are submitted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SAMPLE_MERCHANT] })
      .mockResolvedValueOnce({ rows: [
        { doc_type: 'NATIONAL_ID', uploaded_at: new Date(), verified: false },
        { doc_type: 'BUSINESS_REG', uploaded_at: new Date(), verified: false },
        { doc_type: 'KRA_CERT', uploaded_at: new Date(), verified: false },
      ] })

    const res = await request(buildApp()).get('/api/v1/kyc/status')

    expect(res.status).toBe(200)
    expect(res.body.requiredMissing).toHaveLength(0)
  })

  it('returns 500 when DB throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildApp()).get('/api/v1/kyc/status')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to fetch KYC status')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/v1/kyc/documents
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/kyc/documents', () => {
  it('returns list of submitted documents', async () => {
    const docs = [
      { id: 'doc-1', doc_type: 'NATIONAL_ID', file_name: 'id_front.jpg', verified: false, uploaded_at: new Date() },
      { id: 'doc-2', doc_type: 'BUSINESS_REG', file_name: 'cert.pdf', verified: true, uploaded_at: new Date() },
    ]
    mockQuery.mockResolvedValueOnce({ rows: docs })

    const res = await request(buildApp()).get('/api/v1/kyc/documents')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].doc_type).toBe('NATIONAL_ID')
  })

  it('returns empty array when no documents submitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildApp()).get('/api/v1/kyc/documents')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(0)
  })

  it('returns 500 when DB throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildApp()).get('/api/v1/kyc/documents')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to fetch documents')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/v1/kyc/documents
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/kyc/documents', () => {
  const NEW_DOC = {
    id:          'doc-new',
    doc_type:    'NATIONAL_ID',
    file_name:   'national_id.jpg',
    uploaded_at: new Date().toISOString(),
  }

  it('saves a new document and returns allRequiredSubmitted=false when not all required present', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // DELETE existing
      .mockResolvedValueOnce({ rows: [NEW_DOC] })         // INSERT new doc
      .mockResolvedValueOnce({ rows: [                    // check existing docs
        { doc_type: 'NATIONAL_ID' },                      // only 1/3 required docs
      ] })

    const res = await request(buildApp())
      .post('/api/v1/kyc/documents')
      .send({
        docType:  'NATIONAL_ID',
        fileUrl:  'https://bucket.s3.amazonaws.com/national_id.jpg',
        fileName: 'national_id.jpg',
      })

    expect(res.status).toBe(201)
    expect(res.body.doc_type).toBe('NATIONAL_ID')
    expect(res.body.allRequiredSubmitted).toBe(false)
  })

  it('upserts document: deletes existing then inserts new one', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })   // DELETE (upsert removes old)
      .mockResolvedValueOnce({ rows: [NEW_DOC] })
      .mockResolvedValueOnce({ rows: [{ doc_type: 'NATIONAL_ID' }] })

    await request(buildApp())
      .post('/api/v1/kyc/documents')
      .send({ docType: 'NATIONAL_ID', fileUrl: 'https://example.com/doc.jpg' })

    // First call should be DELETE
    const deleteCall = mockQuery.mock.calls[0]
    expect(String(deleteCall[0])).toContain('DELETE FROM kyc_documents')
    expect(deleteCall[1]).toContain('NATIONAL_ID')
  })

  it('auto-advances kyc_status to SUBMITTED when all required docs present', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })     // DELETE
      .mockResolvedValueOnce({ rows: [{ ...NEW_DOC, doc_type: 'KRA_CERT' }] })  // INSERT
      .mockResolvedValueOnce({ rows: [                      // all 3 required docs present
        { doc_type: 'NATIONAL_ID' },
        { doc_type: 'BUSINESS_REG' },
        { doc_type: 'KRA_CERT' },
      ] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })     // UPDATE kyc_status

    const res = await request(buildApp())
      .post('/api/v1/kyc/documents')
      .send({ docType: 'KRA_CERT', fileUrl: 'https://example.com/kra_cert.pdf' })

    expect(res.status).toBe(201)
    expect(res.body.allRequiredSubmitted).toBe(true)

    // Verify UPDATE was called to advance KYC status
    const updateCall = mockQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("kyc_status = 'SUBMITTED'")
    )
    expect(updateCall).toBeTruthy()
  })

  it('saves document without optional fileName (stores null)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ ...NEW_DOC, file_name: null }] })
      .mockResolvedValueOnce({ rows: [{ doc_type: 'NATIONAL_ID' }] })

    const res = await request(buildApp())
      .post('/api/v1/kyc/documents')
      .send({ docType: 'NATIONAL_ID', fileUrl: 'https://example.com/doc.jpg' })  // no fileName

    expect(res.status).toBe(201)
    // Verify fileName ?? null was passed as null
    const insertCall = mockQuery.mock.calls[1]
    expect(insertCall[1][3]).toBeNull()
  })

  it('returns 400 for invalid docType', async () => {
    const res = await request(buildApp())
      .post('/api/v1/kyc/documents')
      .send({ docType: 'INVALID_TYPE', fileUrl: 'https://example.com/doc.jpg' })

    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid fileUrl', async () => {
    const res = await request(buildApp())
      .post('/api/v1/kyc/documents')
      .send({ docType: 'NATIONAL_ID', fileUrl: 'not-a-url' })

    expect(res.status).toBe(400)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/kyc/documents')
      .send({})

    expect(res.status).toBe(400)
  })

  it('returns 500 when DB throws during save', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB write error'))

    const res = await request(buildApp())
      .post('/api/v1/kyc/documents')
      .send({ docType: 'NATIONAL_ID', fileUrl: 'https://example.com/doc.jpg' })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to save document')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// adminKycRouter GET /pending
// ═════════════════════════════════════════════════════════════════════════════

describe('adminKycRouter GET /pending', () => {
  it('returns list of merchants pending KYC review', async () => {
    const merchant = {
      id:              MERCHANT_ID,
      name:            'Test Merchant',
      email:           'merchant@example.com',
      phone:           '254712345678',
      kyc_status:      'SUBMITTED',
      kyc_submitted_at: '2026-06-20T10:00:00Z',
      approval_status: 'PENDING_REVIEW',
      created_at:      '2026-06-01T00:00:00Z',
      documents:       [{ docType: 'NATIONAL_ID', fileUrl: 'https://example.com/doc.jpg' }],
    }
    mockQuery.mockResolvedValueOnce({ rows: [merchant] })

    const res = await request(buildAdminApp()).get('/api/v1/admin/kyc/pending')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].kyc_status).toBe('SUBMITTED')
  })

  it('returns empty array when no pending KYC', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildAdminApp()).get('/api/v1/admin/kyc/pending')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(0)
  })

  it('returns 500 when DB throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(buildAdminApp()).get('/api/v1/admin/kyc/pending')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to fetch pending KYC')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// adminKycRouter PATCH /:id — approve or reject
// ═════════════════════════════════════════════════════════════════════════════

describe('adminKycRouter PATCH /:id', () => {
  const APPROVED_MERCHANT = {
    id:              MERCHANT_ID,
    name:            'Test Merchant',
    email:           'merchant@example.com',
    kyc_status:      'APPROVED',
    approval_status: 'APPROVED',
  }

  it('approves merchant KYC and updates kyc_status to APPROVED', async () => {
    const KYC_PRE_CHECK = { ...APPROVED_MERCHANT, kra_pin: 'A001234567B', sanctions_status: 'CLEAR', phone: '254712345678' }
    mockQuery
      .mockResolvedValueOnce({ rows: [KYC_PRE_CHECK] })    // pre-check: SELECT kra_pin, sanctions_status, phone
      .mockResolvedValueOnce({ rows: [APPROVED_MERCHANT] }) // UPDATE kyc_status + approval_status
      .mockResolvedValueOnce({ rows: [{ phone: '254712345678', name: 'Test Merchant' }] }) // SMS SELECT

    const res = await request(buildAdminApp())
      .patch(`/api/v1/admin/kyc/${MERCHANT_ID}`)
      .send({ action: 'APPROVE' })

    expect(res.status).toBe(200)
    expect(res.body.kyc_status).toBe('APPROVED')
    expect(res.body.approval_status).toBe('APPROVED')

    // Verify APPROVE sets correct statuses (UPDATE is now calls[1], after pre-check SELECT)
    const updateCall = mockQuery.mock.calls[1]
    expect(updateCall[1][1]).toBe('APPROVED')   // kyc_status
    expect(updateCall[1][2]).toBe('APPROVED')   // approval_status
  })

  it('rejects merchant KYC and updates kyc_status to REJECTED', async () => {
    const rejectedMerchant = { ...APPROVED_MERCHANT, kyc_status: 'REJECTED', approval_status: 'REJECTED' }
    mockQuery
      .mockResolvedValueOnce({ rows: [rejectedMerchant] })                                    // UPDATE (no pre-check for REJECT)
      .mockResolvedValueOnce({ rows: [{ phone: '254712345678', name: 'Test Merchant' }] })   // SMS SELECT

    const res = await request(buildAdminApp())
      .patch(`/api/v1/admin/kyc/${MERCHANT_ID}`)
      .send({ action: 'REJECT', notes: 'Documents are blurry' })

    expect(res.status).toBe(200)
    expect(res.body.kyc_status).toBe('REJECTED')

    // Verify REJECT sets correct statuses and passes notes (UPDATE is calls[0] — no pre-check for REJECT)
    const updateCall = mockQuery.mock.calls[0]
    expect(updateCall[1][1]).toBe('REJECTED')     // kyc_status
    expect(updateCall[1][2]).toBe('REJECTED')     // approval_status
    expect(updateCall[1][3]).toBe('Documents are blurry')  // notes
  })

  it('passes null notes when notes field is omitted', async () => {
    const KYC_PRE_CHECK = { ...APPROVED_MERCHANT, kra_pin: 'A001234567B', sanctions_status: 'CLEAR', phone: '254712345678' }
    mockQuery
      .mockResolvedValueOnce({ rows: [KYC_PRE_CHECK] })    // pre-check SELECT
      .mockResolvedValueOnce({ rows: [APPROVED_MERCHANT] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ phone: '254712345678', name: 'Test Merchant' }] }) // SMS SELECT

    await request(buildAdminApp())
      .patch(`/api/v1/admin/kyc/${MERCHANT_ID}`)
      .send({ action: 'APPROVE' })

    const updateCall = mockQuery.mock.calls[1]  // UPDATE is now calls[1]
    expect(updateCall[1][3]).toBeNull()  // notes ?? null
  })

  it('returns 404 when merchant not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await request(buildAdminApp())
      .patch(`/api/v1/admin/kyc/nonexistent-id`)
      .send({ action: 'APPROVE' })

    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Merchant not found')
  })

  it('returns 400 for invalid action', async () => {
    const res = await request(buildAdminApp())
      .patch(`/api/v1/admin/kyc/${MERCHANT_ID}`)
      .send({ action: 'SUSPEND' })  // Not valid — only APPROVE | REJECT

    expect(res.status).toBe(400)
  })

  it('returns 400 when action is missing', async () => {
    const res = await request(buildAdminApp())
      .patch(`/api/v1/admin/kyc/${MERCHANT_ID}`)
      .send({})

    expect(res.status).toBe(400)
  })

  it('returns 500 when DB throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'))

    const res = await request(buildAdminApp())
      .patch(`/api/v1/admin/kyc/${MERCHANT_ID}`)
      .send({ action: 'APPROVE' })

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Failed to process KYC review')
  })

  it('writes an audit log entry on successful APPROVE', async () => {
    const KYC_PRE_CHECK = { ...APPROVED_MERCHANT, kra_pin: 'A001234567B', sanctions_status: 'CLEAR', phone: '254712345678' }
    mockQuery
      .mockResolvedValueOnce({ rows: [KYC_PRE_CHECK] })    // pre-check SELECT
      .mockResolvedValueOnce({ rows: [APPROVED_MERCHANT] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ phone: '254712345678', name: 'Test Merchant' }] }) // SMS SELECT

    await request(buildAdminApp())
      .patch(`/api/v1/admin/kyc/${MERCHANT_ID}`)
      .send({ action: 'APPROVE' })

    const { writeAuditLog } = require('../util/audit')
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'KYC_APPROVED', entityId: MERCHANT_ID })
    )
  })

  it('writes an audit log entry on successful REJECT', async () => {
    const rejectedMerchant = { ...APPROVED_MERCHANT, kyc_status: 'REJECTED', approval_status: 'REJECTED' }
    mockQuery.mockResolvedValueOnce({ rows: [rejectedMerchant] })

    await request(buildAdminApp())
      .patch(`/api/v1/admin/kyc/${MERCHANT_ID}`)
      .send({ action: 'REJECT', notes: 'Poor quality docs' })

    const { writeAuditLog } = require('../util/audit')
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'KYC_REJECTED', entityId: MERCHANT_ID })
    )
  })
})

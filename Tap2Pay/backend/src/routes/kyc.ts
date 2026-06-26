/**
 * routes/kyc.ts — KYC document submission and admin review.
 *
 * Merchant flow:
 *   POST /api/v1/kyc/documents        — upload a document URL (post-registration)
 *   GET  /api/v1/kyc/documents        — list own submitted documents
 *   GET  /api/v1/kyc/status           — check overall KYC status
 *
 * Admin flow (mounted at /api/v1/admin/kyc):
 *   GET  /api/v1/admin/kyc/pending    — merchants awaiting review
 *   PATCH /api/v1/admin/kyc/:id       — approve or reject a merchant's KYC
 */
import { Router, Request, Response } from 'express'
import Joi from 'joi'
import { db } from '../db/index'
import { logger } from '../util/logger'
import { requireAuth } from '../middleware/auth'
import { requireAdmin } from './admin'
import { validate } from '../middleware/validate'
import { writeAuditLog } from '../util/audit'
import { sendSms } from '../integrations/africas-talking'

const router = Router()

const REQUIRED_DOCS = ['NATIONAL_ID', 'BUSINESS_REG', 'KRA_CERT'] as const

const documentSchema = Joi.object({
  docType:  Joi.string().valid('NATIONAL_ID','PASSPORT','BUSINESS_REG','KRA_CERT','SELFIE','OTHER').required(),
  fileUrl:  Joi.string().uri().max(1000).required(),
  fileName: Joi.string().max(255).optional(),
})

// ─── GET /api/v1/kyc/status ───────────────────────────────────────────────────

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  try {
    const { rows: [merchant] } = await db.query(
      `SELECT kyc_status, kyc_notes, kyc_submitted_at, approval_status FROM merchants WHERE id = $1`,
      [merchantId]
    )
    const { rows: docs } = await db.query(
      `SELECT doc_type, uploaded_at, verified FROM kyc_documents WHERE merchant_id = $1`,
      [merchantId]
    )
    const submitted = docs.map(d => d.doc_type)
    const missing   = REQUIRED_DOCS.filter(r => !submitted.includes(r))

    res.json({
      kycStatus:      merchant.kyc_status,
      kycNotes:       merchant.kyc_notes,
      kycSubmittedAt: merchant.kyc_submitted_at,
      approvalStatus: merchant.approval_status,
      documents:      docs,
      requiredMissing: missing,
    })
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to fetch KYC status' })
  }
})

// ─── GET /api/v1/kyc/business-details ────────────────────────────────────────

router.get('/business-details', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  try {
    const { rows: [m] } = await db.query(
      `SELECT business_type, business_address_line1, business_address_city,
              business_address_country, nature_of_business,
              expected_monthly_volume_cents, beneficial_owner_name,
              beneficial_owner_id_number, beneficial_owner_ownership_pct,
              kra_pin, sanctions_status, aml_risk_level
       FROM merchants WHERE id = $1`,
      [merchantId]
    )
    if (!m) return res.status(404).json({ error: 'Merchant not found' })
    res.json(m)
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to fetch business details' })
  }
})

const businessDetailsSchema = Joi.object({
  businessType:                Joi.string().valid('SOLE_TRADER','PARTNERSHIP','LIMITED_COMPANY','NGO','COOPERATIVE','MONEY_EXCHANGE','CRYPTOCURRENCY','OTHER').optional(),
  businessAddressLine1:        Joi.string().max(200).optional(),
  businessAddressCity:         Joi.string().max(100).optional(),
  natureOfBusiness:            Joi.string().max(500).optional(),
  expectedMonthlyVolumeCents:  Joi.number().integer().min(0).optional(),
  beneficialOwnerName:         Joi.string().max(200).optional(),
  beneficialOwnerIdNumber:     Joi.string().max(50).optional(),
  beneficialOwnerOwnershipPct: Joi.number().integer().min(1).max(100).optional(),
  kraPin:                      Joi.string().min(10).max(15).optional(),
}).min(1)

// ─── PUT /api/v1/kyc/business-details ────────────────────────────────────────

router.put('/business-details', requireAuth, validate(businessDetailsSchema), async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const {
    businessType, businessAddressLine1, businessAddressCity,
    natureOfBusiness, expectedMonthlyVolumeCents,
    beneficialOwnerName, beneficialOwnerIdNumber, beneficialOwnerOwnershipPct,
    kraPin,
  } = req.body

  const updates: string[] = []
  const vals: unknown[] = []
  let i = 1

  if (businessType !== undefined)               { updates.push(`business_type = $${i++}`);                 vals.push(businessType) }
  if (businessAddressLine1 !== undefined)        { updates.push(`business_address_line1 = $${i++}`);        vals.push(businessAddressLine1) }
  if (businessAddressCity !== undefined)         { updates.push(`business_address_city = $${i++}`);         vals.push(businessAddressCity) }
  if (natureOfBusiness !== undefined)            { updates.push(`nature_of_business = $${i++}`);            vals.push(natureOfBusiness) }
  if (expectedMonthlyVolumeCents !== undefined)  { updates.push(`expected_monthly_volume_cents = $${i++}`); vals.push(expectedMonthlyVolumeCents) }
  if (beneficialOwnerName !== undefined)         { updates.push(`beneficial_owner_name = $${i++}`);         vals.push(beneficialOwnerName) }
  if (beneficialOwnerIdNumber !== undefined)     { updates.push(`beneficial_owner_id_number = $${i++}`);    vals.push(beneficialOwnerIdNumber) }
  if (beneficialOwnerOwnershipPct !== undefined) { updates.push(`beneficial_owner_ownership_pct = $${i++}`);vals.push(beneficialOwnerOwnershipPct) }
  if (kraPin !== undefined)                      { updates.push(`kra_pin = $${i++}`);                       vals.push(kraPin) }

  vals.push(merchantId)

  try {
    const { rows: [updated] } = await db.query(
      `UPDATE merchants SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${i} RETURNING business_type, business_address_line1,
       business_address_city, nature_of_business, expected_monthly_volume_cents,
       beneficial_owner_name, beneficial_owner_id_number, beneficial_owner_ownership_pct, kra_pin`,
      vals
    )
    if (!updated) return res.status(404).json({ error: 'Merchant not found' })

    // Re-run AML screening; capped at 8 s so a slow external call can't stall the response.
    const { runFullScreening } = await import('../util/aml-screening')
    try {
      await Promise.race([
        runFullScreening(merchantId),
        new Promise<never>((_, reject) => {
          const t = setTimeout(() => reject(new Error('AML screening timed out')), 8_000)
          t.unref()
        }),
      ])
    } catch (err) {
      logger.warn('AML re-screening failed after profile update', { merchantId, error: (err as Error).message })
    }

    await writeAuditLog({
      event: 'KYC_BUSINESS_DETAILS_UPDATED' as never,
      entityType: 'merchant',
      entityId: merchantId,
      detail: req.body as Record<string, unknown>,
    })
    res.json(updated)
  } catch (err: unknown) {
    logger.error('Failed to update business details', { error: (err as Error).message })
    res.status(500).json({ error: 'Failed to update business details' })
  }
})

// ─── GET /api/v1/kyc/documents ────────────────────────────────────────────────

router.get('/documents', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  try {
    const { rows } = await db.query(
      `SELECT id, doc_type, file_name, verified, uploaded_at FROM kyc_documents WHERE merchant_id = $1 ORDER BY uploaded_at`,
      [merchantId]
    )
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to fetch documents' })
  }
})

// ─── POST /api/v1/kyc/documents ───────────────────────────────────────────────

router.post('/documents', requireAuth, validate(documentSchema), async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { docType, fileUrl, fileName } = req.body

  try {
    // Upsert: replace existing doc of same type so merchants can re-submit.
    await db.query(
      `DELETE FROM kyc_documents WHERE merchant_id = $1 AND doc_type = $2`,
      [merchantId, docType]
    )
    const { rows: [doc] } = await db.query(
      `INSERT INTO kyc_documents (merchant_id, doc_type, file_url, file_name)
       VALUES ($1,$2,$3,$4) RETURNING id, doc_type, file_name, uploaded_at`,
      [merchantId, docType, fileUrl, fileName ?? null]
    )

    // Check if all required docs are now present — auto-advance kyc_status.
    const { rows: existing } = await db.query(
      `SELECT doc_type FROM kyc_documents WHERE merchant_id = $1`,
      [merchantId]
    )
    const submittedTypes = existing.map(d => d.doc_type)
    const allRequired    = REQUIRED_DOCS.every(r => submittedTypes.includes(r))

    if (allRequired) {
      await db.query(
        `UPDATE merchants
            SET kyc_status = 'SUBMITTED', kyc_submitted_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND kyc_status IN ('NOT_SUBMITTED','SUBMITTED')`,
        [merchantId]
      )
      logger.info('Merchant KYC documents complete — status → SUBMITTED', { merchantId })
    }

    res.status(201).json({ ...doc, allRequiredSubmitted: allRequired })
  } catch (err: unknown) {
    logger.error('Failed to save KYC document', { error: (err as Error).message, merchantId })
    res.status(500).json({ error: 'Failed to save document' })
  }
})

// ─── Admin KYC router ─────────────────────────────────────────────────────────

export const adminKycRouter = Router()

adminKycRouter.use(requireAdmin)

const adminReviewSchema = Joi.object({
  action: Joi.string().valid('APPROVE', 'REJECT', 'UNDER_REVIEW').required(),
  notes:  Joi.string().max(1000).optional(),
})

// GET /api/v1/admin/kyc/pending
adminKycRouter.get('/pending', async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(
      `SELECT m.id, m.name, m.email, m.phone, m.kyc_status, m.kyc_submitted_at,
              m.approval_status, m.created_at, m.sanctions_status, m.aml_risk_level,
              COALESCE(
                json_agg(json_build_object('docType', k.doc_type, 'fileUrl', k.file_url,
                                           'fileName', k.file_name, 'uploadedAt', k.uploaded_at))
                FILTER (WHERE k.id IS NOT NULL), '[]'
              ) AS documents
         FROM merchants m
         LEFT JOIN kyc_documents k ON k.merchant_id = m.id
        WHERE m.kyc_status IN ('SUBMITTED','UNDER_REVIEW')
        GROUP BY m.id
        ORDER BY m.kyc_submitted_at`
    )
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to fetch pending KYC' })
  }
})

// PATCH /api/v1/admin/kyc/:id
adminKycRouter.patch('/:id', validate(adminReviewSchema), async (req: Request, res: Response) => {
  const { id } = req.params
  const { action, notes } = req.body

  try {
    // Pre-approval guards
    if (action === 'APPROVE') {
      const { rows: [merchant] } = await db.query(
        `SELECT kra_pin, sanctions_status, phone, name FROM merchants WHERE id = $1`,
        [id]
      )
      if (!merchant) return res.status(404).json({ error: 'Merchant not found' })
      if (!merchant.kra_pin) {
        return res.status(422).json({ error: 'Cannot approve: KRA PIN not provided by merchant' })
      }
      if (merchant.sanctions_status === 'FLAGGED') {
        return res.status(422).json({ error: 'Cannot approve: merchant has open AML sanctions flags. Clear flags first.' })
      }
    }

    const newKycStatus      = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'UNDER_REVIEW'
    const newApprovalStatus = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : undefined

    let rows: Array<Record<string, unknown>>

    if (action === 'UNDER_REVIEW') {
      // Only update kyc_status — do not change approval_status
      const result = await db.query(
        `UPDATE merchants
            SET kyc_status = 'UNDER_REVIEW', kyc_notes = $2, updated_at = NOW()
          WHERE id = $1
          RETURNING id, name, email, kyc_status, approval_status`,
        [id, notes ?? null]
      )
      rows = result.rows
    } else {
      const result = await db.query(
        `UPDATE merchants
            SET kyc_status = $2, approval_status = $3, kyc_notes = $4, updated_at = NOW()
          WHERE id = $1
          RETURNING id, name, email, kyc_status, approval_status`,
        [id, newKycStatus, newApprovalStatus, notes ?? null]
      )
      rows = result.rows
    }

    if (rows.length === 0) return res.status(404).json({ error: 'Merchant not found' })

    await writeAuditLog({
      event: action === 'APPROVE' ? 'KYC_APPROVED' : action === 'UNDER_REVIEW' ? 'KYC_UNDER_REVIEW' : 'KYC_REJECTED',
      entityType: 'merchant', entityId: id,
      detail: { action, notes }, ip: req.ip,
    })

    // Send SMS notification to merchant (fire-and-forget)
    const { rows: [mer] } = await db.query(
      `SELECT phone, name FROM merchants WHERE id = $1`, [id]
    )
    if (mer?.phone) {
      const msg = action === 'APPROVE'
        ? `OrchestratePay: Your merchant account "${mer.name}" has been approved! You can now start accepting payments. Login at orchestratepay.co.ke`
        : action === 'REJECT'
        ? `OrchestratePay: KYC review for "${mer.name}" was not approved. Reason: ${notes ?? 'See dashboard for details'}. Contact support@orchestratepay.co.ke`
        : `OrchestratePay: Your KYC documents for "${mer.name}" are under review. We will notify you within 1-2 business days.`
      sendSms(mer.phone as string, msg).catch(() => {})
    }

    logger.info(`KYC ${action}`, { merchantId: id, notes })
    res.json(rows[0])
  } catch (err: unknown) {
    logger.error('Failed to process KYC review', { error: (err as Error).message })
    res.status(500).json({ error: 'Failed to process KYC review' })
  }
})

// POST /api/v1/admin/kyc/:id/screen — trigger manual AML screening
adminKycRouter.post('/:id/screen', async (req: Request, res: Response) => {
  try {
    const { runFullScreening } = await import('../util/aml-screening')
    const result = await runFullScreening(req.params.id)
    await writeAuditLog({
      event: 'ADMIN_ACTION',
      entityType: 'merchant',
      entityId: req.params.id,
      detail: { action: 'manual_aml_screening', result: result as unknown as Record<string, unknown> },
      ip: req.ip,
    })
    res.json(result)
  } catch (err: unknown) {
    res.status(500).json({ error: 'Screening failed', detail: (err as Error).message })
  }
})

export default router

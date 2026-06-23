/**
 * util/aml-screening.ts — Sanctions and AML risk screening.
 *
 * In production: replace with a real provider (Refinitiv World-Check,
 * ComplyAdvantage, or Kenya-specific KENASEC/CBK lists).
 *
 * Current implementation: keyword-based local check + manual flag.
 * Any FLAGGED result blocks KYC approval until manually cleared by admin.
 */
import { db }     from '../db/index'
import { logger } from './logger'
import { writeAuditLog } from './audit'

// High-risk keywords — partial-match against merchant name, beneficial owner
// In production: replace with OFAC/UN/EU API call
const SANCTIONS_KEYWORDS = [
  'NORTH KOREA', 'DPRK', 'IRAN', 'SYRIA', 'CUBA', 'VENEZUELA',
  'AL-QAEDA', 'ISIS', 'ISIL', 'HAMAS', 'HEZBOLLAH',
]

// Business types considered high risk under CBK AML guidelines
const HIGH_RISK_BUSINESS_TYPES = [
  'MONEY_EXCHANGE', 'CRYPTOCURRENCY', 'CASINO', 'GAMBLING', 'PAWN_SHOP',
]

export interface ScreeningResult {
  status:    'CLEAR' | 'FLAGGED' | 'ERROR'
  matches:   string[]
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  reasons:   string[]
}

export async function runFullScreening(merchantId: string): Promise<ScreeningResult> {
  try {
    const { rows } = await db.query(
      `SELECT name, beneficial_owner_name, beneficial_owner_id_number,
              business_type, expected_monthly_volume_cents, kra_pin
       FROM merchants WHERE id = $1`,
      [merchantId]
    )
    if (rows.length === 0) {
      return { status: 'ERROR', matches: [], riskLevel: 'HIGH', reasons: ['Merchant not found'] }
    }
    const m = rows[0]

    const matches: string[] = []
    const reasons: string[] = []
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'

    // 1. Sanctions keyword screening
    const textToScreen = [m.name, m.beneficial_owner_name].filter(Boolean).join(' ').toUpperCase()
    for (const kw of SANCTIONS_KEYWORDS) {
      if (textToScreen.includes(kw)) {
        matches.push(kw)
        riskLevel = 'HIGH'
        reasons.push(`Name matches sanctions keyword: ${kw}`)
      }
    }

    // 2. High-risk business type
    if (m.business_type && HIGH_RISK_BUSINESS_TYPES.includes(m.business_type.toUpperCase())) {
      riskLevel = riskLevel === 'HIGH' ? 'HIGH' : 'MEDIUM'
      reasons.push(`High-risk business type: ${m.business_type}`)
    }

    // 3. High expected volume without KRA PIN → elevated risk
    if (!m.kra_pin && m.expected_monthly_volume_cents > 100_000_00) {
      riskLevel = riskLevel === 'HIGH' ? 'HIGH' : 'MEDIUM'
      reasons.push('High expected volume without KRA PIN')
    }

    // 4. No beneficial owner info → noted but does not elevate risk alone
    if (!m.beneficial_owner_name) {
      reasons.push('Beneficial owner information not provided')
    }

    const status: 'CLEAR' | 'FLAGGED' = matches.length > 0 ? 'FLAGGED' : 'CLEAR'

    // Persist screening result
    await db.query(
      `INSERT INTO kyc_screening_log (merchant_id, screening_type, result, details)
       VALUES ($1, 'FULL', $2, $3)`,
      [merchantId, status, JSON.stringify({ matches, riskLevel, reasons })]
    )

    await db.query(
      `UPDATE merchants SET sanctions_status = $2, sanctions_checked_at = NOW(), aml_risk_level = $3 WHERE id = $1`,
      [merchantId, status, riskLevel]
    )

    if (status === 'FLAGGED') {
      await db.query(
        `INSERT INTO aml_flags (merchant_id, flag_type, details, status)
         VALUES ($1, 'SANCTIONS_MATCH', $2, 'OPEN')`,
        [merchantId, JSON.stringify({ matches, reasons })]
      )
      await writeAuditLog({
        event: 'AML_FLAG_RAISED' as never,
        entityType: 'merchant',
        entityId: merchantId,
        detail: { flagType: 'SANCTIONS_MATCH', matches, reasons },
      })
    }

    logger.info('AML screening complete', { merchantId, status, riskLevel, matches })
    return { status, matches, riskLevel, reasons }

  } catch (err: unknown) {
    logger.error('AML screening failed', { merchantId, error: (err as Error).message })
    return { status: 'ERROR', matches: [], riskLevel: 'HIGH', reasons: [(err as Error).message] }
  }
}

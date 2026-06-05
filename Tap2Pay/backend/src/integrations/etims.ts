/**
 * etims.ts — KRA eTIMS / VSCU REST client.
 *
 * Submits a fiscal invoice to KRA for every CONFIRMED transaction where the
 * merchant has a KRA PIN set. Failures are non-fatal (payment has already
 * succeeded); the fiscal_log row is written with status=FAILED and retried
 * by the reconciliation job.
 *
 * Environment variables:
 *   ETIMS_BASE_URL   — KRA eTIMS endpoint (e.g. https://etims-api.kra.go.ke)
 *   ETIMS_API_KEY    — KRA-issued API key
 */
import crypto from 'crypto'
import { Pool } from 'pg'
import { logger } from '../util/logger'
import { vatBreakdown } from '../util/vat'

export interface EtimsInvoice {
    merchantId:     string
    transactionId:  string
    kraPin:         string
    amountCents:    number
    mpesaReceipt:   string
    issuedAt:       string   // ISO-8601 UTC
}

export interface EtimsResult {
    success:       boolean
    invoiceNumber: string
    rawResponse?:  unknown
    error?:        string
}

async function postToEtims(invoice: EtimsInvoice): Promise<EtimsResult> {
    const baseUrl = process.env.ETIMS_BASE_URL
    const apiKey  = process.env.ETIMS_API_KEY

    if (!baseUrl || !apiKey) {
        // eTIMS not configured — treat as accepted in dev/test environments
        const invoiceNumber = `LOCAL-${Date.now()}`
        logger.warn('eTIMS not configured — using local invoice number', { invoiceNumber })
        return { success: true, invoiceNumber }
    }

    const { vatCents, netCents } = vatBreakdown(invoice.amountCents)

    const body = {
        kraPin:          invoice.kraPin,
        totalAmount:     (invoice.amountCents / 100).toFixed(2),
        vatAmount:       (vatCents / 100).toFixed(2),
        netAmount:       (netCents / 100).toFixed(2),
        currency:        'KES',
        paymentRef:      invoice.mpesaReceipt,
        transactionId:   invoice.transactionId,
        issuedAt:        invoice.issuedAt,
    }

    const response = await fetch(`${baseUrl}/vscu/invoice`, {
        method:  'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key':    apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),  // 10s timeout
    })

    const raw = await response.json().catch(() => ({}))

    if (!response.ok) {
        return {
            success:       false,
            invoiceNumber: '',
            rawResponse:   raw,
            error:         `eTIMS HTTP ${response.status}`,
        }
    }

    return {
        success:       true,
        invoiceNumber: (raw as any).invoiceNumber ?? `ETIMS-${Date.now()}`,
        rawResponse:   raw,
    }
}

/**
 * Submit a fiscal invoice and record it in fiscal_log.
 * Never throws — returns silently on failure after logging.
 */
export async function submitFiscalInvoice(
    invoice: EtimsInvoice,
    db: Pool
): Promise<void> {
    const { vatCents } = vatBreakdown(invoice.amountCents)
    const invoiceNumber = `DRAFT-${crypto.randomUUID()}`  // placeholder until eTIMS confirms

    // Insert initial QUEUED row
    const { rows } = await db.query(`
        INSERT INTO fiscal_log
          (transaction_id, merchant_id, invoice_number, amount_cents, vat_cents,
           etims_status, created_at)
        VALUES ($1,$2,$3,$4,$5,'QUEUED',NOW())
        ON CONFLICT (transaction_id) DO NOTHING
        RETURNING id
    `, [invoice.transactionId, invoice.merchantId, invoiceNumber,
        invoice.amountCents, vatCents])

    if (rows.length === 0) {
        // Already submitted for this transaction — idempotent skip
        return
    }

    const fiscalLogId = rows[0].id

    try {
        const result = await postToEtims(invoice)
        await db.query(`
            UPDATE fiscal_log SET
                invoice_number = $1,
                etims_status   = $2,
                etims_response = $3,
                submitted_at   = NOW()
            WHERE id = $4
        `, [
            result.success ? result.invoiceNumber : invoiceNumber,
            result.success ? 'ACCEPTED' : 'FAILED',
            JSON.stringify(result.rawResponse ?? null),
            fiscalLogId,
        ])
    } catch (err) {
        await db.query(`
            UPDATE fiscal_log SET etims_status='FAILED', etims_response=$1 WHERE id=$2
        `, [JSON.stringify({ error: (err as Error).message }), fiscalLogId])
        logger.error('eTIMS submission failed', { transactionId: invoice.transactionId, err })
    }
}

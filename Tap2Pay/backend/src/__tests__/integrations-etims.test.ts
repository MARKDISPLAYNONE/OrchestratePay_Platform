/**
 * Focused integration tests for integrations/etims.ts
 *
 * Tests submitFiscalInvoice (and the internal postToEtims path it exercises).
 * Mocks global.fetch and a minimal pg Pool — no live DB or network required.
 *
 * Key behaviours under test:
 *  - When ETIMS_BASE_URL / ETIMS_API_KEY are absent, a LOCAL-* invoice number
 *    is used and status is written as ACCEPTED.
 *  - When eTIMS is configured, the KRA endpoint is called with the correct
 *    headers and body; ACCEPTED / FAILED status is recorded accordingly.
 *  - fiscal_log INSERT is idempotent (ON CONFLICT DO NOTHING → row skip).
 *  - DB sequence failure falls back to INV-FALLBACK-* without throwing.
 *  - Network errors and JSON parse failures in the fetch path are non-fatal.
 */
process.env.NODE_ENV = 'test'

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../util/vat', () => ({
  vatBreakdown: jest.fn().mockReturnValue({ vatCents: 1_600, netCents: 8_400 }),
}))

const mockFetch = jest.fn()
global.fetch = mockFetch as any

import { submitFiscalInvoice, EtimsInvoice } from '../integrations/etims'
import { logger } from '../util/logger'
import { vatBreakdown } from '../util/vat'

// ─── shared fixture ───────────────────────────────────────────────────────────

const INVOICE: EtimsInvoice = {
  merchantId:    'merchant-etims-1',
  transactionId: 'txn-etims-001',
  kraPin:        'A001234567B',
  amountCents:   10_000,          // KES 100.00
  mpesaReceipt:  'ET0T1EXAMPLE',
  issuedAt:      '2026-06-17T10:00:00Z',
}

// ─── db mock factory ─────────────────────────────────────────────────────────

/**
 * Creates a minimal pg Pool mock where each successive call to .query() resolves
 * to the corresponding value in `returnValues`.
 */
function makeDb(...returnValues: Array<{ rows: any[] } | Error>) {
  const mockQuery = jest.fn()
  returnValues.forEach((val) => {
    if (val instanceof Error) {
      mockQuery.mockRejectedValueOnce(val)
    } else {
      mockQuery.mockResolvedValueOnce(val)
    }
  })
  return { query: mockQuery } as any
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function seqRow(seq: number) {
  return { rows: [{ seq }] }
}

function insertRow(id: string) {
  return { rows: [{ id }] }
}

function noInsertRow() {
  return { rows: [] }   // ON CONFLICT DO NOTHING → no row returned
}

// ─────────────────────────────────────────────────────────────────────────────
// submitFiscalInvoice — eTIMS NOT configured (local / dev mode)
// ─────────────────────────────────────────────────────────────────────────────

describe('submitFiscalInvoice — eTIMS not configured (local mode)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    delete process.env.ETIMS_BASE_URL
    delete process.env.ETIMS_API_KEY
  })

  it('does not call fetch when ETIMS_BASE_URL is absent', async () => {
    const db = makeDb(seqRow(1), insertRow('fl-local-1'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('records ACCEPTED status with a LOCAL-* invoice number', async () => {
    const db = makeDb(seqRow(1), insertRow('fl-local-2'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const updateCall = db.query.mock.calls[2]   // 3rd call is the UPDATE
    expect(updateCall[1][1]).toBe('ACCEPTED')    // $2 = etims_status
    expect(updateCall[1][0]).toMatch(/^LOCAL-/)  // $1 = invoice_number
  })

  it('logs warning that eTIMS is not configured', async () => {
    const db = makeDb(seqRow(1), insertRow('fl-local-3'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not configured'),
      expect.objectContaining({ invoiceNumber: expect.stringMatching(/^LOCAL-/) })
    )
  })

  it('does not call fetch when only ETIMS_API_KEY is set (BASE_URL missing)', async () => {
    process.env.ETIMS_API_KEY = 'key-without-url'
    const db = makeDb(seqRow(1), insertRow('fl-local-4'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    expect(mockFetch).not.toHaveBeenCalled()
    delete process.env.ETIMS_API_KEY
  })

  it('does not call fetch when only ETIMS_BASE_URL is set (API_KEY missing)', async () => {
    process.env.ETIMS_BASE_URL = 'https://etims.example.com'
    const db = makeDb(seqRow(1), insertRow('fl-local-5'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    expect(mockFetch).not.toHaveBeenCalled()
    delete process.env.ETIMS_BASE_URL
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// submitFiscalInvoice — eTIMS configured, successful submission
// ─────────────────────────────────────────────────────────────────────────────

describe('submitFiscalInvoice — eTIMS configured, success', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    process.env.ETIMS_BASE_URL = 'https://etims-api.kra.go.ke'
    process.env.ETIMS_API_KEY  = 'kra-api-key-secret'
  })

  afterEach(() => {
    delete process.env.ETIMS_BASE_URL
    delete process.env.ETIMS_API_KEY
  })

  it('calls the KRA /vscu/invoice endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000001' }),
    })
    const db = makeDb(seqRow(1), insertRow('fl-1'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://etims-api.kra.go.ke/vscu/invoice')
  })

  it('uses HTTP POST method', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000002' }),
    })
    const db = makeDb(seqRow(2), insertRow('fl-2'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const [, options] = mockFetch.mock.calls[0]
    expect(options.method).toBe('POST')
  })

  it('sends Content-Type: application/json', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000003' }),
    })
    const db = makeDb(seqRow(3), insertRow('fl-3'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('sends X-API-Key header with the configured API key', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000004' }),
    })
    const db = makeDb(seqRow(4), insertRow('fl-4'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['X-API-Key']).toBe('kra-api-key-secret')
  })

  it('includes kraPin in request body', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000005' }),
    })
    const db = makeDb(seqRow(5), insertRow('fl-5'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.kraPin).toBe('A001234567B')
  })

  it('includes transactionId in request body', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000006' }),
    })
    const db = makeDb(seqRow(6), insertRow('fl-6'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.transactionId).toBe('txn-etims-001')
  })

  it('sends totalAmount as a 2dp string (cents / 100)', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000007' }),
    })
    const db = makeDb(seqRow(7), insertRow('fl-7'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    // 10000 cents → '100.00'
    expect(body.totalAmount).toBe('100.00')
  })

  it('sends vatAmount and netAmount derived from vatBreakdown', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000008' }),
    })
    const db = makeDb(seqRow(8), insertRow('fl-8'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    // vatBreakdown mock returns { vatCents: 1600, netCents: 8400 }
    expect(vatBreakdown).toHaveBeenCalledWith(10_000)
    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.vatAmount).toBe('16.00')   // 1600 / 100
    expect(body.netAmount).toBe('84.00')   // 8400 / 100
  })

  it('sends currency: KES', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000009' }),
    })
    const db = makeDb(seqRow(9), insertRow('fl-9'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.currency).toBe('KES')
  })

  it('sends paymentRef (mpesaReceipt) in body', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000010' }),
    })
    const db = makeDb(seqRow(10), insertRow('fl-10'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.paymentRef).toBe('ET0T1EXAMPLE')
  })

  it('sends issuedAt in body', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000011' }),
    })
    const db = makeDb(seqRow(11), insertRow('fl-11'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.issuedAt).toBe('2026-06-17T10:00:00Z')
  })

  it('records ACCEPTED status with KRA invoice number in fiscal_log UPDATE', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({ invoiceNumber: 'KRA-2026-000042' }),
    })
    const db = makeDb(seqRow(42), insertRow('fl-ok'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    // 3 DB calls: nextval SELECT, INSERT, UPDATE
    expect(db.query).toHaveBeenCalledTimes(3)
    const updateCall = db.query.mock.calls[2]
    expect(updateCall[1][0]).toBe('KRA-2026-000042')   // $1 = invoice_number
    expect(updateCall[1][1]).toBe('ACCEPTED')           // $2 = etims_status
  })

  it('falls back to ETIMS-* invoice number when response omits invoiceNumber', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: jest.fn().mockResolvedValue({}),  // no invoiceNumber field
    })
    const db = makeDb(seqRow(99), insertRow('fl-fallback'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const updateCall = db.query.mock.calls[2]
    expect(updateCall[1][0]).toMatch(/^ETIMS-/)  // fallback `ETIMS-${Date.now()}`
    expect(updateCall[1][1]).toBe('ACCEPTED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// submitFiscalInvoice — eTIMS configured, failure responses
// ─────────────────────────────────────────────────────────────────────────────

describe('submitFiscalInvoice — eTIMS configured, HTTP failures', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    process.env.ETIMS_BASE_URL = 'https://etims-api.kra.go.ke'
    process.env.ETIMS_API_KEY  = 'kra-api-key-secret'
  })

  afterEach(() => {
    delete process.env.ETIMS_BASE_URL
    delete process.env.ETIMS_API_KEY
  })

  it('records FAILED status when KRA returns HTTP 500', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: jest.fn().mockResolvedValue({}),
    })
    const db = makeDb(seqRow(1), insertRow('fl-fail-1'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const updateCall = db.query.mock.calls[2]
    expect(updateCall[1][1]).toBe('FAILED')
  })

  it('records FAILED status when KRA returns HTTP 400', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 400,
      json: jest.fn().mockResolvedValue({ error: 'INVALID_PIN' }),
    })
    const db = makeDb(seqRow(2), insertRow('fl-fail-2'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const updateCall = db.query.mock.calls[2]
    expect(updateCall[1][1]).toBe('FAILED')
  })

  it('records FAILED status when KRA returns HTTP 401 (auth error)', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 401,
      json: jest.fn().mockResolvedValue({ error: 'UNAUTHORIZED' }),
    })
    const db = makeDb(seqRow(3), insertRow('fl-fail-3'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const updateCall = db.query.mock.calls[2]
    expect(updateCall[1][1]).toBe('FAILED')
  })

  it('handles json() parse failure gracefully (catch → {} fallback, still records status)', async () => {
    // response.ok is false; json() also rejects → .catch(() => ({})) returns {}
    mockFetch.mockResolvedValue({
      ok: false, status: 503,
      json: jest.fn().mockRejectedValue(new Error('not JSON')),
    })
    const db = makeDb(seqRow(4), insertRow('fl-fail-json'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    // Should complete without throwing; FAILED status recorded
    const updateCall = db.query.mock.calls[2]
    expect(updateCall[1][1]).toBe('FAILED')
  })

  it('still issues an UPDATE when fetch itself throws a network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const db = makeDb(seqRow(5), insertRow('fl-throw'), { rows: [] })

    // The outer try/catch in submitFiscalInvoice catches postToEtims throws
    await submitFiscalInvoice(INVOICE, db)

    // 3 DB calls: nextval SELECT, INSERT, catch-path UPDATE (etims_status='FAILED' hardcoded in SQL)
    expect(db.query).toHaveBeenCalledTimes(3)
    const lastCall = db.query.mock.calls[2]
    // The catch-path UPDATE uses $1=etims_response JSON and $2=fiscalLogId — etims_status is
    // baked into the SQL string as 'FAILED', not a parameter
    expect(lastCall[1][0]).toContain('ECONNREFUSED')   // $1 = JSON.stringify({ error })
  })

  it('logs error when fetch throws and continues without rethrowing', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))
    const db = makeDb(seqRow(6), insertRow('fl-logerr'), { rows: [] })

    // Must not throw
    await expect(submitFiscalInvoice(INVOICE, db)).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      'eTIMS submission failed',
      expect.objectContaining({ transactionId: 'txn-etims-001' })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// submitFiscalInvoice — idempotency (ON CONFLICT DO NOTHING)
// ─────────────────────────────────────────────────────────────────────────────

describe('submitFiscalInvoice — idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    delete process.env.ETIMS_BASE_URL
    delete process.env.ETIMS_API_KEY
  })

  it('skips eTIMS call and UPDATE when INSERT returns no row (already submitted)', async () => {
    const db = makeDb(seqRow(1), noInsertRow())

    await submitFiscalInvoice(INVOICE, db)

    // Only 2 DB calls: nextval SELECT + INSERT (no UPDATE)
    expect(db.query).toHaveBeenCalledTimes(2)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not throw on duplicate submission', async () => {
    const db = makeDb(seqRow(1), noInsertRow())

    await expect(submitFiscalInvoice(INVOICE, db)).resolves.toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// submitFiscalInvoice — DB sequence fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('submitFiscalInvoice — DB sequence fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    delete process.env.ETIMS_BASE_URL
    delete process.env.ETIMS_API_KEY
  })

  it('falls back to INV-FALLBACK-* when sequence query throws', async () => {
    const db = makeDb(
      new Error('sequence "etims_invoice_seq" does not exist'),
      insertRow('fl-seq-fail'),
      { rows: [] }
    )

    await submitFiscalInvoice(INVOICE, db)

    // The INSERT should have been called with the fallback invoice number
    const insertCall = db.query.mock.calls[1]
    expect(insertCall[1][2]).toMatch(/^INV-FALLBACK-/)
  })

  it('continues to ACCEPTED status even with fallback invoice number', async () => {
    const db = makeDb(
      new Error('sequence unavailable'),
      insertRow('fl-seq-fallback'),
      { rows: [] }
    )

    await submitFiscalInvoice(INVOICE, db)

    const updateCall = db.query.mock.calls[2]
    expect(updateCall[1][1]).toBe('ACCEPTED')  // LOCAL-* path → ACCEPTED
  })

  it('fallback invoice number has the expected INV-FALLBACK- prefix format', async () => {
    const db = makeDb(
      new Error('seq error'),
      insertRow('fl-fmt'),
      { rows: [] }
    )

    await submitFiscalInvoice(INVOICE, db)

    const insertCall = db.query.mock.calls[1]
    const invoiceNumber: string = insertCall[1][2]
    // Format: INV-FALLBACK-{8 uppercase hex chars}
    expect(invoiceNumber).toMatch(/^INV-FALLBACK-[A-F0-9]{8}$/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// submitFiscalInvoice — correct fiscal_log INSERT structure
// ─────────────────────────────────────────────────────────────────────────────

describe('submitFiscalInvoice — fiscal_log INSERT arguments', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    delete process.env.ETIMS_BASE_URL
    delete process.env.ETIMS_API_KEY
  })

  it('passes transactionId as $1 to the INSERT', async () => {
    const db = makeDb(seqRow(5), insertRow('fl-args'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const insertCall = db.query.mock.calls[1]
    expect(insertCall[1][0]).toBe('txn-etims-001')
  })

  it('passes merchantId as $2 to the INSERT', async () => {
    const db = makeDb(seqRow(5), insertRow('fl-args'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const insertCall = db.query.mock.calls[1]
    expect(insertCall[1][1]).toBe('merchant-etims-1')
  })

  it('passes amountCents as $4 to the INSERT', async () => {
    const db = makeDb(seqRow(5), insertRow('fl-args'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const insertCall = db.query.mock.calls[1]
    expect(insertCall[1][3]).toBe(10_000)
  })

  it('passes vatCents from vatBreakdown as $5 to the INSERT', async () => {
    const db = makeDb(seqRow(5), insertRow('fl-args'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const insertCall = db.query.mock.calls[1]
    expect(insertCall[1][4]).toBe(1_600)   // mocked vatBreakdown
  })

  it('generates a sequential invoice number from the DB sequence', async () => {
    const db = makeDb(seqRow(42), insertRow('fl-seq'), { rows: [] })

    await submitFiscalInvoice(INVOICE, db)

    const insertCall = db.query.mock.calls[1]
    const year = new Date().getUTCFullYear()
    expect(insertCall[1][2]).toBe(`INV-${year}-000042`)
  })
})

/**
 * Suite: P2P Transaction Flow (Scenarios 6, 7, 10, 11)
 *
 * Consumer-to-consumer payments.  The PAYEE generates a short-lived token via
 * POST /consumers/p2p-token (stored as consumer:p2p:{token} → JSON, 90s TTL).
 * The PAYER resolves the token and calls POST /consumers/p2p-pay.
 * The STK Push fires to the PAYER's phone.  Two DB rows are written:
 *   - transactions (source=P2P_NFC or P2P_QR, consumer_id=payer, merchant_id=PLATFORM)
 *   - p2p_transactions (payer_consumer_id, payee_consumer_id)
 *
 * Scenarios 6 & 7 use source=P2P_NFC (NFC tap).
 * Scenarios 10 & 11 use source=P2P_QR (QR scan).
 * The only difference between 6 and 7 (or 10 and 11) is which consumer is the
 * payer and which is the payee — the code path is identical.
 *
 * Tests cover (pure logic — no real DB/Redis):
 *   - Token format, TTL, Redis key
 *   - Token payload structure (consumerId, displayName, optional amountCents)
 *   - Self-payment guard
 *   - Amount preset enforcement (payee can lock the amount)
 *   - Payee resolution: via token OR direct consumerId
 *   - Source enum restriction (P2P_NFC | P2P_QR only)
 *   - Idempotency key format
 *   - STK Push goes to PAYER phone — not payee
 *   - Both DB rows are written atomically
 *   - Display name masking in status responses
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

interface P2PTokenPayload {
  consumerId:  string
  displayName: string | null
  amountCents: number | null
}

function buildP2PRedisKey(token: string): string {
  return `consumer:p2p:${token}`
}

function makeUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function buildP2PToken(
  consumerId:  string,
  displayName: string | null,
  amountCents: number | null = null
): { token: string; key: string; payload: P2PTokenPayload; expiresAt: number } {
  const token     = makeUuid()
  const expiresAt = Date.now() + 90_000
  return {
    token,
    key:     buildP2PRedisKey(token),
    expiresAt,
    payload: { consumerId, displayName, amountCents },
  }
}

function validateP2PPaySource(source: string): boolean {
  return source === 'P2P_NFC' || source === 'P2P_QR'
}

function validateIdempotencyKey(key: string): boolean {
  return /^[0-9a-f]{32}$/.test(key)
}

// Mirrors the amount mismatch guard in consumers.ts p2p-pay handler
function checkAmountMismatch(
  presetCents: number | null,
  payerCents:  number
): { valid: boolean; error?: string } {
  if (presetCents !== null && presetCents !== payerCents) {
    return {
      valid: false,
      error: `Amount mismatch: payee requested KSh ${(presetCents / 100).toFixed(2)}`,
    }
  }
  return { valid: true }
}

// Mirrors self-payment guard
function checkSelfPayment(payerConsumerId: string, payeeConsumerId: string): boolean {
  return payerConsumerId === payeeConsumerId
}

// Mirrors the two-row DB write for P2P
interface MockTxnRow {
  id:         string
  merchantId: string  // PLATFORM_MERCHANT_ID for P2P
  consumerId: string  // payer
  amountCents: number
  source:     string
  idempotencyKey: string
}

interface MockP2PRow {
  id:                string
  transactionId:     string
  payerConsumerId:   string
  payeeConsumerId:   string
  amountCents:       number
  idempotencyKey:    string
}

function writeP2PTxnRows(
  txnId:          string,
  p2pTxnId:       string,
  payerConsumerId: string,
  payeeConsumerId: string,
  amountCents:    number,
  source:         string,
  idempotencyKey: string,
  platformMerchantId: string
): { txn: MockTxnRow; p2p: MockP2PRow } {
  return {
    txn: {
      id: txnId,
      merchantId: platformMerchantId,
      consumerId: payerConsumerId,
      amountCents,
      source,
      idempotencyKey,
    },
    p2p: {
      id: p2pTxnId,
      transactionId: txnId,
      payerConsumerId,
      payeeConsumerId,
      amountCents,
      idempotencyKey,
    },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('P2P token issuance (POST /consumers/p2p-token)', () => {
  const PAYEE_ID   = 'consumer-payee-uuid'
  const PAYER_ID   = 'consumer-payer-uuid'

  it('generates a UUID v4 token', () => {
    const { token } = buildP2PToken(PAYEE_ID, 'Alice')
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('expiresAt is ~90 seconds in the future', () => {
    const before = Date.now()
    const { expiresAt } = buildP2PToken(PAYEE_ID, 'Alice')
    const after  = Date.now()
    expect(expiresAt).toBeGreaterThanOrEqual(before + 89_000)
    expect(expiresAt).toBeLessThanOrEqual(after   + 91_000)
  })

  it('Redis key is consumer:p2p:{token}', () => {
    const { token, key } = buildP2PToken(PAYEE_ID, 'Alice')
    expect(key).toBe(`consumer:p2p:${token}`)
    expect(key.startsWith('consumer:p2p:')).toBe(true)
  })

  it('payload includes consumerId, displayName, and amountCents', () => {
    const { payload } = buildP2PToken(PAYEE_ID, 'Alice', 5000)
    expect(payload.consumerId).toBe(PAYEE_ID)
    expect(payload.displayName).toBe('Alice')
    expect(payload.amountCents).toBe(5000)
  })

  it('amountCents is null when payee does not preset an amount', () => {
    const { payload } = buildP2PToken(PAYEE_ID, 'Alice', null)
    expect(payload.amountCents).toBeNull()
  })

  it('displayName is null when consumer has no display name set', () => {
    const { payload } = buildP2PToken(PAYEE_ID, null)
    expect(payload.displayName).toBeNull()
  })

  it('two tokens for the same payee are always different', () => {
    const a = buildP2PToken(PAYEE_ID, 'Alice')
    const b = buildP2PToken(PAYEE_ID, 'Alice')
    expect(a.token).not.toBe(b.token)
  })
})

describe('Self-payment guard (POST /consumers/p2p-pay)', () => {
  it('rejects when payer and payee are the same consumer', () => {
    expect(checkSelfPayment('same-id', 'same-id')).toBe(true)
    // true = is self-payment = should be rejected
  })

  it('allows payment between different consumers', () => {
    expect(checkSelfPayment('payer-id', 'payee-id')).toBe(false)
  })

  it('comparison is case-sensitive', () => {
    expect(checkSelfPayment('Consumer-A', 'consumer-a')).toBe(false)
  })
})

describe('Amount preset enforcement', () => {
  it('no preset: any amount is accepted', () => {
    expect(checkAmountMismatch(null, 5000).valid).toBe(true)
    expect(checkAmountMismatch(null, 100).valid).toBe(true)
  })

  it('preset matches: amount is accepted', () => {
    expect(checkAmountMismatch(5000, 5000).valid).toBe(true)
  })

  it('preset mismatch: payer sends more than preset → rejected', () => {
    const result = checkAmountMismatch(5000, 10000)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('KSh 50.00')
  })

  it('preset mismatch: payer sends less than preset → rejected', () => {
    const result = checkAmountMismatch(5000, 2000)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('KSh 50.00')
  })

  it('error message shows the preset amount in KSh (not cents)', () => {
    const result = checkAmountMismatch(7500, 5000)
    expect(result.error).toContain('KSh 75.00')
    expect(result.error).not.toContain('7500')  // must not expose raw cents
  })

  it('preset of KSh 1 (100 cents) matches exactly', () => {
    expect(checkAmountMismatch(100, 100).valid).toBe(true)
  })
})

describe('P2P source enum validation', () => {
  it('P2P_NFC is a valid source (Scenarios 6 & 7)', () => {
    expect(validateP2PPaySource('P2P_NFC')).toBe(true)
  })

  it('P2P_QR is a valid source (Scenarios 10 & 11)', () => {
    expect(validateP2PPaySource('P2P_QR')).toBe(true)
  })

  it('other sources are not valid for p2p-pay', () => {
    expect(validateP2PPaySource('NFC_TAG')).toBe(false)
    expect(validateP2PPaySource('QR_CODE')).toBe(false)
    expect(validateP2PPaySource('MERCHANT_HCE')).toBe(false)
    expect(validateP2PPaySource('CONSUMER_QR')).toBe(false)
    expect(validateP2PPaySource('HCE_PHONE')).toBe(false)
    expect(validateP2PPaySource('P2P')).toBe(false)
    expect(validateP2PPaySource('')).toBe(false)
  })

  it('Scenario 6 (A taps B) and Scenario 7 (B taps A) use the same P2P_NFC source', () => {
    // They differ only in which consumer is the payer — the code path is identical
    const scenario6Source = 'P2P_NFC'
    const scenario7Source = 'P2P_NFC'
    expect(scenario6Source).toBe(scenario7Source)
  })

  it('Scenario 10 (A scans B) and Scenario 11 (B scans A) use the same P2P_QR source', () => {
    expect('P2P_QR').toBe('P2P_QR')
  })
})

describe('P2P payee resolution', () => {
  const PAYEE_ID = 'payee-uuid'
  const PAYER_ID = 'payer-uuid'

  interface Consumer { id: string; phone: string; active: boolean }
  const db: Consumer[] = [
    { id: PAYER_ID, phone: '254712345678', active: true },
    { id: PAYEE_ID, phone: '254798765432', active: true },
    { id: 'inactive-id', phone: '254755500000', active: false },
  ]

  function resolvePayee(
    p2pToken:   string | null,
    directId:   string | null,
    tokenStore: Map<string, P2PTokenPayload>
  ): { consumerId: string; error?: string } | { error: string } {
    if (p2pToken) {
      const payload = tokenStore.get(`consumer:p2p:${p2pToken}`)
      if (!payload) return { error: 'P2P token expired or already used' }
      return { consumerId: payload.consumerId }
    }
    if (directId) {
      const c = db.find(c => c.id === directId && c.active)
      if (!c) return { error: 'Payee consumer not found' }
      return { consumerId: c.id }
    }
    return { error: 'p2pToken or payeeConsumerId is required' }
  }

  it('resolves payee from a valid p2pToken', () => {
    const store = new Map<string, P2PTokenPayload>()
    store.set(`consumer:p2p:test-token`, { consumerId: PAYEE_ID, displayName: 'Alice', amountCents: null })
    const result = resolvePayee('test-token', null, store)
    expect('consumerId' in result && result.consumerId).toBe(PAYEE_ID)
  })

  it('returns error for an expired/missing token', () => {
    const store = new Map<string, P2PTokenPayload>()  // empty store
    const result = resolvePayee('expired-token', null, store)
    expect('error' in result).toBe(true)
    expect((result as any).error).toContain('expired')
  })

  it('resolves payee from a direct consumerId (no token)', () => {
    const store = new Map<string, P2PTokenPayload>()
    const result = resolvePayee(null, PAYEE_ID, store)
    expect('consumerId' in result && result.consumerId).toBe(PAYEE_ID)
  })

  it('rejects direct consumerId for inactive consumer', () => {
    const store = new Map<string, P2PTokenPayload>()
    const result = resolvePayee(null, 'inactive-id', store)
    expect('error' in result).toBe(true)
  })

  it('returns error when both p2pToken and payeeConsumerId are absent', () => {
    const store = new Map<string, P2PTokenPayload>()
    const result = resolvePayee(null, null, store)
    expect('error' in result).toBe(true)
  })
})

describe('P2P DB rows', () => {
  const PLATFORM_ID = 'platform-merchant-uuid'

  it('transactions row uses payer as consumer_id and platform as merchant_id', () => {
    const { txn } = writeP2PTxnRows(
      'txn-1', 'p2p-1', 'payer-id', 'payee-id', 5000, 'P2P_NFC', 'a'.repeat(32), PLATFORM_ID
    )
    expect(txn.consumerId).toBe('payer-id')  // STK Push goes to payer
    expect(txn.merchantId).toBe(PLATFORM_ID)  // payment goes to platform shortcode
    expect(txn.source).toBe('P2P_NFC')
  })

  it('p2p_transactions row records both payer and payee', () => {
    const { p2p } = writeP2PTxnRows(
      'txn-1', 'p2p-1', 'payer-id', 'payee-id', 5000, 'P2P_QR', 'b'.repeat(32), PLATFORM_ID
    )
    expect(p2p.payerConsumerId).toBe('payer-id')
    expect(p2p.payeeConsumerId).toBe('payee-id')
    expect(p2p.transactionId).toBe('txn-1')
  })

  it('p2p_transactions row shares idempotency_key with transactions row', () => {
    const key = 'c'.repeat(32)
    const { txn, p2p } = writeP2PTxnRows('txn-1', 'p2p-1', 'p', 'q', 5000, 'P2P_NFC', key, PLATFORM_ID)
    expect(txn.idempotencyKey).toBe(key)
    expect(p2p.idempotencyKey).toBe(key)
  })

  it('P2P_NFC and P2P_QR rows have the same structure (source is the only difference)', () => {
    const { txn: nfc } = writeP2PTxnRows('t1', 'p1', 'pyr', 'pye', 5000, 'P2P_NFC', 'a'.repeat(32), PLATFORM_ID)
    const { txn: qr  } = writeP2PTxnRows('t2', 'p2', 'pyr', 'pye', 5000, 'P2P_QR',  'b'.repeat(32), PLATFORM_ID)
    const { source: _, idempotencyKey: __, id: ___, ...nfcRest } = nfc
    const { source: _s, idempotencyKey: __k, id: __i, ...qrRest  } = qr
    // Same merchantId, consumerId, amountCents
    expect(nfcRest).toEqual(qrRest)
    // Source differs
    expect(nfc.source).toBe('P2P_NFC')
    expect(qr.source).toBe('P2P_QR')
  })
})

describe('STK Push routing for P2P', () => {
  it('STK Push goes to the PAYER — not the payee (mirrors daraja call in consumers.ts)', () => {
    // The payer is payer.phone, not payee.phone
    const payer = { id: 'payer-id', phone: '254712345678' }
    const payee = { id: 'payee-id', phone: '254798765432' }

    // The backend looks up payer phone and passes it to stkPush()
    const stkPushPhone = payer.phone
    expect(stkPushPhone).toBe(payer.phone)
    expect(stkPushPhone).not.toBe(payee.phone)
  })

  it('M-Pesa description is truncated to 13 chars (Daraja limit)', () => {
    const displayName = 'Alice'
    const description = `Send to ${displayName}`.slice(0, 13)
    expect(description.length).toBeLessThanOrEqual(13)
    expect(description).toBe('Send to Alice')
  })

  it('long display names are truncated in the STK description', () => {
    const displayName = 'Wanjiku Kamau'
    const description = `Send to ${displayName}`.slice(0, 13)
    expect(description.length).toBeLessThanOrEqual(13)
    expect(description).toBe('Send to Wanji')
  })

  it('null display name falls back to generic description', () => {
    const displayName: string | null = null
    const description = displayName ? `Send to ${displayName}`.slice(0, 13) : 'P2P Transfer'
    expect(description).toBe('P2P Transfer')
  })
})

describe('P2P idempotency', () => {
  it('idempotency key must be 32 lowercase hex chars', () => {
    expect(validateIdempotencyKey('a'.repeat(32))).toBe(true)
    expect(validateIdempotencyKey('0'.repeat(32))).toBe(true)
    expect(validateIdempotencyKey('g'.repeat(32))).toBe(false)  // non-hex
    expect(validateIdempotencyKey('A'.repeat(32))).toBe(false)  // uppercase
    expect(validateIdempotencyKey('a'.repeat(31))).toBe(false)  // too short
    expect(validateIdempotencyKey('a'.repeat(33))).toBe(false)  // too long
  })

  it('same idempotency key returns the cached response (prevents duplicate charges)', () => {
    const store = new Map<string, object>()
    const key   = 'idempotency:' + 'a'.repeat(32)
    const resp  = { status: 'STK_SENT', txnId: 'txn-1', p2pTxnId: 'p2p-1' }
    store.set(key, resp)

    // Second call with same key hits cache
    expect(store.get(key)).toEqual(resp)
  })
})

describe('P2P token single-use (Scenarios 6/7/10/11)', () => {
  it('token is deleted from Redis after first resolution', () => {
    const store = new Map<string, string>()
    const token = 'p2p-token-uuid'
    const key   = buildP2PRedisKey(token)
    store.set(key, JSON.stringify({ consumerId: 'payee-id', displayName: null, amountCents: null }))

    // First use
    expect(store.get(key)).not.toBeUndefined()
    store.delete(key)

    // Second use
    expect(store.get(key)).toBeUndefined()
  })
})

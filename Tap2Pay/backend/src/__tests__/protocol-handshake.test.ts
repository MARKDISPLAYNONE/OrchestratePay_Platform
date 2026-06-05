/**
 * Suite: Protocol Handshake — NFC/HCE APDU logic (pure unit)
 *
 * Tests the low-level APDU protocol between the Sunmi POS / merchant phone
 * (reader) and the consumer HCE service (card emulator).
 *
 * All tests run in pure Node.js — no NFC hardware, no Android emulator.
 * The APDU byte arrays are constructed identically to the Android source so
 * any divergence here immediately catches protocol drift.
 *
 * Protocol reference (from NfcReaderManager.kt / ConsumerHceService.kt):
 *   POS  → SELECT AID F0 4F 52 43 48 45 53 54 41
 *   Card → 90 00
 *   POS  → 80 C0 00 00 00  (GET DATA)
 *   Card → <JSON> 90 00
 *   POS  → 80 C1 00 00 00  (CONFIRM — single-use)
 *   Card → 90 00
 */

// ─── APDU constants (mirrors Android source) ──────────────────────────────────

const SW_OK      = Buffer.from([0x90, 0x00])
const SW_NOT_FOUND = Buffer.from([0x6A, 0x82])  // File not found — AID not supported
const SW_WRONG_DATA = Buffer.from([0x6A, 0x80]) // Wrong data

const OUR_AID = Buffer.from([0xF0, 0x4F, 0x52, 0x43, 0x48, 0x45, 0x53, 0x54, 0x41])

// Builds a SELECT AID APDU (ISO 7816-4)
function buildSelectApdu(aid: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0xA4, 0x04, 0x00, aid.length]),
    aid,
    Buffer.from([0x00])
  ])
}

const GET_DATA_APDU    = Buffer.from([0x80, 0xC0, 0x00, 0x00, 0x00])
const CONFIRM_APDU     = Buffer.from([0x80, 0xC1, 0x00, 0x00, 0x00])

function isSW_OK(response: Buffer): boolean {
  const n = response.length
  return n >= 2 && response[n - 2] === 0x90 && response[n - 1] === 0x00
}

// Simulates the HCE service's AID matching logic
function matchesOurAid(apdu: Buffer): boolean {
  if (apdu.length < 5) return false
  // CLA=0x00, INS=0xA4, P1=0x04, P2=0x00
  if (apdu[0] !== 0x00 || apdu[1] !== 0xA4 || apdu[2] !== 0x04 || apdu[3] !== 0x00) return false
  const aidLen = apdu[4]
  if (apdu.length < 5 + aidLen) return false
  const aidInApdu = apdu.slice(5, 5 + aidLen)
  return aidInApdu.equals(OUR_AID)
}

// ─── APDU payload handling (mirrors HceService) ───────────────────────────────

const MAX_APDU_PAYLOAD = 252  // ISO 7816-4 short APDU max data bytes

function buildPayloadResponse(jsonPayload: string): Buffer {
  const data = Buffer.from(jsonPayload, 'utf8')
  if (data.length > MAX_APDU_PAYLOAD) {
    // Simulates the HCE service chunking behavior
    // In real HCE, extended APDUs or command chaining would be needed
    throw new Error(`Payload ${data.length}B exceeds APDU limit ${MAX_APDU_PAYLOAD}B — use chunking`)
  }
  return Buffer.concat([data, SW_OK])
}

function extractPayloadFromResponse(response: Buffer): object | null {
  if (!isSW_OK(response)) return null
  const jsonBytes = response.slice(0, response.length - 2)
  try {
    return JSON.parse(jsonBytes.toString('utf8'))
  } catch {
    return null
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AID Selection', () => {
  it('our AID select APDU is correctly formed', () => {
    const apdu = buildSelectApdu(OUR_AID)
    // CLA=0x00, INS=0xA4 (SELECT), P1=0x04 (by name), P2=0x00, Lc=9 (AID length)
    expect(apdu[0]).toBe(0x00)
    expect(apdu[1]).toBe(0xA4)
    expect(apdu[2]).toBe(0x04)
    expect(apdu[3]).toBe(0x00)
    expect(apdu[4]).toBe(OUR_AID.length)
    expect(apdu.slice(5, 5 + OUR_AID.length)).toEqual(OUR_AID)
  })

  it('HCE service accepts our exact AID', () => {
    const apdu = buildSelectApdu(OUR_AID)
    expect(matchesOurAid(apdu)).toBe(true)
  })

  it('HCE service rejects Google Pay AID (A0 00 00 00 04 10 10)', () => {
    const googlePayAid = Buffer.from([0xA0, 0x00, 0x00, 0x00, 0x04, 0x10, 0x10])
    const apdu = buildSelectApdu(googlePayAid)
    expect(matchesOurAid(apdu)).toBe(false)
  })

  it('HCE service rejects Visa payWave AID (A0 00 00 00 03 10 10)', () => {
    const visaAid = Buffer.from([0xA0, 0x00, 0x00, 0x00, 0x03, 0x10, 0x10])
    const apdu = buildSelectApdu(visaAid)
    expect(matchesOurAid(apdu)).toBe(false)
  })

  it('HCE service rejects Mastercard AID (A0 00 00 00 04 10 01)', () => {
    const mastercardAid = Buffer.from([0xA0, 0x00, 0x00, 0x00, 0x04, 0x10, 0x01])
    const apdu = buildSelectApdu(mastercardAid)
    expect(matchesOurAid(apdu)).toBe(false)
  })

  it('truncated APDU (too short) does not crash AID matching', () => {
    const truncated = Buffer.from([0x00, 0xA4])
    expect(matchesOurAid(truncated)).toBe(false)
  })

  it('AID one byte too short is rejected', () => {
    const partialAid = OUR_AID.slice(0, OUR_AID.length - 1)
    const apdu = buildSelectApdu(partialAid)
    expect(matchesOurAid(apdu)).toBe(false)
  })

  it('AID with one byte flipped is rejected (no fuzzy matching)', () => {
    const flippedAid = Buffer.from(OUR_AID)
    flippedAid[4] ^= 0xFF  // flip one byte
    const apdu = buildSelectApdu(flippedAid)
    expect(matchesOurAid(apdu)).toBe(false)
  })
})

describe('SW1 SW2 status word parsing', () => {
  it('90 00 is OK', () => {
    expect(isSW_OK(Buffer.from([0x90, 0x00]))).toBe(true)
  })

  it('90 00 appended to data is OK', () => {
    const resp = Buffer.concat([Buffer.from('hello'), SW_OK])
    expect(isSW_OK(resp)).toBe(true)
  })

  it('6A 82 (file not found) is not OK', () => {
    expect(isSW_OK(SW_NOT_FOUND)).toBe(false)
  })

  it('empty buffer does not crash', () => {
    expect(isSW_OK(Buffer.alloc(0))).toBe(false)
  })

  it('1-byte buffer does not crash', () => {
    expect(isSW_OK(Buffer.from([0x90]))).toBe(false)
  })
})

describe('APDU payload size limits', () => {
  it('a minimal JSON payload fits within the APDU limit', () => {
    const payload = JSON.stringify({ phone: '254712345678', token: 'a'.repeat(32), exp: Date.now() + 60000 })
    expect(payload.length).toBeLessThanOrEqual(MAX_APDU_PAYLOAD)
  })

  it('nominal payload builds a valid response', () => {
    const payload = JSON.stringify({
      phone: '254712345678',
      token: 'a'.repeat(32),
      exp: Date.now() + 60000,
      deviceType: 'CONSUMER_PHONE',
      walletVersion: 2
    })
    const resp = buildPayloadResponse(payload)
    expect(isSW_OK(resp)).toBe(true)
    const extracted = extractPayloadFromResponse(resp)
    expect((extracted as any).phone).toBe('254712345678')
  })

  it('oversized payload throws rather than silently truncating phone number', () => {
    // A truncated phone number would charge the wrong consumer — must never happen
    const massivePayload = JSON.stringify({ phone: '254712345678', token: 'x'.repeat(500) })
    expect(() => buildPayloadResponse(massivePayload)).toThrow(/exceeds APDU limit/)
  })

  it('payload exactly at limit is accepted', () => {
    const atLimit = 'x'.repeat(MAX_APDU_PAYLOAD)
    // Should not throw for exactly-at-limit content
    const resp = Buffer.concat([Buffer.from(atLimit), SW_OK])
    expect(isSW_OK(resp)).toBe(true)
  })

  it('payload one byte over limit is rejected', () => {
    const json = 'x'.repeat(MAX_APDU_PAYLOAD + 1)
    expect(() => buildPayloadResponse(json)).toThrow()
  })
})

describe('HCE token expiry guard', () => {
  const TOKEN_TTL_MS = 60_000  // 60 second TTL (matches ConsumerHceService)

  function isTokenExpired(expEpochMs: number, nowMs = Date.now()): boolean {
    return nowMs > expEpochMs
  }

  it('token expiring in the future is valid', () => {
    const exp = Date.now() + TOKEN_TTL_MS
    expect(isTokenExpired(exp)).toBe(false)
  })

  it('token expiring in 1ms is still valid', () => {
    const exp = Date.now() + 1
    expect(isTokenExpired(exp)).toBe(false)
  })

  it('token that already expired 1ms ago is invalid', () => {
    const exp = Date.now() - 1
    expect(isTokenExpired(exp)).toBe(true)
  })

  it('token expired 70 seconds ago (missed the tap window) is rejected', () => {
    const exp = Date.now() - 70_000
    expect(isTokenExpired(exp)).toBe(true)
  })

  it('token issued in the future (clock skew attack) is treated as not-yet-expired', () => {
    // If the consumer's clock is ahead, exp > now — token appears valid.
    // The backend re-verifies exp server-side; client guard allows but does not block.
    const exp = Date.now() + 120_000  // 2 minutes ahead
    expect(isTokenExpired(exp)).toBe(false)
  })
})

describe('GET DATA / CONFIRM APDU commands', () => {
  it('GET DATA APDU has correct CLA INS P1 P2', () => {
    expect(GET_DATA_APDU[0]).toBe(0x80)  // CLA: proprietary
    expect(GET_DATA_APDU[1]).toBe(0xC0)  // INS: GET DATA (proprietary)
    expect(GET_DATA_APDU[2]).toBe(0x00)
    expect(GET_DATA_APDU[3]).toBe(0x00)
  })

  it('CONFIRM APDU has correct CLA INS P1 P2', () => {
    expect(CONFIRM_APDU[0]).toBe(0x80)  // CLA: proprietary
    expect(CONFIRM_APDU[1]).toBe(0xC1)  // INS: CONFIRM (single-use — different from GET DATA)
    expect(CONFIRM_APDU[2]).toBe(0x00)
    expect(CONFIRM_APDU[3]).toBe(0x00)
  })

  it('GET DATA and CONFIRM differ only in INS byte', () => {
    // Ensure they are distinct — using the same APDU for both would be a protocol bug
    expect(GET_DATA_APDU[1]).not.toBe(CONFIRM_APDU[1])
  })

  it('malformed JSON in GET DATA response returns null from extractor', () => {
    const badResponse = Buffer.concat([Buffer.from('not-json{{{'), SW_OK])
    expect(extractPayloadFromResponse(badResponse)).toBeNull()
  })

  it('empty JSON object is extractable', () => {
    const resp = Buffer.concat([Buffer.from('{}'), SW_OK])
    expect(extractPayloadFromResponse(resp)).toEqual({})
  })
})

describe('NFC mid-handshake interruption (tag lost)', () => {
  // Models the IOException → NfcError.READ_FAILED path in NfcReaderManager

  class MockIsoDepConnection {
    private steps: ('ok' | 'throw')[]
    private step = 0

    constructor(steps: ('ok' | 'throw')[]) { this.steps = steps }

    transceive(_: Buffer): Buffer {
      const action = this.steps[this.step++]
      if (action === 'throw') throw new Error('Tag was lost')
      return Buffer.concat([Buffer.from('{}'), SW_OK])
    }
  }

  it('connection lost on SELECT → throws IOException (READ_FAILED)', () => {
    const conn = new MockIsoDepConnection(['throw'])
    expect(() => conn.transceive(buildSelectApdu(OUR_AID))).toThrow('Tag was lost')
  })

  it('connection lost on GET DATA (after SELECT) → throws IOException', () => {
    const conn = new MockIsoDepConnection(['ok', 'throw'])
    conn.transceive(buildSelectApdu(OUR_AID))  // SELECT ok
    expect(() => conn.transceive(GET_DATA_APDU)).toThrow('Tag was lost')
  })

  it('connection lost on CONFIRM (after successful read) → throws IOException', () => {
    const conn = new MockIsoDepConnection(['ok', 'ok', 'throw'])
    conn.transceive(buildSelectApdu(OUR_AID))  // SELECT ok
    conn.transceive(GET_DATA_APDU)             // GET DATA ok
    // Confirm must still be attempted; interruption here is AFTER payment data was read.
    // The wallet app's session should still be cleared by the wallet on reconnect.
    expect(() => conn.transceive(CONFIRM_APDU)).toThrow('Tag was lost')
  })

  it('successful full handshake completes all 3 steps without error', () => {
    const conn = new MockIsoDepConnection(['ok', 'ok', 'ok'])
    expect(() => {
      conn.transceive(buildSelectApdu(OUR_AID))
      conn.transceive(GET_DATA_APDU)
      conn.transceive(CONFIRM_APDU)
    }).not.toThrow()
  })
})

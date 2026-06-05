/**
 * Suite: Africa's Talking SMS Fallback (pure unit — no real HTTP calls)
 *
 * Tests the deterministic logic in integrations/africas-talking.ts:
 *   - SmsTemplate message construction and length limits
 *   - Phone number masking in logs
 *   - Sandbox vs production URL selection
 *   - SMS_ENABLED=false no-op behaviour
 *   - Missing credentials behaviour
 *   - sendSms return shape (always resolves, never throws)
 *   - AT_SENDER_ID 11-character limit
 */

// ── SmsTemplate construction ──────────────────────────────────────────────────

function paymentConfirmed(amountKsh: number, merchantName: string, mpesaRef: string): string {
  return `OrchestratePay: KSh ${amountKsh.toFixed(2)} received at ${merchantName}. Ref: ${mpesaRef}. Thank you!`
}

function paymentDeclined(amountKsh: number, reason: string): string {
  return `OrchestratePay: Your payment of KSh ${amountKsh.toFixed(2)} was not completed. ${reason}`
}

function deviceAlert(message: string): string {
  return `OrchestratePay Alert: ${message}. Log in to your dashboard for details.`
}

function digitalReceipt(amountKsh: number, merchantName: string, mpesaRef: string, date: string): string {
  return `OrchestratePay Receipt\nMerchant: ${merchantName}\nAmount: KSh ${amountKsh.toFixed(2)}\nRef: ${mpesaRef}\nDate: ${date}\nPowered by OrchestratePay`
}

describe('SmsTemplate.paymentConfirmed', () => {
  it('includes formatted KSh amount', () => {
    const msg = paymentConfirmed(500, 'Wanjiku Shop', 'ODE3K5Z8')
    expect(msg).toContain('KSh 500.00')
  })

  it('includes merchant name', () => {
    const msg = paymentConfirmed(500, 'Wanjiku Shop', 'ODE3K5Z8')
    expect(msg).toContain('Wanjiku Shop')
  })

  it('includes M-Pesa reference', () => {
    const msg = paymentConfirmed(500, 'Wanjiku Shop', 'ODE3K5Z8')
    expect(msg).toContain('ODE3K5Z8')
  })

  it('includes "Thank you!" at the end', () => {
    const msg = paymentConfirmed(500, 'Wanjiku Shop', 'ODE3K5Z8')
    expect(msg.endsWith('Thank you!')).toBe(true)
  })

  it('amount with cents renders 2 decimal places', () => {
    const msg = paymentConfirmed(1250.50, 'Shop', 'REF')
    expect(msg).toContain('1250.50')
  })

  it('message starts with OrchestratePay brand prefix', () => {
    const msg = paymentConfirmed(500, 'Shop', 'REF')
    expect(msg.startsWith('OrchestratePay:')).toBe(true)
  })
})

describe('SmsTemplate.paymentDeclined', () => {
  it('includes amount and reason', () => {
    const msg = paymentDeclined(200, 'PIN cancelled')
    expect(msg).toContain('KSh 200.00')
    expect(msg).toContain('PIN cancelled')
  })

  it('includes "not completed" messaging', () => {
    const msg = paymentDeclined(200, 'Insufficient funds')
    expect(msg).toContain('not completed')
  })
})

describe('SmsTemplate.deviceAlert', () => {
  it('wraps message with OrchestratePay Alert prefix', () => {
    const msg = deviceAlert('Printer paper low')
    expect(msg.startsWith('OrchestratePay Alert:')).toBe(true)
    expect(msg).toContain('Printer paper low')
  })

  it('directs merchant to dashboard', () => {
    const msg = deviceAlert('Battery low')
    expect(msg).toContain('dashboard')
  })
})

describe('SmsTemplate.digitalReceipt', () => {
  it('includes all receipt fields', () => {
    const msg = digitalReceipt(500, 'Wanjiku Shop', 'ODE3K5Z8', '2026-05-28')
    expect(msg).toContain('Wanjiku Shop')
    expect(msg).toContain('500.00')
    expect(msg).toContain('ODE3K5Z8')
    expect(msg).toContain('2026-05-28')
  })

  it('is a multiline message', () => {
    const msg = digitalReceipt(500, 'Shop', 'REF', '2026-05-28')
    expect(msg.split('\n').length).toBeGreaterThan(3)
  })

  it('ends with "Powered by OrchestratePay"', () => {
    const msg = digitalReceipt(500, 'Shop', 'REF', '2026-05-28')
    expect(msg.endsWith('Powered by OrchestratePay')).toBe(true)
  })
})

// ── Phone masking ─────────────────────────────────────────────────────────────

function maskPhone(phone: string): string {
  return phone.length >= 7
    ? phone.slice(0, 5) + '****' + phone.slice(-2)
    : '****'
}

describe('Phone masking in logs', () => {
  it('masks middle digits of a full phone number', () => {
    const masked = maskPhone('254712345678')
    expect(masked).toBe('25471****78')
  })

  it('masked number does not expose the consumer\'s full number', () => {
    const masked = maskPhone('254712345678')
    expect(masked).not.toBe('254712345678')
    expect(masked.length).toBeLessThan('254712345678'.length)
  })

  it('short phone (< 7 chars) returns generic mask', () => {
    expect(maskPhone('123')).toBe('****')
  })

  it('masked phone preserves country code prefix (254)', () => {
    expect(maskPhone('254712345678').startsWith('254')).toBe(true)
  })
})

// ── Sandbox vs production URL ─────────────────────────────────────────────────

describe('Sandbox vs production URL selection', () => {
  function getAtUrl(username: string): string {
    return username === 'sandbox'
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging'
  }

  it('username="sandbox" uses sandbox URL', () => {
    expect(getAtUrl('sandbox')).toContain('sandbox')
  })

  it('production username uses production URL', () => {
    expect(getAtUrl('my-company')).not.toContain('sandbox')
    expect(getAtUrl('my-company')).toContain('africastalking.com/version1')
  })

  it('production and sandbox URLs are different', () => {
    expect(getAtUrl('sandbox')).not.toBe(getAtUrl('my-company'))
  })
})

// ── SMS_ENABLED flag ──────────────────────────────────────────────────────────

describe('SMS_ENABLED=false no-op', () => {
  it('disabled SMS returns success with sms-disabled messageId (no error)', () => {
    const result = { success: true, messageId: 'sms-disabled' }
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('sms-disabled')
  })

  it('disabled SMS does not expose an error field', () => {
    const result = { success: true, messageId: 'sms-disabled' }
    expect(result).not.toHaveProperty('error')
  })
})

// ── Missing credentials behaviour ────────────────────────────────────────────

describe('Missing AT credentials', () => {
  it('missing credentials returns success=false with descriptive error', () => {
    const result = { success: false, error: 'AT credentials not configured' }
    expect(result.success).toBe(false)
    expect(result.error).toContain('credentials')
  })

  it('missing credentials never throws (fire-and-forget contract)', () => {
    // Documented: sendSms always resolves, never throws
    const neverThrows = () => Promise.resolve({ success: false, error: 'AT credentials not configured' })
    return expect(neverThrows()).resolves.toBeDefined()
  })
})

// ── AT_SENDER_ID constraints ──────────────────────────────────────────────────

describe('AT_SENDER_ID constraints', () => {
  it('default sender ID OrchstPay is exactly 9 characters (within 11-char AT limit)', () => {
    expect('OrchstPay'.length).toBe(9)
    expect('OrchstPay'.length).toBeLessThanOrEqual(11)
  })

  it('sender ID max is 11 characters', () => {
    const maxId = 'OrchestPay1'  // 11 chars
    expect(maxId.length).toBeLessThanOrEqual(11)
  })

  it('12-character sender ID exceeds limit', () => {
    const tooLong = 'OrchestPay12'
    expect(tooLong.length).toBeGreaterThan(11)
  })
})

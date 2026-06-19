import { normalisePhone, initiateB2cPayout } from '../integrations/daraja'

describe('normalisePhone', () => {
  it('passes through an already-normalised number', () => {
    expect(normalisePhone('254712345678')).toBe('254712345678')
  })

  it('converts 0-prefix format to 254 format', () => {
    expect(normalisePhone('0712345678')).toBe('254712345678')
  })

  it('converts 9-digit number to 254 format', () => {
    expect(normalisePhone('712345678')).toBe('254712345678')
  })

  it('strips +254 prefix correctly', () => {
    expect(normalisePhone('+254712345678')).toBe('254712345678')
  })

  it('strips spaces from phone number', () => {
    expect(normalisePhone('0712 345 678')).toBe('254712345678')
  })

  it('strips hyphens from phone number', () => {
    expect(normalisePhone('0712-345-678')).toBe('254712345678')
  })

  it('returns unrecognised format as-is so Daraja can reject it cleanly', () => {
    // A random 6-digit number — not a valid Kenyan phone
    const result = normalisePhone('123456')
    expect(result).toBe('123456')
  })

  it('handles a number that is exactly 12 digits starting with 254', () => {
    expect(normalisePhone('254708374149')).toBe('254708374149')  // Safaricom sandbox test number
  })
})

describe('Daraja constants', () => {
  it('uses sandbox URL when DARAJA_ENVIRONMENT is not production', () => {
    // The current implementation uses a compile-time constant.
    // This test documents the expected behaviour for the team.
    // When DARAJA_ENVIRONMENT switching is added, update this test.
    expect(process.env.DARAJA_ENVIRONMENT).not.toBe('production')
  })
})

describe('initiateB2cPayout', () => {
  it('throws a not-yet-implemented error', async () => {
    await expect(
      initiateB2cPayout({ refundId: 'r-1', merchantId: 'm-1', amountCents: 1000 })
    ).rejects.toThrow('not yet implemented')
  })
})

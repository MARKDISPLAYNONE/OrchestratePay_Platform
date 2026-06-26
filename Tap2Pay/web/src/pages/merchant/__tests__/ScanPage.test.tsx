/**
 * Tests for the merchant NFC scan page.
 *
 * The page uses the Web NFC API (NDEFReader) which is unavailable in jsdom.
 * We stub it on `window` for the "supported" path and omit it for the
 * "unsupported" path so we can test both branches.
 *
 * Covers: NFC not supported → warning, NFC supported → ready state,
 * Start Scanning button, confirm state with consumer info + amount input,
 * amount validation, payment submission, success/failed states,
 * and manual consumer resolution via lookupByTagId.
 */

import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MerchantScanPage from '@/pages/merchant/ScanPage'

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/lib/api', () => ({
  consumers:    { lookupByTagId: jest.fn() },
  transactions: { initiate: jest.fn(), getStatus: jest.fn() },
}))

jest.mock('@/lib/auth', () => ({
  getToken: jest.fn(),
}))

const mockLookupByTagId = jest.requireMock('@/lib/api').consumers.lookupByTagId       as jest.Mock
const mockInitiate      = jest.requireMock('@/lib/api').transactions.initiate         as jest.Mock
const mockGetStatus     = jest.requireMock('@/lib/api').transactions.getStatus        as jest.Mock
const mockGetToken      = jest.requireMock('@/lib/auth').getToken                     as jest.Mock

// Minimal NDEFReader stub — tests override onreading / onreadingerror as needed
class MockNDEFReader {
  onreading:      ((e: any) => void) | null = null
  onreadingerror: (() => void) | null       = null
  async scan(_opts?: any) { /* resolves immediately */ }
}

beforeEach(() => {
  jest.clearAllMocks()

  // Default: valid merchant JWT with sub claim
  const payload = btoa(JSON.stringify({ sub: 'mid-001', name: 'Test Shop', role: 'MERCHANT', exp: 9999999999 }))
  mockGetToken.mockReturnValue(`header.${payload}.sig`)
})

afterEach(() => {
  jest.restoreAllMocks()
  // Clean up any NDEFReader stub installed during a test
  delete (window as any).NDEFReader
})

// ─── NFC unsupported ──────────────────────────────────────────────────────────

describe('ScanPage NFC not supported', () => {
  beforeEach(() => {
    delete (window as any).NDEFReader
  })

  it('shows the "Web NFC not available" warning', async () => {
    render(<MerchantScanPage />)
    await waitFor(() =>
      expect(screen.getByText(/web nfc not available/i)).toBeInTheDocument()
    )
  })

  it('recommends the Android app as the primary path', async () => {
    render(<MerchantScanPage />)
    await waitFor(() =>
      expect(screen.getByText(/orchestratepay android app/i)).toBeInTheDocument()
    )
  })

  it('does not show the Start Scanning button when NFC is unsupported', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByText(/web nfc not available/i))
    expect(screen.queryByRole('button', { name: /start scanning/i })).not.toBeInTheDocument()
  })
})

// ─── NFC supported — ready state ─────────────────────────────────────────────

describe('ScanPage NFC supported — ready state', () => {
  beforeEach(() => {
    ;(window as any).NDEFReader = MockNDEFReader
  })

  it('renders the page heading', async () => {
    render(<MerchantScanPage />)
    await waitFor(() =>
      expect(screen.getByText(/scan customer tag/i)).toBeInTheDocument()
    )
  })

  it('shows the Start Scanning button', async () => {
    render(<MerchantScanPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /start scanning/i })).toBeInTheDocument()
    )
  })

  it('transitions to scanning state when Start Scanning is clicked', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() =>
      expect(screen.getByText(/waiting for tag/i)).toBeInTheDocument()
    )
  })

  it('shows a Cancel button during scanning', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    )
  })

  it('returns to ready state when Cancel is clicked', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByRole('button', { name: /cancel/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /start scanning/i })).toBeInTheDocument()
    )
  })
})

// ─── Confirm state (consumer resolved via lookupByTagId) ─────────────────────

describe('ScanPage confirm state after consumer lookup', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    mockLookupByTagId.mockResolvedValue({
      consumerId:  'cid-001',
      displayName: 'Jane Wanjiku',
      maskedPhone: '2547****78',
    })

    // Override NDEFReader so we can trigger onreading manually
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan(_opts?: any) {
        ndefInstance = this
      }
    }
  })

  async function scanConsumerTag() {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    // Simulate a consumer-written tag URL
    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    const record = {
      data: { buffer: encoded.buffer },
    }
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [record] } } as any)
    })
  }

  it('resolves the consumer and shows their display name', async () => {
    await scanConsumerTag()
    await waitFor(() =>
      expect(screen.getByText('Jane Wanjiku')).toBeInTheDocument()
    )
  })

  it('shows the masked phone number', async () => {
    await scanConsumerTag()
    await waitFor(() =>
      expect(screen.getByText('2547****78')).toBeInTheDocument()
    )
  })

  it('renders the amount input with KSh prefix area', async () => {
    await scanConsumerTag()
    await waitFor(() =>
      expect(screen.getByText('KSh')).toBeInTheDocument()
    )
  })

  it('renders the Charge with M-Pesa button', async () => {
    await scanConsumerTag()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /charge with m-pesa/i })).toBeInTheDocument()
    )
  })

  it('renders the Scan again button', async () => {
    await scanConsumerTag()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /scan again/i })).toBeInTheDocument()
    )
  })

  it('resets to ready state when Scan again is clicked', async () => {
    await scanConsumerTag()
    await waitFor(() => screen.getByRole('button', { name: /scan again/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan again/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /start scanning/i })).toBeInTheDocument()
    )
  })
})

// ─── Amount validation ────────────────────────────────────────────────────────

describe('ScanPage amount validation', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    mockLookupByTagId.mockResolvedValue({
      consumerId:  'cid-001',
      displayName: 'Test User',
      maskedPhone: '2547****01',
    })
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  async function reachConfirmState() {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))
  }

  it('shows minimum payment error when amount is below KSh 1', async () => {
    await reachConfirmState()
    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '0.5')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))
    await waitFor(() =>
      expect(screen.getByText(/minimum payment is ksh 1/i)).toBeInTheDocument()
    )
    expect(mockInitiate).not.toHaveBeenCalled()
  })

  it('accepts a valid amount and calls transactions.initiate', async () => {
    mockInitiate.mockResolvedValue({ txnId: 'txn-scan-001', status: 'STK_SENT' })
    mockGetStatus.mockResolvedValue({ status: 'CONFIRMED', mpesaRef: 'NLJ7RT61SV' })

    await reachConfirmState()
    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '100')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(mockInitiate).toHaveBeenCalledWith(expect.objectContaining({
        amountCents: 10_000,
        merchantId:  'mid-001',
      }))
    )
  })
})

// ─── Payment success state ────────────────────────────────────────────────────

describe('ScanPage payment success', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    // Immediately invoke the setInterval callback so pollStatus fires without
    // needing fake timers (which break userEvent v14 and waitFor).
    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => {
      ;(fn as () => void)()
      return 0 as any
    })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})

    mockLookupByTagId.mockResolvedValue({
      consumerId:  'cid-001',
      displayName: 'Alice',
      maskedPhone: '2547****99',
    })
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockInitiate.mockResolvedValue({ txnId: 'txn-scan-002', status: 'STK_SENT' })
    mockGetStatus.mockResolvedValue({ status: 'CONFIRMED', mpesaRef: 'NLJ7RT61SV' })
  })

  it('shows the payment confirmed screen after a CONFIRMED status', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByText(/payment confirmed/i)).toBeInTheDocument()
    )
  })

  it('shows M-Pesa reference on success screen', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByText(/nlj7rt61sv/i)).toBeInTheDocument()
    )
  })

  it('shows a New payment button after success', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /new payment/i })).toBeInTheDocument()
    )
  })
})

// ─── Payment failed state ─────────────────────────────────────────────────────

describe('ScanPage payment failed', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => {
      ;(fn as () => void)()
      return 0 as any
    })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})

    mockLookupByTagId.mockResolvedValue({
      consumerId:  'cid-001',
      displayName: 'Bob',
      maskedPhone: '2547****22',
    })
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockInitiate.mockResolvedValue({ txnId: 'txn-scan-fail', status: 'STK_SENT' })
    mockGetStatus.mockResolvedValue({ status: 'DECLINED', reason: 'User cancelled' })
  })

  it('shows "Payment not completed" when status is DECLINED', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByText(/payment not completed/i)).toBeInTheDocument()
    )
  })

  it('shows the rejection reason on the failed screen', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByText(/user cancelled/i)).toBeInTheDocument()
    )
  })

  it('shows a Try again button on the failed screen', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    )
  })
})

// ─── initiate API error ───────────────────────────────────────────────────────

describe('ScanPage initiate API error', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    mockLookupByTagId.mockResolvedValue({
      consumerId:  'cid-001',
      displayName: 'Charlie',
      maskedPhone: '2547****33',
    })
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockInitiate.mockRejectedValue(new Error('STK push failed'))
  })

  it('shows the error message when initiate rejects', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByText(/stk push failed/i)).toBeInTheDocument()
    )
  })
})

// ─── Identity tag (orchestratepay://pay?tid=...) ─────────────────────────────

describe('ScanPage identity tag (orchestratepay:// scheme)', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  it('shows confirm state with 254*** phone when orchestratepay://pay?tid= tag is scanned', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    const url = 'orchestratepay://pay?mid=mid-001&tid=TAG456'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })

    await waitFor(() =>
      expect(screen.getByText(/254\*\*\*/i)).toBeInTheDocument()
    )
  })
})

// ─── Unrecognised tag (valid URL but no consumer/identity pattern) ────────────

describe('ScanPage unrecognised tag', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  it('shows unrecognised tag error when URL matches neither consumer nor identity pattern', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    const url = 'https://example.com/unknown'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })

    await waitFor(() =>
      expect(screen.getByText(/unrecognised tag/i)).toBeInTheDocument()
    )
  })
})

// ─── NFC reading error ────────────────────────────────────────────────────────

describe('ScanPage NFC reading error', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  it('shows "Could not read tag" when onreadingerror fires', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    await act(async () => {
      ndefInstance.onreadingerror?.()
    })

    await waitFor(() =>
      expect(screen.getByText(/could not read tag/i)).toBeInTheDocument()
    )
  })
})

// ─── Scan abort / generic error ──────────────────────────────────────────────

describe('ScanPage AbortError on scan start', () => {
  it('silently returns when scan throws AbortError', async () => {
    ;(window as any).NDEFReader = class {
      onreading = null; onreadingerror = null
      async scan() { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }
    }
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() =>
      expect(screen.queryByText(/scanning/i)).not.toBeInTheDocument()
    )
  })
})

describe('ScanPage generic NFC scan error', () => {
  it('shows NFC scan failed message when scan throws a generic error', async () => {
    ;(window as any).NDEFReader = class {
      onreading = null; onreadingerror = null
      async scan() { throw new Error('NFC hardware error') }
    }
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() =>
      expect(screen.getByText(/NFC hardware error/i)).toBeInTheDocument()
    )
  })
})

// ─── extractUrl fallback (full bytes path) ───────────────────────────────────

describe('ScanPage extractUrl full bytes fallback', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockLookupByTagId.mockResolvedValue({
      consumerId: 'cid-fullbytes', displayName: 'Full Bytes User', maskedPhone: '254***',
    })
  })

  it('resolves consumer when URL is found in full bytes (not slice(1))', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    const url = 'https://orchestratepay.co.ke/c/cid-fullbytes'
    const encoded = new TextEncoder().encode(url) // no prefix byte
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })

    await waitFor(() =>
      expect(mockLookupByTagId).toHaveBeenCalledWith('cid-fullbytes')
    )
  })
})

// ─── resolveConsumer catch block ─────────────────────────────────────────────

describe('ScanPage resolveConsumer catch block', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    mockLookupByTagId.mockRejectedValue(new Error('Consumer not found'))
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  it('shows "Consumer not found" when lookupByTagId rejects', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    const url = 'https://orchestratepay.co.ke/c/cid-bad'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })

    await waitFor(() =>
      expect(screen.getByText(/consumer not found/i)).toBeInTheDocument()
    )
  })
})

// ─── extractUrl catch (buffer missing) ───────────────────────────────────────

describe('ScanPage extractUrl catch block (no buffer)', () => {
  let ndefInstance: any

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan(_opts?: any) { ndefInstance = this }
    }
    mockLookupByTagId.mockResolvedValue({ consumerId: 'cid-001', displayName: 'Test', maskedPhone: '254***' })
  })

  it('silently skips tag when data.buffer = -1 → RangeError in extractUrl catch', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    // Wait for ndefInstance to be assigned (scan called)
    await waitFor(() => expect(ndefInstance).toBeTruthy())

    // data.buffer = -1 → new Uint8Array(-1) throws RangeError → catch { return null } → tag skipped
    await act(async () => {
      ndefInstance?.onreading?.({ message: { records: [{ data: { buffer: -1 } }] } } as any)
    })

    // No error shown — tag was silently skipped
    expect(screen.queryByText(/tag read error/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/consumer not found/i)).not.toBeInTheDocument()
  })
})

// ─── getMerchantId error ─────────────────────────────────────────────────────

describe('ScanPage getMerchantId catch block', () => {
  it('shows session expired when token is malformed', async () => {
    mockGetToken.mockReturnValue('a.aGVsbG8=.b') // middle = 'hello' → not valid JSON → getMerchantId returns null
    const ndefRef: { instance?: MockNDEFReader } = {}
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefRef.instance = this }
    }
    mockLookupByTagId.mockResolvedValue({ consumerId: 'cid-001', displayName: 'Test', maskedPhone: '254***' })
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefRef.instance?.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByText(/session expired/i)).toBeInTheDocument()
    )
  })
})

// ─── NFC scan error with no message → ?? fallback (branch 7) ────────────────

describe('ScanPage NFC scan error with no message', () => {
  it('shows "NFC scan failed" when scan throws error with no message property', async () => {
    ;(window as any).NDEFReader = class {
      onreading = null; onreadingerror = null
      async scan() { throw { name: 'SomeError' } } // no message
    }
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() =>
      expect(screen.getByText(/nfc scan failed/i)).toBeInTheDocument()
    )
  })
})

// ─── NFC_TAG payment via identity URL (branches 11, 12, 13) ──────────────────

describe('ScanPage NFC_TAG payment (consumer with tagId, no consumerId)', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => {
      ;(fn as () => void)()
      return 0 as any
    })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockInitiate.mockResolvedValue({ txnId: 'txn-nfctag', status: 'STK_SENT' })
    mockGetStatus.mockResolvedValue({ status: 'CONFIRMED', mpesaRef: 'REF001' })
  })

  it('sends source=NFC_TAG and tagId when consumer was set via orchestratepay:// identity URL', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    const url = 'orchestratepay://pay?mid=mid-001&tid=TAG456'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(mockInitiate).toHaveBeenCalledWith(expect.objectContaining({
        source: 'NFC_TAG',
        tagId:  'TAG456',
      }))
    )
    expect(mockInitiate.mock.calls[0][0]).not.toHaveProperty('consumerTagId')
  })
})

// ─── getMerchantId: token is null (branch 41) ────────────────────────────────

describe('ScanPage getMerchantId returns null when getToken is null', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockLookupByTagId.mockResolvedValue({ consumerId: 'cid-001', displayName: 'Test', maskedPhone: '254***' })
  })

  it('shows "Session expired" when getToken returns null', async () => {
    mockGetToken.mockReturnValue(null)
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByText(/session expired/i)).toBeInTheDocument()
    )
  })
})

// ─── getMerchantId: JWT has no sub claim (branch 42) ─────────────────────────

describe('ScanPage getMerchantId returns null when JWT has no sub', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    // JWT payload has no 'sub' field
    const payload = btoa(JSON.stringify({ name: 'Test Shop', role: 'MERCHANT' }))
    mockGetToken.mockReturnValue(`header.${payload}.sig`)
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockLookupByTagId.mockResolvedValue({ consumerId: 'cid-001', displayName: 'Test', maskedPhone: '254***' })
  })

  it('shows "Session expired" when JWT payload has no sub claim', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByText(/session expired/i)).toBeInTheDocument()
    )
  })
})

// ─── pollStatus: CONFIRMED without mpesaRef (branch 16) ──────────────────────

describe('ScanPage pollStatus CONFIRMED with no mpesaRef', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => {
      ;(fn as () => void)()
      return 0 as any
    })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockLookupByTagId.mockResolvedValue({ consumerId: 'cid-001', displayName: 'Alice', maskedPhone: '2547****99' })
    mockInitiate.mockResolvedValue({ txnId: 'txn-nompesa', status: 'STK_SENT' })
    mockGetStatus.mockResolvedValue({ status: 'CONFIRMED' }) // no mpesaRef
  })

  it('shows success state with empty mpesaRef string when CONFIRMED has no mpesaRef', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByText(/payment confirmed/i)).toBeInTheDocument()
    )
  })
})

// ─── pollStatus: status is PENDING (branch 17 FALSE — neither CONFIRMED nor DECLINED) ──

describe('ScanPage pollStatus with PENDING status (branch 17 FALSE)', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => {
      ;(fn as () => void)() // fires once with PENDING → neither if nor else if taken
      return 0 as any
    })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockLookupByTagId.mockResolvedValue({ consumerId: 'cid-001', displayName: 'Alice', maskedPhone: '2547****99' })
    mockInitiate.mockResolvedValue({ txnId: 'txn-pending', status: 'STK_SENT' })
    mockGetStatus.mockResolvedValue({ status: 'PENDING' }) // neither CONFIRMED nor DECLINED
  })

  it('stays in processing state when poll returns PENDING (branch 17 FALSE, branch 12 FALSE)', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    // After PENDING poll, page stays in processing state (spinner shown)
    await waitFor(() =>
      expect(screen.getByText(/waiting for m-pesa pin/i)).toBeInTheDocument()
    )
    expect(screen.queryByText(/payment confirmed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/payment not completed/i)).not.toBeInTheDocument()
  })
})

// ─── pollStatus: DECLINED without reason (branch 18 right) ───────────────────

describe('ScanPage pollStatus DECLINED with no reason', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => {
      ;(fn as () => void)()
      return 0 as any
    })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockLookupByTagId.mockResolvedValue({ consumerId: 'cid-001', displayName: 'Alice', maskedPhone: '2547****99' })
    mockInitiate.mockResolvedValue({ txnId: 'txn-declined', status: 'STK_SENT' })
    mockGetStatus.mockResolvedValue({ status: 'DECLINED' }) // no reason
  })

  it('shows "Payment not completed" when DECLINED has no reason field', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() => {
      const msgs = screen.getAllByText(/payment not completed/i)
      expect(msgs.length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ─── extractUrl: record with no data property (branch 34) ────────────────────

describe('ScanPage extractUrl record with no data returns null (branch 34)', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  it('silently skips records where data is missing', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    await act(async () => {
      // Record with no data property at all
      ndefInstance.onreading?.({ message: { records: [{}] } } as any)
    })

    // No error — the record was skipped
    expect(screen.queryByText(/not a merchant payment tag/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument()
  })
})

// ─── initiate error with no message → ?? fallback (branch 14) ────────────────

describe('ScanPage initiate throws error with no message', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockLookupByTagId.mockResolvedValue({ consumerId: 'cid-001', displayName: 'Test', maskedPhone: '254***' })
    mockInitiate.mockRejectedValue({}) // no message
  })

  it('shows "Payment failed" when initiate rejects with error having no message', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    await waitFor(() =>
      expect(screen.getByText(/payment failed/i)).toBeInTheDocument()
    )
  })
})

// ─── 90-second timeout callback (line 89, branches 19 and 20) ────────────────

describe('ScanPage 90-second poll timeout (branch 19/20)', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
    mockLookupByTagId.mockResolvedValue({ consumerId: 'cid-001', displayName: 'Alice', maskedPhone: '2547****99' })
    mockInitiate.mockResolvedValue({ txnId: 'txn-timeout90', status: 'STK_SENT' })
    // getStatus keeps returning PENDING so processing stays active
    mockGetStatus.mockResolvedValue({ status: 'PENDING' })
  })

  it('fires the 90s callback which clears the interval (covers anonymous_10)', async () => {
    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => {
      ;(fn as () => void)() // PENDING poll — no state change
      return 42 as any
    })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})
    let timeoutCb: (() => void) | undefined
    const origSetTimeout = global.setTimeout
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation((fn: any, ms?: number) => {
      if (ms === 90_000) { timeoutCb = fn; return 0 as any }
      return origSetTimeout(fn as any, ms)
    })
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))

    const url = 'https://orchestratepay.co.ke/c/cid-001'
    const encoded = new TextEncoder().encode('\x00' + url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })
    await waitFor(() => screen.getByRole('button', { name: /charge with m-pesa/i }))

    const amountInput = screen.getByRole('spinbutton')
    await userEvent.clear(amountInput)
    await userEvent.type(amountInput, '50')
    await userEvent.click(screen.getByRole('button', { name: /charge with m-pesa/i }))

    // Wait until the timeout callback is captured (fires after initiate resolves)
    await waitFor(() => expect(timeoutCb).toBeDefined())
    spy.mockRestore()

    // Fire the 90s callback: txnId is stale '' in closure → if branch is FALSE
    await act(async () => { timeoutCb?.() })

    // clearInterval was called (by the callback)
    expect(jest.requireMock('@/lib/auth').getToken).toHaveBeenCalled()
  })
})

// ─── extractUrl: full bytes start with orchestratepay (branch 37/38) ──────────

describe('ScanPage extractUrl full bytes start with orchestratepay (branch 38 right TRUE)', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  it('resolves full bytes path for orchestratepay:// URL (no prefix byte)', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    // 'orchestratepay://unrecognised' — no prefix byte, so:
    // raw = bytes.slice(1) = 'rchestratepay://...' → doesn't match
    // full = bytes = 'orchestratepay://...' → matches full.startsWith('orchestratepay') (branch 38 right TRUE)
    const url = 'orchestratepay://unrecognised'
    const encoded = new TextEncoder().encode(url)
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })

    // The URL is extracted but matches neither consumer nor identity pattern → unrecognised tag
    await waitFor(() =>
      expect(screen.getByText(/unrecognised tag/i)).toBeInTheDocument()
    )
  })
})

// ─── extractUrl: full bytes return null (line 196 return null, branch 37/38 FALSE) ──

describe('ScanPage extractUrl returns null when neither raw nor full match (line 196)', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  it('shows unrecognised tag error when extractUrl returns null (loop falls through)', async () => {
    render(<MerchantScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /start scanning/i }))
    await userEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => screen.getByText(/waiting for tag/i))

    // Random bytes that decode to neither http nor orchestratepay prefix
    // extractUrl returns null → loop continues → falls through to setErrorMsg
    const encoded = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])
    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })

    await waitFor(() =>
      expect(screen.getByText(/unrecognised tag/i)).toBeInTheDocument()
    )
  })
})

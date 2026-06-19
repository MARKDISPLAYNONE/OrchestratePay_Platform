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
import MerchantScanPage from '../page'

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
      async scan(opts?: any) {
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

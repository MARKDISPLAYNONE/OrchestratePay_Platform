/**
 * Tests for the merchant transactions page.
 *
 * Covers: data rendering, status badge colours, pagination controls,
 * row click navigation, empty state, and error display.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransactionsPage from '../page'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@/lib/api', () => ({
  merchants: {
    getTransactions: jest.fn(),
  },
}))

const mockGetTransactions = jest.requireMock('@/lib/api').merchants.getTransactions as jest.Mock

const sampleTxns = [
  {
    id:            'txn-001',
    status:        'CONFIRMED',
    amount_cents:  10_000,
    mpesa_receipt: 'NLJ7RT61SV',
    source:        'NFC_TAG',
    created_at:    '2024-05-18T14:30:00Z',
  },
  {
    id:            'txn-002',
    status:        'DECLINED',
    amount_cents:  5_000,
    mpesa_receipt: null,
    source:        'QR_CODE',
    created_at:    '2024-05-18T15:00:00Z',
  },
  {
    id:            'txn-003',
    status:        'STK_SENT',
    amount_cents:  2_500,
    mpesa_receipt: null,
    source:        'HCE_PHONE',
    created_at:    '2024-05-18T16:00:00Z',
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockPush.mockClear()
})

// ─── Loading state ────────────────────────────────────────────────────────────

describe('TransactionsPage loading', () => {
  it('shows a loading indicator while fetching', () => {
    mockGetTransactions.mockReturnValue(new Promise(() => {}))
    render(<TransactionsPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})

// ─── Data rendering ───────────────────────────────────────────────────────────

describe('TransactionsPage with data', () => {
  beforeEach(() => {
    mockGetTransactions.mockResolvedValue({ transactions: sampleTxns })
  })

  it('renders the page heading', async () => {
    render(<TransactionsPage />)
    expect(screen.getByText('Transactions')).toBeInTheDocument()
  })

  it('renders table column headers', async () => {
    render(<TransactionsPage />)
    expect(screen.getByText(/time/i)).toBeInTheDocument()
    expect(screen.getByText(/amount/i)).toBeInTheDocument()
    expect(screen.getByText(/status/i)).toBeInTheDocument()
    expect(screen.getByText(/source/i)).toBeInTheDocument()
    expect(screen.getByText(/m-pesa ref/i)).toBeInTheDocument()
  })

  it('renders transaction amounts in KSh', async () => {
    render(<TransactionsPage />)
    await waitFor(() => {
      expect(screen.getByText('KSh 100')).toBeInTheDocument()  // 10_000 cents
      expect(screen.getByText('KSh 50')).toBeInTheDocument()   // 5_000 cents
    })
  })

  it('renders M-Pesa reference for CONFIRMED transactions', async () => {
    render(<TransactionsPage />)
    await waitFor(() =>
      expect(screen.getByText('NLJ7RT61SV')).toBeInTheDocument()
    )
  })

  it('renders — for transactions without M-Pesa reference', async () => {
    render(<TransactionsPage />)
    await waitFor(() => {
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders payment source names', async () => {
    render(<TransactionsPage />)
    await waitFor(() => {
      expect(screen.getByText('NFC_TAG')).toBeInTheDocument()
      expect(screen.getByText('QR_CODE')).toBeInTheDocument()
      expect(screen.getByText('HCE_PHONE')).toBeInTheDocument()
    })
  })

  it('renders CONFIRMED status badge', async () => {
    render(<TransactionsPage />)
    await waitFor(() =>
      expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
    )
  })

  it('renders DECLINED status badge', async () => {
    render(<TransactionsPage />)
    await waitFor(() =>
      expect(screen.getByText('DECLINED')).toBeInTheDocument()
    )
  })

  it('renders STK_SENT status badge', async () => {
    render(<TransactionsPage />)
    await waitFor(() =>
      expect(screen.getByText('STK_SENT')).toBeInTheDocument()
    )
  })
})

// ─── Row click navigation ─────────────────────────────────────────────────────

describe('TransactionsPage row navigation', () => {
  it('navigates to the transaction detail page when a row is clicked', async () => {
    mockGetTransactions.mockResolvedValue({ transactions: sampleTxns })
    render(<TransactionsPage />)
    await waitFor(() => screen.getByText('NLJ7RT61SV'))
    await userEvent.click(screen.getByText('NLJ7RT61SV'))
    expect(mockPush).toHaveBeenCalledWith('/merchant/transactions/txn-001')
  })
})

// ─── Pagination ───────────────────────────────────────────────────────────────

describe('TransactionsPage pagination', () => {
  beforeEach(() => {
    mockGetTransactions.mockResolvedValue({ transactions: sampleTxns })
  })

  it('shows "Page 1" initially', async () => {
    render(<TransactionsPage />)
    await waitFor(() =>
      expect(screen.getByText(/page 1/i)).toBeInTheDocument()
    )
  })

  it('Previous button is disabled on the first page', async () => {
    render(<TransactionsPage />)
    await waitFor(() => {
      const prevBtn = screen.getByRole('button', { name: /previous/i })
      expect(prevBtn).toBeDisabled()
    })
  })

  it('Next button is disabled when fewer than PAGE_SIZE transactions are shown', async () => {
    // sampleTxns has 3 items, PAGE_SIZE is 25
    render(<TransactionsPage />)
    await waitFor(() => {
      const nextBtn = screen.getByRole('button', { name: /next/i })
      expect(nextBtn).toBeDisabled()
    })
  })

  it('shows the row count range when transactions exist', async () => {
    render(<TransactionsPage />)
    await waitFor(() =>
      expect(screen.getByText(/showing 1/i)).toBeInTheDocument()
    )
  })
})

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('TransactionsPage empty state', () => {
  it('shows "No transactions yet" when list is empty', async () => {
    mockGetTransactions.mockResolvedValue({ transactions: [] })
    render(<TransactionsPage />)
    await waitFor(() =>
      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument()
    )
  })
})

// ─── Error state ──────────────────────────────────────────────────────────────

describe('TransactionsPage error state', () => {
  it('shows the error message when fetch fails', async () => {
    mockGetTransactions.mockRejectedValue(new Error('Network error'))
    render(<TransactionsPage />)
    await waitFor(() =>
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    )
  })
})

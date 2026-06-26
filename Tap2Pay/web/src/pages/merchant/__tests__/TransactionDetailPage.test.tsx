/**
 * Tests for src/pages/merchant/TransactionDetailPage.tsx
 *
 * Covers: loading, not-found error, transaction rendering (amount, status,
 * mpesaRef, consumerPhone, reason), Print button visible for CONFIRMED only,
 * back navigation.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransactionDetailPage from '@/pages/merchant/TransactionDetailPage'

const mockNavigate = jest.fn()

jest.mock('react-router-dom', () => ({
  useParams:   jest.fn(() => ({ id: 'txn-001' })),
  useNavigate: () => mockNavigate,
}))

jest.mock('@/lib/api', () => ({
  merchants: { getTransaction: jest.fn() },
}))

jest.mock('@/components/ui/Badge', () => ({ __esModule: true, default: ({ label }: any) => <span>{label}</span> }))
jest.mock('@/components/ui/GlassCard', () => ({
  __esModule: true,
  default: ({ children, className }: any) => <div className={className}>{children}</div>,
}))

const mockGetTransaction = jest.requireMock('@/lib/api').merchants.getTransaction as jest.Mock

const confirmedTxn = {
  txnId:         'txn-001',
  status:        'CONFIRMED',
  amountCents:   25_000,
  merchantName:  'Savannah Bistro',
  mpesaRef:      'NLJ7RT61SV',
  consumerPhone: '254712345678',
  reason:        null,
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('TransactionDetailPage — loading', () => {
  it('shows loading indicator while fetching', () => {
    mockGetTransaction.mockReturnValue(new Promise(() => {}))
    render(<TransactionDetailPage />)
    expect(screen.getByText(/loading receipt/i)).toBeInTheDocument()
  })
})

describe('TransactionDetailPage — not found', () => {
  it('shows error message when fetch fails', async () => {
    mockGetTransaction.mockRejectedValue(new Error('Not found'))
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByText(/transaction not found/i)).toBeInTheDocument()
    )
  })

  it('shows Back button on error', async () => {
    mockGetTransaction.mockRejectedValue(new Error('Not found'))
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    )
  })

  it('calls navigate(-1) when Back is clicked', async () => {
    mockGetTransaction.mockRejectedValue(new Error('Not found'))
    render(<TransactionDetailPage />)
    await waitFor(() => screen.getByRole('button', { name: /back/i }))
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })
})

describe('TransactionDetailPage — CONFIRMED transaction', () => {
  beforeEach(() => {
    mockGetTransaction.mockResolvedValue(confirmedTxn)
  })

  it('renders the merchant name', async () => {
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByText('Savannah Bistro')).toBeInTheDocument()
    )
  })

  it('renders the amount in KSh', async () => {
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByText(/KSh 250\.00/)).toBeInTheDocument()
    )
  })

  it('renders the CONFIRMED status badge', async () => {
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
    )
  })

  it('renders the M-Pesa reference', async () => {
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByText('NLJ7RT61SV')).toBeInTheDocument()
    )
  })

  it('renders the consumer phone', async () => {
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByText('254712345678')).toBeInTheDocument()
    )
  })

  it('renders the truncated transaction ID', async () => {
    render(<TransactionDetailPage />)
    await waitFor(() => {
      const txnRow = screen.getByText(/txn-001/)
      expect(txnRow).toBeInTheDocument()
    })
  })

  it('shows the Print / Save as PDF button for CONFIRMED', async () => {
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument()
    )
  })

  it('navigates back when back button is clicked', async () => {
    render(<TransactionDetailPage />)
    await waitFor(() => screen.getByText('Savannah Bistro'))
    await userEvent.click(screen.getByText(/← back to transactions/i))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })
})

describe('TransactionDetailPage — non-CONFIRMED transaction', () => {
  it('does not show Print button for DECLINED transaction', async () => {
    mockGetTransaction.mockResolvedValue({ ...confirmedTxn, status: 'DECLINED', mpesaRef: null })
    render(<TransactionDetailPage />)
    await waitFor(() => screen.getByText('DECLINED'))
    expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument()
  })

  it('renders reason when provided', async () => {
    mockGetTransaction.mockResolvedValue({ ...confirmedTxn, status: 'DECLINED', reason: 'User cancelled', mpesaRef: null })
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByText('User cancelled')).toBeInTheDocument()
    )
  })

  it('does not render M-Pesa reference row when mpesaRef is null', async () => {
    mockGetTransaction.mockResolvedValue({ ...confirmedTxn, status: 'DECLINED', mpesaRef: null })
    render(<TransactionDetailPage />)
    await waitFor(() => screen.getByText('DECLINED'))
    expect(screen.queryByText('M-Pesa Reference')).not.toBeInTheDocument()
  })
})

describe('TransactionDetailPage — missing id param', () => {
  it('does nothing when id is undefined', () => {
    jest.requireMock('react-router-dom').useParams.mockReturnValue({ id: undefined })
    render(<TransactionDetailPage />)
    expect(mockGetTransaction).not.toHaveBeenCalled()
  })
})

describe('TransactionDetailPage — null optional fields', () => {
  beforeEach(() => {
    jest.requireMock('react-router-dom').useParams.mockReturnValue({ id: 'txn-001' })
  })

  it('shows em-dash when merchantName is null', async () => {
    mockGetTransaction.mockResolvedValue({ ...confirmedTxn, merchantName: null })
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByText('—')).toBeInTheDocument()
    )
  })

  it('does not render customer phone row when consumerPhone is null', async () => {
    mockGetTransaction.mockResolvedValue({ ...confirmedTxn, consumerPhone: null })
    render(<TransactionDetailPage />)
    await waitFor(() => screen.getByText(/NLJ7RT61SV/))
    expect(screen.queryByText(/customer phone/i)).not.toBeInTheDocument()
  })

  it('uses 0 for amountCents when null', async () => {
    mockGetTransaction.mockResolvedValue({ ...confirmedTxn, amountCents: null })
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByText(/KSh 0\.00/i)).toBeInTheDocument()
    )
  })

  it('shows empty txnId when txnId is null', async () => {
    mockGetTransaction.mockResolvedValue({ ...confirmedTxn, txnId: null })
    render(<TransactionDetailPage />)
    await waitFor(() =>
      expect(screen.getByText(/transaction id/i)).toBeInTheDocument()
    )
  })
})

describe('TransactionDetailPage — print button', () => {
  it('calls window.print when Print button is clicked', async () => {
    const mockPrint = jest.fn()
    Object.defineProperty(window, 'print', { value: mockPrint, configurable: true })
    jest.requireMock('react-router-dom').useParams.mockReturnValue({ id: 'txn-001' })
    mockGetTransaction.mockResolvedValue(confirmedTxn)
    render(<TransactionDetailPage />)
    await waitFor(() => screen.getByRole('button', { name: /print/i }))
    await userEvent.click(screen.getByRole('button', { name: /print/i }))
    expect(mockPrint).toHaveBeenCalled()
  })
})

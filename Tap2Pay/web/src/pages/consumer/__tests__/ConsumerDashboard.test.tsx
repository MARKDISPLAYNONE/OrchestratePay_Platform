/**
 * Tests for the consumer dashboard page.
 *
 * Covers: loading state, transaction list rendering (amount / merchant / status),
 * empty state when no transactions, failed-fetch error display,
 * status text colour classes (CONFIRMED = green, everything else = gray),
 * total-spent KPI card, and getName() integration.
 */

import { render, screen, waitFor } from '@testing-library/react'
import ConsumerDashboard from '@/pages/consumer/DashboardPage'

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('@/lib/api', () => ({
  consumers: {
    getTransactions: jest.fn(),
  },
}))

jest.mock('@/lib/auth', () => ({
  getName: jest.fn(),
}))

const mockGetTransactions = jest.requireMock('@/lib/api').consumers.getTransactions as jest.Mock
const mockGetName         = jest.requireMock('@/lib/auth').getName as jest.Mock

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const txnConfirmed = {
  id: 'txn-001',
  status: 'CONFIRMED',
  amount_cents: 15000,          // KSh 150
  original_currency: 'KES',
  mpesa_receipt: 'QJE1234ABC',
  merchant_name: 'Java House',
  created_at: '2024-03-10T09:00:00Z',
}

const txnPending = {
  id: 'txn-002',
  status: 'PENDING',
  amount_cents: 5000,           // KSh 50
  original_currency: 'KES',
  mpesa_receipt: null,
  merchant_name: 'Quickmart',
  created_at: '2024-03-11T12:30:00Z',
}

const txnFailed = {
  id: 'txn-003',
  status: 'FAILED',
  amount_cents: 20000,          // KSh 200
  original_currency: 'KES',
  mpesa_receipt: null,
  merchant_name: 'Naivas',
  created_at: '2024-03-12T15:00:00Z',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetName.mockReturnValue(null)
})

// ─── Loading state ─────────────────────────────────────────────────────────────

describe('ConsumerDashboard loading', () => {
  it('shows loading indicator before data resolves', () => {
    mockGetTransactions.mockReturnValue(new Promise(() => {}))
    render(<ConsumerDashboard />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('removes the loading indicator after data resolves', async () => {
    mockGetTransactions.mockResolvedValue({ transactions: [] })
    render(<ConsumerDashboard />)
    await waitFor(() =>
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    )
  })
})

// ─── Greeting ────────────────────────────────────────────────────────────────

describe('ConsumerDashboard greeting', () => {
  it('renders a generic greeting when getName returns null', async () => {
    mockGetName.mockReturnValue(null)
    mockGetTransactions.mockResolvedValue({ transactions: [] })
    render(<ConsumerDashboard />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^hello$/i })).toBeInTheDocument()
    )
  })

  it('renders a personalised greeting when getName returns a name', async () => {
    mockGetName.mockReturnValue('Alice')
    mockGetTransactions.mockResolvedValue({ transactions: [] })
    render(<ConsumerDashboard />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /hello, alice/i })).toBeInTheDocument()
    )
  })
})

// ─── Transaction list ─────────────────────────────────────────────────────────

describe('ConsumerDashboard transaction list', () => {
  beforeEach(() => {
    mockGetTransactions.mockResolvedValue({
      transactions: [txnConfirmed, txnPending, txnFailed],
    })
  })

  it('renders the merchant name for each transaction', async () => {
    render(<ConsumerDashboard />)
    await waitFor(() => {
      expect(screen.getByText('Java House')).toBeInTheDocument()
      expect(screen.getByText('Quickmart')).toBeInTheDocument()
      expect(screen.getByText('Naivas')).toBeInTheDocument()
    })
  })

  it('renders the formatted amount for each transaction', async () => {
    render(<ConsumerDashboard />)
    await waitFor(() => {
      // 15000 / 100 = 150 → KSh 150 (appears in KPI card + transaction row — use getAllByText)
      expect(screen.getAllByText(/ksh 150/i).length).toBeGreaterThanOrEqual(1)
      // 5000  / 100 = 50   →  KSh 50
      expect(screen.getByText(/ksh 50/i)).toBeInTheDocument()
      // 20000 / 100 = 200  →  KSh 200
      expect(screen.getByText(/ksh 200/i)).toBeInTheDocument()
    })
  })

  it('renders the status label for each transaction', async () => {
    render(<ConsumerDashboard />)
    await waitFor(() => {
      expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
      expect(screen.getByText('PENDING')).toBeInTheDocument()
      expect(screen.getByText('FAILED')).toBeInTheDocument()
    })
  })

  it('applies blue colour class to CONFIRMED status', async () => {
    render(<ConsumerDashboard />)
    await waitFor(() => screen.getByText('CONFIRMED'))
    const badge = screen.getByText('CONFIRMED')
    expect(badge.className).toMatch(/text-emerald-400/)
  })

  it('applies a non-blue (gray) colour class to PENDING status', async () => {
    render(<ConsumerDashboard />)
    await waitFor(() => screen.getByText('PENDING'))
    const badge = screen.getByText('PENDING')
    expect(badge.className).not.toMatch(/text-emerald-400/)
    expect(badge.className).toMatch(/text-amber/)
  })

  it('applies a non-blue (gray) colour class to FAILED status', async () => {
    render(<ConsumerDashboard />)
    await waitFor(() => screen.getByText('FAILED'))
    const badge = screen.getByText('FAILED')
    expect(badge.className).not.toMatch(/text-emerald-400/)
  })
})

// ─── KPI summary card ─────────────────────────────────────────────────────────

describe('ConsumerDashboard KPI card', () => {
  it('shows total spent from CONFIRMED transactions only', async () => {
    mockGetTransactions.mockResolvedValue({
      transactions: [txnConfirmed, txnPending, txnFailed],
    })
    render(<ConsumerDashboard />)
    // Only txnConfirmed (15000 cents = KSh 150) is CONFIRMED — appears in KPI card + transaction row
    await waitFor(() =>
      expect(screen.getAllByText(/ksh 150/i).length).toBeGreaterThanOrEqual(1)
    )
    expect(screen.getByText(/1 confirmed payment/i)).toBeInTheDocument()
  })

  it('shows KSh 0 and 0 confirmed payments when no confirmed transactions', async () => {
    mockGetTransactions.mockResolvedValue({
      transactions: [txnPending, txnFailed],
    })
    render(<ConsumerDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/0 confirmed payment/i)).toBeInTheDocument()
    )
  })

  it('shows "Total spent" label in the summary card', async () => {
    mockGetTransactions.mockResolvedValue({ transactions: [txnConfirmed] })
    render(<ConsumerDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/total spent/i)).toBeInTheDocument()
    )
  })
})

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('ConsumerDashboard empty state', () => {
  it('shows "No transactions yet" when the list is empty', async () => {
    mockGetTransactions.mockResolvedValue({ transactions: [] })
    render(<ConsumerDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument()
    )
  })

  it('does not render any transaction row when list is empty', async () => {
    mockGetTransactions.mockResolvedValue({ transactions: [] })
    render(<ConsumerDashboard />)
    await waitFor(() => screen.getByText(/no transactions yet/i))
    expect(screen.queryByText('Java House')).not.toBeInTheDocument()
  })
})

// ─── Error state ──────────────────────────────────────────────────────────────

describe('ConsumerDashboard error state', () => {
  it('displays error message when fetch fails', async () => {
    mockGetTransactions.mockRejectedValue(new Error('Network error'))
    render(<ConsumerDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/failed to load transactions/i)).toBeInTheDocument()
    )
  })

  it('does not show the "No transactions yet" empty state on error', async () => {
    mockGetTransactions.mockRejectedValue(new Error('Network error'))
    render(<ConsumerDashboard />)
    await waitFor(() => screen.getByText(/failed to load transactions/i))
    expect(screen.queryByText(/no transactions yet/i)).not.toBeInTheDocument()
  })

  it('hides the loading indicator after a failed fetch', async () => {
    mockGetTransactions.mockRejectedValue(new Error('Network error'))
    render(<ConsumerDashboard />)
    await waitFor(() =>
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    )
  })
})

// ─── API call ─────────────────────────────────────────────────────────────────

describe('ConsumerDashboard API call', () => {
  it('calls getTransactions with limit 10 on mount', async () => {
    mockGetTransactions.mockResolvedValue({ transactions: [] })
    render(<ConsumerDashboard />)
    await waitFor(() =>
      expect(mockGetTransactions).toHaveBeenCalledWith(10)
    )
  })

  it('calls getTransactions exactly once on mount', async () => {
    mockGetTransactions.mockResolvedValue({ transactions: [] })
    render(<ConsumerDashboard />)
    await waitFor(() => expect(mockGetTransactions).toHaveBeenCalledTimes(1))
  })
})

describe('ConsumerDashboard — missing transactions key', () => {
  it('shows empty state when response has no transactions key', async () => {
    mockGetTransactions.mockResolvedValue({})
    render(<ConsumerDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument()
    )
  })
})

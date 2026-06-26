/**
 * Tests for the merchant dashboard page.
 *
 * Covers: loading state, KPI card rendering, error display,
 * revenue/transaction aggregation, and empty-state handling.
 */

import { render, screen, waitFor } from '@testing-library/react'
import MerchantDashboard from '@/pages/merchant/DashboardPage'

// Recharts uses ResizeObserver which isn't available in jsdom
global.ResizeObserver = class {
  observe()    {}
  unobserve()  {}
  disconnect() {}
}

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  XAxis: () => null,
  YAxis: ({ tickFormatter }: any) => { tickFormatter?.(100000); return null },
  Tooltip: ({ formatter }: any) => { formatter?.(50000, 'Revenue'); return null },
  Bar: () => null,
  Cell: () => null,
}))

jest.mock('@/lib/api', () => ({
  merchants: {
    getWeekly:  jest.fn(),
    getSources: jest.fn(),
  },
}))

const mockGetWeekly  = jest.requireMock('@/lib/api').merchants.getWeekly  as jest.Mock
const mockGetSources = jest.requireMock('@/lib/api').merchants.getSources as jest.Mock

const weeklyData = {
  days: [
    { day: 'Mon', revenue: 10_000_00, count: 5 },
    { day: 'Tue', revenue: 20_000_00, count: 8 },
    { day: 'Wed', revenue:  5_000_00, count: 2 },
  ],
}
const sourcesData = {
  sources: [
    { source: 'NFC_TAG',    count: 10, pct: 67 },
    { source: 'QR_CODE',    count:  5, pct: 33 },
  ],
}

beforeEach(() => jest.clearAllMocks())

// ─── Loading state ────────────────────────────────────────────────────────────

describe('MerchantDashboard loading', () => {
  it('shows loading indicator before data resolves', async () => {
    mockGetWeekly.mockReturnValue(new Promise(() => {}))
    mockGetSources.mockReturnValue(new Promise(() => {}))
    render(<MerchantDashboard />)
    expect(screen.getAllByText(/loading/i).length).toBeGreaterThan(0)
  })
})

// ─── Successful data load ─────────────────────────────────────────────────────

describe('MerchantDashboard with data', () => {
  beforeEach(() => {
    mockGetWeekly.mockResolvedValue(weeklyData)
    mockGetSources.mockResolvedValue(sourcesData)
  })

  it('renders the heading', async () => {
    render(<MerchantDashboard />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('shows 7-day revenue KPI card', async () => {
    render(<MerchantDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/7-day revenue/i)).toBeInTheDocument()
    )
  })

  it('shows 7-day transactions KPI card', async () => {
    render(<MerchantDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/7-day transactions/i)).toBeInTheDocument()
    )
  })

  it('shows average transaction KPI card', async () => {
    render(<MerchantDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/avg transaction/i)).toBeInTheDocument()
    )
  })

  it('displays total transaction count correctly', async () => {
    render(<MerchantDashboard />)
    // 5 + 8 + 2 = 15 transactions
    await waitFor(() =>
      expect(screen.getByText('15')).toBeInTheDocument()
    )
  })

  it('shows NFC_TAG payment source', async () => {
    render(<MerchantDashboard />)
    await waitFor(() =>
      expect(screen.getByText('NFC_TAG')).toBeInTheDocument()
    )
  })

  it('shows QR_CODE payment source', async () => {
    render(<MerchantDashboard />)
    await waitFor(() =>
      expect(screen.getByText('QR_CODE')).toBeInTheDocument()
    )
  })

  it('shows transaction count next to each source', async () => {
    render(<MerchantDashboard />)
    await waitFor(() => {
      expect(screen.getByText(/10 txns/i)).toBeInTheDocument()
      expect(screen.getByText(/5 txns/i)).toBeInTheDocument()
    })
  })
})

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('MerchantDashboard empty state', () => {
  it('shows — for average transaction when there are no transactions', async () => {
    mockGetWeekly.mockResolvedValue({ days: [] })
    mockGetSources.mockResolvedValue({ sources: [] })
    render(<MerchantDashboard />)
    await waitFor(() => {
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows "No transactions yet" when sources list is empty', async () => {
    mockGetWeekly.mockResolvedValue({ days: [] })
    mockGetSources.mockResolvedValue({ sources: [] })
    render(<MerchantDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument()
    )
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('MerchantDashboard error state', () => {
  it('shows an error message when the API call fails', async () => {
    mockGetWeekly.mockRejectedValue(new Error('Failed to fetch analytics'))
    mockGetSources.mockRejectedValue(new Error('Failed to fetch analytics'))
    render(<MerchantDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/failed to fetch analytics/i)).toBeInTheDocument()
    )
  })
})

describe('MerchantDashboard — missing response keys', () => {
  it('shows empty state when getWeekly and getSources responses have no keys', async () => {
    mockGetWeekly.mockResolvedValue({})
    mockGetSources.mockResolvedValue({})
    render(<MerchantDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument()
    )
  })

  it('renders source bar with 0% width when pct is null', async () => {
    mockGetWeekly.mockResolvedValue({ days: [] })
    mockGetSources.mockResolvedValue({ sources: [{ source: 'NFC_TAG', count: 5, pct: null }] })
    render(<MerchantDashboard />)
    await waitFor(() =>
      expect(screen.getByText('NFC_TAG')).toBeInTheDocument()
    )
    const bar = document.querySelector('[style*="width: 0%"]')
    expect(bar).toBeInTheDocument()
  })
})

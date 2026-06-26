/**
 * Tests for the merchant analytics page.
 *
 * Covers: loading state, page heading, 7-day revenue chart section,
 * peak hours chart section, empty state when no data, error handling.
 *
 * Note: Recharts uses ResizeObserver which is unavailable in jsdom.
 * We stub it globally and let chart components render silently.
 */

import { render, screen, waitFor } from '@testing-library/react'
import AnalyticsPage from '@/pages/merchant/AnalyticsPage'

// Recharts needs ResizeObserver
global.ResizeObserver = class {
  observe()    {}
  unobserve()  {}
  disconnect() {}
}

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  AreaChart: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  XAxis: ({ tickFormatter }: any) => { tickFormatter?.(10); return null },
  YAxis: ({ tickFormatter }: any) => { tickFormatter?.(100000); return null },
  Tooltip: ({ formatter, labelFormatter }: any) => { formatter?.(50000, 'Revenue'); labelFormatter?.(14); return null },
  Area: () => null,
  Bar: () => null,
}))

jest.mock('@/lib/api', () => ({
  merchants: {
    getWeekly:    jest.fn(),
    getPeakHours: jest.fn(),
  },
}))

const mockGetWeekly    = jest.requireMock('@/lib/api').merchants.getWeekly    as jest.Mock
const mockGetPeakHours = jest.requireMock('@/lib/api').merchants.getPeakHours as jest.Mock

const weeklyData = {
  days: [
    { day: 'Mon', revenue: 15_000_00, count: 6 },
    { day: 'Tue', revenue: 22_000_00, count: 9 },
    { day: 'Wed', revenue:  8_000_00, count: 3 },
  ],
}

const peakData = {
  hours: [
    { hour: 8,  count: 12 },
    { hour: 12, count: 30 },
    { hour: 17, count: 25 },
  ],
}

beforeEach(() => jest.clearAllMocks())

// ─── Loading state ────────────────────────────────────────────────────────────

describe('AnalyticsPage loading', () => {
  it('shows loading placeholders while fetching', () => {
    mockGetWeekly.mockReturnValue(new Promise(() => {}))
    mockGetPeakHours.mockReturnValue(new Promise(() => {}))
    render(<AnalyticsPage />)
    const loadingEls = screen.getAllByText(/loading/i)
    expect(loadingEls.length).toBeGreaterThanOrEqual(1)
  })

  it('shows the page heading immediately', () => {
    mockGetWeekly.mockReturnValue(new Promise(() => {}))
    mockGetPeakHours.mockReturnValue(new Promise(() => {}))
    render(<AnalyticsPage />)
    expect(screen.getByText('Analytics')).toBeInTheDocument()
  })
})

// ─── Successful data load ─────────────────────────────────────────────────────

describe('AnalyticsPage with data', () => {
  beforeEach(() => {
    mockGetWeekly.mockResolvedValue(weeklyData)
    mockGetPeakHours.mockResolvedValue(peakData)
  })

  it('renders the page heading', async () => {
    render(<AnalyticsPage />)
    expect(screen.getByText('Analytics')).toBeInTheDocument()
  })

  it('renders the 7-day revenue section heading', async () => {
    render(<AnalyticsPage />)
    await waitFor(() =>
      expect(screen.getByText(/7-day revenue trend/i)).toBeInTheDocument()
    )
  })

  it('renders the peak hours section heading', async () => {
    render(<AnalyticsPage />)
    await waitFor(() =>
      expect(screen.getByText(/peak hours/i)).toBeInTheDocument()
    )
  })

  it('hides loading indicators after data resolves', async () => {
    render(<AnalyticsPage />)
    await waitFor(() => {
      const loadingEls = screen.queryAllByText(/loading/i)
      expect(loadingEls.length).toBe(0)
    })
  })

  it('calls getWeekly once on mount', async () => {
    render(<AnalyticsPage />)
    await waitFor(() => expect(mockGetWeekly).toHaveBeenCalledTimes(1))
  })

  it('calls getPeakHours once on mount', async () => {
    render(<AnalyticsPage />)
    await waitFor(() => expect(mockGetPeakHours).toHaveBeenCalledTimes(1))
  })
})

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('AnalyticsPage empty state', () => {
  it('renders without errors when days and hours are empty', async () => {
    mockGetWeekly.mockResolvedValue({ days: [] })
    mockGetPeakHours.mockResolvedValue({ hours: [] })
    render(<AnalyticsPage />)
    await waitFor(() => {
      expect(screen.getByText(/7-day revenue trend/i)).toBeInTheDocument()
      expect(screen.getByText(/peak hours/i)).toBeInTheDocument()
    })
  })

  it('does not show loading indicators after empty data resolves', async () => {
    mockGetWeekly.mockResolvedValue({ days: [] })
    mockGetPeakHours.mockResolvedValue({ hours: [] })
    render(<AnalyticsPage />)
    await waitFor(() => {
      const loadingEls = screen.queryAllByText(/loading/i)
      expect(loadingEls.length).toBe(0)
    })
  })
})

// ─── API missing fields ───────────────────────────────────────────────────────

describe('AnalyticsPage handles missing response fields', () => {
  it('handles a response without days or hours fields gracefully', async () => {
    mockGetWeekly.mockResolvedValue({})
    mockGetPeakHours.mockResolvedValue({})
    render(<AnalyticsPage />)
    await waitFor(() => {
      expect(screen.getByText('Analytics')).toBeInTheDocument()
    })
  })
})

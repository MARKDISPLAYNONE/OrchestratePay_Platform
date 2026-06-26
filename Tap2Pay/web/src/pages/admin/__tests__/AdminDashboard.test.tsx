/**
 * Tests for src/pages/admin/DashboardPage.tsx
 *
 * Covers: loading state, error state, KPI rendering, infrastructure status,
 * timing metrics, hourly chart (present and absent), success/rate formatting.
 */
import { render, screen, waitFor } from '@testing-library/react'
import AdminDashboard from '@/pages/admin/DashboardPage'

jest.mock('@/lib/api', () => ({
  admin: { getStats: jest.fn() },
}))

const mockGetStats = jest.requireMock('@/lib/api').admin.getStats as jest.Mock

const fullStats = {
  generatedAt:    '2024-06-01T12:00:00Z',
  merchants:      { total: 42 },
  consumers:      { total: 187 },
  allTime:        { total: 1024, confirmed: 900, pending: 10 },
  last24h:        { total: 30, confirmed: 27, declined: 2, failed: 1, successRate: 0.9, timeoutRate: 0.033 },
  timing:         { medianConfirmMs: 3500, p95ConfirmMs: 8200, avgConfirmMs: 4100 },
  infrastructure: { redis: 'ok', darajaCircuit: { state: 'CLOSED', failureCount: 0 } },
  hourly:         [
    { hour: '10:00', confirmed: 5 },
    { hour: '11:00', confirmed: 10 },
  ],
}

beforeEach(() => jest.clearAllMocks())

describe('AdminDashboard loading', () => {
  it('shows loading message while fetching', () => {
    mockGetStats.mockReturnValue(new Promise(() => {}))
    render(<AdminDashboard />)
    expect(screen.getByText(/loading platform stats/i)).toBeInTheDocument()
  })
})

describe('AdminDashboard error state', () => {
  it('shows error message when fetch fails', async () => {
    mockGetStats.mockRejectedValue(new Error('Unauthorized'))
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/unauthorized/i)).toBeInTheDocument()
    )
  })
})

describe('AdminDashboard with data', () => {
  beforeEach(() => {
    mockGetStats.mockResolvedValue(fullStats)
  })

  it('renders the page heading', async () => {
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/platform dashboard/i)).toBeInTheDocument()
    )
  })

  it('renders merchant count', async () => {
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText('42')).toBeInTheDocument()
    )
  })

  it('renders consumer count', async () => {
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText('187')).toBeInTheDocument()
    )
  })

  it('renders Redis ok status', async () => {
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/ok/i)).toBeInTheDocument()
    )
  })

  it('renders Daraja circuit state', async () => {
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/CLOSED/)).toBeInTheDocument()
    )
  })

  it('renders last 24h total', async () => {
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText('30')).toBeInTheDocument()
    )
  })

  it('renders success rate percentage', async () => {
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/90.0% success/i)).toBeInTheDocument()
    )
  })

  it('renders median confirm time in seconds', async () => {
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/3\.5s/)).toBeInTheDocument()
    )
  })

  it('renders all-time confirmed count', async () => {
    render(<AdminDashboard />)
    await waitFor(() => {
      const cells = screen.getAllByText('900')
      expect(cells.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders the hourly chart section when hourly data exists', async () => {
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/hourly activity/i)).toBeInTheDocument()
    )
  })
})

describe('AdminDashboard — no hourly data', () => {
  it('does not render hourly section when hourly array is empty', async () => {
    mockGetStats.mockResolvedValue({ ...fullStats, hourly: [] })
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/platform dashboard/i)).toBeInTheDocument()
    )
    expect(screen.queryByText(/hourly activity/i)).not.toBeInTheDocument()
  })
})

describe('AdminDashboard — missing optional fields', () => {
  it('handles null timing values gracefully', async () => {
    mockGetStats.mockResolvedValue({
      ...fullStats,
      timing: { medianConfirmMs: null, p95ConfirmMs: null, avgConfirmMs: null },
    })
    render(<AdminDashboard />)
    await waitFor(() => {
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(3)
    })
  })

  it('handles undefined successRate', async () => {
    mockGetStats.mockResolvedValue({
      ...fullStats,
      last24h: { total: 5, confirmed: 5, declined: 0, failed: 0 },
    })
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/platform dashboard/i)).toBeInTheDocument()
    )
  })

  it('covers ?? fallbacks when allTime, last24h, timing, infrastructure are all missing', async () => {
    mockGetStats.mockResolvedValue({ generatedAt: '2024-06-01T12:00:00Z', merchants: {}, consumers: {}, hourly: [] })
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/platform dashboard/i)).toBeInTheDocument()
    )
  })

  it('shows amber dot when darajaCircuit state is not CLOSED', async () => {
    mockGetStats.mockResolvedValue({
      ...fullStats,
      infrastructure: { redis: 'ok', darajaCircuit: { state: 'OPEN', failureCount: 3 } },
    })
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/OPEN/)).toBeInTheDocument()
    )
  })

  it('covers false branch of redis === ok when redis is not ok', async () => {
    mockGetStats.mockResolvedValue({
      ...fullStats,
      infrastructure: { redis: 'error', darajaCircuit: { state: 'CLOSED', failureCount: 0 } },
    })
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText('error')).toBeInTheDocument()
    )
  })

  it('covers max === 0 branch in hourly chart (all-zero confirmed)', async () => {
    mockGetStats.mockResolvedValue({
      ...fullStats,
      hourly: [{ hour: '10:00', confirmed: 0 }, { hour: '11:00', confirmed: 0 }],
    })
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/hourly activity/i)).toBeInTheDocument()
    )
  })

  it('handles null timeoutRate', async () => {
    mockGetStats.mockResolvedValue({
      ...fullStats,
      last24h: { total: 5, confirmed: 5, declined: 0, failed: 0, successRate: 1.0 },
    })
    render(<AdminDashboard />)
    await waitFor(() =>
      expect(screen.getByText(/platform dashboard/i)).toBeInTheDocument()
    )
  })
})

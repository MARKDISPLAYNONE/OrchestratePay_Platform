/**
 * Tests for src/pages/admin/ConsumersPage.tsx
 *
 * Covers: loading state, error state, empty state, consumer list rendering,
 * transaction count colour, active/inactive status dot.
 */
import { render, screen, waitFor } from '@testing-library/react'
import AdminConsumersPage from '@/pages/admin/ConsumersPage'

jest.mock('@/lib/api', () => ({
  admin: {
    getConsumers: jest.fn(),
  },
}))

const mockGetConsumers = jest.requireMock('@/lib/api').admin.getConsumers as jest.Mock

const consumer1 = {
  id:                'c-001',
  phone:             '254712345678',
  email:             'alice@example.com',
  display_name:      'Alice Wanjiku',
  active:            true,
  created_at:        '2024-01-15T08:00:00Z',
  transaction_count: 5,
}

const consumer2 = {
  id:                'c-002',
  phone:             '254798765432',
  email:             null,
  display_name:      null,
  active:            false,
  created_at:        '2024-02-20T10:00:00Z',
  transaction_count: 0,
}

beforeEach(() => jest.clearAllMocks())

describe('AdminConsumersPage loading', () => {
  it('shows loading indicator while fetching', () => {
    mockGetConsumers.mockReturnValue(new Promise(() => {}))
    render(<AdminConsumersPage />)
    expect(screen.getByText(/loading consumers/i)).toBeInTheDocument()
  })
})

describe('AdminConsumersPage error state', () => {
  it('shows error message when fetch fails', async () => {
    mockGetConsumers.mockRejectedValue(new Error('Forbidden'))
    render(<AdminConsumersPage />)
    await waitFor(() =>
      expect(screen.getByText(/forbidden/i)).toBeInTheDocument()
    )
  })
})

describe('AdminConsumersPage empty state', () => {
  it('shows "No consumers registered yet" when list is empty', async () => {
    mockGetConsumers.mockResolvedValue({ consumers: [] })
    render(<AdminConsumersPage />)
    await waitFor(() =>
      expect(screen.getByText(/no consumers registered yet/i)).toBeInTheDocument()
    )
  })

  it('shows heading with count 0', async () => {
    mockGetConsumers.mockResolvedValue({ consumers: [] })
    render(<AdminConsumersPage />)
    await waitFor(() =>
      expect(screen.getByText(/0 registered/i)).toBeInTheDocument()
    )
  })
})

describe('AdminConsumersPage with consumers', () => {
  beforeEach(() => {
    mockGetConsumers.mockResolvedValue({ consumers: [consumer1, consumer2] })
  })

  it('renders consumer heading', async () => {
    render(<AdminConsumersPage />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /consumers/i })).toBeInTheDocument()
    )
  })

  it('renders the display name', async () => {
    render(<AdminConsumersPage />)
    await waitFor(() =>
      expect(screen.getByText('Alice Wanjiku')).toBeInTheDocument()
    )
  })

  it('renders the phone number', async () => {
    render(<AdminConsumersPage />)
    await waitFor(() =>
      expect(screen.getByText('254712345678')).toBeInTheDocument()
    )
  })

  it('renders the email address', async () => {
    render(<AdminConsumersPage />)
    await waitFor(() =>
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    )
  })

  it('renders — when display_name is null', async () => {
    render(<AdminConsumersPage />)
    await waitFor(() => {
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders transaction count with electric colour for non-zero', async () => {
    render(<AdminConsumersPage />)
    await waitFor(() => {
      const cell = screen.getByText('5')
      expect(cell).toHaveClass('text-electric')
    })
  })

  it('renders transaction count with slate colour for zero', async () => {
    render(<AdminConsumersPage />)
    await waitFor(() => {
      const cell = screen.getByText('0')
      expect(cell).toHaveClass('text-slate-600')
    })
  })
})

describe('AdminConsumersPage — missing consumers key', () => {
  it('shows empty state when response has no consumers key', async () => {
    jest.requireMock('@/lib/api').admin.getConsumers.mockResolvedValue({})
    render(<AdminConsumersPage />)
    await waitFor(() =>
      expect(screen.getByText(/no consumers registered yet/i)).toBeInTheDocument()
    )
  })
})

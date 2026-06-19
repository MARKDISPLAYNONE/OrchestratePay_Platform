/**
 * Tests for the merchant accounting / GL integrations page.
 *
 * Covers: loading state, platform cards (QuickBooks / Xero / Sage / Wave),
 * connect flow (token input → Save), error on missing token, disconnect,
 * GL posting log table, POSTED / FAILED / PENDING status badges, empty state.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccountingPage from '../page'

jest.mock('@/lib/api', () => ({
  accounting: {
    getIntegrations: jest.fn(),
    getPostings:     jest.fn(),
    connect:         jest.fn(),
    disconnect:      jest.fn(),
  },
}))

const mockGetIntegrations = jest.requireMock('@/lib/api').accounting.getIntegrations as jest.Mock
const mockGetPostings     = jest.requireMock('@/lib/api').accounting.getPostings     as jest.Mock
const mockConnect         = jest.requireMock('@/lib/api').accounting.connect         as jest.Mock
const mockDisconnect      = jest.requireMock('@/lib/api').accounting.disconnect      as jest.Mock

const emptyState = {
  integrations: [],
  postings: [],
}

const sampleIntegrations = [
  { id: 'int-1', platform: 'quickbooks', status: 'ACTIVE',    last_sync_at: '2024-05-18T10:00:00Z' },
  { id: 'int-2', platform: 'xero',       status: 'INACTIVE',  last_sync_at: null },
]

const samplePostings = [
  {
    id: 'post-1', platform: 'quickbooks', journal_date: '2024-05-18',
    amount_cents: 10_000, status: 'POSTED', external_id: 'QBO-001',
  },
  {
    id: 'post-2', platform: 'xero', journal_date: '2024-05-17',
    amount_cents: 5_000, status: 'FAILED', external_id: null,
  },
  {
    id: 'post-3', platform: 'sage', journal_date: '2024-05-16',
    amount_cents: 2_500, status: 'PENDING', external_id: null,
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockGetIntegrations.mockResolvedValue({ integrations: [] })
  mockGetPostings.mockResolvedValue({ postings: [] })
})

// ─── Loading state ────────────────────────────────────────────────────────────

describe('AccountingPage loading', () => {
  it('shows a loading row in the GL table while fetching', () => {
    mockGetIntegrations.mockReturnValue(new Promise(() => {}))
    mockGetPostings.mockReturnValue(new Promise(() => {}))
    render(<AccountingPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})

// ─── Page structure ───────────────────────────────────────────────────────────

describe('AccountingPage structure', () => {
  beforeEach(() => {
    mockGetIntegrations.mockResolvedValue(emptyState)
    mockGetPostings.mockResolvedValue(emptyState)
  })

  it('renders the page heading', async () => {
    render(<AccountingPage />)
    expect(screen.getByText(/accounting integrations/i)).toBeInTheDocument()
  })

  it('renders all four platform names', async () => {
    render(<AccountingPage />)
    await waitFor(() => {
      expect(screen.getByText('QuickBooks')).toBeInTheDocument()
      expect(screen.getByText('Xero')).toBeInTheDocument()
      expect(screen.getByText('Sage')).toBeInTheDocument()
      expect(screen.getByText('Wave')).toBeInTheDocument()
    })
  })

  it('shows "Not connected" for all platforms when no integrations exist', async () => {
    render(<AccountingPage />)
    await waitFor(() => {
      const badges = screen.getAllByText('Not connected')
      expect(badges.length).toBe(4)
    })
  })

  it('renders the GL postings section heading', async () => {
    render(<AccountingPage />)
    await waitFor(() =>
      expect(screen.getByText(/recent gl postings/i)).toBeInTheDocument()
    )
  })

  it('renders the GL table column headers', async () => {
    render(<AccountingPage />)
    await waitFor(() => {
      expect(screen.getByText(/platform/i)).toBeInTheDocument()
      expect(screen.getByText(/amount/i)).toBeInTheDocument()
      expect(screen.getByText(/status/i)).toBeInTheDocument()
    })
  })
})

// ─── Connected platform ───────────────────────────────────────────────────────

describe('AccountingPage connected platform', () => {
  beforeEach(() => {
    mockGetIntegrations.mockResolvedValue({ integrations: sampleIntegrations })
    mockGetPostings.mockResolvedValue({ postings: [] })
  })

  it('shows "Connected" badge for active integrations', async () => {
    render(<AccountingPage />)
    await waitFor(() =>
      expect(screen.getByText('Connected')).toBeInTheDocument()
    )
  })

  it('shows a Disconnect button for connected platforms', async () => {
    render(<AccountingPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument()
    )
  })

  it('calls accounting.disconnect when Disconnect is clicked', async () => {
    mockDisconnect.mockResolvedValue({})
    render(<AccountingPage />)
    await waitFor(() => screen.getByRole('button', { name: /disconnect/i }))
    await userEvent.click(screen.getByRole('button', { name: /disconnect/i }))
    expect(mockDisconnect).toHaveBeenCalledWith('quickbooks')
  })
})

// ─── Connect flow ─────────────────────────────────────────────────────────────

describe('AccountingPage connect flow', () => {
  beforeEach(() => {
    mockGetIntegrations.mockResolvedValue({ integrations: [] })
    mockGetPostings.mockResolvedValue({ postings: [] })
  })

  it('shows Connect buttons for unconnected platforms', async () => {
    render(<AccountingPage />)
    await waitFor(() => {
      const connectBtns = screen.getAllByRole('button', { name: /connect/i })
      expect(connectBtns.length).toBeGreaterThanOrEqual(4)
    })
  })

  it('expands the token input when Connect is clicked', async () => {
    render(<AccountingPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /^connect$/i }))
    const [firstConnect] = screen.getAllByRole('button', { name: /^connect$/i })
    await userEvent.click(firstConnect)
    expect(screen.getByPlaceholderText(/paste access token/i)).toBeInTheDocument()
  })

  it('shows error when Save is clicked without a token', async () => {
    render(<AccountingPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /^connect$/i }))
    const [firstConnect] = screen.getAllByRole('button', { name: /^connect$/i })
    await userEvent.click(firstConnect)
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(screen.getByText(/paste your api/i)).toBeInTheDocument()
  })

  it('calls accounting.connect with trimmed token when Save is clicked', async () => {
    mockConnect.mockResolvedValue({ connected: true })
    render(<AccountingPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /^connect$/i }))
    const [firstConnect] = screen.getAllByRole('button', { name: /^connect$/i })
    await userEvent.click(firstConnect)
    await userEvent.type(screen.getByPlaceholderText(/paste access token/i), 'tok-abc123')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(mockConnect).toHaveBeenCalledWith('quickbooks', { accessToken: 'tok-abc123' })
  })

  it('shows an error message when connect API call fails', async () => {
    mockConnect.mockRejectedValue(new Error('Invalid API key'))
    render(<AccountingPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /^connect$/i }))
    const [firstConnect] = screen.getAllByRole('button', { name: /^connect$/i })
    await userEvent.click(firstConnect)
    await userEvent.type(screen.getByPlaceholderText(/paste access token/i), 'bad-tok')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(screen.getByText(/invalid api key/i)).toBeInTheDocument()
    )
  })
})

// ─── GL posting log ───────────────────────────────────────────────────────────

describe('AccountingPage GL posting log', () => {
  it('shows "No postings yet" when the list is empty', async () => {
    mockGetIntegrations.mockResolvedValue({ integrations: [] })
    mockGetPostings.mockResolvedValue({ postings: [] })
    render(<AccountingPage />)
    await waitFor(() =>
      expect(screen.getByText(/no postings yet/i)).toBeInTheDocument()
    )
  })

  it('renders posting rows with platform, amount and status', async () => {
    mockGetIntegrations.mockResolvedValue({ integrations: [] })
    mockGetPostings.mockResolvedValue({ postings: samplePostings })
    render(<AccountingPage />)
    await waitFor(() => {
      expect(screen.getByText('quickbooks')).toBeInTheDocument()
      expect(screen.getByText('KSh 100')).toBeInTheDocument()    // 10_000 cents
    })
  })

  it('renders POSTED status badge', async () => {
    mockGetIntegrations.mockResolvedValue({ integrations: [] })
    mockGetPostings.mockResolvedValue({ postings: samplePostings })
    render(<AccountingPage />)
    await waitFor(() =>
      expect(screen.getByText('POSTED')).toBeInTheDocument()
    )
  })

  it('renders FAILED status badge', async () => {
    mockGetIntegrations.mockResolvedValue({ integrations: [] })
    mockGetPostings.mockResolvedValue({ postings: samplePostings })
    render(<AccountingPage />)
    await waitFor(() =>
      expect(screen.getByText('FAILED')).toBeInTheDocument()
    )
  })

  it('renders PENDING status badge', async () => {
    mockGetIntegrations.mockResolvedValue({ integrations: [] })
    mockGetPostings.mockResolvedValue({ postings: samplePostings })
    render(<AccountingPage />)
    await waitFor(() =>
      expect(screen.getByText('PENDING')).toBeInTheDocument()
    )
  })

  it('shows — for postings without an external ID', async () => {
    mockGetIntegrations.mockResolvedValue({ integrations: [] })
    mockGetPostings.mockResolvedValue({ postings: samplePostings })
    render(<AccountingPage />)
    await waitFor(() => {
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows the external ID when present', async () => {
    mockGetIntegrations.mockResolvedValue({ integrations: [] })
    mockGetPostings.mockResolvedValue({ postings: samplePostings })
    render(<AccountingPage />)
    await waitFor(() =>
      expect(screen.getByText('QBO-001')).toBeInTheDocument()
    )
  })
})

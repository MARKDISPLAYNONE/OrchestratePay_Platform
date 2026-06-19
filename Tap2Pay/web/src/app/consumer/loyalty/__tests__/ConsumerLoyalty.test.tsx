/**
 * Tests for the consumer loyalty page.
 *
 * Covers: loading state, error state, empty state ("no loyalty cards yet"),
 * points balance displayed, stamp card rendered with programme type,
 * progress bar percentage, "Ready to redeem!" vs "X to go" text,
 * and the page heading.
 *
 * Note: the current LoyaltyPage does not render a "Redeem" button — the API
 * call tested in the spec description maps to the progress-bar flow. Tests
 * reflect the actual rendered output of the source component.
 */

import { render, screen, waitFor } from '@testing-library/react'
import LoyaltyPage from '../page'

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('@/lib/api', () => ({
  consumers: {
    getLoyalty: jest.fn(),
  },
}))

const mockGetLoyalty = jest.requireMock('@/lib/api').consumers.getLoyalty as jest.Mock

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const pointsBalance = {
  merchant_id:      'merch-001',
  merchant_name:    'Java House',
  reward_type:      'POINTS' as const,
  points_balance:   750,
  stamps_balance:   0,
  lifetime_points:  1200,
  lifetime_stamps:  0,
  redeem_threshold: 1000,
}

const stampsBalance = {
  merchant_id:      'merch-002',
  merchant_name:    'Artcaffe',
  reward_type:      'STAMPS' as const,
  points_balance:   0,
  stamps_balance:   8,
  lifetime_points:  0,
  lifetime_stamps:  30,
  redeem_threshold: 10,
}

const redeemableBalance = {
  merchant_id:      'merch-003',
  merchant_name:    'Nairobi Java',
  reward_type:      'POINTS' as const,
  points_balance:   1000,
  stamps_balance:   0,
  lifetime_points:  2000,
  lifetime_stamps:  0,
  redeem_threshold: 1000,
}

beforeEach(() => jest.clearAllMocks())

// ─── Loading state ────────────────────────────────────────────────────────────

describe('LoyaltyPage loading', () => {
  it('shows loading indicator before data resolves', () => {
    mockGetLoyalty.mockReturnValue(new Promise(() => {}))
    render(<LoyaltyPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('removes loading indicator once data resolves', async () => {
    mockGetLoyalty.mockResolvedValue({ balances: [] })
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    )
  })
})

// ─── Page heading ─────────────────────────────────────────────────────────────

describe('LoyaltyPage heading', () => {
  it('renders the "Loyalty rewards" heading', async () => {
    mockGetLoyalty.mockResolvedValue({ balances: [] })
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /loyalty rewards/i })).toBeInTheDocument()
    )
  })
})

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('LoyaltyPage empty state', () => {
  it('shows the "no loyalty cards yet" message when balances is empty', async () => {
    mockGetLoyalty.mockResolvedValue({ balances: [] })
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText(/no loyalty cards yet/i)).toBeInTheDocument()
    )
  })

  it('does not show empty state when there are balances', async () => {
    mockGetLoyalty.mockResolvedValue({ balances: [pointsBalance] })
    render(<LoyaltyPage />)
    await waitFor(() => screen.getByText('Java House'))
    expect(screen.queryByText(/no loyalty cards yet/i)).not.toBeInTheDocument()
  })
})

// ─── Error state ──────────────────────────────────────────────────────────────

describe('LoyaltyPage error state', () => {
  it('shows error message when getLoyalty fails', async () => {
    mockGetLoyalty.mockRejectedValue(new Error('Network failure'))
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText(/failed to load loyalty rewards/i)).toBeInTheDocument()
    )
  })

  it('does not show empty-state message on error', async () => {
    mockGetLoyalty.mockRejectedValue(new Error('Network failure'))
    render(<LoyaltyPage />)
    await waitFor(() => screen.getByText(/failed to load loyalty rewards/i))
    expect(screen.queryByText(/no loyalty cards yet/i)).not.toBeInTheDocument()
  })

  it('hides the loading indicator after a failed fetch', async () => {
    mockGetLoyalty.mockRejectedValue(new Error('Network failure'))
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    )
  })
})

// ─── Points card ──────────────────────────────────────────────────────────────

describe('LoyaltyPage points card', () => {
  beforeEach(() => {
    mockGetLoyalty.mockResolvedValue({ balances: [pointsBalance] })
  })

  it('renders the merchant name', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText('Java House')).toBeInTheDocument()
    )
  })

  it('renders "Points programme" label', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText(/points programme/i)).toBeInTheDocument()
    )
  })

  it('displays the points balance', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText('750')).toBeInTheDocument()
    )
  })

  it('displays the "pts" unit label', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText('pts')).toBeInTheDocument()
    )
  })

  it('shows "250 to go" progress text (1000 - 750)', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText(/250 to go/i)).toBeInTheDocument()
    )
  })

  it('shows 75% progress percentage', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText('75%')).toBeInTheDocument()
    )
  })

  it('renders the progress bar with 75% width style', async () => {
    render(<LoyaltyPage />)
    await waitFor(() => screen.getByText('75%'))
    // The filled inner div has an inline style width
    const bars = document.querySelectorAll('.bg-green-500.h-2.rounded-full')
    const matchingBar = Array.from(bars).find(
      el => (el as HTMLElement).style.width === '75%'
    )
    expect(matchingBar).toBeTruthy()
  })
})

// ─── Stamps card ──────────────────────────────────────────────────────────────

describe('LoyaltyPage stamps card', () => {
  beforeEach(() => {
    mockGetLoyalty.mockResolvedValue({ balances: [stampsBalance] })
  })

  it('renders the merchant name for stamps card', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText('Artcaffe')).toBeInTheDocument()
    )
  })

  it('renders "Stamps programme" label', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText(/stamps programme/i)).toBeInTheDocument()
    )
  })

  it('displays the stamps balance', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText('8')).toBeInTheDocument()
    )
  })

  it('displays the "stamps" unit label', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText('stamps')).toBeInTheDocument()
    )
  })

  it('shows "2 to go" progress text (10 - 8)', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText(/2 to go/i)).toBeInTheDocument()
    )
  })

  it('shows 80% progress percentage', async () => {
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText('80%')).toBeInTheDocument()
    )
  })
})

// ─── Ready to redeem ─────────────────────────────────────────────────────────

describe('LoyaltyPage ready to redeem', () => {
  it('shows "Ready to redeem!" when balance meets threshold', async () => {
    mockGetLoyalty.mockResolvedValue({ balances: [redeemableBalance] })
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText(/ready to redeem!/i)).toBeInTheDocument()
    )
  })

  it('shows 100% progress when balance meets threshold', async () => {
    mockGetLoyalty.mockResolvedValue({ balances: [redeemableBalance] })
    render(<LoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText('100%')).toBeInTheDocument()
    )
  })
})

// ─── Multiple merchants ───────────────────────────────────────────────────────

describe('LoyaltyPage multiple merchant cards', () => {
  it('renders a card for each merchant in the balances array', async () => {
    mockGetLoyalty.mockResolvedValue({
      balances: [pointsBalance, stampsBalance, redeemableBalance],
    })
    render(<LoyaltyPage />)
    await waitFor(() => {
      expect(screen.getByText('Java House')).toBeInTheDocument()
      expect(screen.getByText('Artcaffe')).toBeInTheDocument()
      expect(screen.getByText('Nairobi Java')).toBeInTheDocument()
    })
  })
})

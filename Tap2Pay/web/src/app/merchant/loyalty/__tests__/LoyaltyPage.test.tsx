/**
 * Tests for the merchant loyalty programme page.
 *
 * Covers: loading state, POINTS vs STAMPS type selection, form fields,
 * existing programme pre-fill, save success / error feedback,
 * "no programme yet" banner, and API integration.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MerchantLoyaltyPage from '../page'

jest.mock('@/lib/api', () => ({
  merchants: {
    getLoyaltyProgramme: jest.fn(),
    saveLoyaltyProgramme: jest.fn(),
  },
}))

const mockGetLoyaltyProgramme  = jest.requireMock('@/lib/api').merchants.getLoyaltyProgramme  as jest.Mock
const mockSaveLoyaltyProgramme = jest.requireMock('@/lib/api').merchants.saveLoyaltyProgramme as jest.Mock

const pointsProgramme = {
  programme_type:    'POINTS',
  points_per_ksh:    1.5,
  stamps_for_reward: null,
  reward_description: 'Free coffee after 200 points',
  active:            true,
}

const stampsProgramme = {
  programme_type:    'STAMPS',
  points_per_ksh:    null,
  stamps_for_reward: 10,
  reward_description: 'Free meal every 10 visits',
  active:            true,
}

beforeEach(() => jest.clearAllMocks())

// ─── Loading state ────────────────────────────────────────────────────────────

describe('LoyaltyPage loading', () => {
  it('shows a loading message while fetching', () => {
    mockGetLoyaltyProgramme.mockReturnValue(new Promise(() => {}))
    render(<MerchantLoyaltyPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})

// ─── No programme yet ─────────────────────────────────────────────────────────

describe('LoyaltyPage no programme', () => {
  beforeEach(() => {
    mockGetLoyaltyProgramme.mockResolvedValue({ programme_type: null })
  })

  it('shows the page heading', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText('Loyalty Programme')).toBeInTheDocument()
    )
  })

  it('shows a "no programme yet" setup banner', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText(/you don't have a loyalty programme yet/i)).toBeInTheDocument()
    )
  })

  it('shows "Activate programme" as the submit button label', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /activate programme/i })).toBeInTheDocument()
    )
  })
})

// ─── Programme type toggle ────────────────────────────────────────────────────

describe('LoyaltyPage programme type selection', () => {
  beforeEach(() => {
    mockGetLoyaltyProgramme.mockResolvedValue({ programme_type: null })
  })

  it('renders both POINTS and STAMPS type buttons', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /points/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /stamps/i })).toBeInTheDocument()
    })
  })

  it('defaults to POINTS type and shows points-per-ksh input', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText(/points per ksh spent/i)).toBeInTheDocument()
    )
  })

  it('switches to STAMPS view when Stamps button is clicked', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() => screen.getByRole('button', { name: /stamps/i }))
    await userEvent.click(screen.getByRole('button', { name: /stamps/i }))
    await waitFor(() =>
      expect(screen.getByText(/stamps needed for a reward/i)).toBeInTheDocument()
    )
  })

  it('hides points-per-ksh input when STAMPS is selected', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() => screen.getByRole('button', { name: /stamps/i }))
    await userEvent.click(screen.getByRole('button', { name: /stamps/i }))
    await waitFor(() =>
      expect(screen.queryByText(/points per ksh spent/i)).not.toBeInTheDocument()
    )
  })
})

// ─── Existing POINTS programme ────────────────────────────────────────────────

describe('LoyaltyPage with existing POINTS programme', () => {
  beforeEach(() => {
    mockGetLoyaltyProgramme.mockResolvedValue(pointsProgramme)
  })

  it('pre-fills the points-per-ksh field', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() => {
      const input = screen.getByDisplayValue('1.5') as HTMLInputElement
      expect(input).toBeInTheDocument()
    })
  })

  it('pre-fills the reward description field', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByDisplayValue('Free coffee after 200 points')).toBeInTheDocument()
    )
  })

  it('shows "Update programme" as the submit button label', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /update programme/i })).toBeInTheDocument()
    )
  })

  it('does not show the "no programme" banner', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() => screen.getByText('Loyalty Programme'))
    expect(screen.queryByText(/you don't have a loyalty programme yet/i)).not.toBeInTheDocument()
  })
})

// ─── Existing STAMPS programme ────────────────────────────────────────────────

describe('LoyaltyPage with existing STAMPS programme', () => {
  beforeEach(() => {
    mockGetLoyaltyProgramme.mockResolvedValue(stampsProgramme)
  })

  it('pre-selects the STAMPS type and shows stamps field', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText(/stamps needed for a reward/i)).toBeInTheDocument()
    )
  })

  it('pre-fills the stamps-for-reward field', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() => {
      const input = screen.getByDisplayValue('10') as HTMLInputElement
      expect(input).toBeInTheDocument()
    })
  })
})

// ─── Save success ─────────────────────────────────────────────────────────────

describe('LoyaltyPage save success', () => {
  beforeEach(() => {
    mockGetLoyaltyProgramme.mockResolvedValue({ programme_type: null })
    mockSaveLoyaltyProgramme.mockResolvedValue({ success: true })
  })

  it('calls saveLoyaltyProgramme on form submit', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() => screen.getByRole('button', { name: /activate programme/i }))
    await userEvent.click(screen.getByRole('button', { name: /activate programme/i }))
    expect(mockSaveLoyaltyProgramme).toHaveBeenCalledTimes(1)
  })

  it('shows "Saved ✓" label after successful save', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() => screen.getByRole('button', { name: /activate programme/i }))
    await userEvent.click(screen.getByRole('button', { name: /activate programme/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument()
    )
  })
})

// ─── Save error ───────────────────────────────────────────────────────────────

describe('LoyaltyPage save error', () => {
  beforeEach(() => {
    mockGetLoyaltyProgramme.mockResolvedValue({ programme_type: null })
    mockSaveLoyaltyProgramme.mockRejectedValue(new Error('Programme save failed'))
  })

  it('shows error message when save fails', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() => screen.getByRole('button', { name: /activate programme/i }))
    await userEvent.click(screen.getByRole('button', { name: /activate programme/i }))
    await waitFor(() =>
      expect(screen.getByText(/programme save failed/i)).toBeInTheDocument()
    )
  })
})

// ─── Reward description field ─────────────────────────────────────────────────

describe('LoyaltyPage reward description field', () => {
  beforeEach(() => {
    mockGetLoyaltyProgramme.mockResolvedValue({ programme_type: null })
  })

  it('renders the reward description field', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() =>
      expect(screen.getByText(/reward description/i)).toBeInTheDocument()
    )
  })

  it('accepts text input in the reward description field', async () => {
    render(<MerchantLoyaltyPage />)
    await waitFor(() => screen.getByPlaceholderText(/free cup/i))
    await userEvent.type(screen.getByPlaceholderText(/free cup/i), 'Free samosa')
    expect(screen.getByDisplayValue('Free samosa')).toBeInTheDocument()
  })
})

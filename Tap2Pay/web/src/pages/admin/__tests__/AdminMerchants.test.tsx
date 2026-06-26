/**
 * Tests for the admin merchants page.
 *
 * Covers: loading state, error state, empty state ("No pending applications"),
 * merchant list rendering (name / email / phone / status badge),
 * approve / reject / suspend action buttons trigger admin.approveMerchant,
 * merchant is removed from list after a successful action,
 * disabled state while action is in-flight,
 * review notes input passed through to the API call,
 * and a Refresh button that re-fetches the list.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminMerchantsPage from '@/pages/admin/MerchantsPage'

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('@/lib/api', () => ({
  admin: {
    getPendingMerchants: jest.fn(),
    getAllMerchants:      jest.fn(),
    approveMerchant:     jest.fn(),
  },
}))

const mockGetPendingMerchants = jest.requireMock('@/lib/api').admin.getPendingMerchants as jest.Mock
const mockGetAllMerchants     = jest.requireMock('@/lib/api').admin.getAllMerchants     as jest.Mock
const mockApproveMerchant     = jest.requireMock('@/lib/api').admin.approveMerchant     as jest.Mock

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const merchant1 = {
  id:                   'merch-001',
  name:                 'Savannah Bistro',
  email:                'ops@savannah.ke',
  phone:                '0712345678',
  business_reg_number:  'BRN/2024/001',
  mpesa_shortcode:      '123456',
  created_at:           '2024-03-01T08:00:00Z',
  approval_status:      'PENDING_REVIEW',
}

const merchant2 = {
  id:                   'merch-002',
  name:                 'Roastery KE',
  email:                'hello@roastery.ke',
  phone:                '0798765432',
  business_reg_number:  null,
  mpesa_shortcode:      null,
  created_at:           '2024-03-05T10:30:00Z',
  approval_status:      'PENDING_REVIEW',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAllMerchants.mockResolvedValue({ merchants: [] })
})

// ─── Loading state ─────────────────────────────────────────────────────────────

describe('AdminMerchantsPage loading', () => {
  it('shows loading indicator before data resolves', () => {
    mockGetPendingMerchants.mockReturnValue(new Promise(() => {}))
    mockGetAllMerchants.mockReturnValue(new Promise(() => {}))
    render(<AdminMerchantsPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('removes loading indicator after data resolves', async () => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [] })
    render(<AdminMerchantsPage />)
    await waitFor(() =>
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    )
  })
})

// ─── Page heading ─────────────────────────────────────────────────────────────

describe('AdminMerchantsPage heading', () => {
  it('renders the "Merchants" heading', async () => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [] })
    render(<AdminMerchantsPage />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^merchants$/i })).toBeInTheDocument()
    )
  })
})

// ─── Error state ──────────────────────────────────────────────────────────────

describe('AdminMerchantsPage error state', () => {
  it('shows error message when getPendingMerchants fails', async () => {
    mockGetPendingMerchants.mockRejectedValue(new Error('Unauthorised'))
    render(<AdminMerchantsPage />)
    await waitFor(() =>
      expect(screen.getByText(/unauthorised/i)).toBeInTheDocument()
    )
  })

  it('does not show loading after a failed fetch', async () => {
    mockGetPendingMerchants.mockRejectedValue(new Error('Unauthorised'))
    render(<AdminMerchantsPage />)
    await waitFor(() =>
      expect(screen.queryByText(/loading applications/i)).not.toBeInTheDocument()
    )
  })
})

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('AdminMerchantsPage empty state', () => {
  it('shows "No pending applications" when list is empty', async () => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [] })
    render(<AdminMerchantsPage />)
    await waitFor(() =>
      expect(screen.getByText(/no pending applications/i)).toBeInTheDocument()
    )
  })

  it('does not render a merchant card when list is empty', async () => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [] })
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByText(/no pending applications/i))
    expect(screen.queryByText('Savannah Bistro')).not.toBeInTheDocument()
  })
})

// ─── Merchant list rendering ──────────────────────────────────────────────────

describe('AdminMerchantsPage merchant list rendering', () => {
  beforeEach(() => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [merchant1, merchant2] })
  })

  it('renders the merchant name', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() =>
      expect(screen.getByText('Savannah Bistro')).toBeInTheDocument()
    )
  })

  it('renders the merchant email', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() =>
      expect(screen.getByText('ops@savannah.ke')).toBeInTheDocument()
    )
  })

  it('renders the merchant phone', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() =>
      expect(screen.getByText('0712345678')).toBeInTheDocument()
    )
  })

  it('renders the approval_status badge', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() => {
      const badges = screen.getAllByText('PENDING_REVIEW')
      expect(badges.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders the business registration number when present', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() =>
      expect(screen.getByText(/BRN\/2024\/001/)).toBeInTheDocument()
    )
  })

  it('renders the M-Pesa shortcode when present', async () => {
    render(<AdminMerchantsPage />)
    // Use specific pattern — /123456/ alone also matches phone "0712345678"
    await waitFor(() =>
      expect(screen.getByText(/M-Pesa:.*123456/)).toBeInTheDocument()
    )
  })

  it('renders approve, reject, and suspend buttons for each merchant', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() => {
      const approveButtons = screen.getAllByRole('button', { name: /approve/i })
      const rejectButtons  = screen.getAllByRole('button', { name: /reject/i })
      const suspendButtons = screen.getAllByRole('button', { name: /suspend/i })
      expect(approveButtons).toHaveLength(2)
      expect(rejectButtons).toHaveLength(2)
      expect(suspendButtons).toHaveLength(2)
    })
  })

  it('renders both merchants', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() => {
      expect(screen.getByText('Savannah Bistro')).toBeInTheDocument()
      expect(screen.getByText('Roastery KE')).toBeInTheDocument()
    })
  })
})

// ─── Approve action ───────────────────────────────────────────────────────────

describe('AdminMerchantsPage approve action', () => {
  beforeEach(() => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [merchant1] })
    mockApproveMerchant.mockResolvedValue({})
  })

  it('calls approveMerchant with approve action when approve is clicked', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByText('Savannah Bistro'))
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    await waitFor(() =>
      expect(mockApproveMerchant).toHaveBeenCalledWith('merch-001', 'approve', undefined)
    )
  })

  it('removes the merchant card from the list after approve', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByText('Savannah Bistro'))
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    await waitFor(() =>
      expect(screen.queryByText('Savannah Bistro')).not.toBeInTheDocument()
    )
  })
})

// ─── Reject action ────────────────────────────────────────────────────────────

describe('AdminMerchantsPage reject action', () => {
  beforeEach(() => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [merchant1] })
    mockApproveMerchant.mockResolvedValue({})
  })

  it('calls approveMerchant with reject action when reject is clicked', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByText('Savannah Bistro'))
    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }))
    await waitFor(() =>
      expect(mockApproveMerchant).toHaveBeenCalledWith('merch-001', 'reject', undefined)
    )
  })

  it('removes the merchant card from the list after reject', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByText('Savannah Bistro'))
    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }))
    await waitFor(() =>
      expect(screen.queryByText('Savannah Bistro')).not.toBeInTheDocument()
    )
  })
})

// ─── Suspend action ───────────────────────────────────────────────────────────

describe('AdminMerchantsPage suspend action', () => {
  beforeEach(() => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [merchant1] })
    mockApproveMerchant.mockResolvedValue({})
  })

  it('calls approveMerchant with suspend action when suspend is clicked', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByText('Savannah Bistro'))
    await userEvent.click(screen.getByRole('button', { name: /^suspend$/i }))
    await waitFor(() =>
      expect(mockApproveMerchant).toHaveBeenCalledWith('merch-001', 'suspend', undefined)
    )
  })
})

// ─── Review notes ─────────────────────────────────────────────────────────────

describe('AdminMerchantsPage review notes', () => {
  it('passes review notes to approveMerchant when provided', async () => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [merchant1] })
    mockApproveMerchant.mockResolvedValue({})
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByText('Savannah Bistro'))
    const notesInput = screen.getByPlaceholderText(/kyc verified/i)
    await userEvent.type(notesInput, 'Documents verified, KYC complete')
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    await waitFor(() =>
      expect(mockApproveMerchant).toHaveBeenCalledWith(
        'merch-001',
        'approve',
        'Documents verified, KYC complete'
      )
    )
  })
})

// ─── Disabled state during action ─────────────────────────────────────────────

describe('AdminMerchantsPage disabled state during action', () => {
  it('disables action buttons while an action is in-flight', async () => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [merchant1] })
    mockApproveMerchant.mockReturnValue(new Promise(() => {}))  // never resolves
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByText('Savannah Bistro'))
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    await waitFor(() => {
      // All 3 action buttons show "…" while in-flight — use getAllByRole
      const buttons = screen.getAllByRole('button', { name: /^…$/ })
      expect(buttons.length).toBeGreaterThanOrEqual(1)
      buttons.forEach(btn => expect(btn).toBeDisabled())
    })
  })
})

// ─── Action error ─────────────────────────────────────────────────────────────

describe('AdminMerchantsPage action error', () => {
  it('shows an error message when approveMerchant fails', async () => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [merchant1] })
    mockApproveMerchant.mockRejectedValue(new Error('Permission denied'))
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByText('Savannah Bistro'))
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    await waitFor(() =>
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument()
    )
  })

  it('keeps the merchant in the list when approveMerchant fails', async () => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [merchant1] })
    mockApproveMerchant.mockRejectedValue(new Error('Permission denied'))
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByText('Savannah Bistro'))
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    await waitFor(() => screen.getByText(/permission denied/i))
    expect(screen.getByText('Savannah Bistro')).toBeInTheDocument()
  })
})

// ─── Refresh button ───────────────────────────────────────────────────────────

describe('AdminMerchantsPage refresh button', () => {
  it('re-fetches the merchant list when Refresh is clicked', async () => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [] })
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByRole('button', { name: /refresh/i }))
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))
    await waitFor(() =>
      expect(mockGetPendingMerchants).toHaveBeenCalledTimes(2)
    )
  })
})

// ─── Onboarded tab ────────────────────────────────────────────────────────────

describe('AdminMerchantsPage onboarded tab', () => {
  const onboardedMerchant = {
    id:                  'merch-010',
    name:                'Active Coffee',
    email:               'hi@activecoffee.ke',
    phone:               '0722111222',
    business_reg_number: 'BRN/2024/010',
    mpesa_shortcode:     '888999',
    created_at:          '2024-01-15T00:00:00Z',
    approval_status:     'APPROVED',
    active:              true,
    live:                true,
  }

  beforeEach(() => {
    mockGetPendingMerchants.mockResolvedValue({ merchants: [] })
    mockGetAllMerchants.mockResolvedValue({ merchants: [onboardedMerchant] })
  })

  it('shows onboarded merchant name in the table when onboarded tab is clicked', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByRole('button', { name: /onboarded/i }))
    await userEvent.click(screen.getByRole('button', { name: /onboarded/i }))
    await waitFor(() =>
      expect(screen.getByText('Active Coffee')).toBeInTheDocument()
    )
  })

  it('shows table column headers when onboarded tab is active and has data', async () => {
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByRole('button', { name: /onboarded/i }))
    await userEvent.click(screen.getByRole('button', { name: /onboarded/i }))
    await waitFor(() => screen.getByText('Active Coffee'))
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Contact')).toBeInTheDocument()
  })

  it('shows "No onboarded merchants yet" when onboarded list is empty', async () => {
    mockGetAllMerchants.mockResolvedValue({ merchants: [] })
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByRole('button', { name: /onboarded/i }))
    await userEvent.click(screen.getByRole('button', { name: /onboarded/i }))
    await waitFor(() =>
      expect(screen.getByText(/no onboarded merchants yet/i)).toBeInTheDocument()
    )
  })

  it('shows offline dot for merchant with live=false', async () => {
    const offlineMerchant = { ...onboardedMerchant, id: 'merch-011', live: false }
    mockGetAllMerchants.mockResolvedValue({ merchants: [offlineMerchant] })
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByRole('button', { name: /onboarded/i }))
    await userEvent.click(screen.getByRole('button', { name: /onboarded/i }))
    await waitFor(() => screen.getByText('Active Coffee'))
    const dot = document.querySelector('.bg-slate-700')
    expect(dot).toBeInTheDocument()
  })

  it('shows em-dash for missing mpesa_shortcode', async () => {
    const noShortcode = { ...onboardedMerchant, id: 'merch-012', mpesa_shortcode: null }
    mockGetAllMerchants.mockResolvedValue({ merchants: [noShortcode] })
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByRole('button', { name: /onboarded/i }))
    await userEvent.click(screen.getByRole('button', { name: /onboarded/i }))
    await waitFor(() => screen.getByText('Active Coffee'))
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('uses default badge variant for unknown approval_status', async () => {
    const unknownStatus = { ...onboardedMerchant, id: 'merch-013', approval_status: 'UNKNOWN_STATUS' }
    mockGetAllMerchants.mockResolvedValue({ merchants: [unknownStatus] })
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByRole('button', { name: /onboarded/i }))
    await userEvent.click(screen.getByRole('button', { name: /onboarded/i }))
    await waitFor(() =>
      expect(screen.getByText('UNKNOWN_STATUS')).toBeInTheDocument()
    )
  })

  it('shows empty state when getAllMerchants response has no merchants key', async () => {
    mockGetAllMerchants.mockResolvedValue({})
    render(<AdminMerchantsPage />)
    await waitFor(() => screen.getByRole('button', { name: /onboarded/i }))
    await userEvent.click(screen.getByRole('button', { name: /onboarded/i }))
    await waitFor(() =>
      expect(screen.getByText(/no onboarded merchants yet/i)).toBeInTheDocument()
    )
  })

  it('shows empty pending when getPendingMerchants response has no merchants key', async () => {
    mockGetPendingMerchants.mockResolvedValue({})
    mockGetAllMerchants.mockResolvedValue({ merchants: [] })
    render(<AdminMerchantsPage />)
    await waitFor(() =>
      expect(screen.getByText(/no pending applications/i)).toBeInTheDocument()
    )
  })
})

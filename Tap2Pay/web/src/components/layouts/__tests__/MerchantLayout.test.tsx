/**
 * Tests for src/components/layouts/MerchantLayout.tsx
 *
 * Covers: redirect when role != MERCHANT, nav items, sign-out,
 * KYC banners (pending/rejected/under-review), mobile sidebar toggle.
 */
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MerchantLayout from '@/components/layouts/MerchantLayout'

const mockNavigate = jest.fn()

jest.mock('react-router-dom', () => ({
  NavLink: ({ to, children, className }: any) => {
    // Call with both values to exercise both branches of isActive ternary
    if (typeof className === 'function') { className({ isActive: true }); className({ isActive: false }) }
    return <a href={to} className={typeof className === 'function' ? className({ isActive: false }) : className}>{children}</a>
  },
  Outlet:     () => <div data-testid="outlet">Outlet</div>,
  useNavigate: () => mockNavigate,
  Navigate:   ({ to }: { to: string }) => <div data-testid={`navigate-${to.replace(/\//g, '-')}`} />,
}))

jest.mock('@/lib/auth', () => ({
  getRole:    jest.fn(),
  clearToken: jest.fn(),
}))

jest.mock('@/lib/api', () => ({
  kyc: {
    status: jest.fn(),
  },
}))

const mockGetRole    = jest.requireMock('@/lib/auth').getRole    as jest.Mock
const mockClearToken = jest.requireMock('@/lib/auth').clearToken as jest.Mock
const mockKycStatus  = jest.requireMock('@/lib/api').kyc.status  as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockKycStatus.mockResolvedValue({ kycStatus: 'NOT_SUBMITTED', approvalStatus: 'PENDING_REVIEW' })
})

describe('MerchantLayout — wrong role', () => {
  it('redirects to /auth/login when role is not MERCHANT', () => {
    mockGetRole.mockReturnValue('CONSUMER')
    render(<MerchantLayout />)
    expect(screen.getByTestId('navigate--auth-login')).toBeInTheDocument()
  })
})

describe('MerchantLayout — authenticated MERCHANT', () => {
  beforeEach(() => mockGetRole.mockReturnValue('MERCHANT'))

  it('renders Dashboard nav item', async () => {
    render(<MerchantLayout />)
    await waitFor(() =>
      expect(screen.getByText('Dashboard')).toBeInTheDocument()
    )
  })

  it('renders Scan Tag nav item', async () => {
    render(<MerchantLayout />)
    await waitFor(() =>
      expect(screen.getByText('Scan Tag')).toBeInTheDocument()
    )
  })

  it('renders the Outlet', async () => {
    render(<MerchantLayout />)
    await waitFor(() =>
      expect(screen.getByTestId('outlet')).toBeInTheDocument()
    )
  })

  it('clears token and navigates on sign out', async () => {
    render(<MerchantLayout />)
    await waitFor(() => screen.getByText(/sign out/i))
    await userEvent.click(screen.getByText(/sign out/i))
    expect(mockClearToken).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/auth/login')
  })

  it('toggles mobile sidebar open when hamburger button is clicked', async () => {
    render(<MerchantLayout />)
    const menuBtn = screen.getByRole('button', { name: '' })
    await userEvent.click(menuBtn)
    // Overlay div appears when sidebar is open
    const overlay = document.querySelector('.fixed.inset-0.z-30')
    expect(overlay).toBeInTheDocument()
  })

  it('closes sidebar when overlay is clicked', async () => {
    render(<MerchantLayout />)
    const menuBtn = screen.getByRole('button', { name: '' })
    await userEvent.click(menuBtn)
    const overlay = document.querySelector('.fixed.inset-0.z-30') as HTMLElement
    await userEvent.click(overlay)
    expect(document.querySelector('.fixed.inset-0.z-30')).not.toBeInTheDocument()
  })
})

describe('MerchantLayout — KYC banners', () => {
  beforeEach(() => mockGetRole.mockReturnValue('MERCHANT'))

  it('shows amber KYC banner for NOT_SUBMITTED + PENDING_REVIEW', async () => {
    mockKycStatus.mockResolvedValue({ kycStatus: 'NOT_SUBMITTED', approvalStatus: 'PENDING_REVIEW' })
    render(<MerchantLayout />)
    await waitFor(() =>
      expect(screen.getByText(/submit kyc documents/i)).toBeInTheDocument()
    )
  })

  it('shows "Documents submitted" banner for SUBMITTED + PENDING_REVIEW', async () => {
    mockKycStatus.mockResolvedValue({ kycStatus: 'SUBMITTED', approvalStatus: 'PENDING_REVIEW' })
    render(<MerchantLayout />)
    await waitFor(() =>
      expect(screen.getByText(/documents submitted/i)).toBeInTheDocument()
    )
  })

  it('shows rejected banner for REJECTED approval', async () => {
    mockKycStatus.mockResolvedValue({ kycStatus: 'REJECTED', approvalStatus: 'REJECTED', kycNotes: 'ID expired' })
    render(<MerchantLayout />)
    await waitFor(() =>
      expect(screen.getByText(/kyc not approved/i)).toBeInTheDocument()
    )
  })

  it('shows kycNotes in rejected banner when provided', async () => {
    mockKycStatus.mockResolvedValue({ kycStatus: 'REJECTED', approvalStatus: 'REJECTED', kycNotes: 'ID expired' })
    render(<MerchantLayout />)
    await waitFor(() =>
      expect(screen.getByText(/ID expired/)).toBeInTheDocument()
    )
  })

  it('shows rejected banner without reason when kycNotes is absent', async () => {
    mockKycStatus.mockResolvedValue({ kycStatus: 'REJECTED', approvalStatus: 'REJECTED' })
    render(<MerchantLayout />)
    await waitFor(() =>
      expect(screen.getByText(/kyc not approved/i)).toBeInTheDocument()
    )
    expect(screen.queryByText(/reason:/i)).not.toBeInTheDocument()
  })

  it('shows under-review banner for UNDER_REVIEW status', async () => {
    mockKycStatus.mockResolvedValue({ kycStatus: 'UNDER_REVIEW', approvalStatus: 'APPROVED' })
    render(<MerchantLayout />)
    await waitFor(() =>
      expect(screen.getByText(/under review/i)).toBeInTheDocument()
    )
  })

  it('shows KYC indicator dot on KYC nav item when banner is active', async () => {
    mockKycStatus.mockResolvedValue({ kycStatus: 'NOT_SUBMITTED', approvalStatus: 'PENDING_REVIEW' })
    render(<MerchantLayout />)
    await waitFor(() => {
      const dot = document.querySelector('.bg-amber-400')
      expect(dot).toBeInTheDocument()
    })
  })
})

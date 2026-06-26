/**
 * Tests for src/components/layouts/ConsumerLayout.tsx
 *
 * Covers: redirect when role != CONSUMER, nav items rendered,
 * sign-out clears token and navigates.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConsumerLayout from '@/components/layouts/ConsumerLayout'

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

const mockGetRole    = jest.requireMock('@/lib/auth').getRole    as jest.Mock
const mockClearToken = jest.requireMock('@/lib/auth').clearToken as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('ConsumerLayout — wrong role', () => {
  it('redirects to /auth/login when role is not CONSUMER', () => {
    mockGetRole.mockReturnValue('MERCHANT')
    render(<ConsumerLayout />)
    expect(screen.getByTestId('navigate--auth-login')).toBeInTheDocument()
  })

  it('does not render nav when not authenticated as CONSUMER', () => {
    mockGetRole.mockReturnValue(null)
    render(<ConsumerLayout />)
    expect(screen.queryByText('Home')).not.toBeInTheDocument()
  })
})

describe('ConsumerLayout — authenticated CONSUMER', () => {
  beforeEach(() => mockGetRole.mockReturnValue('CONSUMER'))

  it('renders the Home nav link', () => {
    render(<ConsumerLayout />)
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('renders the Pay nav link', () => {
    render(<ConsumerLayout />)
    expect(screen.getByRole('link', { name: 'Pay' })).toBeInTheDocument()
  })

  it('renders the Loyalty nav link', () => {
    render(<ConsumerLayout />)
    expect(screen.getByText('Loyalty')).toBeInTheDocument()
  })

  it('renders the Profile nav link', () => {
    render(<ConsumerLayout />)
    expect(screen.getByText('Profile')).toBeInTheDocument()
  })

  it('renders the Outlet', () => {
    render(<ConsumerLayout />)
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('clears token and navigates on sign out', async () => {
    render(<ConsumerLayout />)
    await userEvent.click(screen.getByText('Out'))
    expect(mockClearToken).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/auth/login')
  })
})
